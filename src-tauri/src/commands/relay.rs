//! 中转站（new-api）相关 Tauri 命令。

use tauri::{AppHandle, Emitter, State};
use tauri_plugin_opener::OpenerExt;

use crate::error::AppError;
use crate::relay::{
    restart::{self, RelayRestartCapability, RelayRestartProgress, RelayRestartResult},
    tool_registry::{self, DesktopToolDefinition, ToolRegistry},
    RelayAccountInfo, RelayApplyApps, RelayApplyProgress, RelayApplyResult, RelayGroup,
    RelayGroupModels, RelayService, RelayToken, RelayTopupHistory, RelayTopupInfo, RelayTopupOrder,
    RelayTopupQuote, RelayUsageModels, RelayUsageOverview, RelayUsageQuery,
};
use crate::store::AppState;

/// 登录中转站（用户名/邮箱 + 密码）→ 自动换取长效系统访问令牌并落库
#[tauri::command]
pub async fn relay_login(
    state: State<'_, AppState>,
    base_url: String,
    username: String,
    password: String,
    remember: Option<bool>,
) -> Result<RelayAccountInfo, String> {
    RelayService::login(
        state.inner(),
        &base_url,
        &username,
        &password,
        remember.unwrap_or(false),
    )
    .await
    .map_err(|e| safe_relay_error(&e, true))
}

/// 返回当前进程会话；记住的账号必须由用户选择后显式恢复。
#[tauri::command]
pub async fn relay_get_account(
    state: State<'_, AppState>,
) -> Result<Option<RelayAccountInfo>, String> {
    RelayService::restore(state.inner())
        .await
        .map_err(|e| safe_relay_error(&e, false))
}

#[tauri::command]
pub fn relay_list_saved_logins(
    state: State<'_, AppState>,
) -> Result<Vec<crate::relay::credentials::SavedLoginInfo>, String> {
    RelayService::saved_logins(state.inner()).map_err(|e| safe_relay_error(&e, false))
}

#[tauri::command]
pub fn relay_saved_login_name(state: State<'_, AppState>) -> Result<Option<String>, String> {
    RelayService::saved_login_name(state.inner()).map_err(|e| safe_relay_error(&e, false))
}

#[tauri::command]
pub async fn relay_login_saved(
    state: State<'_, AppState>,
    saved_id: String,
) -> Result<Option<RelayAccountInfo>, String> {
    RelayService::restore_saved(state.inner(), &saved_id)
        .await
        .map_err(|e| safe_relay_error(&e, false))
}

#[tauri::command]
pub fn relay_forget_login(
    state: State<'_, AppState>,
    saved_id: Option<String>,
) -> Result<(), String> {
    RelayService::forget_login(state.inner(), saved_id.as_deref())
        .map_err(|e| safe_relay_error(&e, false))
}

/// 联网刷新额度/账号信息
#[tauri::command]
pub async fn relay_refresh_account(state: State<'_, AppState>) -> Result<RelayAccountInfo, String> {
    RelayService::refresh_account(state.inner())
        .await
        .map_err(|e| safe_relay_error(&e, false))
}

#[tauri::command]
pub async fn relay_get_topup_info(state: State<'_, AppState>) -> Result<RelayTopupInfo, String> {
    RelayService::topup_info(state.inner())
        .await
        .map_err(|e| safe_relay_error(&e, false))
}

fn official_topup_url(base_url: &str) -> Result<String, String> {
    let base = url::Url::parse(base_url.trim_end_matches('/'))
        .map_err(|_| "relay.invalid_url".to_string())?;
    if base.scheme() != "https"
        || base.host_str().is_none()
        || !base.username().is_empty()
        || base.password().is_some()
    {
        return Err("relay.invalid_url".to_string());
    }
    let route = if base.host_str() == Some("yjapi.manqiaotechnology.com") {
        "/958c19c404a5/wallet"
    } else {
        "/wallet"
    };
    base.join(route)
        .map(|url| url.to_string())
        .map_err(|_| "relay.invalid_url".to_string())
}

/// Open the relay's own wallet page. Renderer code cannot supply an arbitrary
/// URL; HTTPS and the currently logged-in relay host are enforced here.
#[tauri::command]
pub async fn relay_open_official_topup(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let account = RelayService::account(state.inner())
        .map_err(|e| safe_relay_error(&e, false))?
        .ok_or_else(|| "relay.not_logged_in".to_string())?;
    let url = official_topup_url(&account.base_url)?;
    app.opener()
        .open_url(&url, None::<String>)
        .map_err(|_| "relay.topup_open_failed".to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn relay_calculate_topup_amount(
    state: State<'_, AppState>,
    method: String,
    amount: f64,
) -> Result<RelayTopupQuote, String> {
    if !amount.is_finite() || amount <= 0.0 {
        return Err("relay.invalid_amount".to_string());
    }
    RelayService::topup_quote(state.inner(), &method, amount)
        .await
        .map_err(|e| safe_relay_error(&e, false))
}

#[tauri::command]
pub async fn relay_create_topup_payment(
    app: AppHandle,
    state: State<'_, AppState>,
    method: String,
    amount: f64,
    client_request_id: String,
) -> Result<RelayTopupOrder, String> {
    if !amount.is_finite() || amount <= 0.0 || client_request_id.trim().is_empty() {
        return Err("relay.invalid_amount".to_string());
    }
    let mut order =
        RelayService::create_topup_payment(state.inner(), &method, amount, &client_request_id)
            .await
            .map_err(|e| safe_relay_error(&e, false))?;
    let url = order.checkout_url.take().ok_or("relay.checkout_invalid")?;
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|_| "relay.checkout_open_failed".to_string())?;
    Ok(order)
}

#[tauri::command]
pub async fn relay_list_topup_history(
    state: State<'_, AppState>,
    page: Option<u32>,
    page_size: Option<u32>,
) -> Result<RelayTopupHistory, String> {
    RelayService::topup_history(
        state.inner(),
        page.unwrap_or(1).max(1),
        page_size.unwrap_or(20).clamp(1, 100),
    )
    .await
    .map_err(|e| safe_relay_error(&e, false))
}

#[tauri::command]
pub async fn relay_get_usage_models(
    state: State<'_, AppState>,
    query: RelayUsageQuery,
) -> Result<RelayUsageModels, String> {
    RelayService::usage_models(state.inner(), query)
        .await
        .map_err(|e| safe_relay_error(&e, false))
}

#[tauri::command]
pub async fn relay_get_usage_summary(
    state: State<'_, AppState>,
    query: RelayUsageQuery,
) -> Result<RelayUsageOverview, String> {
    RelayService::usage_summary(state.inner(), query)
        .await
        .map_err(|e| safe_relay_error(&e, false))
}

/// 退出当前会话并清除重启资格票据；已记住账号由 relay_forget_login 单独删除。
#[tauri::command]
pub fn relay_logout(state: State<'_, AppState>) -> Result<bool, String> {
    restart::clear_restart_tickets();
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

/// 一键应用：为分组确保专用令牌 → 下发到指定/全部启用应用并生效
#[tauri::command]
pub async fn relay_apply_model(
    app: AppHandle,
    state: State<'_, AppState>,
    group: String,
    model: String,
    request_id: Option<String>,
    target_apps: Option<Vec<String>>,
) -> Result<Vec<RelayApplyResult>, String> {
    let request_id = request_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let ticket_operation = request_id.clone();
    let requested_targets = target_apps.clone();
    let outcome = RelayService::apply_model(
        state.inner(),
        &group,
        &model,
        target_apps.as_deref(),
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
    .map_err(|e| safe_relay_error(&e, false));
    // 重启资格与本次真实结果绑定：成功目标签发短期票据；
    // 失败目标立即吊销既有资格（重试失败不得沿用旧成功）。
    match &outcome {
        Ok(results) => {
            for result in results {
                if result.ok {
                    restart::issue_restart_ticket(&ticket_operation, &result.app);
                } else {
                    restart::revoke_restart_tickets(&result.app);
                }
            }
        }
        Err(_) => {
            if let Some(targets) = requested_targets {
                for app in targets {
                    restart::revoke_restart_tickets(&app);
                }
            }
        }
    }
    outcome
}

/// 目标工具的本机安装情况
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayTargetInstall {
    app: String,
    cli_path: Option<String>,
    desktop_app: Option<String>,
    desktop_name: Option<String>,
    desktop_reads_cli_config: Option<bool>,
    /// 全部桌面候选的显示名（含未安装的），前端据此决定是否渲染桌面端行
    desktop_candidates: Vec<String>,
    /// 桌面端官方下载页；None 表示该工具不提供桌面端入口
    desktop_url: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayToolInstallPlan {
    app: String,
    source: String,
    command: String,
    docs_url: String,
}

const RELAY_TARGET_APPS: [&str; 3] = ["claude", "codex", "gemini"];

#[tauri::command]
pub async fn relay_detect_target_installations(
    state: State<'_, AppState>,
) -> Result<Vec<RelayTargetInstall>, String> {
    let registry = tool_registry::refresh_registry_if_due(state.inner()).await;
    let installs = tauri::async_runtime::spawn_blocking(move || {
        RELAY_TARGET_APPS
            .iter()
            .map(|app| {
                let desktop = find_desktop_app(app, &registry);
                let definition = registry.tools.get(*app);
                RelayTargetInstall {
                    app: app.to_string(),
                    cli_path: crate::commands::locate_tool_executable(app)
                        .map(|p| p.to_string_lossy().to_string()),
                    desktop_app: desktop
                        .as_ref()
                        .map(|(path, _)| path.to_string_lossy().to_string()),
                    desktop_name: desktop
                        .as_ref()
                        .map(|(_, definition)| definition.display_name.clone()),
                    desktop_reads_cli_config: desktop
                        .as_ref()
                        .map(|(_, definition)| definition.reads_cli_config),
                    // 有官方下载页或已检测到桌面端时才暴露候选，避免渲染无关行
                    desktop_candidates: definition
                        .filter(|d| d.desktop_url.is_some() || desktop.is_some())
                        .map(|d| {
                            d.desktop_apps
                                .iter()
                                .map(|desktop| desktop.display_name.clone())
                                .collect()
                        })
                        .unwrap_or_default(),
                    desktop_url: definition.and_then(|d| d.desktop_url.clone()),
                }
            })
            .collect::<Vec<_>>()
    })
    .await
    .map_err(|e| format!("relay.detect_failed: {e}"))?;
    Ok(installs)
}

/// 打开目标工具桌面端的官方下载页。URL 只来自工具注册表，renderer 不能传任意地址。
#[tauri::command]
pub async fn relay_open_desktop_download(
    state: State<'_, AppState>,
    handle: AppHandle,
    app: String,
) -> Result<(), String> {
    if !RELAY_TARGET_APPS.contains(&app.as_str()) {
        return Err("relay.invalid_target".to_string());
    }
    let registry = tool_registry::cached_registry(state.inner());
    let url = registry
        .tools
        .get(&app)
        .and_then(|definition| definition.desktop_url.as_deref())
        .ok_or("relay.no_desktop".to_string())?;
    tauri_plugin_opener::OpenerExt::opener(&handle)
        .open_url(url, None::<&str>)
        .map_err(|_| "relay.open_failed".to_string())
}

#[tauri::command]
pub async fn relay_get_tool_install_plan(
    state: State<'_, AppState>,
    app: String,
) -> Result<RelayToolInstallPlan, String> {
    if !RELAY_TARGET_APPS.contains(&app.as_str()) {
        return Err("relay.invalid_target".to_string());
    }
    let registry = tool_registry::refresh_registry_if_due(state.inner()).await;
    let definition = registry
        .tools
        .get(&app)
        .ok_or("relay.invalid_target".to_string())?;
    let command = crate::commands::tool_install_command_preview(&app)
        .ok_or("relay.install_unsupported".to_string())?;
    Ok(RelayToolInstallPlan {
        app,
        source: definition.installer_source.clone(),
        command,
        docs_url: definition.docs_url.clone(),
    })
}

/// 应用成功后拉起目标工具：desktop = 打开桌面 App，cli = 在终端窗口中运行 CLI
#[tauri::command]
pub async fn relay_launch_target(
    state: State<'_, AppState>,
    app: String,
    mode: String,
) -> Result<(), String> {
    if !RELAY_TARGET_APPS.contains(&app.as_str()) {
        return Err("relay.invalid_target".to_string());
    }
    let registry = tool_registry::cached_registry(state.inner());
    tauri::async_runtime::spawn_blocking(move || match mode.as_str() {
        "desktop" => launch_desktop_app(&app, &registry),
        "cli" => launch_target_cli(&app),
        _ => Err("relay.invalid_target".to_string()),
    })
    .await
    .map_err(|e| format!("relay.launch_failed: {e}"))?
}

/// 各目标工具的真实重启能力（本地检测；不受 renderer 参数影响）
#[tauri::command]
pub async fn relay_get_restart_capabilities(
    state: State<'_, AppState>,
) -> Result<Vec<RelayRestartCapability>, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let registry = tool_registry::cached_registry(&state);
        let ops = restart::platform_ops();
        restart::capabilities_with(&registry, ops.as_ref())
    })
    .await
    .map_err(|e| format!("relay.detect_failed: {e}"))
}

/// 重启确切实例：检测身份 → 校验重启票据 → 请求正常退出 → 等待退出 → 重新启动同一目标。
///
/// renderer 只回传 `app`、后端签发的 `targetId` 与本次 `operationId`；
/// 路径/PID/bundle id 一律由后端从本地受信任 allowlist 重新解析。
#[tauri::command]
pub async fn relay_restart_target(
    handle: AppHandle,
    state: State<'_, AppState>,
    app: String,
    target_id: String,
    operation_id: String,
) -> Result<RelayRestartResult, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let registry = tool_registry::cached_registry(&state);
        let ops = restart::platform_ops();
        let emit_handle = handle.clone();
        let emit_operation = operation_id.clone();
        let emit_target = app.clone();
        let emit = move |stage: &str| {
            let _ = emit_handle.emit(
                restart::RESTART_PROGRESS_EVENT,
                RelayRestartProgress {
                    operation_id: emit_operation.clone(),
                    app: emit_target.clone(),
                    stage: stage.to_string(),
                },
            );
        };
        restart::run_restart(
            &registry,
            ops.as_ref(),
            restart::RestartTiming::default(),
            &app,
            &target_id,
            &operation_id,
            &emit,
        )
    })
    .await
    .map_err(|e| format!("relay.restart_failed: {e}"))?
}

#[cfg(target_os = "macos")]
fn find_desktop_app(
    app: &str,
    registry: &ToolRegistry,
) -> Option<(std::path::PathBuf, DesktopToolDefinition)> {
    let home = dirs::home_dir()?;
    let definition = registry.tools.get(app)?;
    for desktop in &definition.desktop_apps {
        for base in [
            std::path::PathBuf::from("/Applications"),
            home.join("Applications"),
        ] {
            let candidate = base.join(&desktop.app_name);
            if candidate.is_dir() {
                return Some((candidate, desktop.clone()));
            }
        }
    }
    None
}

#[cfg(not(target_os = "macos"))]
fn find_desktop_app(
    _app: &str,
    _registry: &ToolRegistry,
) -> Option<(std::path::PathBuf, DesktopToolDefinition)> {
    None
}

#[cfg(target_os = "macos")]
fn launch_desktop_app(app: &str, registry: &ToolRegistry) -> Result<(), String> {
    let (path, _) = find_desktop_app(app, registry).ok_or("relay.desktop_not_found".to_string())?;
    std::process::Command::new("open")
        .arg(&path)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("relay.launch_failed: {e}"))
}

#[cfg(not(target_os = "macos"))]
fn launch_desktop_app(_app: &str, _registry: &ToolRegistry) -> Result<(), String> {
    Err("relay.desktop_not_found".to_string())
}

#[cfg(target_os = "macos")]
fn launch_target_cli(app: &str) -> Result<(), String> {
    let path =
        crate::commands::locate_tool_executable(app).ok_or("relay.cli_not_found".to_string())?;
    let script = format!(
        "tell application \"Terminal\" to do script \"{}\"",
        path.to_string_lossy()
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
    );
    std::process::Command::new("osascript")
        .args(["-e", &script])
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("relay.launch_failed: {e}"))
}

#[cfg(target_os = "windows")]
fn launch_target_cli(app: &str) -> Result<(), String> {
    let path =
        crate::commands::locate_tool_executable(app).ok_or("relay.cli_not_found".to_string())?;
    std::process::Command::new("cmd")
        .args(["/c", "start", "RelayDesk", "cmd", "/k"])
        .arg(&path)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("relay.launch_failed: {e}"))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn launch_target_cli(app: &str) -> Result<(), String> {
    let path =
        crate::commands::locate_tool_executable(app).ok_or("relay.cli_not_found".to_string())?;
    let path = path.to_string_lossy().to_string();
    let terminals: [(&str, &[&str]); 5] = [
        ("gnome-terminal", &["--", "bash", "-c"]),
        ("konsole", &["-e", "bash", "-c"]),
        ("xterm", &["-e", "bash", "-c"]),
        ("alacritty", &["-e", "bash", "-c"]),
        ("kitty", &["bash", "-c"]),
    ];
    for (term, args) in terminals {
        if std::process::Command::new("which")
            .arg(term)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
        {
            let cmd = format!("{path}; exec bash");
            return std::process::Command::new(term)
                .args(args)
                .arg(&cmd)
                .spawn()
                .map(|_| ())
                .map_err(|e| format!("relay.launch_failed: {e}"));
        }
    }
    Err("relay.no_terminal".to_string())
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

/// 设置或清除一个分组的本地目标覆盖；target 为 null 时恢复自动建议。
#[tauri::command]
pub fn relay_set_group_target(
    state: State<'_, AppState>,
    group: String,
    target: Option<String>,
) -> Result<RelayAccountInfo, String> {
    RelayService::set_group_target(state.inner(), &group, target.as_deref())
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
    let mapped = map_relay_error(error, login);
    if mapped == "relay.login_failed" || mapped == "relay.sync_failed" {
        let detail = match error {
            AppError::Message(m) => m.clone(),
            AppError::HttpStatus { status, body } => format!("HTTP {status}: {body}"),
            other => format!("{other:?}"),
        };
        let detail = detail.chars().take(160).collect::<String>();
        log::warn!("relay error mapped to {mapped}: {detail}");
    }
    mapped
}

fn map_relay_error(error: &AppError, login: bool) -> String {
    match error {
        AppError::Localized { key, .. } => (*key).to_string(),
        AppError::Message(message) if message.starts_with("relay.") => message.clone(),
        AppError::HttpStatus { status: 429, .. } => "relay.rate_limited".to_string(),
        AppError::HttpStatus {
            status: 404 | 405 | 410,
            ..
        } => "relay.endpoint_unavailable".to_string(),
        AppError::HttpStatus { status, .. } if *status >= 500 => "relay.network".to_string(),
        AppError::HttpStatus {
            status: 401 | 403, ..
        } if !login => "relay.session_expired".to_string(),
        AppError::HttpStatus {
            status: 401 | 403, ..
        } if login => "relay.invalid_credentials".to_string(),
        AppError::Message(message)
            if message.contains("网络请求失败") || message.contains("读取响应失败") =>
        {
            "relay.network".to_string()
        }
        AppError::Message(message)
            if login
                && (message.contains("用户名或密码错误")
                    || message.contains("账号或密码错误")
                    || message.contains("密码错误")
                    || message.contains("用户不存在")
                    || message.contains("已被禁用")
                    || {
                        let lower = message.to_ascii_lowercase();
                        lower.contains("invalid credentials")
                            || lower.contains("password is incorrect")
                            || lower.contains("has been banned")
                            || lower.contains("user not found")
                    }) =>
        {
            "relay.invalid_credentials".to_string()
        }
        _ if login => "relay.login_failed".to_string(),
        _ => "relay.sync_failed".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn login_route_and_protocol_failures_are_not_password_errors() {
        for status in [404, 405, 410] {
            let error = AppError::HttpStatus {
                status,
                body: "<html>private upstream detail</html>".into(),
            };
            assert_eq!(safe_relay_error(&error, true), "relay.endpoint_unavailable");
        }
        assert_eq!(
            safe_relay_error(&AppError::Message("登录响应缺少 access_token".into()), true),
            "relay.login_failed"
        );
        assert_eq!(
            safe_relay_error(
                &AppError::Message("用户名或密码错误，或用户被禁用".into()),
                true
            ),
            "relay.invalid_credentials"
        );
        assert_eq!(
            safe_relay_error(
                &AppError::HttpStatus {
                    status: 403,
                    body: "private WAF detail".into()
                },
                true
            ),
            "relay.invalid_credentials"
        );
    }

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

    #[test]
    fn official_topup_url_is_https_same_origin_path() {
        assert_eq!(
            official_topup_url("https://www.shenlanqaq.com/").unwrap(),
            "https://www.shenlanqaq.com/wallet"
        );
        assert_eq!(
            official_topup_url("https://relay.example.test/").unwrap(),
            "https://relay.example.test/wallet"
        );
        assert_eq!(
            official_topup_url("https://yjapi.manqiaotechnology.com/").unwrap(),
            "https://yjapi.manqiaotechnology.com/958c19c404a5/wallet"
        );
        assert_eq!(
            official_topup_url("http://relay.example.test"),
            Err("relay.invalid_url".into())
        );
        assert_eq!(
            official_topup_url("https://relay.example.test.evil"),
            Ok("https://relay.example.test.evil/wallet".into())
        );
    }
}
