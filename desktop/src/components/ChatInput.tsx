// Chat input — textarea with Cmd/Ctrl+Enter to send.

import { useState, useRef, useEffect, useCallback } from 'react';

interface ChatInputProps {
  onSend: (content: string) => void;
  isLoading: boolean;
  onStop?: () => void;
}

export default function ChatInput({ onSend, isLoading, onStop }: ChatInputProps) {
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

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || isLoading) return;
    onSend(trimmed);
    setValue('');
    // Reset height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [value, isLoading, onSend]);

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
            placeholder="Send a message..."
            rows={1}
            className="w-full resize-none border border-ul-border rounded-lg px-3 py-2.5 text-body text-ul-text bg-white outline-none transition-colors focus:border-ul-border-focus focus:shadow-glow placeholder:text-ul-text-muted selectable"
            disabled={isLoading}
          />
        </div>

        {isLoading ? (
          <button
            onClick={onStop}
            className="btn-secondary btn-sm flex-shrink-0"
            title="Stop generation"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          </button>
        ) : (
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
        )}
      </div>

      <p className="text-center text-caption text-ul-text-muted mt-1.5 max-w-narrow mx-auto">
        Enter to send · Shift+Enter for new line
      </p>
    </div>
  );
}
