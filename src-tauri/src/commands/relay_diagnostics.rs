use serde::Serialize;
use std::path::Path;
use std::sync::OnceLock;

use regex::Regex;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayDiagnosticsExport {
    pub file_path: String,
}

/// 前端未捕获错误 → 写入应用日志，使诊断导出能覆盖 UI 层异常。
/// 输入经过脱敏：剥离控制字符/换行、限长，防止日志注入或泄露大块数据。
#[tauri::command]
pub fn relay_log_frontend_error(message: String) -> Result<(), String> {
    let sanitized: String = message
        .chars()
        .filter(|c| !c.is_control() || *c == ' ')
        .take(800)
        .collect();
    let sanitized = sanitized.trim();
    if sanitized.is_empty() {
        return Ok(());
    }
    log::error!("[frontend] {sanitized}");
    Ok(())
}

#[tauri::command]
pub async fn relay_export_diagnostics(
    state: tauri::State<'_, crate::store::AppState>,
    file_path: String,
) -> Result<RelayDiagnosticsExport, String> {
    let checks = crate::commands::env_doctor::collect_env_checks(state.inner()).await;
    let source = crate::panic_hook::get_log_dir().join("relaydesk.log");
    export_diagnostics_from(&source, Path::new(&file_path), Some(&checks))
}

fn export_diagnostics_from(
    source: &Path,
    destination: &Path,
    checks: Option<&[crate::commands::env_doctor::RelayEnvCheck]>,
) -> Result<RelayDiagnosticsExport, String> {
    let raw = match std::fs::read_to_string(source) {
        Ok(content) if !content.trim().is_empty() => content,
        Ok(_) => return Err("relay.diagnostics_no_logs".to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err("relay.diagnostics_no_logs".to_string())
        }
        Err(error) => {
            log::warn!("读取 RelayDesk 诊断日志失败: {error}");
            return Err("relay.diagnostics_export_failed".to_string());
        }
    };
    let mut sections = String::new();
    sections.push_str(&format!(
        "RelayDesk {} | {}/{}\n",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
        std::env::consts::ARCH
    ));
    if let Some(checks) = checks.filter(|checks| !checks.is_empty()) {
        let section = checks
            .iter()
            .map(|check| check.summary_line())
            .collect::<Vec<_>>()
            .join("\n");
        sections.push_str(&format!("=== RelayDesk Environment Check ===\n{section}\n"));
    }
    // 崩溃记录（若存在）一并导出：panic hook 写 <log_dir>/crash.log。
    if let Some(crash) = source
        .parent()
        .map(|dir| dir.join("crash.log"))
        .filter(|path| path.exists())
        .and_then(|path| std::fs::read_to_string(path).ok())
        .filter(|content| !content.trim().is_empty())
    {
        sections.push_str(&format!("=== Crash Log ===\n{crash}\n"));
    }
    let content = format!("{sections}=== Application Log ===\n{raw}");
    let sanitized = redact_diagnostics(&content);
    if let Err(error) = std::fs::write(destination, sanitized) {
        log::warn!("写入 RelayDesk 诊断导出失败: {error}");
        return Err("relay.diagnostics_export_failed".to_string());
    }
    Ok(RelayDiagnosticsExport {
        file_path: destination.display().to_string(),
    })
}

fn redact_diagnostics(content: &str) -> String {
    static SK_KEY: OnceLock<Regex> = OnceLock::new();
    static LOG_RECORD: OnceLock<Regex> = OnceLock::new();
    let sk_key =
        SK_KEY.get_or_init(|| Regex::new(r"\bsk-[A-Za-z0-9._-]+\b").expect("valid sk-key regex"));
    let log_record = LOG_RECORD.get_or_init(|| {
        Regex::new(
            r"^\[\d{4}-\d{2}-\d{2}\]\[\d{2}:\d{2}:\d{2}(?:\.\d+)?\]\[(?:TRACE|DEBUG|INFO|WARN|ERROR)\]\[[^\]]+\]",
        )
        .expect("valid log-record regex")
    });

    let mut redact_continuation = false;
    content
        .lines()
        .map(|line| {
            let lower = line.to_ascii_lowercase();
            let has_sensitive_label = [
                "password",
                "session",
                "access_token",
                "accesstoken",
                "authorization",
            ]
            .iter()
            .any(|label| lower.contains(label));
            let starts_new_record = log_record.is_match(line);
            if redact_continuation && !starts_new_record {
                return "[REDACTED]";
            }

            redact_continuation = has_sensitive_label;
            if has_sensitive_label || sk_key.is_match(line) {
                "[REDACTED]"
            } else {
                line
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_redacts_credentials_and_preserves_diagnostics() {
        let temp = tempfile::tempdir().expect("isolated tempdir");
        let source = temp.path().join("relaydesk.log");
        let destination = temp.path().join("export.log");
        std::fs::write(
            &source,
            concat!(
                "[2026-09-18][10:00:00][INFO][relaydesk] RelayDesk started\n",
                "password=hunter2\n",
                "session: session-secret\n",
                "{\"access_token\":\"access-secret\"}\n",
                "Authorization: Bearer authorization-secret\n",
                "provider rejected sk-test-secret-value\n",
                "{\"password\": \"alpha password-tail\"}\n",
                "{\"Authorization\":\"Bearer json-authorization tail\"}\n",
                "{\"accessToken\":\"camel-token tail\"}\n",
                "WARN upstream Authorization:\n",
                "  Bearer split-authorization-secret\n",
                "Authorization:\n",
                "  Bearer\n",
                "  split-three-line-secret\n",
                "password:\n",
                "123456789\n",
                "{\"access_token\":\n",
                "\"split-json-secret\"}\n",
                "[2026-09-18][10:00:01][WARN][relaydesk] config write failed\n",
            ),
        )
        .unwrap();

        let exported = export_diagnostics_from(&source, &destination, None).unwrap();
        let content = std::fs::read_to_string(&destination).unwrap();

        assert_eq!(exported.file_path, destination.display().to_string());
        for secret in [
            "hunter2",
            "session-secret",
            "access-secret",
            "authorization-secret",
            "sk-test-secret-value",
            "password-tail",
            "json-authorization",
            "camel-token",
            "split-authorization-secret",
            "split-three-line-secret",
            "123456789",
            "split-json-secret",
        ] {
            assert!(!content.contains(secret), "leaked {secret}");
        }
        assert!(content.contains("RelayDesk started"));
        assert!(content.contains("config write failed"));
        assert!(content.contains("[REDACTED]"));
    }

    #[test]
    fn export_rejects_missing_or_empty_log_without_creating_download() {
        let temp = tempfile::tempdir().expect("isolated tempdir");
        let destination = temp.path().join("export.log");

        assert_eq!(
            export_diagnostics_from(&temp.path().join("missing.log"), &destination, None)
                .unwrap_err(),
            "relay.diagnostics_no_logs"
        );
        assert!(!destination.exists());

        let empty = temp.path().join("empty.log");
        std::fs::write(&empty, "").unwrap();
        assert_eq!(
            export_diagnostics_from(&empty, &destination, None).unwrap_err(),
            "relay.diagnostics_no_logs"
        );
        assert!(!destination.exists());
    }

    #[test]
    fn export_prepends_environment_check_section() {
        let temp = tempfile::tempdir().expect("isolated tempdir");
        let source = temp.path().join("relaydesk.log");
        let destination = temp.path().join("export.log");
        std::fs::write(&source, "[2026-09-19][10:00:00][INFO][relaydesk] started\n").unwrap();
        let checks = [crate::commands::env_doctor::RelayEnvCheck::for_test(
            "git",
            "ok",
            Some("2.54.0".to_string()),
            None,
        )];
        export_diagnostics_from(&source, &destination, Some(&checks)).unwrap();
        let content = std::fs::read_to_string(&destination).unwrap();
        assert!(content.contains(
            "=== RelayDesk Environment Check ===\n[ok] git: 2.54.0\n=== Application Log ===\n"
        ));
        assert!(content.starts_with(&format!("RelayDesk {}", env!("CARGO_PKG_VERSION"))));
    }
}
