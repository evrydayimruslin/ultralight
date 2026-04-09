// Shell + Git tools — Tauri commands for running commands in the project.
// Placeholder — full implementation in Phase 1B.

use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

/// Validate project root exists and is a directory.
fn validate_root(project_root: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(project_root)
        .canonicalize()
        .map_err(|e| format!("Invalid project root: {}", e))?;
    if !root.is_dir() {
        return Err("Project root is not a directory".to_string());
    }
    Ok(root)
}

// ── shell_exec ──

#[tauri::command]
pub fn shell_exec(
    project_root: String,
    command: String,
    timeout_ms: Option<u64>,
) -> Result<String, String> {
    let root = validate_root(&project_root)?;
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(120_000));

    #[cfg(target_os = "windows")]
    let child = Command::new("cmd")
        .args(&["/C", &command])
        .current_dir(&root)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn command: {}", e))?;

    #[cfg(not(target_os = "windows"))]
    let child = Command::new("sh")
        .arg("-c")
        .arg(&command)
        .current_dir(&root)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn command: {}", e))?;

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Command failed: {}", e))?;

    // Check if we should have timed out (basic — real timeout needs threading)
    let _ = timeout; // TODO: implement real timeout with thread in 1B

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    let mut result = String::new();
    if !stdout.is_empty() {
        result.push_str(&stdout);
    }
    if !stderr.is_empty() {
        if !result.is_empty() {
            result.push('\n');
        }
        result.push_str("[stderr]\n");
        result.push_str(&stderr);
    }

    if output.status.success() {
        if result.is_empty() {
            Ok("(command completed with no output)".to_string())
        } else {
            Ok(result)
        }
    } else {
        let code = output.status.code().unwrap_or(-1);
        if result.is_empty() {
            Err(format!("Command exited with code {}", code))
        } else {
            // Include output even on failure — it usually has the error message
            Ok(format!("[exit code {}]\n{}", code, result))
        }
    }
}

// ── git ──

#[tauri::command]
pub fn git(
    project_root: String,
    subcommand: String,
    args: Option<Vec<String>>,
) -> Result<String, String> {
    let root = validate_root(&project_root)?;

    let mut cmd = Command::new("git");
    cmd.arg(&subcommand);
    cmd.current_dir(&root);

    if let Some(extra_args) = &args {
        for arg in extra_args {
            cmd.arg(arg);
        }
    }

    let output = cmd
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    let mut result = String::new();
    if !stdout.is_empty() {
        result.push_str(&stdout);
    }
    if !stderr.is_empty() {
        if !result.is_empty() {
            result.push('\n');
        }
        // Git sends some normal output to stderr (e.g., progress)
        result.push_str(&stderr);
    }

    if result.is_empty() {
        Ok("(no output)".to_string())
    } else {
        Ok(result)
    }
}
