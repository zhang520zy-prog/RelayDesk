//! 中转站（new-api）集成模块
//!
//! - `types`：账号/分组/模型/令牌等数据类型
//! - `client`：用户态 API HTTP 客户端（登录、系统访问令牌、分组、模型、令牌管理）
//! - `service`：业务编排（登录、账号信息、一键应用模型到各 agent）

mod client;
mod service;
mod types;

pub use service::RelayService;
pub use types::{
    RelayAccount, RelayAccountInfo, RelayAppliedModel, RelayApplyApps, RelayApplyProgress,
    RelayApplyResult, RelayGroup, RelayGroupModels, RelayGroupToken, RelayModelInfo, RelayToken,
};
