// Multi-window management — opens subagent chats in separate Tauri windows.
// Uses @tauri-apps/api/webviewWindow to create new windows.

import { WebviewWindow, getAllWebviewWindows } from '@tauri-apps/api/webviewWindow';

/**
 * Open a new window for a subagent's chat.
 * If a window with the same label already exists, focuses it instead.
 */
export async function openSubagentWindow(agentId: string, agentName: string): Promise<void> {
  const label = `subagent-${agentId.slice(0, 8)}`;

  // Check if window already exists — focus it if so
  const existingWindows = await getAllWebviewWindows();
  const existing = existingWindows.find(w => w.label === label);
  if (existing) {
    await existing.setFocus();
    return;
  }

  // Create new window with subagent query param
  const _webview = new WebviewWindow(label, {
    url: `index.html?subagent=${encodeURIComponent(agentId)}`,
    title: `${agentName} — Ultralight`,
    width: 700,
    height: 600,
    minWidth: 400,
    minHeight: 300,
    center: true,
    decorations: true,
    resizable: true,
  });

  // No need to await — window opens asynchronously
}
