//! new-api 中转站用户态 API 客户端。
//!
//! 认证模型（M0 实测，v1.0.0-rc.25）：
//! - `POST /api/user/login` → JWT access_token（15min）+ session（30d）
//! - `GET /api/user/token` → 系统访问令牌，Bearer 可认证全部用户态接口（长效免登）
//!
//! 所有用户态响应统一信封 `{success, message, data}`，此处集中拆包。

use serde_json::Value;
use std::collections::HashMap;
use std::time::Duration;

use super::types::{RelayCurrencyConfig, RelayGroup, RelayModelInfo, RelayToken, RelayUsageQuery};
use crate::error::AppError;

const REQ_TIMEOUT: Duration = Duration::from_secs(30);

/// 登录返回（access_token + 可选的 30d session cookie；其余字段取 user_self）
pub struct LoginResult {
    pub access_token: String,
    /// `Set-Cookie` 里全部 `name=value` 对拼接值；站点未种 cookie 时为 None
    pub session_cookie: Option<String>,
}

pub struct RelayClient {
    base_url: String,
    access_token: String,
    session_cookie: Option<String>,
}

impl RelayClient {
    pub fn new(base_url: &str, access_token: &str) -> Self {
        Self {
            base_url: normalize_base_url(base_url),
            access_token: access_token.to_string(),
            session_cookie: None,
        }
    }

    /// 在 Bearer 之外附加 new-api 30d 会话 Cookie（登录响应 Set-Cookie）。
    /// 站点禁用 `/api/user/token` 时，Cookie 是 JWT 15min 过期后的唯一长效凭据。
    pub fn with_session_cookie(mut self, cookie: Option<&str>) -> Self {
        self.session_cookie = cookie
            .filter(|c| !c.trim().is_empty())
            .map(|c| c.trim().to_string());
        self
    }

    /// 由账号构造：自动携带已保存的 session cookie（若有）。
    pub fn for_account(account: &super::types::RelayAccount) -> Self {
        Self::new(&account.base_url, &account.access_token)
            .with_session_cookie(Some(account.session_cookie.as_str()))
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    fn url(&self, path: &str) -> String {
        // Only the official site's management API moved. Keep the stored
        // model gateway origin unchanged when projecting tool configuration.
        if self.base_url == "https://yjapi.manqiaotechnology.com" && path.starts_with("/api/") {
            return format!("{}/958c19c404a5{}", self.base_url, path);
        }
        format!("{}{}", self.base_url, path)
    }

    /// 统一请求：附加 Bearer（若已持有令牌）与 session Cookie（若已捕获）、
    /// 校验 success 并返回（完整响应体, Set-Cookie 列表）。
    async fn request_full_resp(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<(Value, Vec<String>), AppError> {
        let client = crate::proxy::http_client::get();
        let mut req = client
            .request(method, self.url(path))
            .header("Accept", "application/json")
            .timeout(REQ_TIMEOUT);
        if !self.access_token.is_empty() {
            req = req.header("Authorization", format!("Bearer {}", self.access_token));
        }
        if let Some(cookie) = &self.session_cookie {
            req = req.header(reqwest::header::COOKIE, cookie.clone());
        }
        if let Some(b) = body {
            req = req.json(&b);
        }

        let resp = req
            .send()
            .await
            .map_err(|e| AppError::Message(format!("网络请求失败: {e}")))?;
        let set_cookies: Vec<String> = resp
            .headers()
            .get_all(reqwest::header::SET_COOKIE)
            .iter()
            .filter_map(|v| v.to_str().ok())
            .map(str::to_string)
            .collect();
        let status = resp.status();
        let raw = resp
            .bytes()
            .await
            .map_err(|e| AppError::Message(format!("读取响应失败: {e}")))?;
        let body: Value = serde_json::from_slice(&raw).unwrap_or_else(|_| {
            Value::String(String::from_utf8_lossy(&raw).chars().take(300).collect())
        });

        if !status.is_success() {
            let msg = body
                .get("message")
                .or_else(|| body.get("error"))
                .and_then(|v| v.as_str())
                .map(str::to_string)
                .unwrap_or_else(|| body.to_string());
            return Err(AppError::HttpStatus {
                status: status.as_u16(),
                body: msg,
            });
        }

        // new-api 信封：{success: bool, message, data}
        if let Some(obj) = body.as_object() {
            if obj.contains_key("success") {
                let success = body
                    .get("success")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                if !success {
                    let msg = body
                        .get("message")
                        .and_then(|v| v.as_str())
                        .unwrap_or("请求失败")
                        .to_string();
                    return Err(AppError::Message(msg));
                }
            }
        }
        Ok((body, set_cookies))
    }

    async fn request_full(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<Value, AppError> {
        Ok(self.request_full_resp(method, path, body).await?.0)
    }

    /// 同 request_full，但拆开信封只取 data（常规接口用）
    async fn request(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<Value, AppError> {
        let body = self.request_full(method, path, body).await?;
        if let Some(obj) = body.as_object() {
            if obj.contains_key("success") {
                return Ok(body.get("data").cloned().unwrap_or(Value::Null));
            }
        }
        Ok(body)
    }

    async fn get(&self, path: &str) -> Result<Value, AppError> {
        self.request(reqwest::Method::GET, path, None).await
    }

    /// 返回完整响应体（不拆 data 信封，供 usable_group 等同级字段用）
    async fn get_full(&self, path: &str) -> Result<Value, AppError> {
        self.request_full(reqwest::Method::GET, path, None).await
    }

    async fn post(&self, path: &str, body: Value) -> Result<Value, AppError> {
        self.request(reqwest::Method::POST, path, Some(body)).await
    }

    async fn put(&self, path: &str, body: Value) -> Result<Value, AppError> {
        self.request(reqwest::Method::PUT, path, Some(body)).await
    }

    async fn delete(&self, path: &str) -> Result<Value, AppError> {
        self.request(reqwest::Method::DELETE, path, None).await
    }

    // ── 账号链路 ────────────────────────────────────────────

    /// 从各种形态里找系统访问令牌字符串。只关心"字符串存在"，不做内容校验；
    /// 永不把它写入日志。
    fn token_str(v: &Value) -> Option<String> {
        v.as_str()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    }

    /// 常见 token 字段名（new-api 各 fork 命名不一致）。
    const TOKEN_KEYS: &[&str] = &[
        "token",
        "access_token",
        "system_token",
        "token_key",
        "key",
        "jwt",
        "session_token",
    ];

    fn extract_system_token(data: &Value) -> Option<String> {
        if let Some(s) = Self::token_str(data) {
            return Some(s);
        }
        match data {
            Value::Object(map) => Self::TOKEN_KEYS
                .iter()
                .find_map(|k| map.get(*k).and_then(Self::token_str)),
            Value::Array(items) => items.iter().find_map(Self::extract_system_token),
            _ => None,
        }
    }

    /// 把 `Set-Cookie` 头列表压成可回放的 `Cookie` 头值：
    /// 每条取首个 `;` 前的 `name=value`，全部拼接。永不写日志。
    fn session_cookie_header(set_cookies: &[String]) -> Option<String> {
        let pairs: Vec<&str> = set_cookies
            .iter()
            .filter_map(|raw| raw.split(';').next().map(str::trim))
            .filter(|pair| !pair.is_empty())
            .collect();
        if pairs.is_empty() {
            None
        } else {
            Some(pairs.join("; "))
        }
    }

    fn json_shape_name(v: &Value) -> &'static str {
        match v {
            Value::Null => "null",
            Value::Bool(_) => "bool",
            Value::Number(_) => "number",
            Value::String(_) => "string",
            Value::Array(_) => "array",
            Value::Object(_) => "object",
        }
    }

    /// `POST /api/user/login` → JWT access_token + session cookie（30d）
    ///
    /// session cookie 与 access_token 同敏感：只进内存与加密 vault，永不写日志。
    pub async fn login(
        base_url: &str,
        username: &str,
        password: &str,
    ) -> Result<LoginResult, AppError> {
        let client = Self::new(base_url, "");
        let (body, set_cookies) = client
            .request_full_resp(
                reqwest::Method::POST,
                "/api/user/login",
                Some(serde_json::json!({
                    "username": username,
                    "password": password,
                })),
            )
            .await?;
        let data = if body.as_object().is_some_and(|o| o.contains_key("success")) {
            body.get("data").cloned().unwrap_or(Value::Null)
        } else {
            body
        };
        let access_token = data
            .get("access_token")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| AppError::Message("登录响应缺少 access_token".to_string()))?
            .to_string();
        Ok(LoginResult {
            access_token,
            session_cookie: Self::session_cookie_header(&set_cookies),
        })
    }

    /// `GET /api/user/token` → 系统访问令牌（长效免登凭据）。
    /// new-api 各发行版响应形状不一：裸字符串 / {"token":..} 类对象 /
    /// 列表首项——逐层兼容，避免无谓降级成 15min JWT（会让"记住登录"形同虚设）。
    pub async fn system_token(&self) -> Result<String, AppError> {
        let data = self.get("/api/user/token").await?;
        Self::extract_system_token(&data).ok_or_else(|| {
            AppError::Message(format!(
                "系统访问令牌响应格式异常: {}",
                Self::json_shape_name(&data)
            ))
        })
    }

    /// `GET /api/user/self` → {id, username, quota, used_quota, group, ...}
    pub async fn user_self(&self) -> Result<Value, AppError> {
        self.get("/api/user/self").await
    }

    /// 公共站点状态，用于读取服务端货币和 quota 显示口径。
    pub async fn currency_config(&self) -> Result<RelayCurrencyConfig, AppError> {
        let body = self.get_full("/api/status").await?;
        parse_currency_config(&body)
            .ok_or_else(|| AppError::Message("relay.currency_config_missing".to_string()))
    }

    /// 充值配置。响应字段由 service 层做兼容归一化。
    pub async fn topup_info(&self) -> Result<Value, AppError> {
        self.get("/api/user/topup/info").await
    }

    pub async fn topup_quote(&self, method: &str, amount: f64) -> Result<Value, AppError> {
        let path = topup_amount_path(method)
            .ok_or_else(|| AppError::Message("relay.invalid_payment_method".to_string()))?;
        self.post(path, topup_amount_body(amount)?).await
    }

    pub async fn create_topup_payment(
        &self,
        method: &str,
        amount: f64,
        client_request_id: &str,
    ) -> Result<Value, AppError> {
        let path = topup_pay_path(method)
            .ok_or_else(|| AppError::Message("relay.invalid_payment_method".to_string()))?;
        let mut body = topup_amount_body(amount)?;
        body["payment_method"] = Value::String(method.to_string());
        let _ = client_request_id;
        self.request_full(reqwest::Method::POST, path, Some(body))
            .await
    }

    /// 兑换码充值：new-api `POST /api/user/topup {key}`——与站点"兑换额度"同源。
    pub async fn redeem_code(&self, key: &str) -> Result<Value, AppError> {
        self.post("/api/user/topup", serde_json::json!({ "key": key }))
            .await
    }

    /// 按类型拉取用户日志（new-api LogType）：1=充值到账、3=管理员调整、6=退款。
    /// 分页按类型独立进行，必须用指定 type 分别请求，不能 type=0 拉全量。
    pub async fn recharge_logs(
        &self,
        log_type: u32,
        page: u32,
        page_size: u32,
    ) -> Result<Value, AppError> {
        self.get(&format!(
            "/api/log/self?type={log_type}&p={}&page_size={}",
            page.max(1),
            page_size.clamp(1, 100)
        ))
        .await
    }

    pub async fn topup_history(&self, page: u32, page_size: u32) -> Result<Value, AppError> {
        self.get(&format!(
            "/api/user/topup/self?p={}&page_size={}",
            page.max(1),
            page_size.clamp(1, 100)
        ))
        .await
    }

    /// 仅消费站点明确提供的模型聚合契约；原始 `/api/log/self/stat` 不得
    /// 被当作 RelayDesk 的账单或模型对比数据源。
    pub async fn usage_models(&self, query: &RelayUsageQuery) -> Result<Value, AppError> {
        self.get(&usage_path(query)?).await
    }

    pub async fn usage_details(&self, query: &RelayUsageQuery) -> Result<Value, AppError> {
        // 站点日志保留期可能比查询窗短（limitLogTimeRange 直接报错），
        // 失败时退化为不带时间窗的全量日志——按 model_name 匹配仍准确。
        // usage_path 对明细查询的窗口校验同样可能失败（聚合桶时间戳单位
        // 差异等），此时不能静默返回——直接走无窗口兜底并记录原因。
        let bases: Vec<(bool, String)> = match usage_path(query) {
            Ok(base) => vec![
                (
                    true,
                    format!(
                        "{}&type=2",
                        base.replace("/api/data/self?", "/api/log/self?")
                    ),
                ),
                (false, "/api/log/self?type=2".to_string()),
            ],
            Err(error) => {
                log::warn!(
                    "usage details: ranged path rejected ({error}), using unbounded log query"
                );
                vec![(false, "/api/log/self?type=2".to_string())]
            }
        };
        for (ranged, base) in bases {
            match self.usage_details_page(&base).await {
                Ok(rows) => {
                    log::info!(
                        "usage details fetched: {} rows (ranged={})",
                        rows.as_array().map(|a| a.len()).unwrap_or(0),
                        ranged
                    );
                    return Ok(rows);
                }
                Err(error) if !ranged => {
                    log::warn!("usage details unbounded query failed: {error}");
                    return Err(error);
                }
                Err(error) => {
                    log::info!("usage details ranged query failed, retrying unbounded: {error}");
                    continue;
                }
            }
        }
        unreachable!()
    }

    async fn usage_details_page(&self, base: &str) -> Result<Value, AppError> {
        // 页大小取 200：站点若钳制回 100 也能工作——判停用"服务器实际
        // 返回的页长"而非请求值。页数上限配合行数预算：200 条/页 × 60 页
        // = 12,000 行，覆盖常规账号一个月的消耗日志量级。
        const PAGE_SIZE: u32 = 200;
        const MAX_PAGES: u32 = 60;
        let mut rows = Vec::new();
        let mut expected = None;
        let mut eff_page_len: Option<usize> = None;
        for page in 1..=MAX_PAGES {
            let data = self
                .get(&format!("{base}&p={page}&page_size={PAGE_SIZE}"))
                .await?;
            // 站点版本差异：行数组可能在 items / logs / data / 顶层数组；
            // total 可能叫 count 或完全缺失（此时按"最后一页不足页长"收尾）。
            let items = ["items", "logs", "data"]
                .iter()
                .find_map(|key| data.get(*key).and_then(Value::as_array))
                .or_else(|| data.as_array());
            let Some(items) = items else {
                if page == 1 {
                    return Err(AppError::Message("relay.usage_details_incomplete".into()));
                }
                break;
            };
            let total = data
                .get("total")
                .or_else(|| data.get("count"))
                .and_then(Value::as_u64);
            if let (Some(expected), Some(total)) = (expected, total) {
                if expected != total {
                    break;
                }
            }
            if expected.is_none() {
                expected = total;
            }
            let page_len = items.len();
            if page_len == 0 {
                break;
            }
            // 服务器可能把 page_size 钳制到更小的值：以首页实际返回
            // 长度为"满页"基准，后续不足该长度即视为末页。
            let full = *eff_page_len.get_or_insert(page_len);
            rows.extend(items.iter().cloned());
            log::info!(
                "usage details page {page}: +{page_len} rows (total={total:?}, cumulative={})",
                rows.len()
            );
            match total {
                Some(total) if rows.len() < total as usize => continue,
                Some(_) => return Ok(Value::Array(rows)),
                None if page_len < full => return Ok(Value::Array(rows)),
                None => continue,
            }
        }
        if rows.is_empty() {
            Err(AppError::Message("relay.usage_details_incomplete".into()))
        } else {
            log::warn!(
                "usage details truncated at {} rows (page budget exhausted)",
                rows.len()
            );
            Ok(Value::Array(rows))
        }
    }

    /// 用户可选分组：合并 `/api/user/self/groups`（网页端建 key 分组下拉的
    /// 同源数据，token 绑定的权威范围）与 `/api/pricing` usable_group，
    /// 任一端独有的分组都保留，避免应用端分组少于网页端。
    pub async fn groups(&self) -> Result<Vec<RelayGroup>, AppError> {
        let mut merged: HashMap<String, RelayGroup> = HashMap::new();

        if let Ok(data) = self.get("/api/user/self/groups").await {
            if let Some(map) = data.as_object() {
                for (name, value) in map {
                    // 兼容 {name: {ratio, desc}} 与 {name: 0.85} 两种形态
                    let ratio = value
                        .as_f64()
                        .or_else(|| extract_f64(value, &["ratio", "group_ratio", "rate"]))
                        .or_else(|| {
                            value
                                .get("ratio")
                                .and_then(|v| v.as_str())
                                .and_then(|s| s.parse::<f64>().ok())
                        });
                    let desc = extract_str(value, &["desc", "description"]);
                    merged.insert(
                        name.clone(),
                        RelayGroup {
                            name: name.clone(),
                            ratio,
                            desc,
                        },
                    );
                }
            }
        }

        if let Ok(bundle) = self.pricing_bundle().await {
            for (name, desc) in &bundle.usable_group {
                let entry = merged.entry(name.clone()).or_insert_with(|| RelayGroup {
                    name: name.clone(),
                    ratio: None,
                    desc: None,
                });
                if entry.ratio.is_none() {
                    entry.ratio = bundle.group_ratio.get(name).copied();
                }
                if entry.desc.is_none() && !desc.is_empty() {
                    entry.desc = Some(desc.clone());
                }
            }
        }

        if merged.is_empty() {
            return Err(AppError::Message("relay.sync_failed".to_string()));
        }
        let mut groups: Vec<RelayGroup> = merged.into_values().collect();
        groups.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(groups)
    }

    /// 用户可选分组名集合：self/groups ∪ pricing usable_group。
    /// self/groups 失败时退回 usable_group（匿名/异常场景仍有过滤基准）。
    async fn usable_group_names(
        &self,
        bundle: &PricingBundle,
    ) -> std::collections::HashSet<String> {
        let mut names: std::collections::HashSet<String> =
            bundle.usable_group.keys().cloned().collect();
        if let Ok(data) = self.get("/api/user/self/groups").await {
            if let Some(map) = data.as_object() {
                names.extend(map.keys().cloned());
            }
        }
        names
    }

    /// 分组 → 模型。模型→分组的绑定以 `/api/pricing` 每项的
    /// `enable_groups`（分组名数组）为准；`/api/models` 按渠道 ID 聚合，不可用。
    /// 只保留用户可选分组（usable_group 为空时不过滤）。
    pub async fn models_by_group(&self) -> Result<HashMap<String, Vec<RelayModelInfo>>, AppError> {
        let bundle = self.pricing_bundle().await?;
        let usable = self.usable_group_names(&bundle).await;
        let mut out: HashMap<String, Vec<RelayModelInfo>> = HashMap::new();
        for (info, enable_groups) in &bundle.items {
            for g in enable_groups {
                if !usable.is_empty() && !usable.contains(g) {
                    continue;
                }
                let mut m = info.clone();
                m.group_ratio = bundle.group_ratio.get(g).copied();
                out.entry(g.clone()).or_default().push(m);
            }
        }
        // 可用分组无模型时也保留条目，便于前端展示空分组
        for g in &usable {
            out.entry(g.clone()).or_default();
        }
        for models in out.values_mut() {
            models.sort_by(|a, b| a.id.cmp(&b.id));
            models.dedup_by(|a, b| a.id == b.id);
        }
        Ok(out)
    }

    /// `GET /api/pricing` → {usable_group, group_ratio, data: [模型定价...]}
    /// usable_group/group_ratio 与 data 同级，必须用完整响应体。
    async fn pricing_bundle(&self) -> Result<PricingBundle, AppError> {
        let body = self.get_full("/api/pricing").await?;

        let mut usable_group = HashMap::new();
        if let Some(obj) = body.get("usable_group").and_then(|v| v.as_object()) {
            for (k, v) in obj {
                usable_group.insert(k.clone(), v.as_str().unwrap_or_default().to_string());
            }
        }

        let mut group_ratio = HashMap::new();
        if let Some(obj) = body.get("group_ratio").and_then(|v| v.as_object()) {
            for (k, v) in obj {
                let ratio = v
                    .as_f64()
                    .or_else(|| v.as_str().and_then(|s| s.parse::<f64>().ok()));
                if let Some(n) = ratio {
                    group_ratio.insert(k.clone(), n);
                }
            }
        }

        let data = body.get("data").cloned().unwrap_or(Value::Null);
        // data 可能是数组或 {models: [...]}
        let arr: Vec<&Value> = match &data {
            Value::Array(a) => a.iter().collect(),
            Value::Object(o) => o
                .get("models")
                .and_then(|v| v.as_array())
                .map(|a| a.iter().collect())
                .unwrap_or_default(),
            _ => Vec::new(),
        };

        let mut items = Vec::new();
        for item in arr {
            let Some(name) = extract_str(item, &["model_name", "model", "id"]) else {
                continue;
            };
            let str_list = |key: &str| -> Vec<String> {
                item.get(key)
                    .and_then(|v| v.as_array())
                    .map(|a| {
                        a.iter()
                            .filter_map(|x| x.as_str().map(str::to_string))
                            .collect()
                    })
                    .unwrap_or_default()
            };
            items.push((
                RelayModelInfo {
                    id: name,
                    description: extract_str(item, &["description", "desc"]),
                    tags: str_list("tags"),
                    model_ratio: extract_f64(item, &["model_ratio", "ratio"]),
                    group_ratio: None,
                    model_price: extract_f64(item, &["model_price", "price"]),
                    quota_type: extract_i64(item, &["quota_type"]),
                    completion_ratio: extract_f64(item, &["completion_ratio"]),
                },
                str_list("enable_groups"),
            ));
        }
        Ok(PricingBundle {
            usable_group,
            group_ratio,
            items,
        })
    }

    // ── 令牌管理 ────────────────────────────────────────────

    /// `GET /api/token/?p=0&page_size=...` → {items: [...]}
    pub async fn list_tokens(&self) -> Result<Vec<RelayToken>, AppError> {
        let data = self.get("/api/token/?p=0&page_size=200").await?;
        let items = data
            .get("items")
            .and_then(|v| v.as_array())
            .or_else(|| data.as_array())
            .cloned()
            .unwrap_or_default();
        let mut tokens = Vec::new();
        for item in items {
            let id = extract_i64(&item, &["id"]).unwrap_or(0);
            tokens.push(RelayToken {
                id,
                name: extract_str(&item, &["name"]).unwrap_or_default(),
                key: extract_str(&item, &["key"]).unwrap_or_default(),
                status: extract_i64(&item, &["status"]).unwrap_or(1),
                group: extract_str(&item, &["group"]).unwrap_or_default(),
                created_time: extract_i64(&item, &["created_time"]).unwrap_or(0),
                used_quota: extract_i64(&item, &["used_quota"]).unwrap_or(0),
            });
        }
        Ok(tokens)
    }

    /// `POST /api/token/` 创建绑定分组的专用令牌（创建响应不含完整 key）
    pub async fn create_token(&self, name: &str, group: &str) -> Result<(), AppError> {
        self.post(
            "/api/token/",
            serde_json::json!({
                "name": name,
                "expired_time": -1,
                "unlimited_quota": true,
                "model_limits_enabled": false,
                "group": group,
            }),
        )
        .await?;
        Ok(())
    }

    /// `POST /api/token/{id}/key` → 完整 sk- key
    pub async fn get_token_key(&self, id: i64) -> Result<String, AppError> {
        let data = self
            .post(&format!("/api/token/{id}/key"), Value::Null)
            .await?;
        let raw = extract_str(&data, &["key"])
            .or_else(|| data.as_str().map(str::to_string))
            .ok_or_else(|| AppError::Message("获取令牌 key 响应格式异常".to_string()))?;
        Ok(normalize_sk_key(&raw))
    }

    /// `GET /api/token/{id}` → 单个令牌完整字段（更新前先取回，避免半量覆盖）
    pub async fn get_token(&self, id: i64) -> Result<Value, AppError> {
        self.get(&format!("/api/token/{id}")).await
    }

    /// `PUT /api/token/` 更新令牌。payload 须是完整令牌对象：
    /// new-api 的 PUT 是整对象覆盖，字段缺失会被清零。
    pub async fn update_token(&self, payload: Value) -> Result<(), AppError> {
        self.put("/api/token/", payload).await?;
        Ok(())
    }

    /// `DELETE /api/token/{id}` 吊销令牌
    pub async fn delete_token(&self, id: i64) -> Result<(), AppError> {
        self.delete(&format!("/api/token/{id}")).await?;
        Ok(())
    }
}

/// `/api/pricing` 完整响应的拆解结果
struct PricingBundle {
    /// usable_group: {分组名: 描述}，用户实际可选分组（建 token 的合法范围）
    usable_group: HashMap<String, String>,
    /// group_ratio: {分组名: 分组倍率}
    group_ratio: HashMap<String, f64>,
    /// (模型信息, enable_groups 分组名数组)
    items: Vec<(RelayModelInfo, Vec<String>)>,
}

/// Parameters used by the official dashboard, in Unix seconds.
fn usage_path(query: &RelayUsageQuery) -> Result<String, AppError> {
    let parse = |value: &str| {
        chrono::DateTime::parse_from_rfc3339(value)
            .map(|time| time.timestamp())
            .map_err(|_| AppError::Message("relay.invalid_usage_range".into()))
    };
    let start = parse(&query.start)?;
    let end = parse(&query.end)?;
    if start >= end
        || end - start > 32 * 86400
        || query.group.is_some()
        || query.model_name.is_some()
        || query.token_name.is_some()
        || query.r#type.is_some()
        || query.cursor.is_some()
    {
        return Err(AppError::Message("relay.invalid_usage_range".into()));
    }
    Ok(format!(
        "/api/data/self?start_timestamp={start}&end_timestamp={end}&time_granularity=hour"
    ))
}

/// 规范化实例地址：去尾部斜杠；无 scheme 时补 https://。
/// 用户可能把浏览器里的页面地址整段粘进来（如 `/sign-in`、`/console`），
/// 这类 SPA 页面路径会被剥离只保留源站；其余子路径（真实子路径部署）保留。
pub fn normalize_base_url(base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    let with_scheme = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    let Ok(parsed) = url::Url::parse(&with_scheme) else {
        return with_scheme;
    };
    let first_segment = parsed
        .path_segments()
        .and_then(|mut s| s.next())
        .unwrap_or("");
    const SPA_ROUTES: &[&str] = &[
        "sign-in",
        "signin",
        "login",
        "register",
        "signup",
        "console",
        "panel",
        "home",
        "about",
        "pricing",
        "user",
        "token",
        "channel",
        "detail",
        "reset",
        "personal",
        "topup",
        "midjourney",
        "task",
        "model",
        "log",
        "setting",
        "settings",
        "404",
    ];
    if !first_segment.is_empty()
        && SPA_ROUTES.contains(&first_segment.to_ascii_lowercase().as_str())
    {
        let mut origin = format!("{}://{}", parsed.scheme(), parsed.host_str().unwrap_or(""));
        if let Some(port) = parsed.port() {
            origin.push_str(&format!(":{port}"));
        }
        return origin;
    }
    with_scheme
}

/// 把 new-api 返回的 key 规整为 `sk-` 前缀形式（与 m0_verify 一致）
fn normalize_sk_key(raw: &str) -> String {
    let stripped = raw.trim().trim_start_matches("sk-");
    format!("sk-{stripped}")
}

fn extract_str(v: &Value, keys: &[&str]) -> Option<String> {
    for k in keys {
        if let Some(s) = v.get(*k).and_then(|x| x.as_str()) {
            if !s.is_empty() {
                return Some(s.to_string());
            }
        }
    }
    None
}

fn extract_f64(v: &Value, keys: &[&str]) -> Option<f64> {
    for k in keys {
        if let Some(x) = v.get(*k) {
            if let Some(n) = x.as_f64() {
                return Some(n);
            }
            if let Some(s) = x.as_str().and_then(|s| s.parse::<f64>().ok()) {
                return Some(s);
            }
        }
    }
    // 值本身是数字时兜底（分组表可能出现 {name: 0.85} 简写形态）
    if keys.is_empty() {
        return v.as_f64();
    }
    None
}

fn extract_i64(v: &Value, keys: &[&str]) -> Option<i64> {
    for k in keys {
        if let Some(x) = v.get(*k) {
            if let Some(n) = x.as_i64() {
                return Some(n);
            }
            if let Some(n) = x.as_f64() {
                return Some(n as i64);
            }
            if let Some(s) = x.as_str().and_then(|s| s.parse::<i64>().ok()) {
                return Some(s);
            }
        }
    }
    None
}

fn status_data(body: &Value) -> &Value {
    body.get("data").unwrap_or(body)
}

fn parse_currency_config(body: &Value) -> Option<RelayCurrencyConfig> {
    let data = status_data(body);
    let config = RelayCurrencyConfig {
        currency_code: extract_str(data, &["currency_code", "currency", "custom_currency"]),
        currency_symbol: extract_str(data, &["custom_currency_symbol", "currency_symbol"]),
        quota_per_unit: extract_i64(data, &["quota_per_unit"]),
        quota_display_type: extract_str(data, &["quota_display_type"]),
        display_in_currency: data
            .get("display_in_currency")
            .and_then(|value| value.as_bool()),
        custom_currency_exchange_rate: extract_f64(
            data,
            &["custom_currency_exchange_rate", "exchange_rate"],
        ),
    };
    if config.currency_code.is_none()
        && config.currency_symbol.is_none()
        && config.quota_per_unit.is_none()
        && config.quota_display_type.is_none()
        && config.display_in_currency.is_none()
    {
        None
    } else {
        Some(config)
    }
}

fn topup_amount_body(amount: f64) -> Result<Value, AppError> {
    if !amount.is_finite() || amount <= 0.0 || amount.fract() != 0.0 || amount > i32::MAX as f64 {
        return Err(AppError::Message("relay.invalid_amount".into()));
    }
    Ok(serde_json::json!({ "amount": amount as i64 }))
}

fn topup_amount_path(method: &str) -> Option<&'static str> {
    let method = method.trim().to_ascii_lowercase();
    if method.is_empty() {
        return None;
    }
    match method.as_str() {
        "epay" | "alipay" | "wxpay" | "wechat" | "wechatpay" => Some("/api/user/amount"),
        "stripe" => Some("/api/user/stripe/amount"),
        "creem" => Some("/api/user/creem/amount"),
        "waffo" => Some("/api/user/waffo/amount"),
        "waffo_pancake" | "waffo-pancake" => Some("/api/user/waffo-pancake/amount"),
        value if value.starts_with("custom") => Some("/api/user/amount"),
        _ => None,
    }
}

fn topup_pay_path(method: &str) -> Option<&'static str> {
    let method = method.trim().to_ascii_lowercase();
    match method.as_str() {
        "epay" | "alipay" | "wxpay" | "wechat" | "wechatpay" => Some("/api/user/pay"),
        "stripe" => Some("/api/user/stripe/pay"),
        "creem" => Some("/api/user/creem/pay"),
        "waffo" => Some("/api/user/waffo/pay"),
        "waffo_pancake" | "waffo-pancake" => Some("/api/user/waffo-pancake/pay"),
        value if value.starts_with("custom") => Some("/api/user/pay"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrated_management_routes_preserve_model_origin() {
        let current = RelayClient::new("https://www.shenlanqaq.com/", "");
        assert_eq!(current.base_url(), "https://www.shenlanqaq.com");
        for path in ["/api/user/login", "/api/status", "/api/pricing"] {
            assert_eq!(
                current.url(path),
                format!("https://www.shenlanqaq.com{path}")
            );
        }

        let client = RelayClient::new("https://yjapi.manqiaotechnology.com/", "");
        assert_eq!(client.base_url(), "https://yjapi.manqiaotechnology.com");
        for path in [
            "/api/user/login",
            "/api/status",
            "/api/pricing",
            "/api/data/self?start_timestamp=1",
        ] {
            assert_eq!(
                client.url(path),
                format!("https://yjapi.manqiaotechnology.com/958c19c404a5{path}")
            );
        }
        assert_eq!(
            client.url("/v1/models"),
            "https://yjapi.manqiaotechnology.com/v1/models"
        );
        assert_eq!(
            RelayClient::new("https://relay.example.test/prefix", "").url("/api/status"),
            "https://relay.example.test/prefix/api/status"
        );
    }

    #[test]
    fn pasted_page_urls_strip_spa_routes() {
        // 新手常见操作：从浏览器地址栏整段复制页面地址
        for pasted in [
            "https://relay.example.test/sign-in",
            "https://relay.example.test/console/token",
            "relay.example.test/login",
            "https://relay.example.test/sign-in?next=/console",
        ] {
            assert_eq!(
                normalize_base_url(pasted),
                "https://relay.example.test",
                "pasted: {pasted}"
            );
        }
        // 真实子路径部署不受影响
        assert_eq!(
            normalize_base_url("https://relay.example.test/newapi"),
            "https://relay.example.test/newapi"
        );
        // 端口保留
        assert_eq!(
            normalize_base_url("https://relay.example.test:8443/sign-in"),
            "https://relay.example.test:8443"
        );
        assert_eq!(
            RelayClient::new("https://yjapi.manqiaotechnology.com/958c19c404a5", "")
                .url("/api/status"),
            "https://yjapi.manqiaotechnology.com/958c19c404a5/api/status"
        );
    }

    #[test]
    fn parses_server_currency_configuration_without_defaulting_to_dollars() {
        let status = serde_json::json!({
            "success": true,
            "data": {
                "custom_currency_symbol": "¥",
                "custom_currency_exchange_rate": 1.0,
                "quota_display_type": "CUSTOM",
                "quota_per_unit": 500000,
                "display_in_currency": true
            }
        });
        let parsed = parse_currency_config(&status).expect("currency config");
        assert_eq!(parsed.currency_symbol.as_deref(), Some("¥"));
        assert_eq!(parsed.quota_per_unit, Some(500000));
        assert_eq!(parsed.display_in_currency, Some(true));
    }

    #[test]
    fn quote_amount_is_an_integer_on_the_wire() {
        let body = topup_amount_body(100.0).unwrap();
        assert_eq!(body.to_string(), "{\"amount\":100}");
        assert!(topup_amount_body(1.5).is_err());
        assert!(topup_amount_body(f64::NAN).is_err());
    }

    #[test]
    fn topup_method_paths_are_allowlisted() {
        assert_eq!(topup_amount_path("epay"), Some("/api/user/amount"));
        assert_eq!(topup_amount_path("stripe"), Some("/api/user/stripe/amount"));
        assert_eq!(topup_amount_path("arbitrary"), None);
    }

    #[test]
    fn usage_queries_use_the_explicit_billing_contract_paths() {
        let query = RelayUsageQuery {
            start: "2026-09-01T00:00:00Z".into(),
            end: "2026-09-02T00:00:00Z".into(),
            timezone: Some("Asia/Shanghai".into()),
            group: None,
            model_name: None,
            token_name: None,
            r#type: None,
            cursor: None,
            page_size: Some(50),
        };
        assert_eq!(usage_path(&query).unwrap(), "/api/data/self?start_timestamp=1788220800&end_timestamp=1788307200&time_granularity=hour");
    }
}
