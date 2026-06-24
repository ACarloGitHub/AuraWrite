// secrets.rs - AES-256-GCM encrypted credential storage
// Replaces OS keychain with local encrypted file storage.
// Keys are encrypted with a machine-specific key derived from
// hostname + username + OS name, and stored in
// <app_data_dir>/secrets.enc as base64-encoded JSON.

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use tauri::State;

pub struct SecretsState {
    pub store: Mutex<HashMap<String, String>>,
}

#[derive(Serialize, Deserialize)]
struct SecretsFile {
    entries: String,
}

fn derive_key() -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(b"aurawrite-api-keys-v1-");
    let hostname = sysinfo::System::host_name().unwrap_or_else(|| "unknown".into());
    hasher.update(hostname.as_bytes());
    let username = std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "unknown".into());
    hasher.update(username.as_bytes());
    let os_name = sysinfo::System::name().unwrap_or_else(|| "unknown".into());
    hasher.update(os_name.as_bytes());
    let result = hasher.finalize();
    let mut key = [0u8; 32];
    key.copy_from_slice(&result);
    key
}

fn get_secrets_path() -> PathBuf {
    let app_data = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    let aurawrite_dir = app_data.join("aurawrite");
    fs::create_dir_all(&aurawrite_dir).ok();
    aurawrite_dir.join("secrets.enc")
}

fn encrypt(plaintext: &str, key: &[u8; 32]) -> Result<String, String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let mut nonce_bytes = [0u8; 12];
    rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| e.to_string())?;
    let mut combined = nonce_bytes.to_vec();
    combined.extend_from_slice(&ciphertext);
    Ok(BASE64.encode(&combined))
}

fn decrypt(encoded: &str, key: &[u8; 32]) -> Result<String, String> {
    let combined = BASE64.decode(encoded).map_err(|e| e.to_string())?;
    if combined.len() < 12 {
        return Err("encrypted data too short".into());
    }
    let (nonce_bytes, ciphertext) = combined.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| e.to_string())?;
    String::from_utf8(plaintext).map_err(|e| e.to_string())
}

pub fn load_secrets() -> HashMap<String, String> {
    let path = get_secrets_path();
    let key = derive_key();
    if !path.exists() {
        return HashMap::new();
    }
    let contents = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return HashMap::new(),
    };
    let file: SecretsFile = match serde_json::from_str(&contents) {
        Ok(f) => f,
        Err(_) => return HashMap::new(),
    };
    let decrypted = match decrypt(&file.entries, &key) {
        Ok(d) => d,
        Err(_) => return HashMap::new(),
    };
    serde_json::from_str(&decrypted).unwrap_or_default()
}

pub fn get_secret_direct(key: &str) -> Option<String> {
    let data = load_secrets();
    data.get(key).cloned()
}

fn save_secrets(data: &HashMap<String, String>) -> Result<(), String> {
    let key = derive_key();
    let json = serde_json::to_string(data).map_err(|e| e.to_string())?;
    let encrypted = encrypt(&json, &key)?;
    let file = SecretsFile { entries: encrypted };
    let file_json = serde_json::to_string(&file).map_err(|e| e.to_string())?;
    let path = get_secrets_path();
    fs::write(&path, file_json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secrets_set(state: State<'_, SecretsState>, key: String, value: String) -> Result<(), String> {
    let mut data = state.store.lock().map_err(|e| e.to_string())?;
    data.insert(key, value);
    let result = save_secrets(&data);
    drop(data);
    result
}

#[tauri::command]
pub fn secrets_get(state: State<'_, SecretsState>, key: String) -> Result<Option<String>, String> {
    let data = state.store.lock().map_err(|e| e.to_string())?;
    Ok(data.get(&key).cloned())
}

#[tauri::command]
pub fn secrets_delete(state: State<'_, SecretsState>, key: String) -> Result<(), String> {
    let mut data = state.store.lock().map_err(|e| e.to_string())?;
    data.remove(&key);
    let result = save_secrets(&data);
    drop(data);
    result
}