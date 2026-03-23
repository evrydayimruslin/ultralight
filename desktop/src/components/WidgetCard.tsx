// WidgetCard — renders a single widget item from an MCP server.
// Content: sandboxed HTML via iframe. Actions: native React buttons.
// Supports inline editing for "Edit & Send" type actions.

import { useState, useRef, useEffect, useCallback } from 'react';
import type { WidgetItem, WidgetAction } from '../../../shared/types/index';

interface WidgetCardProps {
  item: WidgetItem;
  appId: string;
  onAction: (appId: string, action: WidgetAction, editedValue?: string) => Promise<{ success: boolean; error?: string }>;
}

export default function WidgetCard({ item, appId, onAction }: WidgetCardProps) {
  const [editingAction, setEditingAction] = useState<WidgetAction | null>(null);
  const [editValue, setEditValue] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

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
        // Cross-origin restriction — use default height
      }
    };

    iframe.addEventListener('load', handleLoad);
    return () => iframe.removeEventListener('load', handleLoad);
  }, [item.html]);

  const handleAction = useCallback(async (action: WidgetAction) => {
    if (action.editable && !editingAction) {
      // Enter edit mode
      setEditingAction(action);
      setEditValue(action.editable.initial_value);
      return;
    }

    setActionLoading(action.label);
    setFeedback(null);

    const editedValue = editingAction ? editValue : undefined;
    const result = await onAction(appId, action, editedValue);

    setActionLoading(null);
    setEditingAction(null);

    if (result.success) {
      setFeedback({ type: 'success', message: action.label + ' completed' });
      setTimeout(() => setFeedback(null), 2000);
    } else {
      setFeedback({ type: 'error', message: result.error || 'Action failed' });
    }
  }, [appId, onAction, editingAction, editValue]);

  const handleCancelEdit = useCallback(() => {
    setEditingAction(null);
    setEditValue('');
  }, []);

  // Build sandboxed HTML with minimal styling reset
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
      {/* HTML Content — sandboxed iframe */}
      <iframe
        ref={iframeRef}
        srcDoc={iframeContent}
        sandbox="allow-same-origin"
        className="w-full border-0"
        style={{ minHeight: '80px', height: '160px' }}
        title="Widget content"
      />

      {/* Edit Mode */}
      {editingAction && (
        <div className="px-3 py-2 border-t border-gray-100 bg-gray-50">
          <textarea
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono resize-y min-h-[80px] focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
            rows={4}
            autoFocus
          />
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={() => handleAction(editingAction)}
              disabled={actionLoading !== null}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {actionLoading === editingAction.label ? 'Sending…' : 'Send Edited'}
            </button>
            <button
              onClick={handleCancelEdit}
              className="px-3 py-1.5 text-xs font-medium rounded-md text-gray-600 hover:bg-gray-200"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      {!editingAction && (
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
                {isLoading ? '…' : action.label}
              </button>
            );
          })}

          {/* Feedback toast */}
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
