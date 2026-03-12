// Main chat interface — assembles message list + input.

import { useState } from 'react';
import { useChat } from '../hooks/useChat';
import { useMcp } from '../hooks/useMcp';
import MessageList from './MessageList';
import ChatInput from './ChatInput';
import ModelSelector from './ModelSelector';
import BalanceIndicator from './BalanceIndicator';
import { clearToken, getToken, getApiBase } from '../lib/storage';

const SYSTEM_PROMPT = `You are Ultralight Assistant, a helpful AI with access to the Ultralight platform.

You can discover and call deployed apps/functions on the platform using your tools:
- ul_discover: Search for available apps and APIs
- ul_call: Execute a discovered app/function
- ul_memory: Store and retrieve persistent notes

When a user asks you to do something that might require an external service or API, first try to discover relevant apps on the platform before suggesting alternatives.

Be concise, helpful, and direct. Format responses with markdown when appropriate.`;

export default function ChatView() {
  const { tools, executeToolCall } = useMcp();
  const [diagnostics, setDiagnostics] = useState<string | null>(null);

  const {
    messages,
    isLoading,
    error,
    sendMessage,
    clearMessages,
    clearError,
    stopGeneration,
  } = useChat({
    systemPrompt: SYSTEM_PROMPT,
    tools,
    onToolCall: executeToolCall,
  });

  const handleSignOut = () => {
    clearToken();
    window.location.reload();
  };

  const runDiagnostics = async () => {
    setDiagnostics('Running...');
    try {
      const token = getToken();
      const base = getApiBase();
      const res = await fetch(`${base}/debug/auth-test`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json();
      const lines = (data.steps || []).map((s: { step: string; result: string; ok: boolean }) =>
        `${s.ok ? '✓' : '✗'} ${s.step}: ${s.result}`
      );
      setDiagnostics(lines.join('\n') || JSON.stringify(data, null, 2));
    } catch (err) {
      setDiagnostics(`Network error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const isAuthError = error?.toLowerCase().includes('auth');

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-4 h-nav border-b border-ul-border bg-white flex-shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-h3 text-ul-text tracking-tight">Ultralight</h1>
          <ModelSelector />
        </div>

        <div className="flex items-center gap-2">
          <BalanceIndicator />

          {messages.length > 0 && (
            <button
              onClick={clearMessages}
              className="btn-ghost btn-sm text-caption"
              title="New conversation"
            >
              New Chat
            </button>
          )}

          <button
            onClick={handleSignOut}
            className="btn-ghost btn-sm text-caption text-ul-text-muted"
            title="Sign out"
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <div className="px-4 py-2 bg-ul-error-soft border-b border-ul-border">
          <div className="flex items-center justify-between">
            <p className="text-small text-ul-error">{error}</p>
            <div className="flex items-center gap-2">
              {isAuthError && (
                <>
                  <button
                    onClick={runDiagnostics}
                    className="text-caption text-ul-text-secondary hover:underline"
                  >
                    Diagnose
                  </button>
                  <button
                    onClick={handleSignOut}
                    className="text-caption text-ul-error hover:underline"
                  >
                    Re-enter Token
                  </button>
                </>
              )}
              <button
                onClick={() => { clearError(); setDiagnostics(null); }}
                className="text-caption text-ul-error hover:underline"
              >
                Dismiss
              </button>
            </div>
          </div>
          {diagnostics && (
            <pre className="mt-2 p-2 bg-white rounded text-xs text-ul-text-secondary font-mono whitespace-pre-wrap border border-ul-border">
              {diagnostics}
            </pre>
          )}
        </div>
      )}

      {/* Messages */}
      <MessageList messages={messages} isLoading={isLoading} />

      {/* Input */}
      <ChatInput
        onSend={sendMessage}
        isLoading={isLoading}
        onStop={stopGeneration}
      />
    </div>
  );
}
