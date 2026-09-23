//! RelayDesk's optional remembered-login vault.
//!
//! This module deliberately does not use an OS credential store. A remembered
//! login stores only the long-lived relay access token, encrypted with a
//! per-installation key kept in the RelayDesk application directory. The
//! renderer can only see [`SavedLoginInfo`], never the token or key.

use base64::Engine;
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM};
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use crate::error::AppError;

const KEY_FILE: &str = "relaydesk-login-vault.key";
const VAULT_FILE: &str = "relaydesk-login-vault.bin";
const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 12;

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct SavedLogin {
    pub id: String,
    pub base_url: String,
    pub username: String,
    pub user_id: Option<i64>,
    pub access_token: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedLoginInfo {
    pub id: String,
    pub base_url: String,
    pub username: String,
    pub user_id: Option<i64>,
    pub updated_at: i64,
}

impl SavedLogin {
    pub(crate) fn new(
        base_url: &str,
        username: &str,
        user_id: Option<i64>,
        access_token: &str,
        updated_at: i64,
    ) -> Self {
        let base_url = normalize_base_url(base_url);
        let id = identity(&base_url, username, user_id);
        Self {
            id,
            base_url,
            username: username.to_string(),
            user_id,
            access_token: access_token.to_string(),
            updated_at,
        }
    }

    fn info(&self) -> SavedLoginInfo {
        SavedLoginInfo {
            id: self.id.clone(),
            base_url: self.base_url.clone(),
            username: self.username.clone(),
            user_id: self.user_id,
            updated_at: self.updated_at,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct VaultEnvelope {
    version: u8,
    nonce: String,
    ciphertext: String,
}

#[derive(Default, Serialize, Deserialize)]
struct VaultPayload {
    accounts: Vec<SavedLogin>,
}

#[derive(Debug, Clone)]
pub(crate) struct VaultStore {
    dir: PathBuf,
    #[cfg(test)]
    _temp: Option<std::sync::Arc<tempfile::TempDir>>,
}

impl VaultStore {
    pub(crate) fn new(dir: impl AsRef<Path>) -> Self {
        Self {
            dir: dir.as_ref().to_path_buf(),
            #[cfg(test)]
            _temp: None,
        }
    }

    pub(crate) fn list(&self) -> Result<Vec<SavedLoginInfo>, AppError> {
        let mut accounts: Vec<_> = self.load()?.iter().map(SavedLogin::info).collect();
        accounts.sort_by(|left, right| {
            right
                .updated_at
                .cmp(&left.updated_at)
                .then_with(|| left.username.cmp(&right.username))
        });
        Ok(accounts)
    }

    pub(crate) fn get(&self, id: &str) -> Result<Option<SavedLogin>, AppError> {
        Ok(self.load()?.into_iter().find(|account| account.id == id))
    }

    pub(crate) fn upsert(&self, account: SavedLogin) -> Result<(), AppError> {
        if account.access_token.trim().is_empty() {
            return Err(storage_error());
        }
        let mut accounts = self.load()?;
        accounts.retain(|existing| existing.id != account.id);
        accounts.push(account);
        self.save(&accounts)
    }

    pub(crate) fn remove(&self, id: &str) -> Result<bool, AppError> {
        let mut accounts = self.load()?;
        let original_len = accounts.len();
        accounts.retain(|account| account.id != id);
        if accounts.len() == original_len {
            return Ok(false);
        }
        self.save(&accounts)?;
        Ok(true)
    }

    pub(crate) fn remove_for_user(
        &self,
        base_url: &str,
        username: &str,
        user_id: Option<i64>,
    ) -> Result<bool, AppError> {
        let normalized_url = normalize_base_url(base_url);
        let mut accounts = self.load()?;
        let original_len = accounts.len();
        accounts.retain(|account| {
            let same_url = account.base_url == normalized_url;
            let same_name = account.username.eq_ignore_ascii_case(username);
            let same_id = user_id.is_some() && account.user_id == user_id;
            !(same_url && (same_name || same_id))
        });
        if accounts.len() == original_len {
            return Ok(false);
        }
        self.save(&accounts)?;
        Ok(true)
    }

    fn load(&self) -> Result<Vec<SavedLogin>, AppError> {
        let path = self.dir.join(VAULT_FILE);
        if !path.exists() {
            return Ok(Vec::new());
        }
        let key = self.read_key(false)?;
        let bytes = fs::read(&path).map_err(|_| storage_error())?;
        let envelope: VaultEnvelope =
            serde_json::from_slice(&bytes).map_err(|_| storage_error())?;
        if envelope.version != 1 {
            return Err(storage_error());
        }
        let nonce_bytes = base64::engine::general_purpose::STANDARD
            .decode(envelope.nonce)
            .map_err(|_| storage_error())?;
        if nonce_bytes.len() != NONCE_LEN {
            return Err(storage_error());
        }
        let mut ciphertext = base64::engine::general_purpose::STANDARD
            .decode(envelope.ciphertext)
            .map_err(|_| storage_error())?;
        let key =
            LessSafeKey::new(UnboundKey::new(&AES_256_GCM, &key).map_err(|_| storage_error())?);
        let nonce = Nonce::try_assume_unique_for_key(&nonce_bytes).map_err(|_| storage_error())?;
        let plaintext = key
            .open_in_place(nonce, Aad::empty(), &mut ciphertext)
            .map_err(|_| storage_error())?;
        let payload: VaultPayload =
            serde_json::from_slice(plaintext).map_err(|_| storage_error())?;
        Ok(payload.accounts)
    }

    fn save(&self, accounts: &[SavedLogin]) -> Result<(), AppError> {
        fs::create_dir_all(&self.dir).map_err(|_| storage_error())?;
        let key_bytes = self.read_key(true)?;
        let mut plaintext = serde_json::to_vec(&VaultPayload {
            accounts: accounts.to_vec(),
        })
        .map_err(|_| storage_error())?;
        let rng = SystemRandom::new();
        let mut nonce_bytes = [0u8; NONCE_LEN];
        rng.fill(&mut nonce_bytes).map_err(|_| storage_error())?;
        let nonce = Nonce::assume_unique_for_key(nonce_bytes);
        let key = LessSafeKey::new(
            UnboundKey::new(&AES_256_GCM, &key_bytes).map_err(|_| storage_error())?,
        );
        key.seal_in_place_append_tag(nonce, Aad::empty(), &mut plaintext)
            .map_err(|_| storage_error())?;
        let envelope = VaultEnvelope {
            version: 1,
            nonce: base64::engine::general_purpose::STANDARD.encode(nonce_bytes),
            ciphertext: base64::engine::general_purpose::STANDARD.encode(plaintext),
        };
        let bytes = serde_json::to_vec(&envelope).map_err(|_| storage_error())?;
        use std::io::Write;
        let mut tmp = tempfile::NamedTempFile::new_in(&self.dir).map_err(|_| storage_error())?;
        set_private_mode(tmp.path())?;
        tmp.write_all(&bytes).map_err(|_| storage_error())?;
        tmp.as_file().sync_all().map_err(|_| storage_error())?;
        tmp.persist(self.dir.join(VAULT_FILE))
            .map_err(|_| storage_error())?;
        Ok(())
    }

    fn read_key(&self, create: bool) -> Result<[u8; KEY_LEN], AppError> {
        let path = self.dir.join(KEY_FILE);
        if let Ok(bytes) = fs::read(&path) {
            return bytes.try_into().map_err(|_| storage_error());
        }
        if !create {
            return Err(storage_error());
        }
        fs::create_dir_all(&self.dir).map_err(|_| storage_error())?;
        let mut key = [0u8; KEY_LEN];
        SystemRandom::new()
            .fill(&mut key)
            .map_err(|_| storage_error())?;
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        match options.open(&path) {
            Ok(mut file) => {
                use std::io::Write;
                file.write_all(&key).map_err(|_| storage_error())?;
                set_private_mode(&path)?;
                Ok(key)
            }
            Err(error) if error.kind() == ErrorKind::AlreadyExists => {
                let bytes = fs::read(&path).map_err(|_| storage_error())?;
                bytes.try_into().map_err(|_| storage_error())
            }
            Err(_) => Err(storage_error()),
        }
    }
}

pub(crate) fn app_store() -> VaultStore {
    #[cfg(test)]
    {
        let temp = std::sync::Arc::new(tempfile::tempdir().expect("isolated test vault"));
        let mut store = VaultStore::new(temp.path());
        store._temp = Some(temp);
        store
    }
    #[cfg(not(test))]
    VaultStore::new(crate::config::get_app_config_dir())
}

fn storage_error() -> AppError {
    AppError::Message("relay.saved_login_storage_failed".to_string())
}

fn identity(base_url: &str, username: &str, _user_id: Option<i64>) -> String {
    let mut hasher = Sha256::new();
    hasher.update(base_url.as_bytes());
    hasher.update([0]);
    hasher.update(username.trim().to_ascii_lowercase().as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(hasher.finalize())
}

fn normalize_base_url(base_url: &str) -> String {
    base_url.trim().trim_end_matches('/').to_string()
}

fn set_private_mode(path: &Path) -> Result<(), AppError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(path)
            .map_err(|_| storage_error())?
            .permissions();
        permissions.set_mode(0o600);
        fs::set_permissions(path, permissions).map_err(|_| storage_error())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{SavedLogin, SavedLoginInfo, VaultStore};
    use tempfile::tempdir;

    fn entry(username: &str, token: &str) -> SavedLogin {
        SavedLogin::new("https://relay.example.test/", username, None, token, 10)
    }

    #[test]
    fn removes_renamed_account_by_user_id_without_removing_other_users() {
        let dir = tempdir().unwrap();
        let store = VaultStore::new(dir.path());
        store
            .upsert(SavedLogin::new(
                "https://relay.example.test",
                "old-name",
                Some(7),
                "synthetic-a",
                1,
            ))
            .unwrap();
        store
            .upsert(SavedLogin::new(
                "https://relay.example.test",
                "other",
                Some(8),
                "synthetic-b",
                1,
            ))
            .unwrap();
        assert!(store
            .remove_for_user("https://relay.example.test/", "new-name", Some(7))
            .unwrap());
        let remaining = store.list().unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].username, "other");
    }

    #[test]
    fn corrupted_ciphertext_is_rejected_and_metadata_never_contains_token() {
        let dir = tempdir().unwrap();
        let store = VaultStore::new(dir.path());
        store.upsert(entry("alice", "synthetic-secret")).unwrap();
        assert!(!serde_json::to_string(&store.list().unwrap())
            .unwrap()
            .contains("synthetic-secret"));
        std::fs::write(dir.path().join(super::VAULT_FILE), b"corrupted").unwrap();
        assert!(store.get("anything").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn vault_and_key_files_are_private() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempdir().unwrap();
        VaultStore::new(dir.path())
            .upsert(entry("alice", "synthetic-secret"))
            .unwrap();
        for name in [super::KEY_FILE, super::VAULT_FILE] {
            assert_eq!(
                std::fs::metadata(dir.path().join(name))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
    }

    #[test]
    fn encrypted_round_trip_keeps_token_out_of_the_vault_file() {
        let dir = tempdir().unwrap();
        let account = entry("alice", "secret-access-token");
        let store = VaultStore::new(dir.path());
        store.upsert(account.clone()).unwrap();

        let raw = std::fs::read(dir.path().join("relaydesk-login-vault.bin")).unwrap();
        assert!(!String::from_utf8_lossy(&raw).contains("secret-access-token"));
        assert_eq!(
            store.get(&account.id).unwrap().unwrap().access_token,
            account.access_token
        );
    }

    #[test]
    fn supports_multiple_accounts_and_removing_one() {
        let dir = tempdir().unwrap();
        let store = VaultStore::new(dir.path());
        let first = entry("alice", "token-a");
        let second = entry("bob", "token-b");
        store.upsert(first.clone()).unwrap();
        store.upsert(second.clone()).unwrap();

        let listed: Vec<SavedLoginInfo> = store.list().unwrap();
        assert_eq!(listed.len(), 2);
        assert!(listed.iter().any(|item| item.username == "alice"));
        assert!(listed.iter().any(|item| item.username == "bob"));
        assert!(store.remove(&first.id).unwrap());
        assert!(store.get(&first.id).unwrap().is_none());
        assert!(store.get(&second.id).unwrap().is_some());
    }
}
