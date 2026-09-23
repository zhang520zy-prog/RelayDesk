use std::collections::{HashMap, HashSet};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::store::AppState;

const CACHE_KEY: &str = "relaydesk_tool_registry_v1";
const REFRESHED_AT_KEY: &str = "relaydesk_tool_registry_refreshed_at_v1";
const ATTEMPTED_AT_KEY: &str = "relaydesk_tool_registry_attempted_at_v1";
const REFRESH_INTERVAL_SECONDS: u64 = 24 * 60 * 60;
const RETRY_INTERVAL_SECONDS: u64 = 60 * 60;
const REGISTRY_URL: Option<&str> = option_env!("RELAYDESK_TOOL_REGISTRY_URL");

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopToolDefinition {
    pub app_name: String,
    pub display_name: String,
    #[serde(default)]
    pub reads_cli_config: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolDefinition {
    pub display_name: String,
    pub installer_source: String,
    pub docs_url: String,
    /// 桌面端官方下载页（无桌面端或"仅 CLI 已足够"的工具为 None）。
    #[serde(default)]
    pub desktop_url: Option<String>,
    #[serde(default)]
    pub desktop_apps: Vec<DesktopToolDefinition>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ToolRegistry {
    pub version: u32,
    pub tools: HashMap<String, ToolDefinition>,
}

pub fn builtin_registry() -> ToolRegistry {
    ToolRegistry {
        version: 1,
        tools: HashMap::from([
            (
                "claude".to_string(),
                ToolDefinition {
                    display_name: "Claude Code".to_string(),
                    installer_source: "Anthropic official installer · npm fallback".to_string(),
                    docs_url: "https://code.claude.com/docs/en/setup".to_string(),
                    desktop_url: Some("https://claude.ai/download".to_string()),
                    desktop_apps: vec![DesktopToolDefinition {
                        app_name: "Claude.app".to_string(),
                        display_name: "Claude desktop".to_string(),
                        // 实测验证（v2.2553.1）：桌面端内嵌 Claude Code 会话以
                        // settingSources:["user"] 启动，user 源即
                        // ~/.claude/settings.json——正是 relay 写入的目标文件。
                        reads_cli_config: true,
                    }],
                },
            ),
            (
                "codex".to_string(),
                ToolDefinition {
                    display_name: "OpenAI Codex".to_string(),
                    installer_source: "npm · @openai/codex".to_string(),
                    docs_url: "https://developers.openai.com/codex/cli/".to_string(),
                    desktop_url: Some("https://chatgpt.com/download".to_string()),
                    desktop_apps: vec![
                        DesktopToolDefinition {
                            app_name: "ChatGPT.app".to_string(),
                            display_name: "ChatGPT (Codex)".to_string(),
                            reads_cli_config: true,
                        },
                        DesktopToolDefinition {
                            app_name: "Codex.app".to_string(),
                            display_name: "Codex (legacy name)".to_string(),
                            reads_cli_config: true,
                        },
                    ],
                },
            ),
            (
                "gemini".to_string(),
                ToolDefinition {
                    display_name: "Gemini CLI".to_string(),
                    installer_source: "npm · @google/gemini-cli".to_string(),
                    docs_url: "https://geminicli.com/docs/get-started/installation/".to_string(),
                    // 桌面端不提供部署入口：Gemini.app 不读 CLI 配置，CLI 已足够。
                    desktop_url: None,
                    desktop_apps: vec![DesktopToolDefinition {
                        app_name: "Gemini.app".to_string(),
                        display_name: "Gemini desktop".to_string(),
                        reads_cli_config: false,
                    }],
                },
            ),
        ]),
    }
}

pub fn cached_registry(state: &AppState) -> ToolRegistry {
    state
        .db
        .get_setting(CACHE_KEY)
        .ok()
        .flatten()
        .and_then(|value| serde_json::from_str::<ToolRegistry>(&value).ok())
        .filter(validate_registry)
        .unwrap_or_else(builtin_registry)
}

pub async fn refresh_registry_if_due(state: &AppState) -> ToolRegistry {
    let cached = cached_registry(state);
    let Some(url) = REGISTRY_URL else {
        return cached;
    };
    let now = unix_timestamp();
    let refreshed_at = state
        .db
        .get_setting(REFRESHED_AT_KEY)
        .ok()
        .flatten()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0);
    if now.saturating_sub(refreshed_at) < REFRESH_INTERVAL_SECONDS {
        return cached;
    }
    let attempted_at = state
        .db
        .get_setting(ATTEMPTED_AT_KEY)
        .ok()
        .flatten()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0);
    if now.saturating_sub(attempted_at) < RETRY_INTERVAL_SECONDS {
        return cached;
    }
    let _ = state.db.set_setting(ATTEMPTED_AT_KEY, &now.to_string());
    let response = match reqwest::Client::new()
        .get(url)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => response,
        _ => return cached,
    };
    let registry = match response.json::<ToolRegistry>().await {
        Ok(registry) if validate_registry(&registry) => registry,
        _ => return cached,
    };
    if let Ok(value) = serde_json::to_string(&registry) {
        let _ = state.db.set_setting(CACHE_KEY, &value);
        let _ = state.db.set_setting(REFRESHED_AT_KEY, &now.to_string());
    }
    registry
}

fn validate_registry(registry: &ToolRegistry) -> bool {
    if registry.version != 1 || registry.tools.len() != 3 {
        return false;
    }
    let expected: HashSet<&str> = ["claude", "codex", "gemini"].into_iter().collect();
    if registry
        .tools
        .keys()
        .map(String::as_str)
        .collect::<HashSet<_>>()
        != expected
    {
        return false;
    }
    registry.tools.values().all(|tool| {
        !tool.display_name.trim().is_empty()
            && !tool.installer_source.trim().is_empty()
            && tool.installer_source.len() <= 200
            && is_https_url(&tool.docs_url)
            && tool
                .desktop_url
                .as_deref()
                .map(is_https_url)
                .unwrap_or(true)
            && tool.desktop_apps.len() <= 4
            && tool.desktop_apps.iter().all(|desktop| {
                !desktop.display_name.trim().is_empty() && valid_app_name(&desktop.app_name)
            })
    })
}

fn is_https_url(value: &str) -> bool {
    value.starts_with("https://") && value.len() <= 300
}

fn valid_app_name(value: &str) -> bool {
    value.ends_with(".app")
        && value.len() <= 100
        && !value.contains('/')
        && !value.contains('\\')
        && !value.contains("..")
}

fn unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_registry_tracks_current_codex_desktop_name() {
        let registry = builtin_registry();
        let codex = &registry.tools["codex"];
        assert_eq!(codex.desktop_apps[0].app_name, "ChatGPT.app");
        assert!(codex.desktop_apps[0].reads_cli_config);
        // Claude.app 已实测：内嵌 Claude Code 会话读 ~/.claude/settings.json
        assert!(registry.tools["claude"].desktop_apps[0].reads_cli_config);
        assert!(!registry.tools["gemini"].desktop_apps[0].reads_cli_config);
    }

    #[test]
    fn validation_rejects_untrusted_paths_and_incomplete_catalogs() {
        let mut registry = builtin_registry();
        registry.tools.get_mut("claude").unwrap().desktop_apps[0].app_name =
            "../Claude.app".to_string();
        assert!(!validate_registry(&registry));
        let mut registry = builtin_registry();
        registry.tools.remove("gemini");
        assert!(!validate_registry(&registry));
    }

    #[test]
    fn install_preview_comes_from_the_backend_command_builder() {
        let command = crate::commands::tool_install_command_preview("claude").unwrap();
        #[cfg(not(target_os = "windows"))]
        {
            assert!(command.contains("https://claude.ai/install.sh"));
            assert!(command.contains("@anthropic-ai/claude-code@latest"));
        }
        #[cfg(target_os = "windows")]
        assert!(command.contains("@anthropic-ai/claude-code@latest"));
    }
}
