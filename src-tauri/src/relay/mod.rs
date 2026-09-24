//! 中转站（new-api）集成模块
//!
//! - `types`：账号/分组/模型/令牌等数据类型
//! - `client`：用户态 API HTTP 客户端（登录、系统访问令牌、分组、模型、令牌管理）
//! - `service`：业务编排（登录、账号信息、一键应用模型到各 agent）

pub(crate) mod checkout;
mod client;
pub(crate) mod credentials;
pub(crate) mod restart;
mod service;
pub(crate) mod tool_registry;
mod types;

pub use restart::{RelayRestartCapability, RelayRestartProgress, RelayRestartResult};
pub use service::RelayService;
pub use types::{
    RelayAccount, RelayAccountInfo, RelayAppliedModel, RelayApplyApps, RelayApplyProgress,
    RelayApplyResult, RelayCurrencyConfig, RelayGroup, RelayGroupModels, RelayGroupToken,
    RelayModelInfo, RelayToken, RelayTopupAmountOption, RelayTopupHistory, RelayTopupInfo,
    RelayTopupOrder, RelayTopupPaymentMethod, RelayTopupQuote, RelayUsageModelRow,
    RelayUsageModels, RelayUsageOverview, RelayUsageQuery,
};
