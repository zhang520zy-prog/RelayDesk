//! 中转站业务编排：登录/账号信息/分组模型/一键应用。
//!
//! 一键应用链路（对应用户流程：点模型 → 自动建 key → 下发全部 agent）：
//! 1. 确保该分组存在 `relaydesk-<group>` 专用令牌（无则静默创建），取完整 sk- key
//! 2. upsert `relay-<group>` 统一供应商（同分组内换模型复用，跨分组各一条目）
//! 3. sync_universal_to_apps 生成/更新 Claude·Codex·Gemini 子供应商
//! 4. 对每个启用应用执行 switch（未激活时）写入 live 配置

use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

use super::client::RelayClient;
use super::credentials::{SavedLogin, SavedLoginInfo};
use super::types::{
    RelayAccount, RelayAccountInfo, RelayAppliedModel, RelayApplyApps, RelayApplyResult,
    RelayGroup, RelayGroupModels, RelayGroupToken, RelayToken, RelayTopupAmountOption,
    RelayTopupHistory, RelayTopupInfo, RelayTopupOrder, RelayTopupPaymentMethod, RelayTopupQuote,
    RelayUsageModelRow, RelayUsageModels, RelayUsageOverview, RelayUsageQuery, TOKEN_NAME_PREFIX,
    UNIVERSAL_ID_PREFIX,
};
use crate::app_config::AppType;
use crate::error::AppError;
use crate::provider::{ClaudeModelConfig, CodexModelConfig, GeminiModelConfig, UniversalProvider};
use crate::services::ProviderService;
use crate::store::AppState;

pub struct RelayService;

#[derive(Debug, Default)]
struct ApplyGate {
    active: AtomicBool,
}

#[derive(Debug)]
struct ApplyPermit<'a> {
    gate: &'a ApplyGate,
}

impl ApplyGate {
    fn try_enter(&self) -> Result<ApplyPermit<'_>, AppError> {
        self.active
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| ApplyPermit { gate: self })
            .map_err(|_| AppError::Message("relay.busy".to_string()))
    }
}

impl Drop for ApplyPermit<'_> {
    fn drop(&mut self) {
        self.gate.active.store(false, Ordering::Release);
    }
}

fn apply_gate() -> &'static ApplyGate {
    static GATE: OnceLock<ApplyGate> = OnceLock::new();
    GATE.get_or_init(ApplyGate::default)
}

fn resolve_apply_targets(
    apps: &RelayApplyApps,
    target_apps: Option<&[String]>,
) -> Result<Vec<AppType>, AppError> {
    let candidates = [
        (AppType::Claude, apps.claude),
        (AppType::Codex, apps.codex),
        (AppType::Gemini, apps.gemini),
    ];
    let targets: Vec<AppType> = match target_apps {
        Some(selected) => {
            for target in selected {
                if !candidates
                    .iter()
                    .any(|(app, _)| app.as_str() == target.as_str())
                {
                    return Err(AppError::Message("relay.invalid_target".to_string()));
                }
            }
            candidates
                .into_iter()
                .filter(|(app, enabled)| *enabled && selected.iter().any(|t| t == app.as_str()))
                .map(|(app, _)| app)
                .collect()
        }
        None => candidates
            .into_iter()
            .filter_map(|(app, enabled)| enabled.then_some(app))
            .collect(),
    };
    if targets.is_empty() {
        Err(AppError::Message("relay.no_targets".to_string()))
    } else {
        Ok(targets)
    }
}

fn run_target_plan(
    account: &mut RelayAccount,
    targets: Vec<AppType>,
    group: &str,
    model: &str,
    mut apply: impl FnMut(AppType) -> RelayApplyResult,
) -> Vec<RelayApplyResult> {
    let results: Vec<_> = targets.into_iter().map(&mut apply).collect();
    if results.iter().any(|result| result.ok) {
        account.last_applied = Some(RelayAppliedModel {
            group: group.to_string(),
            model: model.to_string(),
        });
        account.updated_at = now_ts();
    }
    results
}

impl RelayService {
    // ── 账号链路 ────────────────────────────────────────────

    fn set_session(state: &AppState, account: Option<RelayAccount>) -> Result<(), AppError> {
        *state
            .relay_session
            .write()
            .map_err(|_| AppError::Message("relay.session_lock_failed".into()))? = account;
        Ok(())
    }

    /// Only account metadata and local preferences are persisted. The access
    /// token remains in the process session or the separate encrypted vault.
    fn persist_snapshot(
        state: &AppState,
        account: &RelayAccount,
    ) -> Result<RelayAccount, AppError> {
        let mut snapshot = account.clone();
        snapshot.access_token.clear();
        state.db.save_relay_account(&snapshot)?;
        Ok(snapshot)
    }

    /// Commit a metadata/local-preference update only while the same in-memory
    /// credential session is still active. The database deliberately contains
    /// no access token, so this compare-and-swap must happen against the
    /// process session rather than a persisted snapshot.
    fn commit_session_update<F>(
        state: &AppState,
        expected: &RelayAccount,
        update: F,
    ) -> Result<RelayAccount, AppError>
    where
        F: FnOnce(&mut RelayAccount),
    {
        let mut session = state
            .relay_session
            .write()
            .map_err(|_| AppError::Message("relay.session_lock_failed".into()))?;
        let Some(current) = session.as_ref() else {
            return Err(session_expired_error());
        };
        if !same_active_session(current, expected) {
            return Err(session_expired_error());
        }
        let mut candidate = current.clone();
        update(&mut candidate);
        let _ = Self::persist_snapshot(state, &candidate)?;
        *session = Some(candidate.clone());
        Ok(candidate)
    }

    /// 登录：密码 → JWT → 系统访问令牌 → 用户信息 → 落库
    pub async fn login(
        state: &AppState,
        base_url: &str,
        username: &str,
        password: &str,
        remember: bool,
    ) -> Result<RelayAccountInfo, AppError> {
        // Prevent overlapping submissions, without imposing a delay on a
        // user's next manual attempt. Agent test pacing belongs in AGENTS.md.
        let _permit = state
            .relay_auth_gate
            .try_lock()
            .map_err(|_| AppError::Message("relay.busy".into()))?;
        Self::login_session(state, base_url, username, password, remember).await
    }

    async fn login_session(
        state: &AppState,
        base_url: &str,
        username: &str,
        password: &str,
        remember: bool,
    ) -> Result<RelayAccountInfo, AppError> {
        let login = RelayClient::login(base_url, username, password).await?;

        // 换长效系统访问令牌；失败则降级用 15min JWT（下次 refresh 时会自然失效，提示重登）
        let jwt_client = RelayClient::new(base_url, &login.access_token);
        let access_token = jwt_client.system_token().await.unwrap_or_else(|_| {
            log::warn!("获取系统访问令牌失败，降级使用短期登录凭据");
            login.access_token.clone()
        });

        let client = RelayClient::new(base_url, &access_token);
        let self_user = client.user_self().await.unwrap_or_else(|_| {
            log::warn!("登录后获取用户信息失败");
            json!({})
        });

        let mut account = RelayAccount {
            base_url: client.base_url().to_string(),
            access_token,
            remembered: remember,
            user_id: extract_i64(&self_user, "id"),
            username: extract_str(&self_user, "username").unwrap_or_else(|| username.to_string()),
            quota: extract_i64(&self_user, "quota").unwrap_or(0),
            used_quota: extract_i64(&self_user, "used_quota").unwrap_or(0),
            currency: client.currency_config().await.unwrap_or_default(),
            group: extract_str(&self_user, "group").unwrap_or_default(),
            apply_apps: RelayApplyApps::default(),
            group_targets: Default::default(),
            group_tokens: Default::default(),
            last_applied: None,
            updated_at: now_ts(),
        };
        // The password never leaves this call. When requested, retain only the
        // encrypted long-lived token in the app-local vault; a vault failure
        // must not turn a valid one-session login into a failed login.
        if remember {
            if Self::save_remembered(state, &account).is_err() {
                log::warn!("无法保存中转站记住登录信息");
                account.remembered = false;
            }
        }
        // remember=false 只表示本次不保存。既有保存记录只能由 forget_login
        // 显式删除——一次未勾选不能意外清掉用户已保存的账号。
        let mut persisted = account.clone();
        persisted.access_token.clear();
        let persisted = state.db.save_relay_login_preserving_local(&persisted)?;
        // Preserve local routing preferences while keeping the freshly issued
        // token exclusively in memory.
        let mut active = account;
        active.apply_apps = persisted.apply_apps;
        active.group_targets = persisted.group_targets;
        active.group_tokens = persisted.group_tokens;
        active.last_applied = persisted.last_applied;
        state.db.set_setting("relay_signed_out", "false")?;
        Self::set_session(state, Some(active.clone()))?;
        Ok(active.to_info())
    }

    fn save_remembered(state: &AppState, account: &RelayAccount) -> Result<(), AppError> {
        let saved = SavedLogin::new(
            &account.base_url,
            &account.username,
            account.user_id,
            &account.access_token,
            account.updated_at,
        );
        state
            .relay_vault
            .lock()
            .map_err(|_| AppError::Message("relay.saved_login_storage_failed".to_string()))?
            .upsert(saved)
    }

    fn remove_remembered(state: &AppState, account: &RelayAccount) -> Result<(), AppError> {
        state
            .relay_vault
            .lock()
            .map_err(|_| AppError::Message("relay.saved_login_storage_failed".to_string()))?
            .remove_for_user(&account.base_url, &account.username, account.user_id)?;
        Ok(())
    }

    pub(crate) fn saved_logins(state: &AppState) -> Result<Vec<SavedLoginInfo>, AppError> {
        state
            .relay_vault
            .lock()
            .map_err(|_| AppError::Message("relay.saved_login_storage_failed".to_string()))?
            .list()
    }

    async fn activate_access_token(
        state: &AppState,
        base_url: &str,
        access_token: &str,
        remembered: bool,
        saved: &SavedLogin,
    ) -> Result<RelayAccountInfo, AppError> {
        let client = RelayClient::new(base_url, access_token);
        let self_user = client.user_self().await?;
        if saved.user_id.is_some() && extract_i64(&self_user, "id") != saved.user_id {
            return Err(session_expired_error());
        }
        if saved.user_id.is_none() {
            let current_username = extract_str(&self_user, "username");
            if !current_username
                .as_deref()
                .is_some_and(|name| name.eq_ignore_ascii_case(&saved.username))
            {
                return Err(session_expired_error());
            }
        }
        let mut account = RelayAccount {
            base_url: client.base_url().to_string(),
            access_token: access_token.to_string(),
            remembered,
            user_id: extract_i64(&self_user, "id"),
            username: extract_str(&self_user, "username")
                .or_else(|| Some(saved.username.clone()))
                .unwrap_or_default(),
            quota: extract_i64(&self_user, "quota").unwrap_or(0),
            used_quota: extract_i64(&self_user, "used_quota").unwrap_or(0),
            currency: client.currency_config().await.unwrap_or_default(),
            group: extract_str(&self_user, "group").unwrap_or_default(),
            apply_apps: RelayApplyApps::default(),
            group_targets: Default::default(),
            group_tokens: Default::default(),
            last_applied: None,
            updated_at: now_ts(),
        };
        let mut persisted = account.clone();
        persisted.access_token.clear();
        let persisted = state.db.save_relay_login_preserving_local(&persisted)?;
        account.apply_apps = persisted.apply_apps;
        account.group_targets = persisted.group_targets;
        account.group_tokens = persisted.group_tokens;
        account.last_applied = persisted.last_applied;
        account.updated_at = persisted.updated_at;
        state.db.set_setting("relay_signed_out", "false")?;
        Self::set_session(state, Some(account.clone()))?;
        Ok(account.to_info())
    }

    /// 返回当前进程会话；重启恢复由 `restore` 完成。
    pub fn account(state: &AppState) -> Result<Option<RelayAccountInfo>, AppError> {
        Ok(state
            .relay_session
            .read()
            .map_err(|_| AppError::Message("relay.session_lock_failed".into()))?
            .clone()
            .map(|a| a.to_info()))
    }

    /// Read only the current in-memory session; never auto-select a saved account.
    pub async fn restore(state: &AppState) -> Result<Option<RelayAccountInfo>, AppError> {
        Self::account(state)
    }

    /// Restore only the account explicitly selected by the user.
    pub async fn restore_saved(
        state: &AppState,
        saved_id: &str,
    ) -> Result<Option<RelayAccountInfo>, AppError> {
        let _permit = state
            .relay_auth_gate
            .try_lock()
            .map_err(|_| AppError::Message("relay.busy".into()))?;
        let saved = state
            .relay_vault
            .lock()
            .map_err(|_| AppError::Message("relay.saved_login_storage_failed".to_string()))?
            .get(saved_id)?;
        let Some(saved) = saved else {
            return Ok(None);
        };
        match Self::activate_access_token(state, &saved.base_url, &saved.access_token, true, &saved)
            .await
        {
            Ok(account) => Ok(Some(account)),
            Err(error) if is_auth_error(&error) || error.to_string() == "relay.session_expired" => {
                let _ = state
                    .relay_vault
                    .lock()
                    .map_err(|_| AppError::Message("relay.saved_login_storage_failed".to_string()))?
                    .remove(saved_id);
                Err(AppError::Message("relay.saved_login_expired".to_string()))
            }
            Err(error) => Err(error),
        }
    }

    /// 刷新额度与账号信息
    pub async fn refresh_account(state: &AppState) -> Result<RelayAccountInfo, AppError> {
        let expected = require_account(state)?;
        let client = RelayClient::new(&expected.base_url, &expected.access_token);
        let self_user = client
            .user_self()
            .await
            .map_err(|error| authenticated_error(state, &expected, error))?;
        let refreshed_user_id = extract_i64(&self_user, "id");
        let refreshed_username = extract_str(&self_user, "username");
        let refreshed_quota = extract_i64(&self_user, "quota");
        let refreshed_used_quota = extract_i64(&self_user, "used_quota");
        let refreshed_group = extract_str(&self_user, "group");
        let refreshed_currency = client.currency_config().await.ok();
        let mut account = expected.clone();
        account.user_id = refreshed_user_id.or(account.user_id);
        if let Some(username) = refreshed_username {
            account.username = username;
        }
        if let Some(quota) = refreshed_quota {
            account.quota = quota;
        }
        if let Some(used_quota) = refreshed_used_quota {
            account.used_quota = used_quota;
        }
        if let Some(group) = refreshed_group {
            account.group = group;
        }
        if let Some(currency) = refreshed_currency {
            account.currency = currency;
        }
        account.updated_at = now_ts();
        let account = Self::commit_session_update(state, &expected, |current| {
            current.user_id = account.user_id;
            current.username = account.username.clone();
            current.quota = account.quota;
            current.used_quota = account.used_quota;
            current.group = account.group.clone();
            current.currency = account.currency.clone();
            current.updated_at = account.updated_at;
        })?;
        Ok(account.to_info())
    }

    pub fn logout(state: &AppState) -> Result<(), AppError> {
        let _permit = state
            .relay_auth_gate
            .try_lock()
            .map_err(|_| AppError::Message("relay.busy".into()))?;
        state.db.set_setting("relay_signed_out", "true")?;
        // Sign out of this session; only forget_login removes remembered accounts.
        Self::set_session(state, None)?;
        state.db.clear_relay_account()?;
        Ok(())
    }

    pub fn saved_login_name(state: &AppState) -> Result<Option<String>, AppError> {
        Ok(Self::saved_logins(state)?
            .into_iter()
            .next()
            .map(|account| account.username))
    }

    pub fn forget_login(state: &AppState, saved_id: Option<&str>) -> Result<(), AppError> {
        let _permit = state
            .relay_auth_gate
            .try_lock()
            .map_err(|_| AppError::Message("relay.busy".into()))?;
        state.db.set_setting("relay_signed_out", "true")?;
        if let Some(id) = saved_id {
            state
                .relay_vault
                .lock()
                .map_err(|_| AppError::Message("relay.saved_login_storage_failed".to_string()))?
                .remove(id)?;
        } else if let Some(account) = state
            .relay_session
            .read()
            .map_err(|_| AppError::Message("relay.session_lock_failed".into()))?
            .clone()
        {
            Self::remove_remembered(state, &account)?;
        }
        Ok(())
    }

    /// 设置应用下发目标
    pub fn set_apply_apps(
        state: &AppState,
        apps: RelayApplyApps,
    ) -> Result<RelayAccountInfo, AppError> {
        let mut account = require_account(state)?;
        account.apply_apps = apps;
        account.updated_at = now_ts();
        let account = Self::commit_session_update(state, &account, |current| {
            current.apply_apps = account.apply_apps.clone();
            current.updated_at = account.updated_at;
        })?;
        Ok(account.to_info())
    }

    /// 设置或清除一个分组的本地目标覆盖。
    pub fn set_group_target(
        state: &AppState,
        group: &str,
        target: Option<&str>,
    ) -> Result<RelayAccountInfo, AppError> {
        let group = group.trim();
        if group.is_empty() {
            return Err(AppError::Message("relay.invalid_group".to_string()));
        }
        if target.is_some_and(|target| !matches!(target, "claude" | "codex" | "gemini")) {
            return Err(AppError::Message("relay.invalid_target".to_string()));
        }
        let mut account = require_account(state)?;
        match target {
            Some(target) => {
                account
                    .group_targets
                    .insert(group.to_string(), target.to_string());
            }
            None => {
                account.group_targets.remove(group);
            }
        }
        account.updated_at = now_ts();
        let account = Self::commit_session_update(state, &account, |current| {
            current.group_targets = account.group_targets.clone();
            current.updated_at = account.updated_at;
        })?;
        Ok(account.to_info())
    }

    // ── 分组与模型 ──────────────────────────────────────────

    pub async fn groups(state: &AppState) -> Result<Vec<RelayGroup>, AppError> {
        let account = require_account(state)?;
        let client = RelayClient::new(&account.base_url, &account.access_token);
        client
            .groups()
            .await
            .map_err(|error| authenticated_error(state, &account, error))
    }

    /// 分组 → 模型（含倍率/标签），未登录返回空
    pub async fn models(state: &AppState) -> Result<Vec<RelayGroupModels>, AppError> {
        let account = require_account(state)?;
        let client = RelayClient::new(&account.base_url, &account.access_token);
        let groups = match client.groups().await {
            Ok(groups) => groups,
            Err(error) if is_auth_error(&error) => {
                return Err(authenticated_error(state, &account, error));
            }
            Err(_) => Vec::new(),
        };
        let by_group = client
            .models_by_group()
            .await
            .map_err(|error| authenticated_error(state, &account, error))?;

        let ratio_of = |name: &str| groups.iter().find(|g| g.name == name).and_then(|g| g.ratio);
        let mut out: Vec<RelayGroupModels> = by_group
            .into_iter()
            .map(|(group, models)| RelayGroupModels {
                ratio: ratio_of(&group),
                group,
                models,
            })
            .collect();
        out.sort_by(|a, b| a.group.cmp(&b.group));
        Ok(out)
    }

    /// 令牌列表（供管理页，掩码 key）
    pub async fn tokens(state: &AppState) -> Result<Vec<RelayToken>, AppError> {
        let account = require_account(state)?;
        let client = RelayClient::new(&account.base_url, &account.access_token);
        client
            .list_tokens()
            .await
            .map_err(|error| authenticated_error(state, &account, error))
    }

    // ── 钱包、充值与中转站账单 ────────────────────────────────

    pub async fn topup_info(state: &AppState) -> Result<RelayTopupInfo, AppError> {
        let account = require_account(state)?;
        let client = RelayClient::new(&account.base_url, &account.access_token);
        let raw = client
            .topup_info()
            .await
            .map_err(|error| authenticated_error(state, &account, error))?;
        Ok(parse_topup_info(&raw))
    }

    pub async fn topup_quote(
        state: &AppState,
        method: &str,
        amount: f64,
    ) -> Result<RelayTopupQuote, AppError> {
        let account = require_account(state)?;
        let client = RelayClient::new(&account.base_url, &account.access_token);
        let raw = client
            .topup_quote(method, amount)
            .await
            .map_err(|error| authenticated_error(state, &account, error))?;
        Ok(parse_topup_quote(&raw, amount))
    }

    pub async fn create_topup_payment(
        state: &AppState,
        method: &str,
        amount: f64,
        client_request_id: &str,
    ) -> Result<RelayTopupOrder, AppError> {
        static PAYMENT_GATE: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
        let _permit = PAYMENT_GATE
            .get_or_init(|| tokio::sync::Mutex::new(()))
            .try_lock()
            .map_err(|_| AppError::Message("relay.busy".into()))?;
        if !matches!(method, "wxpay" | "alipay") {
            return Err(AppError::Message("relay.invalid_payment_method".into()));
        }
        let account = require_account(state)?;
        let client = RelayClient::new(&account.base_url, &account.access_token);
        let info = parse_topup_info(&client.topup_info().await?);
        if !info.enabled
            || !info.pay_methods.iter().any(|m| m.id == method && m.enabled)
            || !info.amount_options.iter().any(|a| a.amount == amount)
            || info.min_amount.is_some_and(|min| amount < min)
        {
            return Err(AppError::Message("relay.invalid_amount".into()));
        }
        let raw = client
            .create_topup_payment(method, amount, client_request_id)
            .await
            .map_err(|error| authenticated_error(state, &account, error))?;
        let (trade, html) = super::checkout::form(&raw)?;
        let mut order = parse_topup_order(&raw, Some(method), Some(amount), &account.base_url)
            .ok_or_else(|| AppError::Message("relay.topup_response_invalid".to_string()))?;
        order.trade_no = Some(trade);
        order.status = "pending".into();
        order.checkout_url = Some(super::checkout::serve(html)?);
        Ok(order)
    }

    pub async fn topup_history(
        state: &AppState,
        page: u32,
        page_size: u32,
    ) -> Result<RelayTopupHistory, AppError> {
        let account = require_account(state)?;
        let client = RelayClient::new(&account.base_url, &account.access_token);
        let raw = client
            .topup_history(page, page_size)
            .await
            .map_err(|error| authenticated_error(state, &account, error))?;
        Ok(parse_topup_history(&raw))
    }

    pub async fn usage_models(
        state: &AppState,
        query: RelayUsageQuery,
    ) -> Result<RelayUsageModels, AppError> {
        let account = require_account(state)?;
        let client = RelayClient::new(&account.base_url, &account.access_token);
        let raw = client.usage_models(&query).await.map_err(|error| {
            usage_contract_error(state, &account, error, "relay.usage_models_not_ready")
        })?;
        let mut models = parse_usage_models(&raw, &query)
            .ok_or_else(|| AppError::Message("relay.usage_models_not_ready".to_string()))?;
        let detail_query = usage_bucket_query(&models, &query);
        match tokio::time::timeout(
            std::time::Duration::from_secs(30),
            client.usage_details(&detail_query),
        )
        .await
        {
            Ok(Ok(details)) => enrich_usage_details(&mut models, &details),
            Ok(Err(error)) if error.to_string() == "relay.usage_details_incomplete" => {
                models.details_status = "incomplete".into();
            }
            _ => models.details_status = "failed".into(),
        }
        Ok(models)
    }

    pub async fn usage_summary(
        state: &AppState,
        query: RelayUsageQuery,
    ) -> Result<RelayUsageOverview, AppError> {
        let account = require_account(state)?;
        let client = RelayClient::new(&account.base_url, &account.access_token);
        let raw = client.usage_summary(&query).await.map_err(|error| {
            usage_contract_error(state, &account, error, "relay.usage_summary_not_ready")
        })?;
        parse_usage_summary(&raw, &query, &account)
            .ok_or_else(|| AppError::Message("relay.usage_summary_not_ready".to_string()))
    }

    // ── 一键应用 ────────────────────────────────────────────

    /// 点击模型 → 建/取分组令牌 → 统一供应商 → 下发全部启用应用
    pub async fn apply_model(
        state: &AppState,
        group: &str,
        model: &str,
        target_apps: Option<&[String]>,
        progress: impl Fn(&str, Option<&str>) + Send + Sync + 'static,
    ) -> Result<Vec<RelayApplyResult>, AppError> {
        let _permit = apply_gate().try_enter()?;
        let mut account = require_account(state)?;
        resolve_apply_targets(&account.apply_apps, target_apps)?;
        let client = RelayClient::new(&account.base_url, &account.access_token);

        // 1. 确保分组专用令牌，取完整 sk- key
        progress("preparing", None);
        let key = ensure_group_token(state, &client, &mut account, group).await?;
        let prepared_token = account.group_tokens.get(group).cloned();
        let expected = account.clone();
        account = Self::commit_session_update(state, &expected, |current| {
            if let Some(token) = prepared_token {
                current.group_tokens.insert(group.to_string(), token);
            }
        })?;
        let targets = resolve_apply_targets(&account.apply_apps, target_apps)?;

        // 2-4. DB 与 live 文件写入放到阻塞线程（switch 内含 fs IO 与代理锁）
        let state2 = state.clone();
        let group_owned = group.to_string();
        let model_owned = model.to_string();
        tauri::async_runtime::spawn_blocking(move || {
            apply_model_blocking(
                &state2,
                &mut account,
                &group_owned,
                &model_owned,
                &key,
                targets,
                &progress,
            )
        })
        .await
        .map_err(|e| AppError::Message(format!("应用任务执行失败: {e}")))?
    }
}

/// 确保 `relaydesk-<group>` 令牌存在并返回完整 key
async fn ensure_group_token(
    state: &AppState,
    client: &RelayClient,
    account: &mut RelayAccount,
    group: &str,
) -> Result<String, AppError> {
    if let Some(t) = account.group_tokens.get(group) {
        if !t.key.is_empty() {
            return Ok(t.key.clone());
        }
    }

    let name = format!("{TOKEN_NAME_PREFIX}{group}");
    let tokens = client
        .list_tokens()
        .await
        .map_err(|error| authenticated_error(state, account, error))?;
    let existing = tokens
        .iter()
        .filter(|t| t.name == name)
        .max_by_key(|t| t.created_time)
        .map(|t| t.id);

    let token_id = match existing {
        Some(id) => id,
        None => {
            client
                .create_token(&name, group)
                .await
                .map_err(|error| authenticated_error(state, account, error))?;
            client
                .list_tokens()
                .await
                .map_err(|error| authenticated_error(state, account, error))?
                .iter()
                .filter(|t| t.name == name)
                .max_by_key(|t| t.created_time)
                .map(|t| t.id)
                .ok_or_else(|| AppError::Message(format!("创建令牌 {name} 后未找到")))?
        }
    };

    let key = client
        .get_token_key(token_id)
        .await
        .map_err(|error| authenticated_error(state, account, error))?;
    account.group_tokens.insert(
        group.to_string(),
        RelayGroupToken {
            token_id,
            key: key.clone(),
        },
    );
    Ok(key)
}

/// 阻塞段：upsert 统一供应商 → 同步 → 逐应用 switch
fn apply_model_blocking(
    state: &AppState,
    account: &mut RelayAccount,
    group: &str,
    model: &str,
    key: &str,
    targets: Vec<AppType>,
    progress: &(dyn Fn(&str, Option<&str>) + Send + Sync),
) -> Result<Vec<RelayApplyResult>, AppError> {
    let universal_id = format!("{UNIVERSAL_ID_PREFIX}{group}");

    // 复用已有统一供应商的用户自定义（模型档位/推理强度/图标等）
    let mut universal = state
        .db
        .get_universal_provider(&universal_id)?
        .unwrap_or_else(|| {
            UniversalProvider::new(
                universal_id.clone(),
                format!("中转站 · {group}"),
                "newapi".to_string(),
                account.base_url.clone(),
                key.to_string(),
            )
        });
    universal.base_url = account.base_url.clone();
    universal.api_key = key.to_string();
    universal.apps.claude = account.apply_apps.claude;
    universal.apps.codex = account.apply_apps.codex;
    universal.apps.gemini = account.apply_apps.gemini;

    // Only this request's targets receive the selected model. A targeted retry
    // must not rewrite another app's child on the shared parent.
    if targets.contains(&AppType::Claude) {
        let m = universal
            .models
            .claude
            .get_or_insert_with(ClaudeModelConfig::default);
        m.model = Some(model.to_string());
    }
    if targets.contains(&AppType::Codex) {
        let m = universal
            .models
            .codex
            .get_or_insert_with(CodexModelConfig::default);
        m.model = Some(model.to_string());
    }
    if targets.contains(&AppType::Gemini) {
        let m = universal
            .models
            .gemini
            .get_or_insert_with(GeminiModelConfig::default);
        m.model = Some(model.to_string());
    }

    ProviderService::upsert_universal(state, universal)?;

    let expected_session = account.clone();
    let results = run_target_plan(account, targets, group, model, |app_type| {
        let app = app_type.as_str().to_string();
        progress("syncing", Some(app_type.as_str()));
        let attempt = (|| {
            let latest = require_account(state)?;
            if !same_active_session(&latest, &expected_session) {
                return Err(AppError::Message("relay.session_expired".to_string()));
            }
            resolve_apply_targets(&latest.apply_apps, Some(&[app.clone()]))?;
            let child_id =
                ProviderService::sync_universal_to_app(state, &universal_id, app_type.clone())?;
            let current = crate::settings::get_effective_current_provider(&state.db, &app_type)?;
            if current.as_deref() != Some(child_id.as_str()) {
                ProviderService::switch(state, app_type, &child_id)?;
            }
            Ok::<String, AppError>(child_id)
        })();

        match attempt {
            Ok(child_id) => RelayApplyResult {
                app,
                ok: true,
                provider_id: Some(child_id),
                error: None,
            },
            Err(_) => {
                log::warn!("RelayDesk 同步 {app} 失败");
                RelayApplyResult {
                    app,
                    ok: false,
                    provider_id: None,
                    error: Some("relay.sync_failed".to_string()),
                }
            }
        }
    });

    let any_success = results.iter().any(|result| result.ok);
    let applied = account.last_applied.clone();
    RelayService::commit_session_update(state, &expected_session, move |current| {
        if any_success {
            current.last_applied = applied;
            current.updated_at = now_ts();
        }
    })?;

    Ok(results)
}

// ── 工具 ────────────────────────────────────────────────────

fn require_account(state: &AppState) -> Result<RelayAccount, AppError> {
    state
        .relay_session
        .read()
        .map_err(|_| AppError::Message("relay.session_lock_failed".into()))?
        .clone()
        .filter(|a| !a.access_token.is_empty())
        .ok_or_else(|| {
            AppError::localized(
                "relay.not_logged_in",
                "未登录中转站，请先登录",
                "Not logged in to the relay instance.",
            )
        })
}

fn session_expired_error() -> AppError {
    AppError::Message("relay.session_expired".to_string())
}

fn same_active_session(left: &RelayAccount, right: &RelayAccount) -> bool {
    if left.base_url != right.base_url || left.access_token.is_empty() {
        return false;
    }
    match (left.user_id, right.user_id) {
        (Some(left_id), Some(right_id)) => {
            left_id == right_id && left.access_token == right.access_token
        }
        (None, None) => left.username == right.username && left.access_token == right.access_token,
        _ => false,
    }
}

fn is_auth_error(error: &AppError) -> bool {
    matches!(
        error,
        AppError::HttpStatus {
            status: 401 | 403,
            ..
        }
    )
}

/// Clear only the credential session that actually received 401/403. A newer
/// same-user login is protected by the DAO's exact-session comparison.
fn authenticated_error(state: &AppState, expected: &RelayAccount, error: AppError) -> AppError {
    if is_auth_error(&error) {
        if let Ok(mut session) = state.relay_session.write() {
            if session
                .as_ref()
                .is_some_and(|current| current.access_token == expected.access_token)
            {
                session.take();
            }
        }
        session_expired_error()
    } else {
        error
    }
}

fn usage_contract_error(
    state: &AppState,
    expected: &RelayAccount,
    error: AppError,
    unavailable_key: &str,
) -> AppError {
    if is_auth_error(&error) {
        return authenticated_error(state, expected, error);
    }
    if matches!(
        error,
        AppError::HttpStatus {
            status: 404 | 405 | 501,
            ..
        }
    ) {
        return AppError::Message(unavailable_key.to_string());
    }
    error
}

fn payload(value: &Value) -> &Value {
    value.get("data").unwrap_or(value)
}

fn value_string(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        value.get(*key).and_then(|item| {
            item.as_str()
                .map(str::to_string)
                .or_else(|| item.as_i64().map(|n| n.to_string()))
        })
    })
}

fn value_f64(value: &Value, keys: &[&str]) -> Option<f64> {
    keys.iter().find_map(|key| {
        value.get(*key).and_then(|item| {
            item.as_f64()
                .or_else(|| item.as_i64().map(|n| n as f64))
                .or_else(|| item.as_str().and_then(|s| s.parse::<f64>().ok()))
        })
    })
}

fn value_i64(value: &Value, keys: &[&str]) -> Option<i64> {
    value_f64(value, keys).map(|number| number as i64)
}

fn value_bool(value: &Value, keys: &[&str]) -> Option<bool> {
    keys.iter().find_map(|key| {
        value.get(*key).and_then(|item| {
            item.as_bool()
                .or_else(|| match item.as_str()?.to_ascii_lowercase().as_str() {
                    "true" | "1" | "yes" => Some(true),
                    "false" | "0" | "no" => Some(false),
                    _ => None,
                })
        })
    })
}

fn value_array<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a Vec<Value>> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_array))
}

fn parse_topup_info(raw: &Value) -> RelayTopupInfo {
    let root = payload(raw);
    let amount_values = value_array(root, &["amount_options", "amounts", "fixed_amounts"])
        .cloned()
        .unwrap_or_default();
    let amount_options = amount_values
        .iter()
        .filter_map(|item| {
            if let Some(amount) = item.as_f64() {
                return Some(RelayTopupAmountOption {
                    amount,
                    label: None,
                    credit_amount: None,
                    currency: None,
                    currency_symbol: None,
                });
            }
            Some(RelayTopupAmountOption {
                amount: value_f64(item, &["amount", "value", "pay_amount"])?,
                label: value_string(item, &["label", "name", "title"]),
                credit_amount: value_f64(item, &["credit_amount", "quota", "credit"]),
                currency: value_string(item, &["currency", "currency_code"]),
                currency_symbol: value_string(item, &["currency_symbol", "symbol"]),
            })
        })
        .collect::<Vec<_>>();

    let method_values = value_array(root, &["pay_methods", "methods", "payment_methods"])
        .cloned()
        .unwrap_or_default();
    let mut pay_methods = Vec::new();
    for item in &method_values {
        if let Some(id) = item.as_str() {
            pay_methods.push(RelayTopupPaymentMethod {
                id: id.to_string(),
                label: Some(id.to_string()),
                enabled: true,
                description: None,
            });
            continue;
        }
        if let Some(id) = value_string(item, &["id", "type", "method", "value"]) {
            pay_methods.push(RelayTopupPaymentMethod {
                id,
                label: value_string(item, &["label", "name", "title"]),
                enabled: value_bool(item, &["enabled", "available", "active"]).unwrap_or(true),
                description: value_string(item, &["description", "desc"]),
            });
        }
    }
    let enabled = value_bool(
        root,
        &["enable_online_topup", "enabled", "online", "topup_enabled"],
    )
    .unwrap_or(!amount_options.is_empty() || !pay_methods.is_empty());
    RelayTopupInfo {
        enabled,
        currency: value_string(root, &["currency", "currency_code"]),
        currency_symbol: value_string(root, &["currency_symbol", "symbol"]),
        amount_options,
        pay_methods,
        min_amount: value_f64(root, &["min_amount", "minimum", "min_topup"]),
        message: value_string(root, &["message", "notice", "reason"]),
    }
}

fn parse_topup_quote(raw: &Value, requested_amount: f64) -> RelayTopupQuote {
    let root = payload(raw);
    let nested = root.get("data").unwrap_or(root);
    RelayTopupQuote {
        amount: value_f64(root, &["amount", "requested_amount"]).unwrap_or(requested_amount),
        pay_amount: nested
            .as_str()
            .and_then(|value| value.parse::<f64>().ok())
            .filter(|n| n.is_finite() && *n >= 0.0)
            .or_else(|| value_f64(nested, &["pay_amount", "actual_amount", "amount"])),
        credit_amount: value_f64(nested, &["credit_amount", "quota", "credit"]),
        currency: value_string(nested, &["currency", "currency_code"]),
        currency_symbol: value_string(nested, &["currency_symbol", "symbol"]),
        expires_at: value_string(nested, &["expires_at", "expire_at", "valid_until"]),
    }
}

fn normalize_topup_status(value: Option<String>) -> String {
    let status = value
        .unwrap_or_else(|| "unknown".to_string())
        .to_ascii_lowercase();
    match status.as_str() {
        "success" => "credited".to_string(),
        "created" | "pending" | "paid" | "crediting" | "credited" | "failed" | "expired"
        | "cancelled" | "canceled" | "refunded" => {
            if status == "canceled" {
                "cancelled".to_string()
            } else {
                status
            }
        }
        _ => "unknown".to_string(),
    }
}

fn safe_checkout_url(raw: Option<String>, base_url: &str) -> Option<String> {
    let raw = raw?;
    let url = url::Url::parse(raw.trim()).ok()?;
    if url.scheme() != "https" {
        return None;
    }
    let base_host = url::Url::parse(base_url)
        .ok()?
        .host_str()?
        .to_ascii_lowercase();
    let checkout_host = url.host_str()?.to_ascii_lowercase();
    // Until the relay publishes an explicit payment-host allowlist, only same
    // origin links are surfaced to the renderer.
    (checkout_host == base_host).then_some(url.to_string())
}

fn parse_topup_order(
    raw: &Value,
    method: Option<&str>,
    requested_amount: Option<f64>,
    base_url: &str,
) -> Option<RelayTopupOrder> {
    let root = payload(raw);
    let nested = root.get("data").unwrap_or(root);
    let checkout_raw = value_string(nested, &["checkout_url", "payment_url", "url", "pay_link"])
        .or_else(|| value_string(root, &["checkout_url", "payment_url", "url", "pay_link"]));
    Some(RelayTopupOrder {
        order_id: value_string(nested, &["order_id", "id"]),
        trade_no: value_string(nested, &["trade_no", "tradeNo", "order_no"]),
        created_at: value_string(
            nested,
            &["create_time", "created_at", "createdAt", "created_time"],
        ),
        paid_at: value_string(nested, &["paid_at", "paidAt"]),
        credited_at: value_string(nested, &["credited_at", "creditedAt"]),
        amount: value_f64(nested, &["amount", "requested_amount"]).or(requested_amount),
        pay_amount: value_f64(nested, &["money", "pay_amount", "actual_amount"]),
        credit_amount: value_f64(nested, &["credit_amount", "quota", "credit"]),
        currency: value_string(nested, &["currency", "currency_code"]),
        currency_symbol: value_string(nested, &["currency_symbol", "symbol"]),
        method: method
            .map(str::to_string)
            .or_else(|| value_string(nested, &["method", "payment_method"])),
        status: normalize_topup_status(value_string(nested, &["status", "state"])),
        checkout_url: safe_checkout_url(checkout_raw, base_url),
        checkout_method: value_string(nested, &["checkout_method", "payment_type"]),
        expires_at: value_string(nested, &["expires_at", "expire_at", "valid_until"]),
    })
}

fn parse_topup_history(raw: &Value) -> RelayTopupHistory {
    let root = payload(raw);
    let items = value_array(root, &["items", "data", "records", "list"])
        .map(|entries| {
            entries
                .iter()
                .filter_map(|entry| parse_topup_order(entry, None, None, ""))
                .collect()
        })
        .unwrap_or_default();
    RelayTopupHistory {
        total: value_i64(root, &["total", "count"]).map(|n| n.max(0) as u64),
        is_complete: value_bool(root, &["is_complete", "complete"]),
        next_cursor: value_string(root, &["next_cursor", "next", "cursor"]),
        items,
    }
}

/// /api/data/self returns server billing buckets, not request logs.
/// Missing token splits, client attribution and coverage remain unknown.
fn parse_usage_models(raw: &Value, query: &RelayUsageQuery) -> Option<RelayUsageModels> {
    let rows = payload(raw).as_array()?;
    let mut groups = std::collections::BTreeMap::<(String, Option<String>), (i64, i64, i64)>::new();
    for row in rows {
        let model = row.get("model_name")?.as_str()?.trim();
        if model.is_empty() || row.get("created_at")?.as_i64().is_none() {
            return None;
        }
        let count = row.get("count")?.as_i64()?;
        let tokens = row.get("token_used")?.as_i64()?;
        let quota = row.get("quota")?.as_i64()?;
        if count < 0 || tokens < 0 || quota < 0 {
            return None;
        }
        let group = row
            .get("use_group")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_owned);
        let sum = groups.entry((model.to_string(), group)).or_default();
        sum.0 = sum.0.checked_add(count)?;
        sum.1 = sum.1.checked_add(tokens)?;
        sum.2 = sum.2.checked_add(quota)?;
    }
    let items = groups
        .into_iter()
        .map(
            |((model, group), (count, tokens, quota))| RelayUsageModelRow {
                detail_request_count: None,
                details_reconciled: None,
                model_id: model.clone(),
                display_name: model,
                group,
                request_count: Some(count),
                total_tokens: Some(tokens),
                charged_quota: Some(quota),
                billing_model: None,
                token_alias_masked: None,
                input_tokens: None,
                output_tokens: None,
                cache_read_tokens: None,
                cache_write_tokens: None,
                charged_amount: None,
                currency: None,
                currency_symbol: None,
                success_count: None,
                failed_count: None,
                success_rate: None,
                source: None,
            },
        )
        .collect::<Vec<_>>();
    Some(RelayUsageModels {
        buckets: rows
            .iter()
            .map(|row| super::types::RelayUsageBucket {
                timestamp: row["created_at"].as_i64().unwrap(),
                model_id: row["model_name"].as_str().unwrap().trim().to_string(),
                request_count: row["count"].as_i64().unwrap(),
                total_tokens: row["token_used"].as_i64().unwrap(),
                charged_quota: row["quota"].as_i64().unwrap(),
            })
            .collect(),
        details_status: "unreconciled".into(),
        total: Some(items.len() as u64),
        items,
        is_complete: false,
        as_of: None,
        timezone: query.timezone.clone(),
        next_cursor: None,
        unavailable_fields: [
            "input_tokens",
            "output_tokens",
            "cache_read_tokens",
            "cache_write_tokens",
            "success_rate",
            "source",
            "coverage",
        ]
        .into_iter()
        .map(str::to_string)
        .collect(),
    })
}

// Analytics filters bucket timestamps, while logs filter request timestamps.
// Match the actual returned bucket window instead of including requests from
// an excluded partial first hour.
fn usage_bucket_query(models: &RelayUsageModels, query: &RelayUsageQuery) -> RelayUsageQuery {
    let mut detail = query.clone();
    if let Some(first) = models.buckets.iter().map(|bucket| bucket.timestamp).min() {
        if let Some(time) = chrono::DateTime::from_timestamp(first, 0) {
            detail.start = time.to_rfc3339();
        }
    }
    detail
}

fn enrich_usage_details(models: &mut RelayUsageModels, raw: &Value) {
    let Some(logs) = raw.as_array() else {
        return;
    };
    let mut ids = std::collections::HashSet::new();
    if logs.iter().any(|row| {
        row.get("id")
            .and_then(Value::as_i64)
            .is_none_or(|id| !ids.insert(id))
    }) {
        return;
    }
    for model in &mut models.items {
        let rows: Vec<_> =
            logs.iter()
                .filter(|r| {
                    r.get("model_name").and_then(Value::as_str).map(str::trim)
                        == Some(model.model_id.as_str())
                        && model.group.as_ref().is_none_or(|g| {
                            r.get("group").and_then(Value::as_str) == Some(g.as_str())
                        })
                })
                .collect();
        if rows.is_empty() {
            continue;
        }
        model.detail_request_count = Some(rows.len() as i64);
        let sum = |field: &str| {
            rows.iter().try_fold(0i64, |n, r| {
                n.checked_add(r.get(field)?.as_i64().filter(|v| *v >= 0)?)
            })
        };
        let (Some(input), Some(output)) = (sum("prompt_tokens"), sum("completion_tokens")) else {
            continue;
        };
        model.details_reconciled = Some(
            model.detail_request_count == model.request_count
                && sum("quota") == model.charged_quota
                && input.checked_add(output) == model.total_tokens,
        );
        model.input_tokens = Some(input);
        model.output_tokens = Some(output);
        let others: Option<Vec<Value>> = rows
            .iter()
            .map(|r| serde_json::from_str(r.get("other")?.as_str()?).ok())
            .collect();
        if let Some(others) = others {
            model.cache_read_tokens = others
                .iter()
                .try_fold(0i64, |n, r| n.checked_add(r.get("cache_tokens")?.as_i64()?));
            model.cache_write_tokens = others.iter().try_fold(0i64, |n, r| {
                let value = match (
                    r.get("cache_creation_tokens_5m"),
                    r.get("cache_creation_tokens_1h"),
                ) {
                    (Some(a), Some(b)) => a.as_i64()?.checked_add(b.as_i64()?)?,
                    _ => r.get("cache_creation_tokens")?.as_i64()?,
                };
                n.checked_add(value)
            });
        }
        let groups: std::collections::HashSet<_> = rows
            .iter()
            .filter_map(|r| r.get("group").and_then(Value::as_str))
            .collect();
        if groups.len() == 1 {
            model.group = groups
                .into_iter()
                .next()
                .filter(|v| !v.is_empty())
                .map(str::to_string);
        }
    }
    if models
        .items
        .iter()
        .all(|row| row.details_reconciled == Some(true))
    {
        models.details_status = "matched".into();
    }
    models
        .unavailable_fields
        .retain(|field| match field.as_str() {
            "input_tokens" => models.items.iter().any(|row| row.input_tokens.is_none()),
            "output_tokens" => models.items.iter().any(|row| row.output_tokens.is_none()),
            "cache_read_tokens" => models
                .items
                .iter()
                .any(|row| row.cache_read_tokens.is_none()),
            "cache_write_tokens" => models
                .items
                .iter()
                .any(|row| row.cache_write_tokens.is_none()),
            _ => true,
        });
}

fn parse_usage_summary(
    raw: &Value,
    query: &RelayUsageQuery,
    _account: &RelayAccount,
) -> Option<RelayUsageOverview> {
    let models = parse_usage_models(raw, query)?;
    let (mut count, mut tokens, mut quota) = (0i64, 0i64, 0i64);
    for row in models.items {
        count = count.checked_add(row.request_count?)?;
        tokens = tokens.checked_add(row.total_tokens?)?;
        quota = quota.checked_add(row.charged_quota?)?;
    }
    Some(RelayUsageOverview {
        start: query.start.clone(),
        end: query.end.clone(),
        timezone: query.timezone.clone(),
        as_of: None,
        is_complete: false,
        request_count: Some(count),
        total_tokens: Some(tokens),
        charged_quota: Some(quota),
        input_tokens: None,
        output_tokens: None,
        charged_amount: None,
        currency: None,
        currency_symbol: None,
        data_delay_seconds: None,
        unavailable_fields: models.unavailable_fields,
    })
}

fn now_ts() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn extract_str(v: &serde_json::Value, key: &str) -> Option<String> {
    v.get(key)
        .and_then(|x| x.as_str())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn extract_i64(v: &serde_json::Value, key: &str) -> Option<i64> {
    v.get(key).and_then(|x| {
        x.as_i64()
            .or_else(|| x.as_f64().map(|n| n as i64))
            .or_else(|| x.as_str().and_then(|s| s.parse().ok()))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app_config::{McpApps, McpServer};
    use crate::database::Database;
    use crate::provider::UniversalProvider;
    use crate::services::McpService;
    use serial_test::serial;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    fn account_with_apps(apply_apps: RelayApplyApps) -> RelayAccount {
        RelayAccount {
            base_url: "https://relay.invalid".to_string(),
            access_token: "test-access-token".to_string(),
            remembered: true,
            user_id: Some(7),
            username: "tester".to_string(),
            quota: 0,
            used_quota: 0,
            currency: Default::default(),
            group: "default".to_string(),
            apply_apps,
            group_targets: Default::default(),
            group_tokens: Default::default(),
            last_applied: Some(RelayAppliedModel {
                group: "old-group".to_string(),
                model: "old-model".to_string(),
            }),
            updated_at: 1,
        }
    }

    fn result(app: &str, ok: bool) -> RelayApplyResult {
        RelayApplyResult {
            app: app.to_string(),
            ok,
            provider_id: ok.then(|| format!("provider-{app}")),
            error: (!ok).then(|| "relay.sync_failed".to_string()),
        }
    }

    #[test]
    fn account_does_not_restore_an_unremembered_session_after_restart() {
        let db = Arc::new(Database::memory().unwrap());
        let mut account = account_with_apps(RelayApplyApps::default());
        account.remembered = false;
        db.save_relay_account(&account).unwrap();

        let state = AppState::new(db);
        assert!(RelayService::account(&state).unwrap().is_none());
    }

    #[test]
    fn persisted_relay_account_never_serializes_the_long_lived_access_token() {
        let account = account_with_apps(RelayApplyApps::default());
        let json = serde_json::to_string(&account).unwrap();
        assert!(!json.contains("test-access-token"));
        assert!(!json.contains("access_token"));
    }

    #[test]
    fn no_targets_rejects_before_running_any_target() {
        let apps = RelayApplyApps {
            claude: false,
            codex: false,
            gemini: false,
        };
        let calls = AtomicUsize::new(0);

        let targets = resolve_apply_targets(&apps, None);
        if let Ok(ref targets) = targets {
            for _ in targets {
                calls.fetch_add(1, Ordering::SeqCst);
            }
        }

        assert_eq!(targets.unwrap_err().to_string(), "relay.no_targets");
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn apply_gate_rejects_overlapping_apply() {
        let gate = ApplyGate::default();
        let first = gate.try_enter().expect("first apply acquires the gate");

        assert_eq!(gate.try_enter().unwrap_err().to_string(), "relay.busy");

        drop(first);
        assert!(gate.try_enter().is_ok());
    }

    #[test]
    fn all_success_updates_last_applied() {
        let apps = RelayApplyApps::default();
        let mut account = account_with_apps(apps.clone());
        let targets = resolve_apply_targets(&apps, None).unwrap();

        let results = run_target_plan(&mut account, targets, "paid", "gpt-next", |app| {
            result(app.as_str(), true)
        });

        assert_eq!(results.len(), 3);
        assert!(results.iter().all(|item| item.ok));
        let applied = account.last_applied.unwrap();
        assert_eq!(applied.group, "paid");
        assert_eq!(applied.model, "gpt-next");
    }

    #[test]
    fn partial_success_keeps_individual_failures_and_updates_last_applied() {
        let apps = RelayApplyApps::default();
        let mut account = account_with_apps(apps.clone());
        let targets = resolve_apply_targets(&apps, None).unwrap();

        let results = run_target_plan(&mut account, targets, "paid", "gpt-next", |app| {
            result(app.as_str(), app != AppType::Codex)
        });

        assert_eq!(results.iter().filter(|item| item.ok).count(), 2);
        assert_eq!(
            results
                .iter()
                .find(|item| item.app == "codex")
                .and_then(|item| item.error.as_deref()),
            Some("relay.sync_failed")
        );
        assert_eq!(account.last_applied.unwrap().model, "gpt-next");
    }

    #[test]
    fn all_failures_preserve_previous_last_applied() {
        let apps = RelayApplyApps::default();
        let mut account = account_with_apps(apps.clone());
        let previous = account.last_applied.clone();
        let targets = resolve_apply_targets(&apps, None).unwrap();

        let results = run_target_plan(&mut account, targets, "paid", "gpt-next", |app| {
            result(app.as_str(), false)
        });

        assert!(results.iter().all(|item| !item.ok));
        assert_eq!(
            account
                .last_applied
                .as_ref()
                .map(|item| (&item.group, &item.model)),
            previous.as_ref().map(|item| (&item.group, &item.model))
        );
    }

    #[test]
    fn targeted_retry_runs_only_enabled_tool_and_preserves_preferences() {
        let apps = RelayApplyApps {
            claude: true,
            codex: true,
            gemini: false,
        };
        let mut account = account_with_apps(apps.clone());
        let targets = resolve_apply_targets(&apps, Some(&["codex".to_string()])).unwrap();
        let mut called = Vec::new();

        let results = run_target_plan(&mut account, targets, "paid", "gpt-next", |app| {
            called.push(app.as_str().to_string());
            result(app.as_str(), true)
        });

        assert_eq!(called, vec!["codex"]);
        assert_eq!(results.len(), 1);
        assert_eq!(
            (
                account.apply_apps.claude,
                account.apply_apps.codex,
                account.apply_apps.gemini,
            ),
            (apps.claude, apps.codex, apps.gemini)
        );
    }

    #[test]
    fn targeted_retry_does_not_enable_a_disabled_tool() {
        let apps = RelayApplyApps {
            claude: true,
            codex: false,
            gemini: true,
        };

        assert_eq!(
            resolve_apply_targets(&apps, Some(&["codex".to_string()]))
                .unwrap_err()
                .to_string(),
            "relay.no_targets"
        );
    }

    #[test]
    fn target_subset_intersects_with_enabled_and_rejects_unknown() {
        let apps = RelayApplyApps {
            claude: true,
            codex: true,
            gemini: true,
        };
        // 多目标子集：只同步列出的启用目标
        let targets =
            resolve_apply_targets(&apps, Some(&["claude".to_string(), "gemini".to_string()]))
                .unwrap();
        assert_eq!(
            targets.iter().map(|t| t.as_str()).collect::<Vec<_>>(),
            vec!["claude", "gemini"]
        );
        // 子集中含禁用目标 → 该目标被跳过
        let apps = RelayApplyApps {
            claude: false,
            codex: true,
            gemini: true,
        };
        let targets =
            resolve_apply_targets(&apps, Some(&["claude".to_string(), "codex".to_string()]))
                .unwrap();
        assert_eq!(
            targets.iter().map(|t| t.as_str()).collect::<Vec<_>>(),
            vec!["codex"]
        );
        // 未知目标名 → invalid_target
        assert_eq!(
            resolve_apply_targets(&apps, Some(&["nonexistent".to_string()]))
                .unwrap_err()
                .to_string(),
            "relay.invalid_target"
        );
    }

    #[tokio::test]
    async fn manual_login_can_retry_immediately_after_failure_even_with_old_timestamp() {
        use axum::{routing::post, Json, Router};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let calls = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let handler_calls = calls.clone();
        let router = Router::new().route(
            "/api/user/login",
            post(move || {
                let calls = handler_calls.clone();
                async move {
                    calls.fetch_add(1, Ordering::SeqCst);
                    Json(json!({"success": false, "message": "synthetic login rejected"}))
                }
            }),
        );
        let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        let state = AppState::new(std::sync::Arc::new(
            crate::database::Database::memory().unwrap(),
        ));
        state
            .db
            .set_setting("relay_last_login_attempt_ms", &u64::MAX.to_string())
            .unwrap();
        for _ in 0..2 {
            let error = RelayService::login(
                &state,
                &format!("http://{address}"),
                "fixture-user",
                "fixture-password",
                false,
            )
            .await
            .unwrap_err();
            assert_eq!(error.to_string(), "synthetic login rejected");
        }
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        server.abort();
    }

    #[tokio::test]
    async fn legacy_remembered_accounts_never_restore_or_expose_saved_login() {
        let state = AppState::new(std::sync::Arc::new(
            crate::database::Database::memory().unwrap(),
        ));
        let mut account = account_with_apps(RelayApplyApps::default());
        account.remembered = true;
        state.db.save_relay_account(&account).unwrap();
        assert!(RelayService::restore(&state).await.unwrap().is_none());
        assert!(RelayService::restore_saved(&state, "missing")
            .await
            .unwrap()
            .is_none());
        assert!(RelayService::saved_login_name(&state).unwrap().is_none());
    }

    async fn saved_login_fixture(
        status: axum::http::StatusCode,
    ) -> (String, tokio::task::JoinHandle<()>) {
        use axum::{
            routing::{get, post},
            Json, Router,
        };
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let router = Router::new()
            .route("/api/user/login", post(|| async {
                Json(json!({"success":true,"data":{"access_token":"synthetic-session"}}))
            }))
            .route("/api/user/token", get(|| async {
                Json(json!({"success":true,"data":"synthetic-persistent-token"}))
            }))
            .route("/api/user/self", get(move || async move {
                (status, Json(json!({"success":true,"data":{"id":7,"username":"tester","quota":42,"used_quota":3}})))
            }))
            .route("/api/status", get(|| async { Json(json!({"success":true,"data":{"quota_per_unit":500000}})) }));
        let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        (base, server)
    }

    #[tokio::test]
    async fn saved_session_survives_restart_but_requires_explicit_selection() {
        let (base, server) = saved_login_fixture(axum::http::StatusCode::OK).await;
        let dir = tempfile::tempdir().unwrap();
        let mut state = AppState::new(Arc::new(Database::memory().unwrap()));
        state.relay_vault = Arc::new(std::sync::Mutex::new(
            super::super::credentials::VaultStore::new(dir.path()),
        ));
        let logged_in = RelayService::login(&state, &base, "tester", "synthetic-password", true)
            .await
            .unwrap();
        assert!(logged_in.remembered);
        // Drop both the session and its vault handle; a fresh app opens the disk files.
        drop(state);
        let mut restarted = AppState::new(Arc::new(Database::memory().unwrap()));
        restarted.relay_vault = Arc::new(std::sync::Mutex::new(
            super::super::credentials::VaultStore::new(dir.path()),
        ));
        assert!(RelayService::restore(&restarted).await.unwrap().is_none());
        let saved = RelayService::saved_logins(&restarted).unwrap();
        assert_eq!(saved.len(), 1);
        let restored = RelayService::restore_saved(&restarted, &saved[0].id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(restored.quota, 42);
        assert!(restored.remembered);
        assert!(!serde_json::to_string(&restored)
            .unwrap()
            .contains("synthetic-persistent-token"));
        RelayService::logout(&restarted).unwrap();
        assert_eq!(RelayService::saved_logins(&restarted).unwrap().len(), 1);
        assert!(RelayService::account(&restarted).unwrap().is_none());
        RelayService::forget_login(&restarted, Some(&saved[0].id)).unwrap();
        assert!(RelayService::saved_logins(&restarted).unwrap().is_empty());
        server.abort();
    }

    #[tokio::test]
    async fn saved_session_expiry_removes_only_the_rejected_account() {
        let (base, server) = saved_login_fixture(axum::http::StatusCode::UNAUTHORIZED).await;
        let state = AppState::new(Arc::new(Database::memory().unwrap()));
        let mut account = account_with_apps(RelayApplyApps::default());
        account.base_url = base;
        RelayService::save_remembered(&state, &account).unwrap();
        let id = RelayService::saved_logins(&state).unwrap()[0].id.clone();
        let error = RelayService::restore_saved(&state, &id).await.unwrap_err();
        assert_eq!(error.to_string(), "relay.saved_login_expired");
        assert!(RelayService::saved_logins(&state).unwrap().is_empty());
        assert!(RelayService::account(&state).unwrap().is_none());
        server.abort();
    }

    #[tokio::test]
    async fn unremembered_login_preserves_existing_saved_account() {
        let (base, server) = saved_login_fixture(axum::http::StatusCode::OK).await;
        let dir = tempfile::tempdir().unwrap();
        let mut state = AppState::new(Arc::new(Database::memory().unwrap()));
        state.relay_vault = Arc::new(std::sync::Mutex::new(
            super::super::credentials::VaultStore::new(dir.path()),
        ));
        // 已有一条保存记录；再次登录未勾选“记住账号”不得删除它。
        RelayService::login(&state, &base, "tester", "synthetic-password", true)
            .await
            .unwrap();
        assert_eq!(RelayService::saved_logins(&state).unwrap().len(), 1);
        let unremembered =
            RelayService::login(&state, &base, "tester", "synthetic-password", false)
                .await
                .unwrap();
        assert!(!unremembered.remembered);
        assert_eq!(
            RelayService::saved_logins(&state).unwrap().len(),
            1,
            "remember=false must not delete the existing saved record"
        );
        server.abort();
    }

    #[tokio::test]
    async fn saved_session_network_failure_preserves_account_for_manual_retry() {
        let (base, server) = saved_login_fixture(axum::http::StatusCode::SERVICE_UNAVAILABLE).await;
        let state = AppState::new(Arc::new(Database::memory().unwrap()));
        let mut account = account_with_apps(RelayApplyApps::default());
        account.base_url = base;
        RelayService::save_remembered(&state, &account).unwrap();
        let id = RelayService::saved_logins(&state).unwrap()[0].id.clone();
        assert!(RelayService::restore_saved(&state, &id).await.is_err());
        assert_eq!(RelayService::saved_logins(&state).unwrap().len(), 1);
        assert!(RelayService::account(&state).unwrap().is_none());
        server.abort();
    }

    fn usage_query_fixture() -> RelayUsageQuery {
        RelayUsageQuery {
            start: "2026-09-01T00:00:00Z".into(),
            end: "2026-09-02T00:00:00Z".into(),
            timezone: Some("UTC".into()),
            group: None,
            model_name: None,
            token_name: None,
            r#type: None,
            cursor: None,
            page_size: Some(100),
        }
    }

    #[test]
    fn detail_window_starts_at_first_returned_hour_bucket() {
        let query = usage_query_fixture();
        let first = chrono::DateTime::parse_from_rfc3339("2026-09-01T01:00:00Z")
            .unwrap()
            .timestamp();
        let models = parse_usage_models(&json!([{"model_name":"gpt-6-astra","created_at":first,"count":1,"token_used":30,"quota":50}]), &query).unwrap();
        let details = usage_bucket_query(&models, &query);
        assert_eq!(
            chrono::DateTime::parse_from_rfc3339(&details.start)
                .unwrap()
                .timestamp(),
            first
        );
        assert_eq!(details.end, query.end);
    }

    #[test]
    fn details_only_enrich_matching_complete_billing_rows() {
        let buckets =
            json!([{"model_name":"m","created_at":1,"count":1,"token_used":30,"quota":50}]);
        let logs = json!([{"id":1,"model_name":"m","group":"g","prompt_tokens":20,"completion_tokens":10,"quota":50,"other":"{\"cache_tokens\":5,\"cache_creation_tokens\":2}"}]);
        let mut models = parse_usage_models(&buckets, &usage_query_fixture()).unwrap();
        enrich_usage_details(&mut models, &logs);
        assert_eq!(models.details_status, "matched");
        assert!(!models.unavailable_fields.contains(&"input_tokens".into()));
        assert_eq!(models.items[0].input_tokens, Some(20));
        assert_eq!(models.items[0].output_tokens, Some(10));
        assert_eq!(models.items[0].cache_read_tokens, Some(5));
        assert_eq!(models.items[0].cache_write_tokens, Some(2));
        assert_eq!(models.items[0].group.as_deref(), Some("g"));
        let mut models = parse_usage_models(&buckets, &usage_query_fixture()).unwrap();
        let mut mismatch = logs.clone();
        mismatch[0]["quota"] = json!(51);
        enrich_usage_details(&mut models, &mismatch);
        assert_eq!(models.items[0].input_tokens, Some(20));
        assert_eq!(models.items[0].details_reconciled, Some(false));
        assert_eq!(models.items[0].detail_request_count, Some(1));
        assert_eq!(models.details_status, "unreconciled");
        let mut duplicate = logs.as_array().unwrap().clone();
        duplicate.push(logs[0].clone());
        let mut models = parse_usage_models(&buckets, &usage_query_fixture()).unwrap();
        enrich_usage_details(&mut models, &json!(duplicate));
        assert_eq!(models.items[0].input_tokens, None);
    }

    #[test]
    fn official_topup_quote_and_history_fields_are_preserved() {
        let quote = parse_topup_quote(&json!({"data":"98.00","message":"success"}), 100.0);
        assert_eq!(quote.pay_amount, Some(98.0));
        let info = parse_topup_info(&json!({"enable_online_topup":false,"amount_options":[10]}));
        assert!(!info.enabled);
        let order = parse_topup_order(
            &json!({"id":1,"amount":100,"money":98,"create_time":1789257600,"status":"success"}),
            None,
            None,
            "",
        )
        .unwrap();
        assert_eq!(order.pay_amount, Some(98.0));
        assert_eq!(order.created_at.as_deref(), Some("1789257600"));
        assert_eq!(order.status, "credited");
    }

    #[test]
    fn official_usage_buckets_aggregate_without_inventing_splits() {
        let raw = json!([
            {"model_name":"model-a","created_at":1789257600,"count":2,"token_used":20,"quota":30},
            {"model_name":"model-a","created_at":1789344000,"count":3,"token_used":40,"quota":50}
        ]);
        let data = parse_usage_models(&raw, &usage_query_fixture()).unwrap();
        assert_eq!(data.items.len(), 1);
        assert_eq!(data.items[0].request_count, Some(5));
        assert_eq!(data.items[0].total_tokens, Some(60));
        assert_eq!(data.items[0].charged_quota, Some(80));
        assert_eq!(data.items[0].input_tokens, None);
        assert_eq!(data.items[0].source, None);
        assert!(!data.is_complete);
        assert!(
            parse_usage_models(&json!([{"id":1,"token_used":5}]), &usage_query_fixture()).is_none()
        );
    }

    #[test]
    fn raw_usage_logs_cannot_be_presented_as_model_billing() {
        let raw = json!({
            "success": true,
            "data": {
                "logs": [{"model": "fixture", "tokens": 12}],
                "complete": true
            }
        });
        assert!(parse_usage_models(&raw, &usage_query_fixture()).is_none());
    }

    #[test]
    fn summary_without_explicit_contract_is_not_ready() {
        let raw = json!({
            "success": true,
            "data": {"total_tokens": 10, "is_complete": true}
        });
        let account = account_with_apps(RelayApplyApps::default());
        assert!(parse_usage_summary(&raw, &usage_query_fixture(), &account).is_none());
    }

    #[test]
    #[serial]
    fn malformed_mcp_does_not_downgrade_successful_relay_live_write() {
        let temp = tempfile::tempdir().expect("isolated CLI home");
        let previous_test_home = std::env::var_os("RELAYDESK_TEST_HOME");
        std::env::set_var("RELAYDESK_TEST_HOME", temp.path());
        crate::settings::reload_settings().unwrap();

        let db = Arc::new(Database::memory().unwrap());
        let state = AppState::new(db.clone());
        let apps = RelayApplyApps {
            claude: true,
            codex: false,
            gemini: false,
        };
        let mut account = account_with_apps(apps);
        account.group_tokens.insert(
            "paid".into(),
            RelayGroupToken {
                token_id: 11,
                key: "sk-synthetic-relay".into(),
            },
        );
        db.save_relay_account(&account).unwrap();
        *state.relay_session.write().unwrap() = Some(account.clone());

        let mut universal = UniversalProvider::new(
            "relay-paid".into(),
            "Synthetic relay".into(),
            "newapi".into(),
            account.base_url.clone(),
            "sk-synthetic-relay".into(),
        );
        universal.apps.claude = true;
        universal.models.claude = Some(ClaudeModelConfig {
            model: Some("fixture-old-model".into()),
            ..Default::default()
        });
        ProviderService::upsert_universal(&state, universal).unwrap();
        let child_id =
            ProviderService::sync_universal_to_app(&state, "relay-paid", AppType::Claude).unwrap();
        ProviderService::switch(&state, AppType::Claude, &child_id).unwrap();
        db.save_mcp_server(&McpServer {
            id: "synthetic-mcp".into(),
            name: "Synthetic MCP".into(),
            server: json!({"command": "synthetic-command"}),
            apps: McpApps {
                claude: true,
                ..Default::default()
            },
            description: None,
            homepage: None,
            docs: None,
            tags: Vec::new(),
        })
        .unwrap();
        std::fs::write(
            temp.path().join(".claude.json"),
            "{ malformed synthetic json",
        )
        .unwrap();
        assert!(McpService::sync_enabled_for_app(&state, &AppType::Claude).is_err());

        let results = apply_model_blocking(
            &state,
            &mut account,
            "paid",
            "fixture-new-model",
            "sk-synthetic-relay",
            vec![AppType::Claude],
            &|_, _| {},
        )
        .unwrap();

        assert_eq!(results.len(), 1);
        assert!(results[0].ok);
        assert_eq!(
            db.get_relay_account()
                .unwrap()
                .unwrap()
                .last_applied
                .unwrap()
                .model,
            "fixture-new-model"
        );
        let live: serde_json::Value =
            crate::config::read_json_file(&crate::config::get_claude_settings_path()).unwrap();
        assert_eq!(
            live["env"]["ANTHROPIC_MODEL"].as_str(),
            Some("fixture-new-model")
        );

        match previous_test_home {
            Some(value) => std::env::set_var("RELAYDESK_TEST_HOME", value),
            None => std::env::remove_var("RELAYDESK_TEST_HOME"),
        }
    }
}
