// Individual message bubble — renders user, assistant, and tool messages.

import ReactMarkdown from 'react-markdown';
import type { Message } from '../hooks/useChat';
import ToolCallCard from './ToolCallCard';

interface MessageBubbleProps {
  message: Message;
  /** Tool result content keyed by tool_call_id */
  toolResults?: Map<string, string>;
  /** Whether this message's tool calls are being executed */
  toolsExecuting?: boolean;
}

export default function MessageBubble({ message, toolResults, toolsExecuting }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isTool = message.role === 'tool';
  const isAssistant = message.role === 'assistant';

  // Don't render tool result messages directly — they show in ToolCallCard
  if (isTool) return null;

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div
        className={`max-w-[85%] ${
          isUser
            ? 'bg-ul-accent text-white rounded-xl rounded-br-sm px-4 py-2.5'
            : 'rounded-xl px-1'
        }`}
      >
        {/* User message — plain text */}
        {isUser && (
          <p className="text-body selectable whitespace-pre-wrap">{message.content}</p>
        )}

        {/* Assistant message — markdown */}
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

            {/* Text content */}
            {message.content && (
              <div className="markdown-body text-ul-text">
                <ReactMarkdown>{message.content}</ReactMarkdown>
              </div>
            )}

            {/* Empty state — typing indicator */}
            {!message.content && !message.tool_calls?.length && (
              <div className="flex items-center gap-1 py-2 px-1">
                <span className="typing-dot w-1.5 h-1.5 rounded-full bg-ul-text-muted" />
                <span className="typing-dot w-1.5 h-1.5 rounded-full bg-ul-text-muted" />
                <span className="typing-dot w-1.5 h-1.5 rounded-full bg-ul-text-muted" />
              </div>
            )}

            {/* Cost display */}
            {message.cost_cents !== undefined && message.cost_cents > 0 && (
              <p className="text-caption text-ul-text-muted mt-1">
                {message.cost_cents < 1
                  ? `${(message.cost_cents * 10).toFixed(1)}‰¢`
                  : `${message.cost_cents.toFixed(2)}¢`
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
