//! 中转站账号 DAO
//!
//! 账号（含系统访问令牌与分组专用 key）存储于 settings KV，与
//! universal_providers 同一持久化模式。sk- key 与 provider 配置
//! 一样本就是本库明文存储的既有模型。

use crate::database::{lock_conn, to_json_string, Database};
use crate::error::AppError;
use crate::relay::{RelayAccount, RelayApplyApps};
use rusqlite::{Connection, OptionalExtension};

const RELAY_ACCOUNT_KEY: &str = "relay_account";

fn read_relay_account(conn: &Connection) -> Result<Option<RelayAccount>, AppError> {
    let json: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?",
            [RELAY_ACCOUNT_KEY],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| AppError::Database(e.to_string()))?;
    json.map(|value| {
        serde_json::from_str(&value)
            .map_err(|e| AppError::Database(format!("解析中转站账号失败: {e}")))
    })
    .transpose()
}

fn write_relay_account(conn: &Connection, account: &RelayAccount) -> Result<(), AppError> {
    // Defense in depth: even callers that accidentally pass an active session
    // can only write a metadata snapshot to the ordinary settings table.
    let mut snapshot = account.clone();
    snapshot.access_token.clear();
    let json = to_json_string(&snapshot)?;
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
        [RELAY_ACCOUNT_KEY, &json],
    )
    .map_err(|e| AppError::Database(e.to_string()))?;
    Ok(())
}

fn same_user(left: &RelayAccount, right: &RelayAccount) -> bool {
    if left.base_url != right.base_url {
        return false;
    }
    match (left.user_id, right.user_id) {
        (Some(left_id), Some(right_id)) => left_id == right_id,
        (None, None) => left.username == right.username,
        _ => false,
    }
}

fn same_session(left: &RelayAccount, right: &RelayAccount) -> bool {
    same_user(left, right) && left.access_token == right.access_token
}

impl Database {
    /// 获取中转站账号
    pub fn get_relay_account(&self) -> Result<Option<RelayAccount>, AppError> {
        let conn = lock_conn!(self.conn);
        read_relay_account(&conn)
    }

    /// 保存中转站账号
    pub fn save_relay_account(&self, account: &RelayAccount) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        write_relay_account(&conn, account)
    }

    /// Atomically store a login response while preserving local preferences for
    /// the same relay user. A new credential always replaces the previous one.
    pub fn save_relay_login_preserving_local(
        &self,
        incoming: &RelayAccount,
    ) -> Result<RelayAccount, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stored = incoming.clone();
        if let Some(current) = read_relay_account(&conn)? {
            if same_user(&current, incoming) {
                stored.apply_apps = current.apply_apps;
                stored.group_targets = current.group_targets;
                stored.group_tokens = current.group_tokens;
                stored.last_applied = current.last_applied;
            }
        }
        stored.access_token.clear();
        write_relay_account(&conn, &stored)?;
        Ok(stored)
    }

    /// Atomically mutate the account only if the exact credential session read
    /// by the caller is still current. `None` means logout/relogin won the race.
    pub fn update_relay_account_if_session<F>(
        &self,
        expected: &RelayAccount,
        update: F,
    ) -> Result<Option<RelayAccount>, AppError>
    where
        F: FnOnce(&mut RelayAccount),
    {
        let conn = lock_conn!(self.conn);
        let Some(mut current) = read_relay_account(&conn)? else {
            return Ok(None);
        };
        if !same_session(&current, expected) {
            return Ok(None);
        }
        update(&mut current);
        write_relay_account(&conn, &current)?;
        Ok(Some(current))
    }

    /// Atomically update apply preferences on whichever account is current.
    pub fn set_relay_apply_apps(&self, apps: RelayApplyApps) -> Result<RelayAccount, AppError> {
        let conn = lock_conn!(self.conn);
        let mut current = read_relay_account(&conn)?
            .filter(|account| !account.access_token.is_empty())
            .ok_or_else(|| AppError::Message("relay.not_logged_in".to_string()))?;
        current.apply_apps = apps;
        current.updated_at = chrono::Utc::now().timestamp_millis();
        write_relay_account(&conn, &current)?;
        Ok(current)
    }

    /// Atomically update one local group-to-target override.
    pub fn set_relay_group_target(
        &self,
        group: &str,
        target: Option<&str>,
    ) -> Result<RelayAccount, AppError> {
        let conn = lock_conn!(self.conn);
        let mut current = read_relay_account(&conn)?
            .filter(|account| !account.access_token.is_empty())
            .ok_or_else(|| AppError::Message("relay.not_logged_in".to_string()))?;
        match target {
            Some(target) => {
                current
                    .group_targets
                    .insert(group.to_string(), target.to_string());
            }
            None => {
                current.group_targets.remove(group);
            }
        }
        current.updated_at = chrono::Utc::now().timestamp_millis();
        write_relay_account(&conn, &current)?;
        Ok(current)
    }

    /// Clear only the credential session that observed an authentication
    /// failure. A newer login for the same user is never removed.
    pub fn clear_relay_account_if_session(
        &self,
        expected: &RelayAccount,
    ) -> Result<bool, AppError> {
        let conn = lock_conn!(self.conn);
        let Some(current) = read_relay_account(&conn)? else {
            return Ok(false);
        };
        if !same_session(&current, expected) {
            return Ok(false);
        }
        conn.execute("DELETE FROM settings WHERE key = ?", [RELAY_ACCOUNT_KEY])
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(true)
    }

    /// 清除中转站账号（退出登录）
    pub fn clear_relay_account(&self) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute("DELETE FROM settings WHERE key = ?", [RELAY_ACCOUNT_KEY])
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::relay::{RelayAppliedModel, RelayApplyApps, RelayGroupToken};
    use std::collections::HashMap;

    fn account(access_token: &str) -> RelayAccount {
        RelayAccount {
            base_url: "https://relay.invalid".to_string(),
            access_token: access_token.to_string(),
            remembered: true,
            user_id: Some(42),
            username: "fixture-user".to_string(),
            quota: 10,
            used_quota: 2,
            currency: Default::default(),
            group: "default".to_string(),
            apply_apps: RelayApplyApps::default(),
            group_targets: HashMap::new(),
            group_tokens: HashMap::new(),
            last_applied: None,
            updated_at: 1,
        }
    }

    #[test]
    fn persisted_snapshots_preserve_preferences_but_never_store_session_tokens() {
        let db = Database::memory().unwrap();
        let mut old = account("synthetic-old-session");
        old.apply_apps.codex = false;
        old.group_tokens.insert(
            "paid".into(),
            RelayGroupToken {
                token_id: 7,
                key: "sk-synthetic-group".into(),
            },
        );
        db.save_relay_account(&old).unwrap();

        let fresh = db
            .save_relay_login_preserving_local(&account("synthetic-new-session"))
            .unwrap();
        assert!(fresh.access_token.is_empty());
        assert!(!fresh.apply_apps.codex);
        assert!(fresh.group_tokens.contains_key("paid"));

        let stale_write = db
            .update_relay_account_if_session(&old, |current| current.quota = 999)
            .unwrap();
        assert!(stale_write.is_none());
        let stored = db.get_relay_account().unwrap().unwrap();
        assert!(stored.access_token.is_empty());
        assert_eq!(stored.quota, 10);
        assert!(!db.clear_relay_account_if_session(&old).unwrap());
        assert!(db
            .get_relay_account()
            .unwrap()
            .unwrap()
            .access_token
            .is_empty());
    }

    #[test]
    fn logout_between_read_and_write_cannot_resurrect_account() {
        let db = Database::memory().unwrap();
        let old = account("synthetic-session");
        db.save_relay_account(&old).unwrap();
        db.clear_relay_account().unwrap();

        let stale_write = db
            .update_relay_account_if_session(&old, |current| {
                current.last_applied = Some(RelayAppliedModel {
                    group: "paid".into(),
                    model: "fixture-model".into(),
                });
            })
            .unwrap();

        assert!(stale_write.is_none());
        assert!(db.get_relay_account().unwrap().is_none());
    }

    #[test]
    fn login_snapshot_update_preserves_latest_preferences() {
        let db = Database::memory().unwrap();
        let old = account("synthetic-session");
        db.save_relay_account(&old).unwrap();

        let latest_apps = RelayApplyApps {
            claude: true,
            codex: false,
            gemini: true,
        };
        let mut latest = account("synthetic-session");
        latest.apply_apps = latest_apps.clone();
        latest.group_tokens.insert(
            "paid".into(),
            RelayGroupToken {
                token_id: 8,
                key: "sk-synthetic-new".into(),
            },
        );
        let updated = db.save_relay_login_preserving_local(&latest).unwrap();

        assert_eq!(updated.apply_apps.codex, RelayApplyApps::default().codex);
        assert!(!updated.group_tokens.contains_key("paid"));
        assert!(updated.access_token.is_empty());
    }
}
