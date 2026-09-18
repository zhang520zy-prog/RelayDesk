use serde::Serialize;
use std::path::Path;
use std::sync::OnceLock;

use regex::Regex;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayDiagnosticsExport {
    pub file_path: String,
}

#[tauri::command]
pub fn relay_export_diagnostics(file_path: String) -> Result<RelayDiagnosticsExport, String> {
    let source = crate::panic_hook::get_log_dir().join("relaydesk.log");
    export_diagnostics_from(&source, Path::new(&file_path))
}

fn export_diagnostics_from(
    source: &Path,
    destination: &Path,
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
    let sanitized = redact_diagnostics(&raw);
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

        let exported = export_diagnostics_from(&source, &destination).unwrap();
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
            export_diagnostics_from(&temp.path().join("missing.log"), &destination).unwrap_err(),
            "relay.diagnostics_no_logs"
        );
        assert!(!destination.exists());

        let empty = temp.path().join("empty.log");
        std::fs::write(&empty, "").unwrap();
        assert_eq!(
            export_diagnostics_from(&empty, &destination).unwrap_err(),
            "relay.diagnostics_no_logs"
        );
        assert!(!destination.exists());
    }
}
