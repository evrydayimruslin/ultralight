// WidgetCard — renders a single widget item from an MCP server.
// Content: sandboxed HTML via iframe. Actions: native React buttons.
// Supports inline editing, prompt-based regeneration, and standard actions.

import { useState, useRef, useEffect, useCallback } from 'react';
import type { WidgetItem, WidgetAction } from '../../../shared/types/index';

interface WidgetCardProps {
  item: WidgetItem;
  appId: string;
  onAction: (appId: string, action: WidgetAction, editedValue?: string) => Promise<{ success: boolean; error?: string }>;
}

export default function WidgetCard({ item, appId, onAction }: WidgetCardProps) {
  const [activeInput, setActiveInput] = useState<{ action: WidgetAction; mode: 'edit' | 'prompt' } | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize iframe to content height
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const handleLoad = () => {
      try {
        const doc = iframe.contentDocument;
        if (doc) {
          const height = doc.documentElement.scrollHeight;
          iframe.style.height = Math.min(height + 4, 400) + 'px';
        }
      } catch {
        // Cross-origin — use default height
      }
    };

    iframe.addEventListener('load', handleLoad);
    return () => iframe.removeEventListener('load', handleLoad);
  }, [item.html]);

  // Focus input when entering edit/prompt mode
  useEffect(() => {
    if (activeInput) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [activeInput]);

  const handleAction = useCallback(async (action: WidgetAction) => {
    // If action has prompt_input or editable and we're not in input mode yet, enter it
    if (action.prompt_input && !activeInput) {
      setActiveInput({ action, mode: 'prompt' });
      setInputValue('');
      return;
    }
    if (action.editable && !activeInput) {
      setActiveInput({ action, mode: 'edit' });
      setInputValue(action.editable.initial_value);
      return;
    }

    setActionLoading(action.label);
    setFeedback(null);

    const editedValue = activeInput ? inputValue : undefined;
    const result = await onAction(appId, action, editedValue);

    setActionLoading(null);

    if (result.success) {
      setFeedback({ type: 'success', message: action.label + ' completed' });
      setActiveInput(null);
      setInputValue('');
      setTimeout(() => setFeedback(null), 3000);
    } else {
      setFeedback({ type: 'error', message: result.error || 'Action failed' });
    }
  }, [appId, onAction, activeInput, inputValue]);

  const handleCancelInput = useCallback(() => {
    setActiveInput(null);
    setInputValue('');
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && activeInput) {
      e.preventDefault();
      handleAction(activeInput.action);
    }
    if (e.key === 'Escape') {
      handleCancelInput();
    }
  }, [activeInput, handleAction, handleCancelInput]);

  // Build sandboxed HTML
  const iframeContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; font-size: 13px; line-height: 1.5; color: #1a1a1a; padding: 12px; }
  </style>
</head>
<body>${item.html}</body>
</html>`;

  return (
    <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
      {/* HTML Content */}
      <iframe
        ref={iframeRef}
        srcDoc={iframeContent}
        sandbox="allow-same-origin"
        className="w-full border-0"
        style={{ minHeight: '80px', height: '160px' }}
        title="Widget content"
      />

      {/* Input Mode — edit or prompt */}
      {activeInput && (
        <div className="px-3 py-3 border-t border-gray-100 bg-gray-50">
          {activeInput.mode === 'prompt' && (
            <label className="block text-[11px] font-medium text-gray-500 mb-1.5 uppercase tracking-wide">
              Regeneration instructions
            </label>
          )}
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              activeInput.mode === 'prompt'
                ? (activeInput.action.prompt_input?.placeholder || 'Describe how to rewrite...')
                : ''
            }
            className={`w-full border rounded-md px-3 py-2 text-sm resize-y focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400 ${
              activeInput.mode === 'prompt'
                ? 'border-blue-200 bg-blue-50/50 min-h-[48px]'
                : 'border-gray-300 font-mono min-h-[80px]'
            }`}
            rows={activeInput.mode === 'prompt' ? 2 : 4}
          />
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={() => handleAction(activeInput.action)}
              disabled={actionLoading !== null || (activeInput.mode === 'prompt' && !inputValue.trim())}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {actionLoading === activeInput.action.label
                ? (activeInput.mode === 'prompt' ? 'Regenerating...' : 'Sending...')
                : (activeInput.mode === 'prompt' ? 'Regenerate' : 'Send Edited')
              }
            </button>
            <button
              onClick={handleCancelInput}
              className="px-3 py-1.5 text-xs font-medium rounded-md text-gray-600 hover:bg-gray-200 transition-colors"
            >
              Cancel
            </button>
            {activeInput.mode === 'prompt' && (
              <span className="text-[11px] text-gray-400 ml-auto">Cmd+Enter to submit</span>
            )}
          </div>
        </div>
      )}

      {/* Action Buttons */}
      {!activeInput && (
        <div className="flex items-center gap-2 px-3 py-2 border-t border-gray-100 bg-gray-50/50">
          {item.actions.map(action => {
            const isPrimary = action.style === 'primary';
            const isDanger = action.style === 'danger';
            const isLoading = actionLoading === action.label;

            return (
              <button
                key={action.label}
                onClick={() => handleAction(action)}
                disabled={actionLoading !== null}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors disabled:opacity-50 ${
                  isPrimary
                    ? 'bg-green-600 text-white hover:bg-green-700'
                    : isDanger
                      ? 'text-red-600 hover:bg-red-50 border border-red-200'
                      : 'text-gray-700 hover:bg-gray-200 border border-gray-200'
                }`}
              >
                {isLoading ? '...' : action.label}
              </button>
            );
          })}

          {feedback && (
            <span className={`text-xs ml-auto ${feedback.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
              {feedback.message}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
