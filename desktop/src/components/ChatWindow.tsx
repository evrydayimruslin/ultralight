// ChatWindow — standalone window for any chat conversation.
// Loaded when main.tsx detects ?view=chat query param.
// Thin wrapper around ChatView — all chat logic lives there.

import { useRef, useEffect } from 'react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import ChatView from './ChatView';
import { openViewWindow } from '../lib/multiWindow';

function parseParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    agentId: params.get('agentId') || undefined,
    agentName: params.get('agentName') || undefined,
  };
}

export default function ChatWindow() {
  const { agentId, agentName } = useRef(parseParams()).current;

  // Update window title when we know the agent name
  useEffect(() => {
    if (agentName) {
      getCurrentWebviewWindow().setTitle(`${agentName} — Ultralight`);
    }
  }, [agentName]);

  return (
    <ChatView
      agentId={agentId}
      onNavigateToAgent={(newAgentId) => {
        // When a new chat creates an agent, update the window title.
        // The chat continues in this window — no navigation needed.
        getCurrentWebviewWindow().setTitle('Chat — Ultralight');
        // If opening a different agent (e.g. from subagent link), pop a new window
        if (agentId && newAgentId !== agentId) {
          openViewWindow({ kind: 'chat', agentId: newAgentId, agentName: newAgentId.slice(0, 8) });
        }
      }}
    />
  );
}
