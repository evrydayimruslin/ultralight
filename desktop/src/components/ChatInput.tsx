// Chat input — textarea with Cmd/Ctrl+Enter to send.
// Supports queue mode: input stays enabled while agent runs, shows "Queue" instead of "Send".

import { useState, useRef, useEffect, useCallback } from 'react';
import ProjectDropdown from './ProjectDropdown';

interface ChatInputProps {
  onSend: (content: string) => void;
  isLoading: boolean;
  onStop?: () => void;
  /** When true, input stays enabled during loading — sends go to queue */
  queueMode?: boolean;
  /** Current conversation's project directory */
  projectDir?: string | null;
  /** Called when user picks a new project directory */
  onProjectDirChange?: (dir: string) => void;
}

export default function ChatInput({ onSend, isLoading, onStop, queueMode = false, projectDir, onProjectDirChange }: ChatInputProps) {
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
    <div className="bg-white px-4 pt-3 pb-4">
      <div className="max-w-narrow mx-auto">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isQueueing ? 'Queue a follow-up...' : 'Message...'}
            rows={1}
            className="flex-1 resize-none border border-gray-200 px-3 text-[13px] text-ul-text bg-white outline-none transition-colors focus:border-gray-400 placeholder:text-gray-500 selectable"
            style={{ paddingTop: '9px', paddingBottom: '11px', lineHeight: '20px' }}
            disabled={inputDisabled}
          />

          {/* Stop button */}
          {isLoading && (
            <button
              onClick={onStop}
              className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-200 text-gray-500 hover:bg-gray-200 transition-colors flex-shrink-0 mb-0.5"
              title="Stop"
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          )}

          {/* Send / Queue button */}
          {isQueueing ? (
            <button
              onClick={handleSend}
              disabled={!value.trim()}
              className="flex items-center justify-center w-8 h-8 rounded-full bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-30 transition-colors flex-shrink-0 mb-0.5"
              title="Queue"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
          ) : !isLoading ? (
            <button
              onClick={handleSend}
              disabled={!value.trim()}
              className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-800 text-white hover:bg-gray-700 disabled:opacity-20 transition-colors flex-shrink-0 mb-0.5"
              title="Send"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
              </svg>
            </button>
          ) : null}
        </div>

        {onProjectDirChange && (
          <div className="mt-2">
            <ProjectDropdown
              selectedDir={projectDir ?? null}
              onSelect={(dir) => dir && onProjectDirChange(dir)}
              dropUp
              compact
            />
          </div>
        )}
      </div>
    </div>
  );
}
