// Chat input — textarea with Cmd/Ctrl+Enter to send.
// Supports queue mode: input stays enabled while agent runs, shows "Queue" instead of "Send".

import { useState, useRef, useEffect, useCallback } from 'react';

interface ChatInputProps {
  onSend: (content: string) => void;
  isLoading: boolean;
  onStop?: () => void;
  /** When true, input stays enabled during loading — sends go to queue */
  queueMode?: boolean;
}

export default function ChatInput({ onSend, isLoading, onStop, queueMode = false }: ChatInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [value]);

  // Focus on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // In queue mode, input is never disabled — messages go to queue
  const inputDisabled = isLoading && !queueMode;
  const isQueueing = isLoading && queueMode;

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed) return;
    // In non-queue mode, block sends during loading
    if (isLoading && !queueMode) return;
    onSend(trimmed);
    setValue('');
    // Reset height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [value, isLoading, queueMode, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Cmd/Ctrl + Enter to send
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
      return;
    }

    // Plain Enter to send (no newline), Shift+Enter for newline
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t border-ul-border bg-white px-4 py-3">
      <div className="max-w-narrow mx-auto flex items-end gap-2">
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isQueueing ? 'Queue a follow-up message...' : 'Send a message...'}
            rows={1}
            className="w-full resize-none border border-ul-border rounded-lg px-3 py-2.5 text-body text-ul-text bg-white outline-none transition-colors focus:border-ul-border-focus focus:shadow-glow placeholder:text-ul-text-muted selectable"
            disabled={inputDisabled}
          />
        </div>

        {/* Stop button — always shown when loading */}
        {isLoading && (
          <button
            onClick={onStop}
            className="btn-secondary btn-sm flex-shrink-0"
            title="Stop generation"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          </button>
        )}

        {/* Send/Queue button */}
        {isQueueing ? (
          <button
            onClick={handleSend}
            disabled={!value.trim()}
            className="btn-sm flex-shrink-0 disabled:opacity-30 bg-amber-500 hover:bg-amber-600 text-white rounded-lg px-3 py-1.5 text-small font-medium transition-colors"
            title="Queue message (will send when agent finishes)"
          >
            <svg className="w-4 h-4 inline mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Queue
          </button>
        ) : !isLoading ? (
          <button
            onClick={handleSend}
            disabled={!value.trim()}
            className="btn-primary btn-sm flex-shrink-0 disabled:opacity-30"
            title="Send (Enter)"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </button>
        ) : null}
      </div>

      <p className="text-center text-caption text-ul-text-muted mt-1.5 max-w-narrow mx-auto">
        {isQueueing
          ? 'Agent is running \u00b7 messages will be queued'
          : 'Enter to send \u00b7 Shift+Enter for new line'}
      </p>
    </div>
  );
}
