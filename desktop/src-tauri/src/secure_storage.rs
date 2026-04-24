use keyring::{Entry, Error as KeyringError};

const SERVICE_NAME: &str = "dev.ultralight.chat";
const ACCOUNT_NAME: &str = "auth_token";

fn auth_token_entry() -> Result<Entry, String> {
    Entry::new(SERVICE_NAME, ACCOUNT_NAME)
        .map_err(|err| format!("failed to open secure auth storage: {}", err))
}

#[tauri::command]
pub fn secure_get_auth_token() -> Result<Option<String>, String> {
    let entry = auth_token_entry()?;
    match entry.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(err) => Err(format!("failed to read secure auth token: {}", err)),
    }
}

#[tauri::command]
pub fn secure_set_auth_token(token: String) -> Result<(), String> {
    if token.trim().is_empty() {
        return Err("auth token cannot be empty".to_string());
    }

    auth_token_entry()?
        .set_password(&token)
        .map_err(|err| format!("failed to store secure auth token: {}", err))
}

#[tauri::command]
pub fn secure_clear_auth_token() -> Result<(), String> {
    let entry = auth_token_entry()?;
    match entry.delete_password() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(err) => Err(format!("failed to clear secure auth token: {}", err)),
    }
}
