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

use super::types::{RelayGroup, RelayModelInfo, RelayToken};
use crate::error::AppError;

const REQ_TIMEOUT: Duration = Duration::from_secs(30);

/// 登录返回（仅需 access_token，其余字段取 user_self 获取）
pub struct LoginResult {
    pub access_token: String,
}

pub struct RelayClient {
    base_url: String,
    access_token: String,
}

impl RelayClient {
    pub fn new(base_url: &str, access_token: &str) -> Self {
        Self {
            base_url: normalize_base_url(base_url),
            access_token: access_token.to_string(),
        }
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }

    /// 统一请求：附加 Bearer（若已持有令牌）、校验 success 并返回完整响应体。
    async fn request_full(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<Value, AppError> {
        let client = crate::proxy::http_client::get();
        let mut req = client
            .request(method, self.url(path))
            .header("Accept", "application/json")
            .timeout(REQ_TIMEOUT);
        if !self.access_token.is_empty() {
            req = req.header("Authorization", format!("Bearer {}", self.access_token));
        }
        if let Some(b) = body {
            req = req.json(&b);
        }

        let resp = req
            .send()
            .await
            .map_err(|e| AppError::Message(format!("网络请求失败: {e}")))?;
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
        Ok(body)
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

    async fn delete(&self, path: &str) -> Result<Value, AppError> {
        self.request(reqwest::Method::DELETE, path, None).await
    }

    // ── 账号链路 ────────────────────────────────────────────

    /// `POST /api/user/login` → JWT access_token
    pub async fn login(
        base_url: &str,
        username: &str,
        password: &str,
    ) -> Result<LoginResult, AppError> {
        let client = Self::new(base_url, "");
        let data = client
            .post(
                "/api/user/login",
                serde_json::json!({
                    "username": username,
                    "password": password,
                }),
            )
            .await?;
        let access_token = data
            .get("access_token")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| AppError::Message("登录响应缺少 access_token".to_string()))?
            .to_string();
        Ok(LoginResult { access_token })
    }

    /// `GET /api/user/token` → 系统访问令牌（长效免登凭据）
    pub async fn system_token(&self) -> Result<String, AppError> {
        let data = self.get("/api/user/token").await?;
        data.as_str()
            .map(str::to_string)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| AppError::Message("系统访问令牌响应格式异常".to_string()))
    }

    /// `GET /api/user/self` → {id, username, quota, used_quota, group, ...}
    pub async fn user_self(&self) -> Result<Value, AppError> {
        self.get("/api/user/self").await
    }

    /// 用户可选分组：优先 `/api/pricing` 的 usable_group + group_ratio
    ///（token 只能绑定 usable_group 内的分组）；回退 `/api/user/self/groups`
    pub async fn groups(&self) -> Result<Vec<RelayGroup>, AppError> {
        if let Ok(bundle) = self.pricing_bundle().await {
            if !bundle.usable_group.is_empty() {
                let mut groups: Vec<RelayGroup> = bundle
                    .usable_group
                    .iter()
                    .map(|(name, desc)| RelayGroup {
                        name: name.clone(),
                        ratio: bundle.group_ratio.get(name).copied(),
                        desc: if desc.is_empty() {
                            None
                        } else {
                            Some(desc.clone())
                        },
                    })
                    .collect();
                groups.sort_by(|a, b| a.name.cmp(&b.name));
                return Ok(groups);
            }
        }

        let data = self.get("/api/user/self/groups").await?;
        let mut groups = Vec::new();
        if let Some(map) = data.as_object() {
            for (name, value) in map {
                // 兼容 {name: {ratio, desc}} 与 {name: 0.85} 两种形态
                let ratio = value
                    .as_f64()
                    .or_else(|| extract_f64(value, &["ratio", "group_ratio", "rate"]));
                let desc = extract_str(value, &["desc", "description", "name"]);
                groups.push(RelayGroup {
                    name: name.clone(),
                    ratio,
                    desc,
                });
            }
        }
        groups.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(groups)
    }

    /// 分组 → 模型。模型→分组的绑定以 `/api/pricing` 每项的
    /// `enable_groups`（分组名数组）为准；`/api/models` 按渠道 ID 聚合，不可用。
    /// 只保留用户可选分组（usable_group 为空时不过滤）。
    pub async fn models_by_group(&self) -> Result<HashMap<String, Vec<RelayModelInfo>>, AppError> {
        let bundle = self.pricing_bundle().await?;
        let mut out: HashMap<String, Vec<RelayModelInfo>> = HashMap::new();
        for (info, enable_groups) in &bundle.items {
            for g in enable_groups {
                if !bundle.usable_group.is_empty() && !bundle.usable_group.contains_key(g) {
                    continue;
                }
                let mut m = info.clone();
                m.group_ratio = bundle.group_ratio.get(g).copied();
                out.entry(g.clone()).or_default().push(m);
            }
        }
        // 可用分组无模型时也保留条目，便于前端展示空分组
        for g in bundle.usable_group.keys() {
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

    /// `DELETE /api/token/{id}` 吊销令牌
    #[allow(dead_code)]
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

/// 规范化实例地址：去尾部斜杠；无 scheme 时补 https://
pub fn normalize_base_url(base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    }
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
