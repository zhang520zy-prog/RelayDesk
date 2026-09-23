use crate::database::Database;
use crate::proxy::providers::codex_oauth_auth::CodexOAuthManager;
use crate::relay::RelayAccount;
use crate::services::{ProxyService, UsageCache};
use std::sync::Arc;
use std::sync::RwLock;

/// 全局应用状态
#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Database>,
    pub proxy_service: ProxyService,
    pub usage_cache: Arc<UsageCache>,
    /// 当前进程内的 Relay 会话。未勾选“记住登录”时，重启后不会从
    /// settings 恢复，但当前进程仍可继续使用已登录会话。
    pub(crate) relay_auth_gate: Arc<tokio::sync::Mutex<()>>,
    pub(crate) relay_vault: Arc<std::sync::Mutex<crate::relay::credentials::VaultStore>>,
    pub relay_session: Arc<RwLock<Option<RelayAccount>>>,
    // 内部已使用细粒度锁（accounts/access_tokens/refresh_locks），所有方法均为
    // `&self`，无需外层 RwLock；避免持有粗粒度锁跨网络刷新导致的连锁阻塞。
    pub codex_oauth_manager: Arc<CodexOAuthManager>,
}

impl AppState {
    /// 创建新的应用状态
    pub fn new(db: Arc<Database>) -> Self {
        let codex_oauth_manager =
            Arc::new(CodexOAuthManager::new(crate::config::get_app_config_dir()));
        let proxy_service =
            ProxyService::new_with_codex_oauth_manager(db.clone(), codex_oauth_manager.clone());

        Self {
            db,
            proxy_service,
            usage_cache: Arc::new(UsageCache::new()),
            relay_auth_gate: Arc::new(tokio::sync::Mutex::new(())),
            relay_vault: Arc::new(std::sync::Mutex::new(crate::relay::credentials::app_store())),
            relay_session: Arc::new(RwLock::new(None)),
            codex_oauth_manager,
        }
    }
}
