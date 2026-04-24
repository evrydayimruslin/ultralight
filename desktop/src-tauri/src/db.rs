// SQLite persistence for conversations and messages.
// DB stored in Tauri app data dir (~/.local/share/dev.ultralight.chat/ or equivalent).

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

// ── State ──

pub struct DbState(pub Mutex<Connection>);

// ── Types ──

#[derive(Debug, Serialize, Deserialize)]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub model: String,
    pub project_dir: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub message_count: i64,
    pub last_message_preview: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DbMessage {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub tool_calls: Option<String>,     // JSON serialized
    pub tool_call_id: Option<String>,
    pub usage: Option<String>,          // JSON serialized
    pub cost_cents: Option<f64>,
    pub created_at: i64,
    pub sort_order: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct KanbanBoard {
    pub id: String,
    pub name: String,
    pub project_dir: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct KanbanColumn {
    pub id: String,
    pub board_id: String,
    pub name: String,
    pub position: i64,
    pub created_at: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct KanbanCard {
    pub id: String,
    pub column_id: String,
    pub title: String,
    pub description: Option<String>,
    pub acceptance_criteria: Option<String>,
    pub position: i64,
    pub assigned_agent_id: Option<String>,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Agent {
    pub id: String,
    pub conversation_id: String,
    pub parent_agent_id: Option<String>,
    pub name: String,
    pub role: String,
    pub status: String,
    pub system_prompt: Option<String>,
    pub initial_task: Option<String>,
    pub project_dir: Option<String>,
    pub model: Option<String>,
    pub permission_level: String,
    pub execute_window_seconds: i64,
    pub admin_notes: Option<String>,
    pub end_goal: Option<String>,
    pub context: Option<String>,
    pub launch_mode: String,
    /// JSON array of app IDs this agent has pre-connected access to.
    /// e.g. `["c8952d58-...", "a1b2c3d4-..."]`
    pub connected_app_ids: Option<String>,
    /// JSON object with per-app function selections and conventions.
    /// Keys are app_ids, values have selected_functions and conventions.
    pub connected_apps: Option<String>,
    /// Whether this is a system agent (1) or a regular user agent (0).
    pub is_system: i64,
    /// Canonical system agent type: tool_builder, tool_marketer, platform_manager.
    pub system_agent_type: Option<String>,
    /// Lightweight state summary for Flash context index.
    pub state_summary: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    // Enriched fields (from JOINs, only present in list queries)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_message_preview: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_count: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CardReport {
    pub id: String,
    pub card_id: String,
    pub agent_id: String,
    pub report_type: String,
    pub content: String,
    pub created_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ToolUsed {
    pub app_id: String,
    pub app_name: String,
    pub app_slug: String,
    pub origin: String,
    pub fn_name: String,
    pub args: serde_json::Value,
    pub cost_light: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExecutionPlan {
    pub id: String,
    pub conversation_id: String,
    pub message_id: String,
    pub recipe: String,
    pub tools_used: Vec<ToolUsed>,
    pub total_cost_light: f64,
    pub created_at: i64,
    #[serde(default)]
    pub window_seconds: i64,
    pub fire_at: Option<i64>,
    pub status: String,
    pub result: Option<String>,
    pub fired_at: Option<i64>,
    pub completed_at: Option<i64>,
}

// ── Schema ──

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT 'New Conversation',
    model TEXT NOT NULL,
    project_dir TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    tool_calls TEXT,
    tool_call_id TEXT,
    usage TEXT,
    cost_cents REAL,
    created_at INTEGER NOT NULL,
    sort_order INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation
    ON messages(conversation_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_conversations_updated
    ON conversations(updated_at DESC);

CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
    parent_agent_id TEXT REFERENCES agents(id),
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'general',
    status TEXT NOT NULL DEFAULT 'pending',
    system_prompt TEXT,
    initial_task TEXT,
    project_dir TEXT,
    model TEXT,
    permission_level TEXT NOT NULL DEFAULT 'auto_edit',
    execute_window_seconds INTEGER NOT NULL DEFAULT 8,
    admin_notes TEXT,
    end_goal TEXT,
    context TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agents_parent
    ON agents(parent_agent_id);
CREATE INDEX IF NOT EXISTS idx_agents_status
    ON agents(status);
CREATE INDEX IF NOT EXISTS idx_agents_conversation
    ON agents(conversation_id);

CREATE TABLE IF NOT EXISTS kanban_boards (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    project_dir TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS kanban_columns (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES kanban_boards(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    position INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS kanban_cards (
    id TEXT PRIMARY KEY,
    column_id TEXT NOT NULL REFERENCES kanban_columns(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    acceptance_criteria TEXT,
    position INTEGER NOT NULL,
    assigned_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'todo',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kanban_cards_agent
    ON kanban_cards(assigned_agent_id);
CREATE INDEX IF NOT EXISTS idx_kanban_cards_column
    ON kanban_cards(column_id, position);

CREATE TABLE IF NOT EXISTS card_reports (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL REFERENCES kanban_cards(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    report_type TEXT NOT NULL DEFAULT 'progress',
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_card_reports_card
    ON card_reports(card_id, created_at ASC);

CREATE TABLE IF NOT EXISTS execution_plans (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    fired_at INTEGER,
    completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_execution_plans_message
    ON execution_plans(message_id);
CREATE INDEX IF NOT EXISTS idx_execution_plans_conv
    ON execution_plans(conversation_id);
";

// ── Init ──

const DB_SCHEMA_VERSION: i64 = 1;
const CANONICAL_SYSTEM_AGENT_ROLES: [(&str, &str); 3] = [
    ("tool_builder", "builder"),
    ("tool_marketer", "marketer"),
    ("platform_manager", "manager"),
];

fn apply_column_migrations(conn: &Connection) {
    let _ = conn.execute(
        "ALTER TABLE agents ADD COLUMN launch_mode TEXT NOT NULL DEFAULT 'build_now'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE agents ADD COLUMN connected_app_ids TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE agents ADD COLUMN connected_apps TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE agents ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE agents ADD COLUMN system_agent_type TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE agents ADD COLUMN state_summary TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE agents ADD COLUMN execute_window_seconds INTEGER NOT NULL DEFAULT 8",
        [],
    );
}

fn normalize_legacy_system_agent_rows(conn: &Connection) -> Result<(), String> {
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("Transaction error: {}", e))?;
    let now = chrono_now();

    tx.execute(
        "UPDATE agents
         SET system_agent_type = 'tool_marketer',
             role = 'marketer',
             updated_at = ?1
         WHERE is_system = 1 AND system_agent_type = 'tool_publisher'",
        params![now],
    )
    .map_err(|e| format!("Rename tool_publisher migration failed: {}", e))?;

    tx.execute(
        "UPDATE agents
         SET name = REPLACE(name, 'Tool Publisher', 'Tool Dealer'),
             updated_at = ?1
         WHERE is_system = 1
           AND system_agent_type = 'tool_marketer'
           AND name LIKE 'Tool Publisher%'",
        params![now],
    )
    .map_err(|e| format!("Rename tool_publisher display names failed: {}", e))?;

    tx.execute(
        "UPDATE agents
         SET is_system = 0,
             system_agent_type = NULL,
             updated_at = ?1
         WHERE is_system = 1 AND system_agent_type = 'tool_explorer'",
        params![now],
    )
    .map_err(|e| format!("Demote tool_explorer migration failed: {}", e))?;

    for (agent_type, canonical_role) in CANONICAL_SYSTEM_AGENT_ROLES {
        tx.execute(
            "UPDATE agents
             SET role = ?1,
                 updated_at = ?2
             WHERE is_system = 1
               AND system_agent_type = ?3
               AND role != ?1",
            params![canonical_role, now, agent_type],
        )
        .map_err(|e| format!("System agent role normalization failed: {}", e))?;
    }

    tx.commit()
        .map_err(|e| format!("Commit system agent normalization failed: {}", e))?;

    Ok(())
}

fn apply_versioned_migrations(conn: &Connection) -> Result<(), String> {
    let current_version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| format!("Failed to read database version: {}", e))?;

    if current_version < 1 {
        normalize_legacy_system_agent_rows(conn)?;
        conn.execute_batch(&format!("PRAGMA user_version = {};", DB_SCHEMA_VERSION))
            .map_err(|e| format!("Failed to bump database version: {}", e))?;
    }

    Ok(())
}

pub fn init_db(app_data_dir: &std::path::Path) -> Result<Connection, String> {
    std::fs::create_dir_all(app_data_dir)
        .map_err(|e| format!("Failed to create app data dir: {}", e))?;

    let db_path = app_data_dir.join("conversations.db");
    let conn = Connection::open(&db_path)
        .map_err(|e| format!("Failed to open database: {}", e))?;

    // Enable WAL mode for better concurrent performance
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
        .map_err(|e| format!("Failed to set pragmas: {}", e))?;

    conn.execute_batch(SCHEMA)
        .map_err(|e| format!("Failed to create schema: {}", e))?;

    apply_column_migrations(&conn);
    apply_versioned_migrations(&conn)?;

    log::info!("Database initialized at {:?}", db_path);
    Ok(conn)
}

// ── Commands ──

#[tauri::command]
pub fn db_list_conversations(
    db: State<'_, DbState>,
    limit: Option<i64>,
    search: Option<String>,
) -> Result<Vec<Conversation>, String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {}", e))?;
    let limit = limit.unwrap_or(50);

    // Use a single closure approach: collect rows manually to avoid closure type mismatch
    let mut conversations = Vec::new();

    if let Some(ref s) = search {
        let search_param = format!("%{}%", s);
        let mut stmt = conn.prepare(
            "SELECT c.id, c.title, c.model, c.project_dir, c.created_at, c.updated_at,
                    COUNT(m.id) as message_count,
                    (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY sort_order DESC LIMIT 1) as last_message_preview
             FROM conversations c
             LEFT JOIN messages m ON m.conversation_id = c.id
             WHERE c.title LIKE ?1 OR EXISTS (
                 SELECT 1 FROM messages WHERE conversation_id = c.id AND content LIKE ?1
             )
             GROUP BY c.id
             ORDER BY c.updated_at DESC
             LIMIT ?2"
        ).map_err(|e| format!("Query error: {}", e))?;

        let rows = stmt.query_map(params![search_param, limit], row_to_conversation)
            .map_err(|e| format!("Query error: {}", e))?;
        for row in rows {
            conversations.push(row.map_err(|e| format!("Row error: {}", e))?);
        }
    } else {
        let mut stmt = conn.prepare(
            "SELECT c.id, c.title, c.model, c.project_dir, c.created_at, c.updated_at,
                    COUNT(m.id) as message_count,
                    (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY sort_order DESC LIMIT 1) as last_message_preview
             FROM conversations c
             LEFT JOIN messages m ON m.conversation_id = c.id
             GROUP BY c.id
             ORDER BY c.updated_at DESC
             LIMIT ?1"
        ).map_err(|e| format!("Query error: {}", e))?;

        let rows = stmt.query_map(params![limit], row_to_conversation)
            .map_err(|e| format!("Query error: {}", e))?;
        for row in rows {
            conversations.push(row.map_err(|e| format!("Row error: {}", e))?);
        }
    }

    Ok(conversations)
}

#[tauri::command]
pub fn db_create_conversation(
    db: State<'_, DbState>,
    id: String,
    title: String,
    model: String,
    project_dir: Option<String>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {}", e))?;
    let now = chrono_now();

    conn.execute(
        "INSERT INTO conversations (id, title, model, project_dir, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, title, model, project_dir, now, now],
    ).map_err(|e| format!("Insert error: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn db_update_conversation(
    db: State<'_, DbState>,
    id: String,
    title: Option<String>,
    model: Option<String>,
    updated_at: Option<i64>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {}", e))?;
    let now = updated_at.unwrap_or_else(chrono_now);

    let has_title = title.is_some();
    let has_model = model.is_some();

    if let Some(ref t) = title {
        conn.execute(
            "UPDATE conversations SET title = ?1, updated_at = ?2 WHERE id = ?3",
            params![t, now, id],
        ).map_err(|e| format!("Update error: {}", e))?;
    }

    if let Some(ref m) = model {
        conn.execute(
            "UPDATE conversations SET model = ?1, updated_at = ?2 WHERE id = ?3",
            params![m, now, id],
        ).map_err(|e| format!("Update error: {}", e))?;
    }

    if !has_title && !has_model {
        // Just touch updated_at
        conn.execute(
            "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
            params![now, id],
        ).map_err(|e| format!("Update error: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub fn db_delete_conversation(
    db: State<'_, DbState>,
    id: String,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {}", e))?;

    // Delete messages first (foreign key cascade should handle this, but be explicit)
    conn.execute("DELETE FROM messages WHERE conversation_id = ?1", params![id])
        .map_err(|e| format!("Delete messages error: {}", e))?;
    conn.execute("DELETE FROM conversations WHERE id = ?1", params![id])
        .map_err(|e| format!("Delete conversation error: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn db_load_messages(
    db: State<'_, DbState>,
    conversation_id: String,
) -> Result<Vec<DbMessage>, String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {}", e))?;

    let mut stmt = conn.prepare(
        "SELECT id, conversation_id, role, content, tool_calls, tool_call_id, usage, cost_cents, created_at, sort_order
         FROM messages WHERE conversation_id = ?1 ORDER BY sort_order ASC"
    ).map_err(|e| format!("Query error: {}", e))?;

    let rows = stmt.query_map(params![conversation_id], |row| {
        Ok(DbMessage {
            id: row.get(0)?,
            conversation_id: row.get(1)?,
            role: row.get(2)?,
            content: row.get(3)?,
            tool_calls: row.get(4)?,
            tool_call_id: row.get(5)?,
            usage: row.get(6)?,
            cost_cents: row.get(7)?,
            created_at: row.get(8)?,
            sort_order: row.get(9)?,
        })
    }).map_err(|e| format!("Query error: {}", e))?;

    let mut messages = Vec::new();
    for row in rows {
        messages.push(row.map_err(|e| format!("Row error: {}", e))?);
    }
    Ok(messages)
}

#[tauri::command]
pub fn db_save_message(
    db: State<'_, DbState>,
    message: DbMessage,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {}", e))?;

    conn.execute(
        "INSERT OR REPLACE INTO messages (id, conversation_id, role, content, tool_calls, tool_call_id, usage, cost_cents, created_at, sort_order)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            message.id,
            message.conversation_id,
            message.role,
            message.content,
            message.tool_calls,
            message.tool_call_id,
            message.usage,
            message.cost_cents,
            message.created_at,
            message.sort_order,
        ],
    ).map_err(|e| format!("Insert message error: {}", e))?;

    // Touch conversation updated_at
    let now = chrono_now();
    conn.execute(
        "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
        params![now, message.conversation_id],
    ).map_err(|e| format!("Update conversation error: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn db_save_messages_batch(
    db: State<'_, DbState>,
    messages: Vec<DbMessage>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {}", e))?;

    let tx = conn.unchecked_transaction()
        .map_err(|e| format!("Transaction error: {}", e))?;

    {
        let mut stmt = tx.prepare(
            "INSERT OR REPLACE INTO messages (id, conversation_id, role, content, tool_calls, tool_call_id, usage, cost_cents, created_at, sort_order)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"
        ).map_err(|e| format!("Prepare error: {}", e))?;

        let mut conversation_id: Option<String> = None;

        for msg in &messages {
            stmt.execute(params![
                msg.id, msg.conversation_id, msg.role, msg.content,
                msg.tool_calls, msg.tool_call_id, msg.usage, msg.cost_cents,
                msg.created_at, msg.sort_order,
            ]).map_err(|e| format!("Insert error: {}", e))?;

            if conversation_id.is_none() {
                conversation_id = Some(msg.conversation_id.clone());
            }
        }

        // Touch conversation updated_at
        if let Some(cid) = conversation_id {
            let now = chrono_now();
            tx.execute(
                "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
                params![now, cid],
            ).map_err(|e| format!("Update conversation error: {}", e))?;
        }
    }

    tx.commit().map_err(|e| format!("Commit error: {}", e))?;
    Ok(())
}

// ── Agent Commands ──

const AGENT_SELECT_COLS: &str =
    "id, conversation_id, parent_agent_id, name, role, status, system_prompt, \
     initial_task, project_dir, model, permission_level, execute_window_seconds, \
     admin_notes, end_goal, context, launch_mode, connected_app_ids, connected_apps, \
     is_system, system_agent_type, state_summary, created_at, updated_at";

#[tauri::command]
pub fn db_create_agent(
    db: State<'_, DbState>,
    id: String,
    conversation_id: String,
    name: String,
    role: String,
    system_prompt: Option<String>,
    initial_task: Option<String>,
    project_dir: Option<String>,
    model: Option<String>,
    parent_agent_id: Option<String>,
    permission_level: Option<String>,
    execute_window_seconds: Option<i64>,
    admin_notes: Option<String>,
    end_goal: Option<String>,
    context: Option<String>,
    launch_mode: Option<String>,
    connected_app_ids: Option<String>,
    connected_apps: Option<String>,
    is_system: Option<i64>,
    system_agent_type: Option<String>,
) -> Result<Agent, String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {}", e))?;
    let now = chrono_now();
    let perm = permission_level.unwrap_or_else(|| "auto_edit".to_string());
    let execute_window = execute_window_seconds.unwrap_or(8);
    let lm = launch_mode.unwrap_or_else(|| "build_now".to_string());
    let is_sys = is_system.unwrap_or(0);
    let model_for_conv = model.clone().unwrap_or_else(|| "anthropic/claude-sonnet-4-20250514".to_string());

    let tx = conn.unchecked_transaction()
        .map_err(|e| format!("Transaction error: {}", e))?;

    // Create backing conversation
    tx.execute(
        "INSERT INTO conversations (id, title, model, project_dir, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![conversation_id, name, model_for_conv, project_dir, now, now],
    ).map_err(|e| format!("Create conversation error: {}", e))?;

    // Create agent
    tx.execute(
        "INSERT INTO agents (id, conversation_id, parent_agent_id, name, role, status, \
         system_prompt, initial_task, project_dir, model, permission_level, execute_window_seconds, \
         admin_notes, end_goal, context, launch_mode, connected_app_ids, connected_apps, \
         is_system, system_agent_type, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)",
        params![
            id, conversation_id, parent_agent_id, name, role, "pending",
            system_prompt, initial_task, project_dir, model, perm, execute_window,
            admin_notes, end_goal, context, lm, connected_app_ids, connected_apps,
            is_sys, system_agent_type, now, now,
        ],
    ).map_err(|e| format!("Create agent error: {}", e))?;

    tx.commit().map_err(|e| format!("Commit error: {}", e))?;

    Ok(Agent {
        id,
        conversation_id,
        parent_agent_id,
        name,
        role,
        status: "pending".to_string(),
        system_prompt,
        initial_task,
        project_dir,
        model,
        permission_level: perm,
        execute_window_seconds: execute_window,
        admin_notes,
        end_goal,
        context,
        launch_mode: lm,
        connected_app_ids,
        connected_apps,
        is_system: is_sys,
        system_agent_type,
        state_summary: None,
        created_at: now,
        updated_at: now,
        last_message_preview: None,
        message_count: Some(0),
    })
}

const AGENT_ENRICHED_SELECT: &str =
    "a.id, a.conversation_id, a.parent_agent_id, a.name, a.role, a.status, a.system_prompt, \
     a.initial_task, a.project_dir, a.model, a.permission_level, a.execute_window_seconds, \
     a.admin_notes, a.end_goal, a.context, a.launch_mode, a.connected_app_ids, a.connected_apps, \
     a.is_system, a.system_agent_type, a.state_summary, a.created_at, a.updated_at, \
     COUNT(m.id) as message_count, \
     (SELECT content FROM messages WHERE conversation_id = a.conversation_id ORDER BY sort_order DESC LIMIT 1) as last_message_preview";

#[tauri::command]
pub fn db_list_agents(
    db: State<'_, DbState>,
    parent_agent_id: Option<String>,
    status: Option<String>,
) -> Result<Vec<Agent>, String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {}", e))?;

    let mut agents = Vec::new();

    match (&parent_agent_id, &status) {
        (Some(pid), Some(s)) => {
            let mut stmt = conn.prepare(&format!(
                "SELECT {} FROM agents a LEFT JOIN messages m ON m.conversation_id = a.conversation_id \
                 WHERE a.parent_agent_id = ?1 AND a.status = ?2 GROUP BY a.id ORDER BY a.updated_at DESC",
                AGENT_ENRICHED_SELECT
            )).map_err(|e| format!("Query error: {}", e))?;
            let rows = stmt.query_map(params![pid, s], row_to_agent_enriched)
                .map_err(|e| format!("Query error: {}", e))?;
            for row in rows {
                agents.push(row.map_err(|e| format!("Row error: {}", e))?);
            }
        }
        (Some(pid), None) => {
            let mut stmt = conn.prepare(&format!(
                "SELECT {} FROM agents a LEFT JOIN messages m ON m.conversation_id = a.conversation_id \
                 WHERE a.parent_agent_id = ?1 GROUP BY a.id ORDER BY a.updated_at DESC",
                AGENT_ENRICHED_SELECT
            )).map_err(|e| format!("Query error: {}", e))?;
            let rows = stmt.query_map(params![pid], row_to_agent_enriched)
                .map_err(|e| format!("Query error: {}", e))?;
            for row in rows {
                agents.push(row.map_err(|e| format!("Row error: {}", e))?);
            }
        }
        (None, Some(s)) => {
            let mut stmt = conn.prepare(&format!(
                "SELECT {} FROM agents a LEFT JOIN messages m ON m.conversation_id = a.conversation_id \
                 WHERE a.status = ?1 GROUP BY a.id ORDER BY a.updated_at DESC",
                AGENT_ENRICHED_SELECT
            )).map_err(|e| format!("Query error: {}", e))?;
            let rows = stmt.query_map(params![s], row_to_agent_enriched)
                .map_err(|e| format!("Query error: {}", e))?;
            for row in rows {
                agents.push(row.map_err(|e| format!("Row error: {}", e))?);
            }
        }
        (None, None) => {
            let mut stmt = conn.prepare(&format!(
                "SELECT {} FROM agents a LEFT JOIN messages m ON m.conversation_id = a.conversation_id \
                 GROUP BY a.id ORDER BY a.updated_at DESC",
                AGENT_ENRICHED_SELECT
            )).map_err(|e| format!("Query error: {}", e))?;
            let rows = stmt.query_map([], row_to_agent_enriched)
                .map_err(|e| format!("Query error: {}", e))?;
            for row in rows {
                agents.push(row.map_err(|e| format!("Row error: {}", e))?);
            }
        }
    }

    Ok(agents)
}

#[tauri::command]
pub fn db_get_agent(
    db: State<'_, DbState>,
    id: String,
) -> Result<Option<Agent>, String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {}", e))?;

    let mut stmt = conn.prepare(&format!(
        "SELECT {} FROM agents WHERE id = ?1",
        AGENT_SELECT_COLS
    )).map_err(|e| format!("Query error: {}", e))?;

    let mut rows = stmt.query_map(params![id], row_to_agent)
        .map_err(|e| format!("Query error: {}", e))?;

    match rows.next() {
        Some(row) => Ok(Some(row.map_err(|e| format!("Row error: {}", e))?)),
        None => Ok(None),
    }
}

#[tauri::command]
pub fn db_get_agent_by_conversation(
    db: State<'_, DbState>,
    conversation_id: String,
) -> Result<Option<Agent>, String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {}", e))?;

    let mut stmt = conn.prepare(&format!(
        "SELECT {} FROM agents WHERE conversation_id = ?1",
        AGENT_SELECT_COLS
    )).map_err(|e| format!("Query error: {}", e))?;

    let mut rows = stmt.query_map(params![conversation_id], row_to_agent)
        .map_err(|e| format!("Query error: {}", e))?;

    match rows.next() {
        Some(row) => Ok(Some(row.map_err(|e| format!("Row error: {}", e))?)),
        None => Ok(None),
    }
}

#[tauri::command]
pub fn db_update_agent(
    db: State<'_, DbState>,
    id: String,
    status: Option<String>,
    name: Option<String>,
    admin_notes: Option<String>,
    end_goal: Option<String>,
    context: Option<String>,
    permission_level: Option<String>,
    execute_window_seconds: Option<i64>,
    model: Option<String>,
    project_dir: Option<String>,
    connected_app_ids: Option<String>,
    initial_task: Option<String>,
    connected_apps: Option<String>,
    state_summary: Option<String>,
    system_agent_type: Option<String>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {}", e))?;
    let now = chrono_now();

    // Build dynamic SET clause
    let mut sets: Vec<String> = vec!["updated_at = ?1".to_string()];
    let mut param_index = 2u32;
    let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];

    macro_rules! maybe_set {
        ($field:expr, $col:expr) => {
            if let Some(ref v) = $field {
                sets.push(format!("{} = ?{}", $col, param_index));
                values.push(Box::new(v.clone()));
                param_index += 1;
            }
        };
    }

    maybe_set!(status, "status");
    maybe_set!(name, "name");
    maybe_set!(admin_notes, "admin_notes");
    maybe_set!(end_goal, "end_goal");
    maybe_set!(context, "context");
    maybe_set!(permission_level, "permission_level");
    if let Some(v) = execute_window_seconds {
        sets.push(format!("execute_window_seconds = ?{}", param_index));
        values.push(Box::new(v));
        param_index += 1;
    }
    maybe_set!(model, "model");
    maybe_set!(project_dir, "project_dir");
    maybe_set!(connected_app_ids, "connected_app_ids");
    maybe_set!(initial_task, "initial_task");
    maybe_set!(connected_apps, "connected_apps");
    maybe_set!(state_summary, "state_summary");
    maybe_set!(system_agent_type, "system_agent_type");

    // Always add the WHERE id = ?N
    let where_clause = format!("WHERE id = ?{}", param_index);
    values.push(Box::new(id));

    let sql = format!("UPDATE agents SET {} {}", sets.join(", "), where_clause);
    let params: Vec<&dyn rusqlite::types::ToSql> = values.iter().map(|v| v.as_ref()).collect();

    conn.execute(&sql, params.as_slice())
        .map_err(|e| format!("Update agent error: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn db_delete_agent(
    db: State<'_, DbState>,
    id: String,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {}", e))?;

    // Guard: prevent deletion of system agents
    let is_sys: i64 = conn.query_row(
        "SELECT is_system FROM agents WHERE id = ?1",
        params![id],
        |row| row.get(0),
    ).unwrap_or(0);
    if is_sys == 1 {
        return Err("Cannot delete system agents. Use 'New Session' to reset instead.".to_string());
    }

    // Get conversation_id first for cascade cleanup
    let conv_id: Option<String> = conn.query_row(
        "SELECT conversation_id FROM agents WHERE id = ?1",
        params![id],
        |row| row.get(0),
    ).ok();

    // Delete agent (FK ON DELETE CASCADE should handle conversation cleanup,
    // but be explicit for messages)
    conn.execute("DELETE FROM agents WHERE id = ?1", params![id])
        .map_err(|e| format!("Delete agent error: {}", e))?;

    if let Some(cid) = conv_id {
        conn.execute("DELETE FROM messages WHERE conversation_id = ?1", params![cid])
            .map_err(|e| format!("Delete messages error: {}", e))?;
        conn.execute("DELETE FROM conversations WHERE id = ?1", params![cid])
            .map_err(|e| format!("Delete conversation error: {}", e))?;
    }

    Ok(())
}

/// Reset an agent's conversation — delete all messages, reset status to "pending".
/// Agent identity, config, and notes are preserved.
#[tauri::command]
pub fn db_new_agent_session(
    db: State<'_, DbState>,
    id: String,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {}", e))?;
    let now = chrono_now();

    // Get conversation_id
    let conv_id: String = conn.query_row(
        "SELECT conversation_id FROM agents WHERE id = ?1",
        params![id],
        |row| row.get(0),
    ).map_err(|e| format!("Agent not found: {}", e))?;

    // Delete all messages for this conversation
    conn.execute(
        "DELETE FROM messages WHERE conversation_id = ?1",
        params![conv_id],
    ).map_err(|e| format!("Delete messages error: {}", e))?;

    // Reset conversation metadata
    conn.execute(
        "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
        params![now, conv_id],
    ).map_err(|e| format!("Update conversation error: {}", e))?;

    // Reset agent status to pending
    conn.execute(
        "UPDATE agents SET status = 'pending', updated_at = ?1 WHERE id = ?2",
        params![now, id],
    ).map_err(|e| format!("Update agent error: {}", e))?;

    Ok(())
}

/// List all system agents (is_system = 1), ordered by type.
#[tauri::command]
pub fn db_list_system_agents(
    db: State<'_, DbState>,
) -> Result<Vec<Agent>, String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {}", e))?;

    let mut agents = Vec::new();
    let mut stmt = conn.prepare(&format!(
        "SELECT {} FROM agents a LEFT JOIN messages m ON m.conversation_id = a.conversation_id \
         WHERE a.is_system = 1 GROUP BY a.id ORDER BY a.system_agent_type ASC",
        AGENT_ENRICHED_SELECT
    )).map_err(|e| format!("Query error: {}", e))?;

    let rows = stmt.query_map([], row_to_agent_enriched)
        .map_err(|e| format!("Query error: {}", e))?;
    for row in rows {
        agents.push(row.map_err(|e| format!("Row error: {}", e))?);
    }

    Ok(agents)
}

// ── Kanban Commands ──

#[tauri::command]
pub fn db_create_board(
    db: State<'_, DbState>,
    id: String,
    name: String,
    project_dir: Option<String>,
) -> Result<KanbanBoard, String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {}", e))?;
    let now = chrono_now();

    let tx = conn.unchecked_transaction()
        .map_err(|e| format!("Transaction error: {}", e))?;

    tx.execute(
        "INSERT INTO kanban_boards (id, name, project_dir, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, name, project_dir, now, now],
    ).map_err(|e| format!("Create board error: {}", e))?;

    // Create 4 default columns
    let defaults = [("Backlog", 0), ("In Progress", 1), ("Review", 2), ("Done", 3)];
    for (col_name, pos) in &defaults {
        let col_id = format!("{}-col-{}", id, pos);
        tx.execute(
            "INSERT INTO kanban_columns (id, board_id, name, position, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![col_id, id, col_name, pos, now],
        ).map_err(|e| format!("Create column error: {}", e))?;
    }

    tx.commit().map_err(|e| format!("Commit error: {}", e))?;

    Ok(KanbanBoard {
        id,
        name,
        project_dir,
        created_at: now,
        updated_at: now,
    })
}

#[tauri::command]
pub fn db_list_boards(
    db: State<'_, DbState>,
    project_dir: Option<String>,
) -> Result<Vec<KanbanBoard>, String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {}", e))?;
    let mut boards = Vec::new();

    if let Some(ref dir) = project_dir {
        let mut stmt = conn.prepare(
            "SELECT id, name, project_dir, created_at, updated_at FROM kanban_boards WHERE project_dir = ?1 ORDER BY created_at DESC"
        ).map_err(|e| format!("Query error: {}", e))?;
        let rows = stmt.query_map(params![dir], row_to_board)
            .map_err(|e| format!("Query error: {}", e))?;
        for row in rows {
            boards.push(row.map_err(|e| format!("Row error: {}", e))?);
        }
    } else {
        let mut stmt = conn.prepare(
            "SELECT id, name, project_dir, created_at, updated_at FROM kanban_boards ORDER BY created_at DESC"
        ).map_err(|e| format!("Query error: {}", e))?;
        let rows = stmt.query_map([], row_to_board)
            .map_err(|e| format!("Query error: {}", e))?;
        for row in rows {
            boards.push(row.map_err(|e| format!("Row error: {}", e))?);
        }
    }

    Ok(boards)
}

#[tauri::command]
pub fn db_get_board(
    db: State<'_, DbState>,
    id: String,
) -> Result<Option<KanbanBoard>, String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {}", e))?;
    let mut stmt = conn.prepare(
        "SELECT id, name, project_dir, created_at, updated_at FROM kanban_boards WHERE id = ?1"
    ).map_err(|e| format!("Query error: {}", e))?;
    let mut rows = stmt.query_map(params![id], row_to_board)
        .map_err(|e| format!("Query error: {}", e))?;
    match rows.next() {
        Some(row) => Ok(Some(row.map_err(|e| format!("Row error: {}", e))?)),
        None => Ok(None),
    }
}

#[tauri::command]
pub fn db_delete_board(
    db: State<'_, DbState>,
    id: String,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {}", e))?;
    // CASCADE handles columns → cards
    conn.execute("DELETE FROM kanban_boards WHERE id = ?1", params![id])
        .map_err(|e| format!("Delete board error: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn db_create_column(
    db: State<'_, DbState>,
    id: String,
    board_id: String,
    name: String,
    position: i64,
) -> Result<KanbanColumn, String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {}", e))?;
    let now = chrono_now();
    conn.execute(
        "INSERT INTO kanban_columns (id, board_id, name, position, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, board_id, name, position, now],
    ).map_err(|e| format!("Create column error: {}", e))?;
    Ok(KanbanColumn { id, board_id, name, position, created_at: now })
}

#[tauri::command]
pub fn db_update_column(
    db: State<'_, DbState>,
    id: String,
    name: Option<String>,
    position: Option<i64>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {}", e))?;
    let mut sets: Vec<String> = Vec::new();
    let mut param_index = 1u32;
    let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref v) = name {
        sets.push(format!("name = ?{}", param_index));
        values.push(Box::new(v.clone()));
        param_index += 1;
    }
    if let Some(ref v) = position {
        sets.push(format!("position = ?{}", param_index));
        values.push(Box::new(*v));
        param_index += 1;
    }

    if sets.is_empty() {
        return Ok(());
    }

    let where_clause = format!("WHERE id = ?{}", param_index);
    values.push(Box::new(id));
    let sql = format!("UPDATE kanban_columns SET {} {}", sets.join(", "), where_clause);
    let params: Vec<&dyn rusqlite::types::ToSql> = values.iter().map(|v| v.as_ref()).collect();
    conn.execute(&sql, params.as_slice())
        .map_err(|e| format!("Update column error: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn db_delete_column(
    db: State<'_, DbState>,
    id: String,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {}", e))?;
    // CASCADE handles cards
    conn.execute("DELETE FROM kanban_columns WHERE id = ?1", params![id])
        .map_err(|e| format!("Delete column error: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn db_list_columns(
    db: State<'_, DbState>,
    board_id: String,
) -> Result<Vec<KanbanColumn>, String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {}", e))?;
    let mut stmt = conn.prepare(
        "SELECT id, board_id, name, position, created_at FROM kanban_columns WHERE board_id = ?1 ORDER BY position ASC"
    ).map_err(|e| format!("Query error: {}", e))?;
    let rows = stmt.query_map(params![board_id], row_to_column)
        .map_err(|e| format!("Query error: {}", e))?;
    let mut columns = Vec::new();
    for row in rows {
        columns.push(row.map_err(|e| format!("Row error: {}", e))?);
    }
    Ok(columns)
}

#[tauri::command]
pub fn db_create_card(
    db: State<'_, DbState>,
    id: String,
    column_id: String,
    title: String,
    description: Option<String>,
    acceptance_criteria: Option<String>,
    position: i64,
) -> Result<KanbanCard, String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {}", e))?;
    let now = chrono_now();
    conn.execute(
        "INSERT INTO kanban_cards (id, column_id, title, description, acceptance_criteria, position, status, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![id, column_id, title, description, acceptance_criteria, position, "todo", now, now],
    ).map_err(|e| format!("Create card error: {}", e))?;

    Ok(KanbanCard {
        id, column_id, title, description, acceptance_criteria,
        position, assigned_agent_id: None, status: "todo".to_string(),
        created_at: now, updated_at: now,
    })
}

#[tauri::command]
pub fn db_update_card(
    db: State<'_, DbState>,
    id: String,
    column_id: Option<String>,
    title: Option<String>,
    description: Option<String>,
    acceptance_criteria: Option<String>,
    position: Option<i64>,
    assigned_agent_id: Option<String>,
    status: Option<String>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {}", e))?;
    let now = chrono_now();

    let mut sets: Vec<String> = vec!["updated_at = ?1".to_string()];
    let mut param_index = 2u32;
    let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];

    macro_rules! maybe_set {
        ($field:expr, $col:expr) => {
            if let Some(ref v) = $field {
                sets.push(format!("{} = ?{}", $col, param_index));
                values.push(Box::new(v.clone()));
                param_index += 1;
            }
        };
    }

    maybe_set!(column_id, "column_id");
    maybe_set!(title, "title");
    maybe_set!(description, "description");
    maybe_set!(acceptance_criteria, "acceptance_criteria");
    maybe_set!(status, "status");
    maybe_set!(assigned_agent_id, "assigned_agent_id");

    // position is i64, not String — handle separately
    if let Some(ref v) = position {
        sets.push(format!("position = ?{}", param_index));
        values.push(Box::new(*v));
        param_index += 1;
    }

    let where_clause = format!("WHERE id = ?{}", param_index);
    values.push(Box::new(id));
    let sql = format!("UPDATE kanban_cards SET {} {}", sets.join(", "), where_clause);
    let params: Vec<&dyn rusqlite::types::ToSql> = values.iter().map(|v| v.as_ref()).collect();
    conn.execute(&sql, params.as_slice())
        .map_err(|e| format!("Update card error: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn db_delete_card(
    db: State<'_, DbState>,
    id: String,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {}", e))?;
    conn.execute("DELETE FROM kanban_cards WHERE id = ?1", params![id])
        .map_err(|e| format!("Delete card error: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn db_list_cards(
    db: State<'_, DbState>,
    board_id: String,
) -> Result<Vec<KanbanCard>, String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {}", e))?;
    let mut stmt = conn.prepare(
        "SELECT c.id, c.column_id, c.title, c.description, c.acceptance_criteria, \
                c.position, c.assigned_agent_id, c.status, c.created_at, c.updated_at \
         FROM kanban_cards c \
         JOIN kanban_columns col ON c.column_id = col.id \
         WHERE col.board_id = ?1 \
         ORDER BY col.position ASC, c.position ASC"
    ).map_err(|e| format!("Query error: {}", e))?;
    let rows = stmt.query_map(params![board_id], row_to_card)
        .map_err(|e| format!("Query error: {}", e))?;
    let mut cards = Vec::new();
    for row in rows {
        cards.push(row.map_err(|e| format!("Row error: {}", e))?);
    }
    Ok(cards)
}

// ── Card Report Commands ──

#[tauri::command]
pub fn db_create_card_report(
    db: State<'_, DbState>,
    id: String,
    card_id: String,
    agent_id: String,
    report_type: String,
    content: String,
) -> Result<CardReport, String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {}", e))?;
    let now = chrono_now();
    conn.execute(
        "INSERT INTO card_reports (id, card_id, agent_id, report_type, content, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, card_id, agent_id, report_type, content, now],
    ).map_err(|e| format!("Create card report error: {}", e))?;

    Ok(CardReport {
        id,
        card_id,
        agent_id,
        report_type,
        content,
        created_at: now,
    })
}

#[tauri::command]
pub fn db_list_card_reports(
    db: State<'_, DbState>,
    card_id: String,
) -> Result<Vec<CardReport>, String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {}", e))?;
    let mut stmt = conn.prepare(
        "SELECT id, card_id, agent_id, report_type, content, created_at \
         FROM card_reports WHERE card_id = ?1 ORDER BY created_at ASC"
    ).map_err(|e| format!("Query error: {}", e))?;
    let rows = stmt.query_map(params![card_id], row_to_card_report)
        .map_err(|e| format!("Query error: {}", e))?;
    let mut reports = Vec::new();
    for row in rows {
        reports.push(row.map_err(|e| format!("Row error: {}", e))?);
    }
    Ok(reports)
}

#[tauri::command]
pub fn db_delete_card_report(
    db: State<'_, DbState>,
    id: String,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {}", e))?;
    conn.execute("DELETE FROM card_reports WHERE id = ?1", params![id])
        .map_err(|e| format!("Delete card report error: {}", e))?;
    Ok(())
}

// ── Execution Plan Commands ──

#[tauri::command]
pub fn db_create_execution_plan(
    db: State<'_, DbState>,
    plan: ExecutionPlan,
) -> Result<ExecutionPlan, String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {}", e))?;
    let payload_json = serde_json::to_string(&plan)
        .map_err(|e| format!("Serialize execution plan error: {}", e))?;

    conn.execute(
        "INSERT OR REPLACE INTO execution_plans (id, conversation_id, message_id, payload_json, status, created_at, fired_at, completed_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            &plan.id,
            &plan.conversation_id,
            &plan.message_id,
            &payload_json,
            &plan.status,
            plan.created_at,
            plan.fired_at,
            plan.completed_at,
        ],
    ).map_err(|e| format!("Create execution plan error: {}", e))?;

    Ok(plan)
}

#[tauri::command]
pub fn db_update_execution_plan_status(
    db: State<'_, DbState>,
    id: String,
    status: String,
    result: Option<String>,
    fire_at: Option<i64>,
    fired_at: Option<i64>,
    completed_at: Option<i64>,
) -> Result<ExecutionPlan, String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {}", e))?;
    let mut plan = load_execution_plan(&conn, &id)?
        .ok_or_else(|| format!("Execution plan not found: {}", id))?;

    plan.status = status;
    if let Some(result_value) = result {
        plan.result = Some(result_value);
    }
    if let Some(fire_at_value) = fire_at {
        plan.fire_at = Some(fire_at_value);
    }
    if let Some(fired_at_value) = fired_at {
        plan.fired_at = Some(fired_at_value);
    }
    if let Some(completed_at_value) = completed_at {
        plan.completed_at = Some(completed_at_value);
    }

    let payload_json = serde_json::to_string(&plan)
        .map_err(|e| format!("Serialize execution plan error: {}", e))?;

    conn.execute(
        "UPDATE execution_plans SET payload_json = ?1, status = ?2, fired_at = ?3, completed_at = ?4 WHERE id = ?5",
        params![payload_json, &plan.status, plan.fired_at, plan.completed_at, id],
    ).map_err(|e| format!("Update execution plan error: {}", e))?;

    Ok(plan)
}

#[tauri::command]
pub fn db_get_execution_plan(
    db: State<'_, DbState>,
    id: String,
) -> Result<Option<ExecutionPlan>, String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {}", e))?;
    load_execution_plan(&conn, &id)
}

#[tauri::command]
pub fn db_get_execution_plans_by_message(
    db: State<'_, DbState>,
    message_id: String,
) -> Result<Vec<ExecutionPlan>, String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {}", e))?;
    let mut stmt = conn.prepare(
        "SELECT payload_json FROM execution_plans WHERE message_id = ?1 ORDER BY created_at ASC"
    ).map_err(|e| format!("Query error: {}", e))?;
    let rows = stmt.query_map(params![message_id], |row| row.get::<_, String>(0))
        .map_err(|e| format!("Query error: {}", e))?;

    let mut plans = Vec::new();
    for row in rows {
        let payload_json = row.map_err(|e| format!("Row error: {}", e))?;
        plans.push(parse_execution_plan(&payload_json)?);
    }
    Ok(plans)
}

// ── Helpers ──

fn parse_execution_plan(payload_json: &str) -> Result<ExecutionPlan, String> {
    serde_json::from_str(payload_json)
        .map_err(|e| format!("Deserialize execution plan error: {}", e))
}

fn load_execution_plan(conn: &Connection, id: &str) -> Result<Option<ExecutionPlan>, String> {
    let mut stmt = conn.prepare(
        "SELECT payload_json FROM execution_plans WHERE id = ?1"
    ).map_err(|e| format!("Query error: {}", e))?;

    let mut rows = stmt.query_map(params![id], |row| row.get::<_, String>(0))
        .map_err(|e| format!("Query error: {}", e))?;

    match rows.next() {
        Some(row) => {
            let payload_json = row.map_err(|e| format!("Row error: {}", e))?;
            Ok(Some(parse_execution_plan(&payload_json)?))
        }
        None => Ok(None),
    }
}

fn row_to_board(row: &rusqlite::Row) -> rusqlite::Result<KanbanBoard> {
    Ok(KanbanBoard {
        id: row.get(0)?,
        name: row.get(1)?,
        project_dir: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
    })
}

fn row_to_column(row: &rusqlite::Row) -> rusqlite::Result<KanbanColumn> {
    Ok(KanbanColumn {
        id: row.get(0)?,
        board_id: row.get(1)?,
        name: row.get(2)?,
        position: row.get(3)?,
        created_at: row.get(4)?,
    })
}

fn row_to_card(row: &rusqlite::Row) -> rusqlite::Result<KanbanCard> {
    Ok(KanbanCard {
        id: row.get(0)?,
        column_id: row.get(1)?,
        title: row.get(2)?,
        description: row.get(3)?,
        acceptance_criteria: row.get(4)?,
        position: row.get(5)?,
        assigned_agent_id: row.get(6)?,
        status: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

fn row_to_conversation(row: &rusqlite::Row) -> rusqlite::Result<Conversation> {
    Ok(Conversation {
        id: row.get(0)?,
        title: row.get(1)?,
        model: row.get(2)?,
        project_dir: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
        message_count: row.get(6)?,
        last_message_preview: row.get::<_, Option<String>>(7)?.map(|s| truncate(&s, 100)),
    })
}

fn row_to_agent(row: &rusqlite::Row) -> rusqlite::Result<Agent> {
    Ok(Agent {
        id: row.get(0)?,
        conversation_id: row.get(1)?,
        parent_agent_id: row.get(2)?,
        name: row.get(3)?,
        role: row.get(4)?,
        status: row.get(5)?,
        system_prompt: row.get(6)?,
        initial_task: row.get(7)?,
        project_dir: row.get(8)?,
        model: row.get(9)?,
        permission_level: row.get(10)?,
        execute_window_seconds: row.get(11)?,
        admin_notes: row.get(12)?,
        end_goal: row.get(13)?,
        context: row.get(14)?,
        launch_mode: row.get(15)?,
        connected_app_ids: row.get(16)?,
        connected_apps: row.get(17)?,
        is_system: row.get(18)?,
        system_agent_type: row.get(19)?,
        state_summary: row.get(20)?,
        created_at: row.get(21)?,
        updated_at: row.get(22)?,
        last_message_preview: None,
        message_count: None,
    })
}

fn row_to_agent_enriched(row: &rusqlite::Row) -> rusqlite::Result<Agent> {
    Ok(Agent {
        id: row.get(0)?,
        conversation_id: row.get(1)?,
        parent_agent_id: row.get(2)?,
        name: row.get(3)?,
        role: row.get(4)?,
        status: row.get(5)?,
        system_prompt: row.get(6)?,
        initial_task: row.get(7)?,
        project_dir: row.get(8)?,
        model: row.get(9)?,
        permission_level: row.get(10)?,
        execute_window_seconds: row.get(11)?,
        admin_notes: row.get(12)?,
        end_goal: row.get(13)?,
        context: row.get(14)?,
        launch_mode: row.get(15)?,
        connected_app_ids: row.get(16)?,
        connected_apps: row.get(17)?,
        is_system: row.get(18)?,
        system_agent_type: row.get(19)?,
        state_summary: row.get(20)?,
        created_at: row.get(21)?,
        updated_at: row.get(22)?,
        message_count: row.get(23)?,
        last_message_preview: row.get::<_, Option<String>>(24)?.map(|s| truncate(&s, 100)),
    })
}

fn row_to_card_report(row: &rusqlite::Row) -> rusqlite::Result<CardReport> {
    Ok(CardReport {
        id: row.get(0)?,
        card_id: row.get(1)?,
        agent_id: row.get(2)?,
        report_type: row.get(3)?,
        content: row.get(4)?,
        created_at: row.get(5)?,
    })
}

fn chrono_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        let mut end = max;
        while end > 0 && !s.is_char_boundary(end) {
            end -= 1;
        }
        format!("{}...", &s[..end])
    }
}

// ── Tests ──

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        apply_column_migrations(&conn);
        conn
    }

    #[test]
    fn test_create_and_list_conversations() {
        let conn = setup_db();
        let now = chrono_now();

        conn.execute(
            "INSERT INTO conversations (id, title, model, project_dir, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params!["conv1", "Test Chat", "anthropic/claude-sonnet-4-20250514", Some(std::env::temp_dir().join("project").to_string_lossy().to_string()).as_deref(), now, now],
        ).unwrap();

        let mut stmt = conn.prepare(
            "SELECT id, title, model, project_dir, created_at, updated_at FROM conversations"
        ).unwrap();
        let rows: Vec<(String, String, String, Option<String>, i64, i64)> = stmt.query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?))
        }).unwrap().map(|r| r.unwrap()).collect();

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].0, "conv1");
        assert_eq!(rows[0].1, "Test Chat");
    }

    #[test]
    fn test_save_and_load_messages() {
        let conn = setup_db();
        let now = chrono_now();

        conn.execute(
            "INSERT INTO conversations (id, title, model, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["conv1", "Test", "model", now, now],
        ).unwrap();

        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, created_at, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params!["msg1", "conv1", "user", "Hello!", now, 0],
        ).unwrap();
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, created_at, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params!["msg2", "conv1", "assistant", "Hi there!", now, 1],
        ).unwrap();

        let mut stmt = conn.prepare(
            "SELECT id, role, content, sort_order FROM messages WHERE conversation_id = ?1 ORDER BY sort_order"
        ).unwrap();
        let msgs: Vec<(String, String, String, i64)> = stmt.query_map(params!["conv1"], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        }).unwrap().map(|r| r.unwrap()).collect();

        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0].1, "user");
        assert_eq!(msgs[1].1, "assistant");
    }

    #[test]
    fn test_delete_conversation_cascades() {
        let conn = setup_db();
        let now = chrono_now();

        conn.execute(
            "INSERT INTO conversations (id, title, model, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["conv1", "Test", "model", now, now],
        ).unwrap();
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, created_at, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params!["msg1", "conv1", "user", "Hello!", now, 0],
        ).unwrap();

        // Delete messages then conversation
        conn.execute("DELETE FROM messages WHERE conversation_id = ?1", params!["conv1"]).unwrap();
        conn.execute("DELETE FROM conversations WHERE id = ?1", params!["conv1"]).unwrap();

        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM messages WHERE conversation_id = ?1",
            params!["conv1"],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_truncate() {
        assert_eq!(truncate("hello", 10), "hello");
        assert_eq!(truncate("hello world this is long", 10), "hello worl...");
    }

    #[test]
    fn test_message_sort_order() {
        let conn = setup_db();
        let now = chrono_now();

        conn.execute(
            "INSERT INTO conversations (id, title, model, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["conv1", "Test", "model", now, now],
        ).unwrap();

        // Insert out of order
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, created_at, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params!["msg3", "conv1", "assistant", "Response", now, 2],
        ).unwrap();
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, created_at, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params!["msg1", "conv1", "user", "First", now, 0],
        ).unwrap();
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, created_at, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params!["msg2", "conv1", "user", "Second", now, 1],
        ).unwrap();

        let mut stmt = conn.prepare(
            "SELECT content FROM messages WHERE conversation_id = ?1 ORDER BY sort_order"
        ).unwrap();
        let contents: Vec<String> = stmt.query_map(params!["conv1"], |row| {
            row.get(0)
        }).unwrap().map(|r| r.unwrap()).collect();

        assert_eq!(contents, vec!["First", "Second", "Response"]);
    }

    #[test]
    fn test_versioned_migration_renames_tool_publisher_rows() {
        let conn = setup_db();
        let now = chrono_now();

        conn.execute(
            "INSERT INTO conversations (id, title, model, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["conv-publisher", "Tool Publisher", "model", now, now],
        ).unwrap();
        conn.execute(
            "INSERT INTO agents (
                id, conversation_id, name, role, status, permission_level, execute_window_seconds,
                launch_mode, is_system, system_agent_type, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                "agent-publisher",
                "conv-publisher",
                "Tool Publisher (1)",
                "publisher",
                "pending",
                "auto_edit",
                8i64,
                "build_now",
                1i64,
                "tool_publisher",
                now,
                now,
            ],
        ).unwrap();

        apply_versioned_migrations(&conn).unwrap();

        let (name, role, is_system, system_agent_type): (String, String, i64, Option<String>) = conn.query_row(
            "SELECT name, role, is_system, system_agent_type FROM agents WHERE id = ?1",
            params!["agent-publisher"],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        ).unwrap();

        let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0)).unwrap();

        assert_eq!(name, "Tool Dealer (1)");
        assert_eq!(role, "marketer");
        assert_eq!(is_system, 1);
        assert_eq!(system_agent_type.as_deref(), Some("tool_marketer"));
        assert_eq!(version, DB_SCHEMA_VERSION);
    }

    #[test]
    fn test_versioned_migration_demotes_tool_explorer_rows() {
        let conn = setup_db();
        let now = chrono_now();

        conn.execute(
            "INSERT INTO conversations (id, title, model, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["conv-explorer", "Tool Explorer", "model", now, now],
        ).unwrap();
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, created_at, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params!["msg-explorer", "conv-explorer", "assistant", "Legacy session", now, 0i64],
        ).unwrap();
        conn.execute(
            "INSERT INTO agents (
                id, conversation_id, name, role, status, permission_level, execute_window_seconds,
                launch_mode, is_system, system_agent_type, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                "agent-explorer",
                "conv-explorer",
                "Tool Explorer",
                "explorer",
                "pending",
                "auto_edit",
                8i64,
                "build_now",
                1i64,
                "tool_explorer",
                now,
                now,
            ],
        ).unwrap();

        apply_versioned_migrations(&conn).unwrap();

        let (is_system, system_agent_type, message_count): (i64, Option<String>, i64) = conn.query_row(
            "SELECT a.is_system, a.system_agent_type, (SELECT COUNT(*) FROM messages WHERE conversation_id = a.conversation_id)
             FROM agents a WHERE id = ?1",
            params!["agent-explorer"],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).unwrap();

        assert_eq!(is_system, 0);
        assert_eq!(system_agent_type, None);
        assert_eq!(message_count, 1);
    }

    // ── Agent Tests ──

    #[test]
    fn test_create_agent_creates_both() {
        let conn = setup_db();
        let now = chrono_now();

        // Create backing conversation first (simulating what db_create_agent does)
        let conv_id = "conv-agent-1";
        conn.execute(
            "INSERT INTO conversations (id, title, model, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![conv_id, "Test Agent", "model", now, now],
        ).unwrap();

        conn.execute(
            "INSERT INTO agents (id, conversation_id, name, role, status, permission_level, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params!["agent1", conv_id, "Test Agent", "builder", "pending", "auto_edit", now, now],
        ).unwrap();

        // Verify agent exists
        let agent: (String, String, String, String) = conn.query_row(
            "SELECT id, name, role, status FROM agents WHERE id = ?1",
            params!["agent1"],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        ).unwrap();
        assert_eq!(agent.0, "agent1");
        assert_eq!(agent.1, "Test Agent");
        assert_eq!(agent.2, "builder");
        assert_eq!(agent.3, "pending");

        // Verify conversation exists
        let conv_title: String = conn.query_row(
            "SELECT title FROM conversations WHERE id = ?1",
            params![conv_id],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(conv_title, "Test Agent");
    }

    #[test]
    fn test_list_agents_by_parent() {
        let conn = setup_db();
        let now = chrono_now();

        // Create parent agent
        conn.execute(
            "INSERT INTO conversations (id, title, model, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["conv-parent", "Parent", "model", now, now],
        ).unwrap();
        conn.execute(
            "INSERT INTO agents (id, conversation_id, name, role, status, permission_level, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params!["parent", "conv-parent", "Parent Agent", "general", "running", "auto_edit", now, now],
        ).unwrap();

        // Create two child agents
        for i in 1..=2 {
            let cid = format!("conv-child-{}", i);
            let aid = format!("child-{}", i);
            conn.execute(
                "INSERT INTO conversations (id, title, model, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![cid, format!("Child {}", i), "model", now, now],
            ).unwrap();
            conn.execute(
                "INSERT INTO agents (id, conversation_id, parent_agent_id, name, role, status, permission_level, created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![aid, cid, "parent", format!("Child {}", i), "builder", "pending", "auto_edit", now, now],
            ).unwrap();
        }

        // Create unrelated agent
        conn.execute(
            "INSERT INTO conversations (id, title, model, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["conv-other", "Other", "model", now, now],
        ).unwrap();
        conn.execute(
            "INSERT INTO agents (id, conversation_id, name, role, status, permission_level, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params!["other", "conv-other", "Other Agent", "analyst", "pending", "auto_edit", now, now],
        ).unwrap();

        // List by parent
        let mut stmt = conn.prepare(&format!(
            "SELECT {} FROM agents WHERE parent_agent_id = ?1 ORDER BY created_at DESC",
            AGENT_SELECT_COLS
        )).unwrap();
        let children: Vec<Agent> = stmt.query_map(params!["parent"], row_to_agent)
            .unwrap().map(|r| r.unwrap()).collect();

        assert_eq!(children.len(), 2);
        assert!(children.iter().all(|a| a.parent_agent_id.as_deref() == Some("parent")));
    }

    #[test]
    fn test_update_agent_status() {
        let conn = setup_db();
        let now = chrono_now();

        conn.execute(
            "INSERT INTO conversations (id, title, model, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["conv1", "Agent", "model", now, now],
        ).unwrap();
        conn.execute(
            "INSERT INTO agents (id, conversation_id, name, role, status, permission_level, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params!["agent1", "conv1", "Agent", "builder", "pending", "auto_edit", now, now],
        ).unwrap();

        // Update status
        conn.execute(
            "UPDATE agents SET status = ?1, updated_at = ?2 WHERE id = ?3",
            params!["running", chrono_now(), "agent1"],
        ).unwrap();

        let status: String = conn.query_row(
            "SELECT status FROM agents WHERE id = ?1",
            params!["agent1"],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(status, "running");
    }

    #[test]
    fn test_delete_agent_cascades() {
        let conn = setup_db();
        let now = chrono_now();

        // Create agent with conversation and messages
        conn.execute(
            "INSERT INTO conversations (id, title, model, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["conv-agent", "Agent Conv", "model", now, now],
        ).unwrap();
        conn.execute(
            "INSERT INTO agents (id, conversation_id, name, role, status, permission_level, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params!["agent1", "conv-agent", "Agent", "builder", "running", "auto_edit", now, now],
        ).unwrap();
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, created_at, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params!["msg1", "conv-agent", "user", "Do something", now, 0],
        ).unwrap();

        // Delete agent, then manually cascade (simulating db_delete_agent)
        conn.execute("DELETE FROM agents WHERE id = ?1", params!["agent1"]).unwrap();
        conn.execute("DELETE FROM messages WHERE conversation_id = ?1", params!["conv-agent"]).unwrap();
        conn.execute("DELETE FROM conversations WHERE id = ?1", params!["conv-agent"]).unwrap();

        // Verify everything is gone
        let agent_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM agents WHERE id = ?1", params!["agent1"], |row| row.get(0),
        ).unwrap();
        let conv_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM conversations WHERE id = ?1", params!["conv-agent"], |row| row.get(0),
        ).unwrap();
        let msg_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM messages WHERE conversation_id = ?1", params!["conv-agent"], |row| row.get(0),
        ).unwrap();

        assert_eq!(agent_count, 0);
        assert_eq!(conv_count, 0);
        assert_eq!(msg_count, 0);
    }

    // ── Kanban Tests ──

    #[test]
    fn test_create_board_with_default_columns() {
        let conn = setup_db();
        let now = chrono_now();

        conn.execute(
            "INSERT INTO kanban_boards (id, name, project_dir, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["board1", "My Board", Some(std::env::temp_dir().join("project").to_string_lossy().to_string()).as_deref(), now, now],
        ).unwrap();

        // Create 4 default columns
        for (col_name, pos) in &[("Backlog", 0), ("In Progress", 1), ("Review", 2), ("Done", 3)] {
            let col_id = format!("board1-col-{}", pos);
            conn.execute(
                "INSERT INTO kanban_columns (id, board_id, name, position, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![col_id, "board1", col_name, pos, now],
            ).unwrap();
        }

        // Verify board
        let board_name: String = conn.query_row(
            "SELECT name FROM kanban_boards WHERE id = ?1", params!["board1"], |row| row.get(0),
        ).unwrap();
        assert_eq!(board_name, "My Board");

        // Verify 4 columns
        let col_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM kanban_columns WHERE board_id = ?1", params!["board1"], |row| row.get(0),
        ).unwrap();
        assert_eq!(col_count, 4);

        // Verify column ordering
        let mut stmt = conn.prepare(
            "SELECT name FROM kanban_columns WHERE board_id = ?1 ORDER BY position ASC"
        ).unwrap();
        let names: Vec<String> = stmt.query_map(params!["board1"], |row| row.get(0))
            .unwrap().map(|r| r.unwrap()).collect();
        assert_eq!(names, vec!["Backlog", "In Progress", "Review", "Done"]);
    }

    #[test]
    fn test_create_and_move_card() {
        let conn = setup_db();
        let now = chrono_now();

        // Setup board with columns
        conn.execute(
            "INSERT INTO kanban_boards (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params!["board1", "Board", now, now],
        ).unwrap();
        conn.execute(
            "INSERT INTO kanban_columns (id, board_id, name, position, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["col-backlog", "board1", "Backlog", 0, now],
        ).unwrap();
        conn.execute(
            "INSERT INTO kanban_columns (id, board_id, name, position, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["col-progress", "board1", "In Progress", 1, now],
        ).unwrap();

        // Create card in backlog
        conn.execute(
            "INSERT INTO kanban_cards (id, column_id, title, description, position, status, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params!["card1", "col-backlog", "Add auth", Some("Implement JWT auth"), 0, "todo", now, now],
        ).unwrap();

        // Verify card exists in backlog
        let col: String = conn.query_row(
            "SELECT column_id FROM kanban_cards WHERE id = ?1", params!["card1"], |row| row.get(0),
        ).unwrap();
        assert_eq!(col, "col-backlog");

        // Move card to "In Progress"
        conn.execute(
            "UPDATE kanban_cards SET column_id = ?1, position = ?2, updated_at = ?3 WHERE id = ?4",
            params!["col-progress", 0, chrono_now(), "card1"],
        ).unwrap();

        let col: String = conn.query_row(
            "SELECT column_id FROM kanban_cards WHERE id = ?1", params!["card1"], |row| row.get(0),
        ).unwrap();
        assert_eq!(col, "col-progress");
    }

    #[test]
    fn test_assign_agent_to_card() {
        let conn = setup_db();
        let now = chrono_now();

        // Create agent
        conn.execute(
            "INSERT INTO conversations (id, title, model, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["conv-agent", "Agent", "model", now, now],
        ).unwrap();
        conn.execute(
            "INSERT INTO agents (id, conversation_id, name, role, status, permission_level, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params!["agent1", "conv-agent", "Builder", "builder", "running", "auto_edit", now, now],
        ).unwrap();

        // Create board + column + card
        conn.execute(
            "INSERT INTO kanban_boards (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params!["board1", "Board", now, now],
        ).unwrap();
        conn.execute(
            "INSERT INTO kanban_columns (id, board_id, name, position, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["col1", "board1", "Backlog", 0, now],
        ).unwrap();
        conn.execute(
            "INSERT INTO kanban_cards (id, column_id, title, position, status, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params!["card1", "col1", "Task", 0, "todo", now, now],
        ).unwrap();

        // Assign agent
        conn.execute(
            "UPDATE kanban_cards SET assigned_agent_id = ?1, updated_at = ?2 WHERE id = ?3",
            params!["agent1", chrono_now(), "card1"],
        ).unwrap();

        let assigned: Option<String> = conn.query_row(
            "SELECT assigned_agent_id FROM kanban_cards WHERE id = ?1", params!["card1"], |row| row.get(0),
        ).unwrap();
        assert_eq!(assigned.as_deref(), Some("agent1"));
    }

    #[test]
    fn test_delete_board_cascades() {
        let conn = setup_db();
        let now = chrono_now();

        // Create board → column → card
        conn.execute(
            "INSERT INTO kanban_boards (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params!["board1", "Board", now, now],
        ).unwrap();
        conn.execute(
            "INSERT INTO kanban_columns (id, board_id, name, position, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["col1", "board1", "Backlog", 0, now],
        ).unwrap();
        conn.execute(
            "INSERT INTO kanban_cards (id, column_id, title, position, status, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params!["card1", "col1", "Task", 0, "todo", now, now],
        ).unwrap();

        // Delete board
        conn.execute("DELETE FROM kanban_boards WHERE id = ?1", params!["board1"]).unwrap();

        // Verify cascade
        let col_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM kanban_columns WHERE board_id = ?1", params!["board1"], |row| row.get(0),
        ).unwrap();
        let card_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM kanban_cards WHERE column_id = ?1", params!["col1"], |row| row.get(0),
        ).unwrap();
        assert_eq!(col_count, 0);
        assert_eq!(card_count, 0);
    }

    #[test]
    fn test_list_cards_across_columns() {
        let conn = setup_db();
        let now = chrono_now();

        // Create board with 2 columns
        conn.execute(
            "INSERT INTO kanban_boards (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params!["board1", "Board", now, now],
        ).unwrap();
        conn.execute(
            "INSERT INTO kanban_columns (id, board_id, name, position, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["col-a", "board1", "Backlog", 0, now],
        ).unwrap();
        conn.execute(
            "INSERT INTO kanban_columns (id, board_id, name, position, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["col-b", "board1", "Done", 1, now],
        ).unwrap();

        // Create cards in both columns
        conn.execute(
            "INSERT INTO kanban_cards (id, column_id, title, position, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params!["card-b1", "col-b", "Done task", 0, "done", now, now],
        ).unwrap();
        conn.execute(
            "INSERT INTO kanban_cards (id, column_id, title, position, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params!["card-a1", "col-a", "Backlog task", 0, "todo", now, now],
        ).unwrap();

        // List all cards for board (should be ordered by column position, then card position)
        let mut stmt = conn.prepare(
            "SELECT c.id, c.column_id, c.title, c.description, c.acceptance_criteria, \
                    c.position, c.assigned_agent_id, c.status, c.created_at, c.updated_at \
             FROM kanban_cards c \
             JOIN kanban_columns col ON c.column_id = col.id \
             WHERE col.board_id = ?1 \
             ORDER BY col.position ASC, c.position ASC"
        ).unwrap();
        let cards: Vec<KanbanCard> = stmt.query_map(params!["board1"], row_to_card)
            .unwrap().map(|r| r.unwrap()).collect();

        assert_eq!(cards.len(), 2);
        // First card should be from Backlog (col position 0)
        assert_eq!(cards[0].title, "Backlog task");
        assert_eq!(cards[0].column_id, "col-a");
        // Second from Done (col position 1)
        assert_eq!(cards[1].title, "Done task");
        assert_eq!(cards[1].column_id, "col-b");
    }

    #[test]
    fn test_agent_tree_depth() {
        let conn = setup_db();
        let now = chrono_now();

        // Create 3-level tree: root → child → grandchild
        for (id, conv_id, parent, name) in [
            ("root", "conv-root", None, "Root Agent"),
            ("child", "conv-child", Some("root"), "Child Agent"),
            ("grandchild", "conv-gc", Some("child"), "Grandchild Agent"),
        ] {
            conn.execute(
                "INSERT INTO conversations (id, title, model, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![conv_id, name, "model", now, now],
            ).unwrap();
            conn.execute(
                "INSERT INTO agents (id, conversation_id, parent_agent_id, name, role, status, permission_level, created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![id, conv_id, parent, name, "general", "pending", "auto_edit", now, now],
            ).unwrap();
        }

        // Recursive CTE to find full subtree from root
        let mut stmt = conn.prepare(
            "WITH RECURSIVE subtree AS (
                SELECT id, parent_agent_id, name, 0 as depth FROM agents WHERE id = ?1
                UNION ALL
                SELECT a.id, a.parent_agent_id, a.name, s.depth + 1
                FROM agents a JOIN subtree s ON a.parent_agent_id = s.id
            )
            SELECT id, depth FROM subtree ORDER BY depth"
        ).unwrap();
        let tree: Vec<(String, i64)> = stmt.query_map(params!["root"], |row| {
            Ok((row.get(0)?, row.get(1)?))
        }).unwrap().map(|r| r.unwrap()).collect();

        assert_eq!(tree.len(), 3);
        assert_eq!(tree[0], ("root".to_string(), 0));
        assert_eq!(tree[1], ("child".to_string(), 1));
        assert_eq!(tree[2], ("grandchild".to_string(), 2));
    }

    #[test]
    fn test_new_agent_session() {
        let conn = setup_db();
        let now = chrono_now();

        // Create conversation + agent + some messages
        conn.execute(
            "INSERT INTO conversations (id, title, model, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["conv-session", "Session Test", "model", now, now],
        ).unwrap();
        conn.execute(
            "INSERT INTO agents (id, conversation_id, name, role, status, permission_level, initial_task, admin_notes, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params!["agent-session", "conv-session", "Test Agent", "builder", "running", "auto_edit", "Build feature X", "Keep logs", now, now],
        ).unwrap();

        // Add 3 messages
        for i in 0..3i64 {
            conn.execute(
                "INSERT INTO messages (id, conversation_id, role, content, created_at, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![format!("msg-{}", i), "conv-session", "assistant", format!("Message {}", i), now + i, i],
            ).unwrap();
        }

        // Verify messages exist
        let msg_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM messages WHERE conversation_id = 'conv-session'",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(msg_count, 3);

        // Simulate new session — delete messages + reset status
        conn.execute("DELETE FROM messages WHERE conversation_id = 'conv-session'", []).unwrap();
        conn.execute("UPDATE agents SET status = 'pending', updated_at = ?1 WHERE id = 'agent-session'", params![now + 100]).unwrap();

        // Verify messages deleted
        let msg_count_after: i64 = conn.query_row(
            "SELECT COUNT(*) FROM messages WHERE conversation_id = 'conv-session'",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(msg_count_after, 0);

        // Verify agent status reset but identity preserved
        let (status, name, role, task, notes): (String, String, String, Option<String>, Option<String>) = conn.query_row(
            "SELECT status, name, role, initial_task, admin_notes FROM agents WHERE id = 'agent-session'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        ).unwrap();
        assert_eq!(status, "pending");
        assert_eq!(name, "Test Agent");
        assert_eq!(role, "builder");
        assert_eq!(task.as_deref(), Some("Build feature X"));
        assert_eq!(notes.as_deref(), Some("Keep logs"));
    }

    // ── Card Report Tests ──

    #[test]
    fn test_create_and_list_card_reports() {
        let conn = setup_db();
        let now = chrono_now();

        // Create board + column + card + agent prerequisites
        conn.execute(
            "INSERT INTO kanban_boards (id, name, project_dir, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["board1", "Test Board", "/tmp", now, now],
        ).unwrap();
        conn.execute(
            "INSERT INTO kanban_columns (id, board_id, name, position, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["col1", "board1", "Backlog", 0, now],
        ).unwrap();
        conn.execute(
            "INSERT INTO kanban_cards (id, column_id, title, position, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params!["card1", "col1", "Test Card", 0, "todo", now, now],
        ).unwrap();
        conn.execute(
            "INSERT INTO conversations (id, title, model, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["conv-r1", "Agent", "model", now, now],
        ).unwrap();
        conn.execute(
            "INSERT INTO agents (id, conversation_id, name, role, status, permission_level, launch_mode, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params!["agent-r1", "conv-r1", "Reporter", "analyst", "running", "auto_edit", "discuss_first", now, now],
        ).unwrap();

        // Create reports (out of order to test ordering)
        conn.execute(
            "INSERT INTO card_reports (id, card_id, agent_id, report_type, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params!["rpt2", "card1", "agent-r1", "completion", "Done!", now + 100],
        ).unwrap();
        conn.execute(
            "INSERT INTO card_reports (id, card_id, agent_id, report_type, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params!["rpt1", "card1", "agent-r1", "plan", "Here is my plan...", now],
        ).unwrap();

        // List — should be ordered by created_at ASC
        let mut stmt = conn.prepare(
            "SELECT id, card_id, agent_id, report_type, content, created_at \
             FROM card_reports WHERE card_id = ?1 ORDER BY created_at ASC"
        ).unwrap();
        let reports: Vec<CardReport> = stmt.query_map(params!["card1"], row_to_card_report)
            .unwrap().map(|r| r.unwrap()).collect();

        assert_eq!(reports.len(), 2);
        assert_eq!(reports[0].id, "rpt1");
        assert_eq!(reports[0].report_type, "plan");
        assert_eq!(reports[1].id, "rpt2");
        assert_eq!(reports[1].report_type, "completion");
    }

    #[test]
    fn test_card_report_cascade_on_card_delete() {
        let conn = setup_db();
        let now = chrono_now();

        // Setup
        conn.execute(
            "INSERT INTO kanban_boards (id, name, project_dir, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["board-c", "Board", "/tmp", now, now],
        ).unwrap();
        conn.execute(
            "INSERT INTO kanban_columns (id, board_id, name, position, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["col-c", "board-c", "Col", 0, now],
        ).unwrap();
        conn.execute(
            "INSERT INTO kanban_cards (id, column_id, title, position, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params!["card-c", "col-c", "Card", 0, "todo", now, now],
        ).unwrap();
        conn.execute(
            "INSERT INTO conversations (id, title, model, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["conv-c", "Agent", "model", now, now],
        ).unwrap();
        conn.execute(
            "INSERT INTO agents (id, conversation_id, name, role, status, permission_level, launch_mode, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params!["agent-c", "conv-c", "Agent", "builder", "running", "auto_edit", "build_now", now, now],
        ).unwrap();
        conn.execute(
            "INSERT INTO card_reports (id, card_id, agent_id, report_type, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params!["rpt-c", "card-c", "agent-c", "progress", "Working...", now],
        ).unwrap();

        // Delete card — should cascade to reports
        conn.execute("DELETE FROM kanban_cards WHERE id = 'card-c'", []).unwrap();

        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM card_reports WHERE card_id = 'card-c'",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_agent_launch_mode() {
        let conn = setup_db();
        let now = chrono_now();

        // Create agent with explicit launch_mode
        conn.execute(
            "INSERT INTO conversations (id, title, model, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["conv-lm", "Agent", "model", now, now],
        ).unwrap();
        conn.execute(
            "INSERT INTO agents (id, conversation_id, name, role, status, permission_level, launch_mode, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params!["agent-lm", "conv-lm", "Planner", "analyst", "pending", "auto_edit", "discuss_first", now, now],
        ).unwrap();

        let launch_mode: String = conn.query_row(
            "SELECT launch_mode FROM agents WHERE id = 'agent-lm'",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(launch_mode, "discuss_first");

        // Default launch_mode
        conn.execute(
            "INSERT INTO conversations (id, title, model, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["conv-lm2", "Agent2", "model", now, now],
        ).unwrap();
        conn.execute(
            "INSERT INTO agents (id, conversation_id, name, role, status, permission_level, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params!["agent-lm2", "conv-lm2", "Builder", "builder", "pending", "auto_edit", now, now],
        ).unwrap();

        let launch_mode2: String = conn.query_row(
            "SELECT launch_mode FROM agents WHERE id = 'agent-lm2'",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(launch_mode2, "build_now");
    }

    #[test]
    fn test_agent_execute_window_defaults_and_persists() {
        let conn = setup_db();
        let now = chrono_now();

        conn.execute(
            "INSERT INTO conversations (id, title, model, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["conv-ew", "Agent", "model", now, now],
        ).unwrap();
        conn.execute(
            "INSERT INTO agents (id, conversation_id, name, role, status, permission_level, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params!["agent-ew", "conv-ew", "Runner", "general", "pending", "auto_edit", now, now],
        ).unwrap();

        let default_window: i64 = conn.query_row(
            "SELECT execute_window_seconds FROM agents WHERE id = 'agent-ew'",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(default_window, 8);

        conn.execute(
            "UPDATE agents SET execute_window_seconds = ?1 WHERE id = ?2",
            params![30, "agent-ew"],
        ).unwrap();

        let mut stmt = conn.prepare(&format!(
            "SELECT {} FROM agents WHERE id = ?1",
            AGENT_SELECT_COLS
        )).unwrap();
        let mut rows = stmt.query_map(params!["agent-ew"], row_to_agent).unwrap();
        let agent = rows.next().unwrap().unwrap();

        assert_eq!(agent.execute_window_seconds, 30);
    }

    #[test]
    fn test_execution_plan_roundtrip() {
        let conn = setup_db();
        let now = chrono_now();

        let plan = ExecutionPlan {
            id: "plan-1".to_string(),
            conversation_id: "conv-1".to_string(),
            message_id: "msg-1".to_string(),
            recipe: "return 42;".to_string(),
            tools_used: vec![ToolUsed {
                app_id: "app-1".to_string(),
                app_name: "Calendar".to_string(),
                app_slug: "calendar".to_string(),
                origin: "library".to_string(),
                fn_name: "calendar_lookup".to_string(),
                args: serde_json::json!({ "query": "today" }),
                cost_light: 0.05,
            }],
            total_cost_light: 0.05,
            created_at: now,
            window_seconds: 8,
            fire_at: Some(now + 8_000),
            status: "pending".to_string(),
            result: None,
            fired_at: None,
            completed_at: None,
        };

        let payload_json = serde_json::to_string(&plan).unwrap();
        conn.execute(
            "INSERT INTO execution_plans (id, conversation_id, message_id, payload_json, status, created_at, fired_at, completed_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                plan.id,
                plan.conversation_id,
                plan.message_id,
                payload_json,
                plan.status,
                plan.created_at,
                plan.fired_at,
                plan.completed_at,
            ],
        ).unwrap();

        let loaded = load_execution_plan(&conn, "plan-1").unwrap().unwrap();
        assert_eq!(loaded.recipe, "return 42;");
        assert_eq!(loaded.tools_used.len(), 1);
        assert_eq!(loaded.tools_used[0].origin, "library");
        assert_eq!(loaded.fire_at, Some(now + 8_000));
    }
}
