mod db;
mod tools;

use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Initialize SQLite database in app data directory
      let app_data_dir = app.path().app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))
        .expect("app data dir should be available");

      let conn = db::init_db(&app_data_dir)
        .expect("Failed to initialize database");

      app.manage(db::DbState(Mutex::new(conn)));

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      // Filesystem tools
      tools::fs::file_read,
      tools::fs::file_write,
      tools::fs::file_edit,
      tools::fs::glob_search,
      tools::fs::grep_search,
      tools::fs::ls,
      // Shell + Git tools
      tools::shell::shell_exec,
      tools::shell::git,
      // Database commands
      db::db_list_conversations,
      db::db_create_conversation,
      db::db_update_conversation,
      db::db_delete_conversation,
      db::db_load_messages,
      db::db_save_message,
      db::db_save_messages_batch,
      // Agent commands
      db::db_create_agent,
      db::db_list_agents,
      db::db_get_agent,
      db::db_get_agent_by_conversation,
      db::db_update_agent,
      db::db_delete_agent,
      db::db_new_agent_session,
      // Kanban commands
      db::db_create_board,
      db::db_list_boards,
      db::db_get_board,
      db::db_delete_board,
      db::db_create_column,
      db::db_update_column,
      db::db_delete_column,
      db::db_list_columns,
      db::db_create_card,
      db::db_update_card,
      db::db_delete_card,
      db::db_list_cards,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
