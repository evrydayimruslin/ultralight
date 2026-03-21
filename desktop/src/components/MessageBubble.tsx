// Individual message bubble — renders user, assistant, and tool messages.

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
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
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
              </div>
            )}

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
