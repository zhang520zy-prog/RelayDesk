//! 中转站业务编排：登录/账号信息/分组模型/一键应用。
//!
//! 一键应用链路（对应用户流程：点模型 → 自动建 key → 下发全部 agent）：
//! 1. 确保该分组存在 `relaydesk-<group>` 专用令牌（无则静默创建），取完整 sk- key
//! 2. upsert `relay-<group>` 统一供应商（同分组内换模型复用，跨分组各一条目）
//! 3. sync_universal_to_apps 生成/更新 Claude·Codex·Gemini 子供应商
//! 4. 对每个启用应用执行 switch（未激活时）写入 live 配置

use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

use super::client::RelayClient;
use super::types::{
    RelayAccount, RelayAccountInfo, RelayAppliedModel, RelayApplyApps, RelayApplyResult,
    RelayGroup, RelayGroupModels, RelayGroupToken, RelayToken, TOKEN_NAME_PREFIX,
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
    target_app: Option<&str>,
) -> Result<Vec<AppType>, AppError> {
    let candidates = [
        (AppType::Claude, apps.claude),
        (AppType::Codex, apps.codex),
        (AppType::Gemini, apps.gemini),
    ];
    let targets = match target_app {
        Some(target) => {
            let selected = candidates
                .into_iter()
                .find(|(app, _)| app.as_str() == target)
                .ok_or_else(|| AppError::Message("relay.invalid_target".to_string()))?;
            if selected.1 {
                vec![selected.0]
            } else {
                Vec::new()
            }
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

    /// 登录：密码 → JWT → 系统访问令牌 → 用户信息 → 落库
    pub async fn login(
        state: &AppState,
        base_url: &str,
        username: &str,
        password: &str,
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

        let account = RelayAccount {
            base_url: client.base_url().to_string(),
            access_token,
            user_id: extract_i64(&self_user, "id"),
            username: extract_str(&self_user, "username").unwrap_or_else(|| username.to_string()),
            quota: extract_i64(&self_user, "quota").unwrap_or(0),
            used_quota: extract_i64(&self_user, "used_quota").unwrap_or(0),
            group: extract_str(&self_user, "group").unwrap_or_default(),
            apply_apps: RelayApplyApps::default(),
            group_tokens: Default::default(),
            last_applied: None,
            updated_at: now_ts(),
        };
        let account = state.db.save_relay_login_preserving_local(&account)?;
        Ok(account.to_info())
    }

    /// 读取已存账号（不触网）
    pub fn account(state: &AppState) -> Result<Option<RelayAccountInfo>, AppError> {
        Ok(state.db.get_relay_account()?.map(|a| a.to_info()))
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
        let account = state
            .db
            .update_relay_account_if_session(&expected, move |current| {
                current.user_id = refreshed_user_id.or(current.user_id);
                if let Some(username) = refreshed_username {
                    current.username = username;
                }
                if let Some(quota) = refreshed_quota {
                    current.quota = quota;
                }
                if let Some(used_quota) = refreshed_used_quota {
                    current.used_quota = used_quota;
                }
                if let Some(group) = refreshed_group {
                    current.group = group;
                }
                current.updated_at = now_ts();
            })?
            .ok_or_else(session_expired_error)?;
        Ok(account.to_info())
    }

    pub fn logout(state: &AppState) -> Result<(), AppError> {
        state.db.clear_relay_account()
    }

    /// 设置应用下发目标
    pub fn set_apply_apps(
        state: &AppState,
        apps: RelayApplyApps,
    ) -> Result<RelayAccountInfo, AppError> {
        let account = state.db.set_relay_apply_apps(apps)?;
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

    // ── 一键应用 ────────────────────────────────────────────

    /// 点击模型 → 建/取分组令牌 → 统一供应商 → 下发全部启用应用
    pub async fn apply_model(
        state: &AppState,
        group: &str,
        model: &str,
        target_app: Option<&str>,
        progress: impl Fn(&str, Option<&str>) + Send + Sync + 'static,
    ) -> Result<Vec<RelayApplyResult>, AppError> {
        let _permit = apply_gate().try_enter()?;
        let mut account = require_account(state)?;
        resolve_apply_targets(&account.apply_apps, target_app)?;
        let client = RelayClient::new(&account.base_url, &account.access_token);

        // 1. 确保分组专用令牌，取完整 sk- key
        progress("preparing", None);
        let key = ensure_group_token(state, &client, &mut account, group).await?;
        let prepared_token = account.group_tokens.get(group).cloned();
        account = state
            .db
            .update_relay_account_if_session(&account, |current| {
                if let Some(token) = prepared_token {
                    current.group_tokens.insert(group.to_string(), token);
                }
            })?
            .ok_or_else(session_expired_error)?;
        let targets = resolve_apply_targets(&account.apply_apps, target_app)?;

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

    let expected_base_url = account.base_url.clone();
    let expected_user_id = account.user_id;
    let expected_access_token = account.access_token.clone();
    let results = run_target_plan(account, targets, group, model, |app_type| {
        let app = app_type.as_str().to_string();
        progress("syncing", Some(app_type.as_str()));
        let attempt = (|| {
            let latest = require_account(state)?;
            if latest.base_url != expected_base_url
                || latest.user_id != expected_user_id
                || latest.access_token != expected_access_token
            {
                return Err(AppError::Message("relay.session_expired".to_string()));
            }
            resolve_apply_targets(&latest.apply_apps, Some(app_type.as_str()))?;
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
    state
        .db
        .update_relay_account_if_session(account, move |current| {
            if any_success {
                current.last_applied = applied;
                current.updated_at = now_ts();
            }
        })?
        .ok_or_else(session_expired_error)?;

    Ok(results)
}

// ── 工具 ────────────────────────────────────────────────────

fn require_account(state: &AppState) -> Result<RelayAccount, AppError> {
    state
        .db
        .get_relay_account()?
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
        if let Err(clear_error) = state.db.clear_relay_account_if_session(expected) {
            log::warn!("清除失效 RelayDesk 会话失败: {clear_error}");
        }
        session_expired_error()
    } else {
        error
    }
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
            user_id: Some(7),
            username: "tester".to_string(),
            quota: 0,
            used_quota: 0,
            group: "default".to_string(),
            apply_apps,
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
        let targets = resolve_apply_targets(&apps, Some("codex")).unwrap();
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
            resolve_apply_targets(&apps, Some("codex"))
                .unwrap_err()
                .to_string(),
            "relay.no_targets"
        );
    }

    #[test]
    #[serial]
    fn malformed_mcp_does_not_downgrade_successful_relay_live_write() {
        let temp = tempfile::tempdir().expect("isolated CLI home");
        let previous_test_home = std::env::var_os("CC_SWITCH_TEST_HOME");
        std::env::set_var("CC_SWITCH_TEST_HOME", temp.path());
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
            Some(value) => std::env::set_var("CC_SWITCH_TEST_HOME", value),
            None => std::env::remove_var("CC_SWITCH_TEST_HOME"),
        }
    }
}
