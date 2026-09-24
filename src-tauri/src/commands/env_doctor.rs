//! 环境医生：只读探测 git/python/node、配置目录可写性、中转站可达性与系统代理。
//!
//! 约束：全部检查只读，不修改系统；网络探测仅访问用户已登录的中转站；
//! 返回的 detail 只含版本号或脱敏后的 host:port，绝不包含路径、凭据或环境变量原文。

use serde::Serialize;
use tauri::State;

use crate::relay::RelayService;
use crate::store::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayEnvCheck {
    id: &'static str,
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'static str>,
}

impl RelayEnvCheck {
    fn new(
        id: &'static str,
        status: &'static str,
        detail: Option<String>,
        reason: Option<&'static str>,
    ) -> Self {
        Self {
            id,
            status,
            detail,
            reason,
        }
    }

    #[cfg(test)]
    pub(crate) fn for_test(
        id: &'static str,
        status: &'static str,
        detail: Option<String>,
        reason: Option<&'static str>,
    ) -> Self {
        Self::new(id, status, detail, reason)
    }

    /// 诊断导出用的单行摘要，只含已脱敏的 detail/reason。
    pub(crate) fn summary_line(&self) -> String {
        match self.detail.as_deref().or(self.reason) {
            Some(extra) => format!("[{}] {}: {}", self.status, self.id, extra),
            None => format!("[{}] {}", self.status, self.id),
        }
    }
}

/// 环境医生：一次性返回系统基础与连接两类只读检查。
#[tauri::command]
pub async fn relay_env_check(state: State<'_, AppState>) -> Result<Vec<RelayEnvCheck>, String> {
    Ok(collect_env_checks(state.inner()).await)
}

/// 供命令与诊断导出共用：收集全部只读检查。
pub(crate) async fn collect_env_checks(state: &AppState) -> Vec<RelayEnvCheck> {
    let (git, python, node, writable, proxy, relay) = tokio::join!(
        timed_probe("git", probe_git),
        timed_probe("python", probe_python),
        timed_probe("node", probe_node),
        timed_probe("writable", probe_writable),
        timed_probe("proxy", probe_proxy),
        relay_reachability(state),
    );
    vec![git, python, node, writable, relay, proxy]
}

async fn timed_probe(id: &'static str, probe: fn() -> RelayEnvCheck) -> RelayEnvCheck {
    match tokio::time::timeout(
        std::time::Duration::from_secs(8),
        tauri::async_runtime::spawn_blocking(probe),
    )
    .await
    {
        Ok(Ok(check)) => check,
        _ => RelayEnvCheck::new(id, "error", None, Some("probe_failed")),
    }
}

enum Probe {
    Found(String),
    Missing,
    Failed,
}

fn probe_git() -> RelayEnvCheck {
    match probe_version("git", "--version") {
        Probe::Found(out) => RelayEnvCheck::new("git", "ok", sanitize_version(&out), None),
        Probe::Missing => RelayEnvCheck::new("git", "warn", None, Some("missing")),
        Probe::Failed => RelayEnvCheck::new("git", "error", None, Some("probe_failed")),
    }
}

fn probe_python() -> RelayEnvCheck {
    for binary in ["python3", "python"] {
        match probe_version(binary, "--version") {
            Probe::Found(out) => {
                return RelayEnvCheck::new("python", "ok", sanitize_version(&out), None)
            }
            Probe::Failed => {
                return RelayEnvCheck::new("python", "error", None, Some("probe_failed"))
            }
            Probe::Missing => {}
        }
    }
    RelayEnvCheck::new("python", "warn", None, Some("missing"))
}

fn probe_node() -> RelayEnvCheck {
    match (
        probe_version("node", "--version"),
        probe_version("npm", "--version"),
    ) {
        (Probe::Found(node), Probe::Found(npm)) => {
            let detail = match (sanitize_version(&node), sanitize_version(&npm)) {
                (Some(node), Some(npm)) => Some(format!("node {node} / npm {npm}")),
                (Some(node), None) => Some(format!("node {node}")),
                _ => None,
            };
            RelayEnvCheck::new("node", "ok", detail, None)
        }
        (Probe::Found(node), _) => {
            RelayEnvCheck::new("node", "warn", sanitize_version(&node), Some("npm_missing"))
        }
        (Probe::Failed, _) => RelayEnvCheck::new("node", "error", None, Some("probe_failed")),
        _ => RelayEnvCheck::new("node", "warn", None, Some("missing")),
    }
}

/// `~/.relaydesk` 写探针：创建后立即删除，验证配置目录可写。
fn probe_writable() -> RelayEnvCheck {
    let dir = crate::config::get_home_dir().join(".relaydesk");
    let probe = dir.join(".env_probe.tmp");
    let result = std::fs::create_dir_all(&dir)
        .and_then(|_| std::fs::write(&probe, b"ok"))
        .and_then(|_| std::fs::remove_file(&probe));
    match result {
        Ok(()) => RelayEnvCheck::new("writable", "ok", None, None),
        Err(_) => RelayEnvCheck::new("writable", "error", None, Some("not_writable")),
    }
}

fn probe_proxy() -> RelayEnvCheck {
    if let Some(endpoint) = env_proxy() {
        return RelayEnvCheck::new("proxy", "ok", Some(endpoint), Some("detected"));
    }
    #[cfg(target_os = "macos")]
    if let Some(endpoint) = macos_system_proxy() {
        return RelayEnvCheck::new("proxy", "ok", Some(endpoint), Some("detected"));
    }
    #[cfg(target_os = "windows")]
    if let Some(endpoint) = windows_system_proxy() {
        return RelayEnvCheck::new("proxy", "ok", Some(endpoint), Some("detected"));
    }
    RelayEnvCheck::new("proxy", "ok", None, Some("none"))
}

async fn relay_reachability(state: &AppState) -> RelayEnvCheck {
    let account = match RelayService::account(state) {
        Ok(account) => account,
        Err(_) => None,
    };
    let Some(account) = account else {
        return RelayEnvCheck::new("relay", "unavailable", None, Some("not_logged_in"));
    };
    let url = format!("{}/api/status", account.base_url.trim_end_matches('/'));
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
    {
        Ok(client) => client,
        Err(_) => return RelayEnvCheck::new("relay", "error", None, Some("probe_failed")),
    };
    let host = reqwest::Url::parse(&account.base_url).ok().and_then(|url| {
        url.host_str().map(|host| match url.port() {
            Some(port) => format!("{host}:{port}"),
            None => host.to_string(),
        })
    });
    match client.get(url).send().await {
        // 任意 HTTP 响应（含 4xx/5xx）都说明网络路径可达。
        Ok(_) => RelayEnvCheck::new("relay", "ok", host, None),
        Err(_) => RelayEnvCheck::new("relay", "error", None, Some("unreachable")),
    }
}

/// 经登录 shell 探测 `<binary> <arg>`，拿到与生命周期检测一致的真实用户 PATH
/// （GUI 进程继承的 launchd 窄 PATH 不含 brew/nvm）。
#[cfg(not(target_os = "windows"))]
fn probe_version(binary: &str, arg: &str) -> Probe {
    use std::process::{Command, Stdio};
    let shell = std::env::var("SHELL")
        .ok()
        .filter(|s| s.starts_with('/') && !s.contains(' '))
        .unwrap_or_else(|| "/bin/sh".to_string());
    let script = format!("{binary} {arg} 2>/dev/null");
    let result = Command::new(&shell)
        .args(["-lc", &script])
        .stdin(Stdio::null())
        .output();
    match result {
        Ok(out) if out.status.success() => {
            Probe::Found(crate::commands::decode_command_output(&out.stdout))
        }
        Ok(_) => Probe::Missing,
        Err(_) => Probe::Failed,
    }
}

#[cfg(target_os = "windows")]
fn probe_version(binary: &str, arg: &str) -> Probe {
    use std::process::{Command, Stdio};
    let result = Command::new("cmd")
        .args(["/c", binary, arg])
        .stdin(Stdio::null())
        .output();
    match result {
        Ok(out) if out.status.success() => {
            Probe::Found(crate::commands::decode_command_output(&out.stdout))
        }
        Ok(_) => Probe::Missing,
        Err(_) => Probe::Failed,
    }
}

/// 从版本输出中提取一个短版本号 token；找不到可解析内容时返回 None。
fn sanitize_version(raw: &str) -> Option<String> {
    let line = raw.lines().next()?.trim();
    let token = line
        .split_whitespace()
        .find(|token| token.chars().any(|c| c.is_ascii_digit()))?;
    let mut version: String = token
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '+'))
        .collect();
    if version.starts_with(|c| matches!(c, 'v' | 'V'))
        && version[1..].starts_with(|c: char| c.is_ascii_digit())
    {
        version.remove(0);
    }
    (!version.is_empty() && version.len() <= 40).then_some(version)
}

fn env_proxy() -> Option<String> {
    for key in [
        "HTTPS_PROXY",
        "https_proxy",
        "HTTP_PROXY",
        "http_proxy",
        "ALL_PROXY",
        "all_proxy",
    ] {
        if let Ok(value) = std::env::var(key) {
            if let Some(endpoint) = sanitize_proxy(&value) {
                return Some(endpoint);
            }
        }
    }
    None
}

/// 把代理 URL 脱敏为 scheme://host:port，剥掉 userinfo、路径和查询参数。
fn sanitize_proxy(raw: &str) -> Option<String> {
    let raw = raw.trim();
    if raw.is_empty() || raw.len() > 300 {
        return None;
    }
    let (scheme, rest) = match raw.split_once("://") {
        Some((scheme, rest)) => (format!("{scheme}://"), rest),
        None => ("http://".to_string(), raw),
    };
    let authority = rest.split('/').next()?;
    let host_port = authority.rsplit('@').next()?.trim();
    if host_port.is_empty() || host_port.len() > 120 {
        return None;
    }
    Some(format!("{scheme}{host_port}"))
}

#[cfg(target_os = "macos")]
fn macos_system_proxy() -> Option<String> {
    use std::process::{Command, Stdio};
    let out = Command::new("scutil")
        .arg("--proxy")
        .stdin(Stdio::null())
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = crate::commands::decode_command_output(&out.stdout);
    for (enable_key, host_key, port_key, scheme) in [
        ("HTTPSEnable", "HTTPSProxy", "HTTPSPort", "https"),
        ("HTTPEnable", "HTTPProxy", "HTTPPort", "http"),
        ("SOCKSEnable", "SOCKSProxy", "SOCKSPort", "socks"),
    ] {
        if scutil_value(&text, enable_key).as_deref() == Some("1") {
            let host = scutil_value(&text, host_key)?;
            let port = scutil_value(&text, port_key);
            let host = host
                .chars()
                .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':' | '[' | ']'))
                .collect::<String>();
            if host.is_empty() {
                return None;
            }
            return Some(match port {
                Some(port)
                    if !port.is_empty()
                        && port.len() <= 5
                        && port.chars().all(|c| c.is_ascii_digit()) =>
                {
                    format!("{scheme}://{host}:{port}")
                }
                _ => format!("{scheme}://{host}"),
            });
        }
    }
    None
}

#[cfg(target_os = "macos")]
fn scutil_value(text: &str, key: &str) -> Option<String> {
    for line in text.lines() {
        let line = line.trim();
        if let Some((name, value)) = line.split_once(" : ") {
            if name.trim() == key {
                return Some(value.trim().to_string());
            }
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn windows_system_proxy() -> Option<String> {
    let key = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER)
        .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings")
        .ok()?;
    let enabled: u32 = key.get_value("ProxyEnable").unwrap_or(0);
    if enabled == 0 {
        return None;
    }
    let server: String = key.get_value("ProxyServer").ok()?;
    sanitize_proxy(&server)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_version_extracts_first_numeric_token() {
        assert_eq!(
            sanitize_version("git version 2.45.0"),
            Some("2.45.0".to_string())
        );
        assert_eq!(
            sanitize_version("Python 3.12.4"),
            Some("3.12.4".to_string())
        );
        assert_eq!(
            sanitize_version("node v22.11.0\nextra"),
            Some("22.11.0".to_string())
        );
        assert_eq!(sanitize_version("no digits here"), None);
    }

    #[test]
    fn sanitize_proxy_strips_credentials_and_paths() {
        assert_eq!(
            sanitize_proxy("http://user:secret@127.0.0.1:7890/path"),
            Some("http://127.0.0.1:7890".to_string())
        );
        assert_eq!(
            sanitize_proxy("https://proxy.example.com:8443"),
            Some("https://proxy.example.com:8443".to_string())
        );
        assert_eq!(sanitize_proxy(""), None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn scutil_value_parses_key_pairs() {
        let text =
            "<dictionary> {\n  HTTPSEnable : 1\n  HTTPSProxy : 127.0.0.1\n  HTTPSPort : 7890\n}\n";
        assert_eq!(
            scutil_value(text, "HTTPSProxy"),
            Some("127.0.0.1".to_string())
        );
        assert_eq!(scutil_value(text, "HTTPSPort"), Some("7890".to_string()));
        assert_eq!(scutil_value(text, "Missing"), None);
    }
}
