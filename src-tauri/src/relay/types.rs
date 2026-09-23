//! new-api 中转站账号与模型类型定义。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 中转站专用令牌的命名前缀（分组令牌名 = `relaydesk-<group>`）
pub const TOKEN_NAME_PREFIX: &str = "relaydesk-";

/// 统一供应商 ID 前缀（`relay-<group>`，同分组内换模型复用同一条目）
pub const UNIVERSAL_ID_PREFIX: &str = "relay-";

/// 下发配置的目标应用
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayApplyApps {
    #[serde(default = "default_true")]
    pub claude: bool,
    #[serde(default = "default_true")]
    pub codex: bool,
    #[serde(default = "default_true")]
    pub gemini: bool,
}

fn default_true() -> bool {
    true
}

impl Default for RelayApplyApps {
    fn default() -> Self {
        Self {
            claude: true,
            codex: true,
            gemini: true,
        }
    }
}

/// 某分组下已创建的专用令牌（缓存，避免重复建令牌）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayGroupToken {
    pub token_id: i64,
    pub key: String,
}

/// 最近一次应用的模型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayAppliedModel {
    pub group: String,
    pub model: String,
}

/// 中转站 `/api/status` 返回的额度显示口径。
/// 所有字段均可缺省，缺省时前端必须保留原始 quota 单位。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayCurrencyConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency_symbol: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quota_per_unit: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quota_display_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_in_currency: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_currency_exchange_rate: Option<f64>,
}

/// 中转站账号（持久化到本地数据库 settings KV）
///
/// `access_token` 为 new-api 系统访问令牌（`GET /api/user/token`），
/// 以 Bearer 方式认证全部用户态接口，即长效免登凭据。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayAccount {
    /// 中转站实例地址（origin，无尾部斜杠）
    pub base_url: String,
    /// 系统访问令牌
    #[serde(default, skip_serializing, skip_deserializing)]
    pub access_token: String,
    /// 是否允许在应用重启后恢复本地登录会话。
    ///
    /// 该标记只控制本地会话恢复，不会把密码传给 renderer；旧账号缺失
    /// 此字段时按未勾选处理，避免升级后意外恢复旧会话。
    #[serde(default)]
    pub remembered: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_id: Option<i64>,
    #[serde(default)]
    pub username: String,
    /// 剩余额度（原始 quota 单位，500000 = $1）
    #[serde(default)]
    pub quota: i64,
    #[serde(default)]
    pub used_quota: i64,
    /// 由 `/api/status` 提供的显示口径；旧账号没有这些字段时保持 None。
    #[serde(flatten)]
    pub currency: RelayCurrencyConfig,
    /// 用户默认分组
    #[serde(default)]
    pub group: String,
    /// 模型应用目标
    #[serde(default)]
    pub apply_apps: RelayApplyApps,
    /// 用户覆盖的分组目标映射 {group: claude|codex|gemini}
    #[serde(default)]
    pub group_targets: HashMap<String, String>,
    /// 各分组已创建的专用令牌缓存 {group: {tokenId, key}}
    #[serde(default)]
    pub group_tokens: HashMap<String, RelayGroupToken>,
    /// 最近一次应用的模型
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_applied: Option<RelayAppliedModel>,
    #[serde(default)]
    pub updated_at: i64,
}

impl RelayAccount {
    /// 面向前端的账号视图（不含令牌与密钥材料）
    pub fn to_info(&self) -> RelayAccountInfo {
        RelayAccountInfo {
            remembered: self.remembered,
            base_url: self.base_url.clone(),
            user_id: self.user_id,
            username: self.username.clone(),
            quota: self.quota,
            used_quota: self.used_quota,
            currency_code: self.currency.currency_code.clone(),
            currency_symbol: self.currency.currency_symbol.clone(),
            quota_per_unit: self.currency.quota_per_unit,
            quota_display_type: self.currency.quota_display_type.clone(),
            display_in_currency: self.currency.display_in_currency,
            custom_currency_exchange_rate: self.currency.custom_currency_exchange_rate,
            group: self.group.clone(),
            apply_apps: self.apply_apps.clone(),
            group_targets: self.group_targets.clone(),
            last_applied: self.last_applied.clone(),
            updated_at: self.updated_at,
        }
    }
}

/// 面向前端返回的账号信息（不携带 access_token / sk- key）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayAccountInfo {
    pub remembered: bool,
    pub base_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<i64>,
    pub username: String,
    pub quota: i64,
    pub used_quota: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub currency_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub currency_symbol: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quota_per_unit: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quota_display_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_in_currency: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_currency_exchange_rate: Option<f64>,
    pub group: String,
    pub apply_apps: RelayApplyApps,
    pub group_targets: HashMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_applied: Option<RelayAppliedModel>,
    pub updated_at: i64,
}

/// 用户可用分组
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayGroup {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ratio: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub desc: Option<String>,
}

/// 分组下的模型列表
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayGroupModels {
    pub group: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ratio: Option<f64>,
    pub models: Vec<RelayModelInfo>,
}

/// 模型信息（合并 /api/models 与 /api/pricing）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayModelInfo {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// 能力标签（pricing.tags，如 tools/vision/reasoning）
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    /// 模型倍率
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_ratio: Option<f64>,
    /// 分组倍率
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_ratio: Option<f64>,
    /// 按次计费价（quota_type=1 时为 per-call 价格，单位 quota）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_price: Option<f64>,
    /// 计费类型：0=按量 1=按次
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quota_type: Option<i64>,
    /// 补全倍率
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completion_ratio: Option<f64>,
}

/// 中转站令牌条目（列表视图，key 为掩码）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayToken {
    pub id: i64,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub key: String,
    #[serde(default)]
    pub status: i64,
    #[serde(default)]
    pub group: String,
    #[serde(default)]
    pub created_time: i64,
    #[serde(default)]
    pub used_quota: i64,
}

// ── 钱包、充值与中转站账单 DTO ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayTopupAmountOption {
    pub amount: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credit_amount: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub currency_symbol: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayTopupPaymentMethod {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayTopupInfo {
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub currency_symbol: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub amount_options: Vec<RelayTopupAmountOption>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub pay_methods: Vec<RelayTopupPaymentMethod>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_amount: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayTopupQuote {
    pub amount: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pay_amount: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credit_amount: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub currency_symbol: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayTopupOrder {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trade_no: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paid_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credited_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub amount: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pay_amount: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credit_amount: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub currency_symbol: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checkout_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checkout_method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayTopupHistory {
    pub items: Vec<RelayTopupOrder>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_complete: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayUsageQuery {
    pub start: String,
    pub end: String,
    #[serde(default)]
    pub timezone: Option<String>,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub model_name: Option<String>,
    #[serde(default)]
    pub token_name: Option<String>,
    #[serde(default, rename = "type")]
    pub r#type: Option<String>,
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default)]
    pub page_size: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayUsageModelRow {
    pub detail_request_count: Option<i64>,
    pub details_reconciled: Option<bool>,
    pub model_id: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub billing_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_alias_masked: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_read_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_write_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub charged_quota: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub charged_amount: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub currency_symbol: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub success_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failed_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub success_rate: Option<f64>,
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayUsageOverview {
    pub start: String,
    pub end: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timezone: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub as_of: Option<String>,
    pub is_complete: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub charged_quota: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub charged_amount: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub currency_symbol: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_delay_seconds: Option<i64>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub unavailable_fields: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayUsageBucket {
    pub timestamp: i64,
    pub model_id: String,
    pub request_count: i64,
    pub total_tokens: i64,
    pub charged_quota: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayUsageModels {
    pub buckets: Vec<RelayUsageBucket>,
    pub details_status: String,
    pub items: Vec<RelayUsageModelRow>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
    pub is_complete: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub as_of: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timezone: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub unavailable_fields: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

/// 单个应用的切换结果
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayApplyResult {
    pub app: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Renderer-visible progress for one apply request. Never contains credentials.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayApplyProgress {
    pub request_id: String,
    pub stage: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app: Option<String>,
}
