// Scrollable message thread with auto-scroll on new content.

import { useEffect, useRef } from 'react';
import type { Message } from '../hooks/useChat';
import MessageBubble from './MessageBubble';

interface MessageListProps {
  messages: Message[];
  isLoading: boolean;
}

export default function MessageList({ messages, isLoading }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const userScrolled = useRef(false);

  // Build tool results map: tool_call_id → result content
  const toolResults = new Map<string, string>();
  for (const msg of messages) {
    if (msg.role === 'tool' && msg.tool_call_id) {
      toolResults.set(msg.tool_call_id, msg.content);
    }
  }

  // Track if user has scrolled up manually
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      userScrolled.current = scrollHeight - scrollTop - clientHeight > 80;
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  // Auto-scroll to bottom on new messages (unless user scrolled up)
  useEffect(() => {
    if (!userScrolled.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Filter out tool messages (they render inside ToolCallCard)
  const visibleMessages = messages.filter(m => m.role !== 'tool');

  if (visibleMessages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-h3 text-ul-text mb-2">Ultralight Chat</h2>
          <p className="text-body text-ul-text-muted max-w-sm">
            Ask anything. Your messages are processed through the Ultralight platform
            with access to deployed apps and tools.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto px-4 py-4"
    >
      <div className="max-w-narrow mx-auto">
        {visibleMessages.map(msg => (
          <MessageBubble
            key={msg.id}
            message={msg}
            toolResults={toolResults}
            toolsExecuting={isLoading}
          />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
