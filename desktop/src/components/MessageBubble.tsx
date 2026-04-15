// Individual message bubble — renders user, assistant, and tool messages.
// Detects {{widget:name:app_id}} tokens in assistant responses and renders
// cached widget iframes inline with the markdown content.

import { useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message } from '../hooks/useChat';
import ToolCallCard from './ToolCallCard';
import InChatWidget from './InChatWidget';
import DiscoverWidget from './DiscoverWidget';
import { executeAppMcpTool } from '../lib/api';

interface MessageBubbleProps {
  message: Message;
  /** Tool result content keyed by tool_call_id */
  toolResults?: Map<string, string>;
  /** Whether this message's tool calls are being executed */
  toolsExecuting?: boolean;
}

// ── Widget Token Parsing ──

interface ContentSegment {
  type: 'text' | 'widget' | 'discover';
  content: string;       // markdown text for 'text' segments
  widgetName?: string;    // e.g. "email_inbox"
  appId?: string;         // e.g. "d90a446c-..."
  discoverQuery?: string; // search query for discover widget
}

/** Regex to match {{widget:widget_name:app_uuid}} tokens */
const WIDGET_TOKEN_RE = /\{\{widget:([a-z0-9_]+):([a-f0-9-]{36})\}\}/g;
/** Regex to match {{discover:search query}} tokens */
const DISCOVER_TOKEN_RE = /\{\{discover:([^}]+)\}\}/g;

/** Split message content into text, widget, and discover segments */
function parseWidgetTokens(content: string): ContentSegment[] {
  // Combine both token patterns with their types
  const allMatches: Array<{ index: number; length: number; segment: ContentSegment }> = [];

  for (const match of content.matchAll(WIDGET_TOKEN_RE)) {
    allMatches.push({
      index: match.index!,
      length: match[0].length,
      segment: { type: 'widget', content: match[0], widgetName: match[1], appId: match[2] },
    });
  }

  for (const match of content.matchAll(DISCOVER_TOKEN_RE)) {
    allMatches.push({
      index: match.index!,
      length: match[0].length,
      segment: { type: 'discover', content: match[0], discoverQuery: match[1] },
    });
  }

  // Sort by position
  allMatches.sort((a, b) => a.index - b.index);

  const segments: ContentSegment[] = [];
  let lastIndex = 0;

  for (const m of allMatches) {
    if (m.index > lastIndex) {
      const text = content.slice(lastIndex, m.index).trim();
      if (text) segments.push({ type: 'text', content: text });
    }
    segments.push(m.segment);
    lastIndex = m.index + m.length;
  }

  if (lastIndex < content.length) {
    const text = content.slice(lastIndex).trim();
    if (text) segments.push({ type: 'text', content: text });
  }

  return segments;
}

// ── Inline Widget Loader ──

interface InlineWidgetProps {
  widgetName: string;
  appId: string;
}

function InlineWidget({ widgetName, appId }: InlineWidgetProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadWidget = useCallback(async () => {
    // 1. Check localStorage cache (shared with dashboard widgets)
    const cacheKey = `widget_app:${appId}:${widgetName}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        const { html: cachedHtml } = JSON.parse(cached);
        if (cachedHtml) {
          setHtml(cachedHtml);
          setLoading(false);
          return;
        }
      } catch { /* cache corrupt, fetch fresh */ }
    }

    // 2. Fetch fresh by calling the widget_ui function
    try {
      // We need to find the app slug to call the right function.
      // Try calling the widget function with unprefixed name (server accepts it).
      const uiFn = `widget_${widgetName}_ui`;
      const result = await executeAppMcpTool(appId, uiFn, {});
      if (result.isError) {
        setError('Failed to load widget');
        setLoading(false);
        return;
      }

      const text = result.content?.[0]?.text || '';
      const parsed = JSON.parse(text);

      if (parsed.app_html) {
        // Cache it
        localStorage.setItem(cacheKey, JSON.stringify({
          html: parsed.app_html,
          version: parsed.version || '1',
          cachedAt: Date.now(),
        }));
        setHtml(parsed.app_html);
      } else {
        setError('Widget returned no HTML');
      }
    } catch (e) {
      console.error('[InlineWidget] Failed to load:', e);
      setError('Failed to load widget');
    } finally {
      setLoading(false);
    }
  }, [appId, widgetName]);

  useEffect(() => {
    loadWidget();
  }, [loadWidget]);

  if (loading) {
    return (
      <div className="my-3 flex items-center gap-2 text-caption text-ul-text-muted py-4">
        <div className="w-4 h-4 rounded-full border-2 border-gray-300 border-t-gray-600 animate-spin" />
        Loading widget...
      </div>
    );
  }

  if (error || !html) {
    return (
      <div className="my-3 text-caption text-ul-text-muted py-2">
        Widget unavailable
      </div>
    );
  }

  return (
    <div className="my-3">
      <InChatWidget
        appUuid={appId}
        appSlug=""
        widgetName={widgetName}
        appHtml={html}
      />
    </div>
  );
}

// ── MessageBubble ──

export default function MessageBubble({ message, toolResults, toolsExecuting }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isTool = message.role === 'tool';
  const isAssistant = message.role === 'assistant';

  // Don't render tool result messages directly — they show in ToolCallCard
  if (isTool) return null;

  // Parse widget tokens from assistant content
  const segments = isAssistant && message.content
    ? parseWidgetTokens(message.content)
    : [];
  const hasWidgets = segments.some(s => s.type === 'widget' || s.type === 'discover');

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div
        className={`${
          isUser
            ? 'max-w-[85%] bg-ul-accent text-white rounded-xl rounded-br-sm px-4 py-2.5'
            : 'w-full rounded-xl px-1'
        }`}
      >
        {/* User message — plain text */}
        {isUser && (
          <p className="text-body selectable whitespace-pre-wrap">{message.content}</p>
        )}

        {/* Assistant message — markdown + inline widgets */}
        {isAssistant && (
          <div>
            {/* Tool calls (before or instead of text) */}
            {message.tool_calls?.map(tc => (
              <ToolCallCard
                key={tc.id}
                toolCall={tc}
                result={toolResults?.get(tc.id)}
                executing={toolsExecuting && !toolResults?.has(tc.id)}
              />
            ))}

            {/* Content with inline widgets */}
            {message.content && hasWidgets ? (
              <div className="markdown-body text-ul-text">
                {segments.map((seg, i) => {
                  if (seg.type === 'widget' && seg.widgetName && seg.appId) {
                    return (
                      <InlineWidget
                        key={`widget-${i}-${seg.appId}`}
                        widgetName={seg.widgetName}
                        appId={seg.appId}
                      />
                    );
                  }
                  if (seg.type === 'discover' && seg.discoverQuery) {
                    return (
                      <div key={`discover-${i}`} className="my-3">
                        <DiscoverWidget
                          query={seg.discoverQuery}
                          onInjectScope={(apps) => {
                            // Dispatch custom event — ChatView listens and updates agent scope
                            window.dispatchEvent(new CustomEvent('ul-inject-scope', { detail: { apps } }));
                          }}
                        />
                      </div>
                    );
                  }
                  return (
                    <ReactMarkdown key={`text-${i}`} remarkPlugins={[remarkGfm]}>
                      {seg.content}
                    </ReactMarkdown>
                  );
                })}
              </div>
            ) : message.content ? (
              <div className="markdown-body text-ul-text">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
              </div>
            ) : null}

            {/* Empty state — placeholder for streaming message that hasn't started yet */}
            {!message.content && !message.tool_calls?.length && (
              <div className="h-4" />
            )}

            {/* Cost display */}
            {message.cost_light !== undefined && message.cost_light > 0 && (
              <p className="text-caption text-ul-text-muted mt-1">
                {message.cost_light < 1
                  ? `✦${message.cost_light.toFixed(3)}`
                  : `✦${message.cost_light.toFixed(2)}`
                }
                {message.usage && (
                  <span className="ml-2">
                    {message.usage.prompt_tokens + message.usage.completion_tokens} tokens
                  </span>
                )}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
