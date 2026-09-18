//! 中转站（new-api）相关 Tauri 命令。

use tauri::{AppHandle, Emitter, State};

use crate::error::AppError;
use crate::relay::{
    RelayAccountInfo, RelayApplyApps, RelayApplyProgress, RelayApplyResult, RelayGroup,
    RelayGroupModels, RelayService, RelayToken,
};
use crate::store::AppState;

/// 登录中转站（用户名/邮箱 + 密码）→ 自动换取长效系统访问令牌并落库
#[tauri::command]
pub async fn relay_login(
    state: State<'_, AppState>,
    base_url: String,
    username: String,
    password: String,
) -> Result<RelayAccountInfo, String> {
    RelayService::login(state.inner(), &base_url, &username, &password)
        .await
        .map_err(|e| safe_relay_error(&e, true))
}

/// 已存账号信息（不触网）；未登录返回 None
#[tauri::command]
pub fn relay_get_account(state: State<'_, AppState>) -> Result<Option<RelayAccountInfo>, String> {
    RelayService::account(state.inner()).map_err(|e| safe_relay_error(&e, false))
}

/// 联网刷新额度/账号信息
#[tauri::command]
pub async fn relay_refresh_account(state: State<'_, AppState>) -> Result<RelayAccountInfo, String> {
    RelayService::refresh_account(state.inner())
        .await
        .map_err(|e| safe_relay_error(&e, false))
}

/// 退出登录（清除本地账号与令牌缓存）
#[tauri::command]
pub fn relay_logout(state: State<'_, AppState>) -> Result<bool, String> {
    RelayService::logout(state.inner())
        .map(|_| true)
        .map_err(|e| safe_relay_error(&e, false))
}

/// 用户可用分组（含倍率）
#[tauri::command]
pub async fn relay_list_groups(state: State<'_, AppState>) -> Result<Vec<RelayGroup>, String> {
    RelayService::groups(state.inner())
        .await
        .map_err(|e| safe_relay_error(&e, false))
}

/// 按分组聚合的可用模型（含倍率/能力标签）
#[tauri::command]
pub async fn relay_list_models(
    state: State<'_, AppState>,
) -> Result<Vec<RelayGroupModels>, String> {
    RelayService::models(state.inner())
        .await
        .map_err(|e| safe_relay_error(&e, false))
}

/// 一键应用：为分组确保专用令牌 → 下发到全部启用应用并生效
#[tauri::command]
pub async fn relay_apply_model(
    app: AppHandle,
    state: State<'_, AppState>,
    group: String,
    model: String,
    request_id: Option<String>,
    target_app: Option<String>,
) -> Result<Vec<RelayApplyResult>, String> {
    let request_id = request_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    RelayService::apply_model(
        state.inner(),
        &group,
        &model,
        target_app.as_deref(),
        move |stage, target| {
            let _ = app.emit(
                "relay-apply-progress",
                RelayApplyProgress {
                    request_id: request_id.clone(),
                    stage: stage.to_string(),
                    app: target.map(str::to_string),
                },
            );
        },
    )
    .await
    .map_err(|e| safe_relay_error(&e, false))
}

/// 设置"应用到哪些 agent"
#[tauri::command]
pub fn relay_set_apply_apps(
    state: State<'_, AppState>,
    claude: bool,
    codex: bool,
    gemini: bool,
) -> Result<RelayAccountInfo, String> {
    RelayService::set_apply_apps(
        state.inner(),
        RelayApplyApps {
            claude,
            codex,
            gemini,
        },
    )
    .map_err(|e| safe_relay_error(&e, false))
}

/// 令牌列表（管理用，key 为掩码）
#[tauri::command]
pub async fn relay_list_tokens(state: State<'_, AppState>) -> Result<Vec<RelayToken>, String> {
    RelayService::tokens(state.inner())
        .await
        .map_err(|e| safe_relay_error(&e, false))
}

fn safe_relay_error(error: &AppError, login: bool) -> String {
    match error {
        AppError::Localized { key, .. } => (*key).to_string(),
        AppError::Message(message) if message.starts_with("relay.") => message.clone(),
        AppError::HttpStatus { status: 429, .. } => "relay.rate_limited".to_string(),
        AppError::HttpStatus { status, .. } if *status >= 500 => "relay.network".to_string(),
        AppError::HttpStatus {
            status: 401 | 403, ..
        } if !login => "relay.session_expired".to_string(),
        AppError::HttpStatus {
            status: 400 | 401 | 403 | 422,
            ..
        } if login => "relay.invalid_credentials".to_string(),
        AppError::Message(message)
            if message.contains("网络请求失败") || message.contains("读取响应失败") =>
        {
            "relay.network".to_string()
        }
        _ if login => "relay.invalid_credentials".to_string(),
        _ => "relay.sync_failed".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relay_errors_exposed_to_renderer_never_include_server_details() {
        let raw = AppError::HttpStatus {
            status: 401,
            body: "Authorization: Bearer secret-session".to_string(),
        };
        assert_eq!(safe_relay_error(&raw, false), "relay.session_expired");
        assert_eq!(safe_relay_error(&raw, true), "relay.invalid_credentials");

        let raw = AppError::Message("网络请求失败: sk-secret".to_string());
        assert_eq!(safe_relay_error(&raw, false), "relay.network");

        let throttled = AppError::HttpStatus {
            status: 429,
            body: "retry with accessToken=secret".to_string(),
        };
        assert_eq!(safe_relay_error(&throttled, true), "relay.rate_limited");

        let unavailable = AppError::HttpStatus {
            status: 503,
            body: "upstream Authorization secret".to_string(),
        };
        assert_eq!(safe_relay_error(&unavailable, true), "relay.network");
    }
}
