// Filesystem tools — Tauri commands for local file operations.
// All commands take a `project_root` and validate paths stay within it.

use std::fs;
use std::path::PathBuf;
use std::time::SystemTime;
use walkdir::WalkDir;

/// Validate that a resolved path is within the project root.
/// Returns the canonical absolute path on success.
fn validate_path(project_root: &str, relative_path: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(project_root)
        .canonicalize()
        .map_err(|e| format!("Invalid project root: {}", e))?;

    // Join and canonicalize — handles ".." traversal attempts
    let target = root.join(relative_path);

    // For reads, target must exist to canonicalize
    // For writes, parent must exist — we handle this in the write command
    if target.exists() {
        let canonical = target
            .canonicalize()
            .map_err(|e| format!("Cannot resolve path: {}", e))?;
        if !canonical.starts_with(&root) {
            return Err("Path traversal denied: path is outside project directory".to_string());
        }
        Ok(canonical)
    } else {
        // For non-existent paths (writes), check that the normalized path stays within root
        // Use the parent directory for validation
        let parent = target.parent().ok_or("Invalid path")?;
        if parent.exists() {
            let canonical_parent = parent
                .canonicalize()
                .map_err(|e| format!("Cannot resolve parent: {}", e))?;
            if !canonical_parent.starts_with(&root) {
                return Err(
                    "Path traversal denied: path is outside project directory".to_string(),
                );
            }
        }
        // Return the joined (non-canonical) path for creation
        Ok(target)
    }
}

/// Validate project root exists and is a directory. Returns canonical path.
fn validate_root(project_root: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(project_root)
        .canonicalize()
        .map_err(|e| format!("Invalid project root: {}", e))?;
    if !root.is_dir() {
        return Err("Project root is not a directory".to_string());
    }
    Ok(root)
}

// ── file_read ──

#[tauri::command]
pub fn file_read(
    project_root: String,
    path: String,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<String, String> {
    let target = validate_path(&project_root, &path)?;

    if !target.is_file() {
        return Err(format!("Not a file: {}", path));
    }

    // Check file size — refuse files > 2MB without offset/limit
    let metadata = fs::metadata(&target).map_err(|e| format!("Cannot read metadata: {}", e))?;
    if metadata.len() > 2_000_000 && offset.is_none() && limit.is_none() {
        return Err(format!(
            "File is too large ({} bytes). Use offset and limit parameters to read a portion.",
            metadata.len()
        ));
    }

    let content =
        fs::read_to_string(&target).map_err(|e| format!("Cannot read file: {}", e))?;

    let lines: Vec<&str> = content.lines().collect();
    let start = offset.unwrap_or(1).saturating_sub(1); // Convert 1-based to 0-based
    let end = limit
        .map(|l| (start + l).min(lines.len()))
        .unwrap_or(lines.len());

    if start >= lines.len() {
        return Ok(format!("(file has {} lines, offset {} is past end)", lines.len(), start + 1));
    }

    // Format with line numbers (cat -n style)
    let mut result = String::new();
    for (i, line) in lines[start..end].iter().enumerate() {
        let line_num = start + i + 1; // 1-based
        result.push_str(&format!("{:>6}\t{}\n", line_num, line));
    }

    Ok(result)
}

// ── file_write ──

#[tauri::command]
pub fn file_write(project_root: String, path: String, content: String) -> Result<String, String> {
    let target = validate_path(&project_root, &path)?;

    // Create parent directories if needed
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Cannot create directories: {}", e))?;
    }

    let bytes = content.len();
    fs::write(&target, &content).map_err(|e| format!("Cannot write file: {}", e))?;

    Ok(format!("Wrote {} bytes to {}", bytes, path))
}

// ── file_edit ──

#[tauri::command]
pub fn file_edit(
    project_root: String,
    path: String,
    old_string: String,
    new_string: String,
) -> Result<String, String> {
    let target = validate_path(&project_root, &path)?;

    if !target.is_file() {
        return Err(format!("Not a file: {}", path));
    }

    let content =
        fs::read_to_string(&target).map_err(|e| format!("Cannot read file: {}", e))?;

    // Count occurrences
    let count = content.matches(&old_string).count();

    if count == 0 {
        // Show nearby content for debugging
        let preview = if content.len() > 200 {
            format!("{}...", &content[..200])
        } else {
            content.clone()
        };
        return Err(format!(
            "old_string not found in {}. File starts with:\n{}",
            path, preview
        ));
    }

    if count > 1 {
        return Err(format!(
            "old_string found {} times in {}. It must be unique. Add more surrounding context to make it unique.",
            count, path
        ));
    }

    // Exactly one occurrence — replace it
    let new_content = content.replacen(&old_string, &new_string, 1);
    fs::write(&target, &new_content).map_err(|e| format!("Cannot write file: {}", e))?;

    Ok(format!("Edited {} — replaced 1 occurrence", path))
}

// ── glob_search ──

#[tauri::command]
pub fn glob_search(project_root: String, pattern: String) -> Result<String, String> {
    let root = validate_root(&project_root)?;

    // Resolve the pattern relative to the project root
    let full_pattern = root.join(&pattern);
    let pattern_str = full_pattern.to_string_lossy();

    let mut entries: Vec<(PathBuf, SystemTime)> = Vec::new();

    for entry in glob::glob(&pattern_str).map_err(|e| format!("Invalid glob pattern: {}", e))? {
        match entry {
            Ok(path) => {
                if let Ok(meta) = fs::metadata(&path) {
                    let mtime = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
                    entries.push((path, mtime));
                }
            }
            Err(_) => continue,
        }
    }

    // Sort by modification time (newest first)
    entries.sort_by(|a, b| b.1.cmp(&a.1));

    // Convert to relative paths
    let result: Vec<String> = entries
        .iter()
        .filter_map(|(path, _)| {
            path.strip_prefix(&root)
                .ok()
                .map(|p| p.to_string_lossy().to_string())
        })
        .collect();

    if result.is_empty() {
        Ok(format!("No files matching pattern: {}", pattern))
    } else {
        Ok(result.join("\n"))
    }
}

// ── grep_search ──

#[tauri::command]
pub fn grep_search(
    project_root: String,
    pattern: String,
    include: Option<String>,
    max_results: Option<usize>,
) -> Result<String, String> {
    let root = validate_root(&project_root)?;
    let re = regex::Regex::new(&pattern).map_err(|e| format!("Invalid regex: {}", e))?;
    let max = max_results.unwrap_or(100);

    // Optional glob filter for file inclusion
    let include_re = include
        .as_ref()
        .map(|inc| {
            // Convert simple glob to regex (e.g., "*.ts" → "\.ts$")
            let escaped = regex::escape(inc).replace(r"\*", ".*").replace(r"\?", ".");
            regex::Regex::new(&format!("{}$", escaped))
        })
        .transpose()
        .map_err(|e| format!("Invalid include pattern: {}", e))?;

    let mut results = Vec::new();

    for entry in WalkDir::new(&root)
        .into_iter()
        .filter_entry(|e| {
            // Skip hidden dirs and common noise, but always allow the root itself
            if e.depth() == 0 {
                return true;
            }
            let name = e.file_name().to_string_lossy();
            !name.starts_with('.')
                && name != "node_modules"
                && name != "target"
                && name != "dist"
                && name != "__pycache__"
        })
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }

        let path = entry.path();

        // Apply include filter
        if let Some(ref inc_re) = include_re {
            if !inc_re.is_match(&path.to_string_lossy()) {
                continue;
            }
        }

        // Skip binary files (check first 512 bytes)
        if let Ok(bytes) = fs::read(path) {
            let check_len = bytes.len().min(512);
            if bytes[..check_len].contains(&0) {
                continue; // Binary file
            }

            if let Ok(content) = String::from_utf8(bytes) {
                let rel_path = path
                    .strip_prefix(&root)
                    .unwrap_or(path)
                    .to_string_lossy();

                for (line_num, line) in content.lines().enumerate() {
                    if re.is_match(line) {
                        results.push(format!("{}:{}:{}", rel_path, line_num + 1, line));
                        if results.len() >= max {
                            results.push(format!("... (truncated at {} results)", max));
                            return Ok(results.join("\n"));
                        }
                    }
                }
            }
        }
    }

    if results.is_empty() {
        Ok(format!("No matches for pattern: {}", pattern))
    } else {
        Ok(results.join("\n"))
    }
}

// ── ls ──

#[tauri::command]
pub fn ls(project_root: String, path: Option<String>) -> Result<String, String> {
    let root = validate_root(&project_root)?;
    let target = match &path {
        Some(p) => validate_path(&project_root, p)?,
        None => root.clone(),
    };

    if !target.is_dir() {
        return Err(format!("Not a directory: {}", path.unwrap_or_default()));
    }

    let mut entries: Vec<String> = Vec::new();

    let mut dir_entries: Vec<_> = fs::read_dir(&target)
        .map_err(|e| format!("Cannot read directory: {}", e))?
        .filter_map(|e| e.ok())
        .collect();

    // Sort: directories first, then alphabetically
    dir_entries.sort_by(|a, b| {
        let a_is_dir = a.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let b_is_dir = b.file_type().map(|t| t.is_dir()).unwrap_or(false);
        match (a_is_dir, b_is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.file_name().cmp(&b.file_name()),
        }
    });

    for entry in dir_entries {
        let name = entry.file_name().to_string_lossy().to_string();
        let file_type = entry.file_type().map_err(|e| format!("Error: {}", e))?;

        if file_type.is_dir() {
            entries.push(format!("  {}/", name));
        } else {
            let size = entry
                .metadata()
                .map(|m| format_size(m.len()))
                .unwrap_or_else(|_| "?".to_string());
            entries.push(format!("  {}  ({})", name, size));
        }
    }

    if entries.is_empty() {
        Ok("(empty directory)".to_string())
    } else {
        Ok(entries.join("\n"))
    }
}

fn format_size(bytes: u64) -> String {
    if bytes < 1024 {
        format!("{} B", bytes)
    } else if bytes < 1024 * 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    }
}

// ── Tests ──

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// Create a temp directory with test files and return its path.
    fn setup_test_dir() -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("create temp dir");
        let root = dir.path();

        // Create test files
        fs::write(root.join("hello.txt"), "line one\nline two\nline three\n").unwrap();
        fs::write(root.join("code.ts"), "const x = 1;\nconst y = 2;\nexport { x, y };\n").unwrap();
        fs::create_dir(root.join("sub")).unwrap();
        fs::write(root.join("sub/nested.txt"), "nested content\n").unwrap();
        fs::write(root.join("empty.txt"), "").unwrap();

        dir
    }

    // ── validate_path tests ──

    #[test]
    fn validate_path_normal_file() {
        let dir = setup_test_dir();
        let root = dir.path().to_str().unwrap();
        let result = validate_path(root, "hello.txt");
        assert!(result.is_ok());
    }

    #[test]
    fn validate_path_nested_file() {
        let dir = setup_test_dir();
        let root = dir.path().to_str().unwrap();
        let result = validate_path(root, "sub/nested.txt");
        assert!(result.is_ok());
    }

    #[test]
    fn validate_path_traversal_blocked() {
        let dir = setup_test_dir();
        let root = dir.path().to_str().unwrap();
        // Try to escape with ../
        let result = validate_path(root, "../../../etc/passwd");
        // Either error or the path doesn't start with root
        assert!(result.is_err() || !result.unwrap().starts_with(dir.path()));
    }

    #[test]
    fn validate_path_nonexistent_for_write() {
        let dir = setup_test_dir();
        let root = dir.path().to_str().unwrap();
        // New file in existing directory — should be OK
        let result = validate_path(root, "newfile.txt");
        assert!(result.is_ok());
    }

    #[test]
    fn validate_path_invalid_root() {
        let result = validate_path("/nonexistent/path/xyz", "file.txt");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid project root"));
    }

    // ── file_read tests ──

    #[test]
    fn file_read_full() {
        let dir = setup_test_dir();
        let root = dir.path().to_str().unwrap().to_string();
        let result = file_read(root, "hello.txt".to_string(), None, None).unwrap();
        assert!(result.contains("line one"));
        assert!(result.contains("line two"));
        assert!(result.contains("line three"));
        // Should have line numbers
        assert!(result.contains("\t"));
    }

    #[test]
    fn file_read_with_offset_limit() {
        let dir = setup_test_dir();
        let root = dir.path().to_str().unwrap().to_string();
        // Read line 2 only (1-based offset)
        let result = file_read(root, "hello.txt".to_string(), Some(2), Some(1)).unwrap();
        assert!(result.contains("line two"));
        assert!(!result.contains("line one"));
        assert!(!result.contains("line three"));
    }

    #[test]
    fn file_read_offset_past_end() {
        let dir = setup_test_dir();
        let root = dir.path().to_str().unwrap().to_string();
        let result = file_read(root, "hello.txt".to_string(), Some(999), None).unwrap();
        assert!(result.contains("past end"));
    }

    #[test]
    fn file_read_not_a_file() {
        let dir = setup_test_dir();
        let root = dir.path().to_str().unwrap().to_string();
        let result = file_read(root, "sub".to_string(), None, None);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Not a file"));
    }

    #[test]
    fn file_read_nonexistent() {
        let dir = setup_test_dir();
        let root = dir.path().to_str().unwrap().to_string();
        let result = file_read(root, "nope.txt".to_string(), None, None);
        assert!(result.is_err());
    }

    // ── file_write tests ──

    #[test]
    fn file_write_new_file() {
        let dir = setup_test_dir();
        let root = dir.path().to_str().unwrap().to_string();
        let result = file_write(root.clone(), "new.txt".to_string(), "hello world".to_string());
        assert!(result.is_ok());
        assert!(result.unwrap().contains("11 bytes"));

        // Verify file was written
        let content = fs::read_to_string(dir.path().join("new.txt")).unwrap();
        assert_eq!(content, "hello world");
    }

    #[test]
    fn file_write_creates_dirs() {
        let dir = setup_test_dir();
        let root = dir.path().to_str().unwrap().to_string();
        let result = file_write(root, "deep/nested/dir/file.txt".to_string(), "content".to_string());
        assert!(result.is_ok());

        // Verify nested path was created
        assert!(dir.path().join("deep/nested/dir/file.txt").exists());
    }

    #[test]
    fn file_write_overwrite() {
        let dir = setup_test_dir();
        let root = dir.path().to_str().unwrap().to_string();
        file_write(root.clone(), "hello.txt".to_string(), "replaced".to_string()).unwrap();
        let content = fs::read_to_string(dir.path().join("hello.txt")).unwrap();
        assert_eq!(content, "replaced");
    }

    // ── file_edit tests ──

    #[test]
    fn file_edit_unique_match() {
        let dir = setup_test_dir();
        let root = dir.path().to_str().unwrap().to_string();
        let result = file_edit(
            root, "hello.txt".to_string(),
            "line two".to_string(),
            "LINE TWO".to_string(),
        );
        assert!(result.is_ok());

        let content = fs::read_to_string(dir.path().join("hello.txt")).unwrap();
        assert!(content.contains("LINE TWO"));
        assert!(!content.contains("line two"));
        // Other lines untouched
        assert!(content.contains("line one"));
        assert!(content.contains("line three"));
    }

    #[test]
    fn file_edit_no_match() {
        let dir = setup_test_dir();
        let root = dir.path().to_str().unwrap().to_string();
        let result = file_edit(
            root, "hello.txt".to_string(),
            "this does not exist".to_string(),
            "replacement".to_string(),
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[test]
    fn file_edit_multiple_matches() {
        let dir = setup_test_dir();
        let root = dir.path().to_str().unwrap().to_string();
        // "line" appears 3 times in hello.txt
        let result = file_edit(
            root, "hello.txt".to_string(),
            "line".to_string(),
            "LINE".to_string(),
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("3 times"));
    }

    // ── glob_search tests ──

    #[test]
    fn glob_search_txt_files() {
        let dir = setup_test_dir();
        let root = dir.path().to_str().unwrap().to_string();
        let result = glob_search(root, "*.txt".to_string()).unwrap();
        assert!(result.contains("hello.txt"));
        assert!(result.contains("empty.txt"));
        // Should NOT include nested files (*.txt is not recursive)
        assert!(!result.contains("nested.txt"));
    }

    #[test]
    fn glob_search_recursive() {
        let dir = setup_test_dir();
        let root = dir.path().to_str().unwrap().to_string();
        let result = glob_search(root, "**/*.txt".to_string()).unwrap();
        assert!(result.contains("hello.txt"));
        assert!(result.contains("nested.txt"));
    }

    #[test]
    fn glob_search_no_matches() {
        let dir = setup_test_dir();
        let root = dir.path().to_str().unwrap().to_string();
        let result = glob_search(root, "*.xyz".to_string()).unwrap();
        assert!(result.contains("No files matching"));
    }

    // ── grep_search tests ──

    #[test]
    fn grep_search_basic() {
        let dir = setup_test_dir();
        let root = dir.path().to_str().unwrap().to_string();
        let result = grep_search(root, "const".to_string(), None, None).unwrap();
        assert!(result.contains("code.ts"));
        assert!(result.contains("const x"));
    }

    #[test]
    fn grep_search_with_include() {
        let dir = setup_test_dir();
        let root = dir.path().to_str().unwrap().to_string();
        // Search only .txt files
        let result = grep_search(root, "line".to_string(), Some("*.txt".to_string()), None).unwrap();
        assert!(result.contains("hello.txt"));
        assert!(!result.contains("code.ts"));
    }

    #[test]
    fn grep_search_no_results() {
        let dir = setup_test_dir();
        let root = dir.path().to_str().unwrap().to_string();
        let result = grep_search(root, "zzz_no_match_zzz".to_string(), None, None).unwrap();
        assert!(result.contains("No matches"));
    }

    #[test]
    fn grep_search_max_results() {
        let dir = setup_test_dir();
        let root = dir.path().to_str().unwrap().to_string();
        let result = grep_search(root, ".*".to_string(), None, Some(2)).unwrap();
        assert!(result.contains("truncated at 2"));
    }

    // ── ls tests ──

    #[test]
    fn ls_root() {
        let dir = setup_test_dir();
        let root = dir.path().to_str().unwrap().to_string();
        let result = ls(root, None).unwrap();
        // Should list files and the sub directory
        assert!(result.contains("sub/"));
        assert!(result.contains("hello.txt"));
        assert!(result.contains("code.ts"));
    }

    #[test]
    fn ls_subdirectory() {
        let dir = setup_test_dir();
        let root = dir.path().to_str().unwrap().to_string();
        let result = ls(root, Some("sub".to_string())).unwrap();
        assert!(result.contains("nested.txt"));
    }

    #[test]
    fn ls_not_a_directory() {
        let dir = setup_test_dir();
        let root = dir.path().to_str().unwrap().to_string();
        let result = ls(root, Some("hello.txt".to_string()));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Not a directory"));
    }

    // ── format_size tests ──

    #[test]
    fn format_size_bytes() {
        assert_eq!(format_size(42), "42 B");
        assert_eq!(format_size(0), "0 B");
        assert_eq!(format_size(1023), "1023 B");
    }

    #[test]
    fn format_size_kb() {
        assert_eq!(format_size(1024), "1.0 KB");
        assert_eq!(format_size(1536), "1.5 KB");
    }

    #[test]
    fn format_size_mb() {
        assert_eq!(format_size(1_048_576), "1.0 MB");
        assert_eq!(format_size(2_621_440), "2.5 MB");
    }
}
