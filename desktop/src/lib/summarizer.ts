// Message summarization — compresses old messages to fit within context.
// Makes an extra LLM call to generate a summary of earlier conversation.

import { streamChat, type ChatMessage } from './api';
import { KEEP_RECENT } from './tokens';
import { getInferencePreference } from './storage';

/**
 * Find a safe split point in the message array.
 * Never splits in the middle of a tool-call sequence
 * (assistant with tool_calls → tool result messages must stay together).
 */
export function findSplitPoint(messages: ChatMessage[]): number {
  // We want to keep the most recent KEEP_RECENT messages.
  // Walk backward from (length - KEEP_RECENT) to find a safe split.
  const idealSplit = Math.max(0, messages.length - KEEP_RECENT);

  // Walk backward from idealSplit to find a safe boundary
  for (let i = idealSplit; i >= 0; i--) {
    const msg = messages[i];
    // Safe to split before a user message (new turn)
    if (msg.role === 'user') {
      return i;
    }
    // Safe to split before an assistant message that has no tool calls
    if (msg.role === 'assistant' && !msg.tool_calls?.length) {
      return i;
    }
  }

  // If we can't find a safe split, just use the ideal point
  return idealSplit;
}

/**
 * Summarize older messages into a single summary message.
 * Returns the new message array with the summary prepended to recent messages.
 */
export async function summarizeMessages(
  messages: ChatMessage[],
  model: string,
): Promise<ChatMessage[]> {
  const splitAt = findSplitPoint(messages);

  if (splitAt <= 0) {
    // Nothing to summarize
    return messages;
  }

  const toSummarize = messages.slice(0, splitAt);
  const toKeep = messages.slice(splitAt);

  // Build a summary prompt
  const summaryPrompt: ChatMessage[] = [
    {
      role: 'system',
      content:
        'Summarize the following conversation history concisely. ' +
        'Focus on: key decisions made, files modified, errors encountered, ' +
        'and the current state of the task. Use bullet points. Be brief.',
    },
    {
      role: 'user',
      content: toSummarize
        .map((m) => {
          if (m.role === 'tool') {
            // Truncate long tool results
            const content = m.content.length > 500
              ? m.content.slice(0, 500) + '...(truncated)'
              : m.content;
            return `[Tool Result]: ${content}`;
          }
          if (m.role === 'assistant' && m.tool_calls?.length) {
            const calls = m.tool_calls
              .map((tc) => `${tc.function.name}(${tc.function.arguments.slice(0, 100)})`)
              .join(', ');
            return `Assistant: ${m.content}\n[Called: ${calls}]`;
          }
          return `${m.role}: ${m.content}`;
        })
        .join('\n\n'),
    },
  ];

  // Make a small LLM call for the summary
  let summaryText = '';
  try {
    for await (const event of streamChat({
      model,
      messages: summaryPrompt,
      max_tokens: 1024,
      temperature: 0.3,
      inference: getInferencePreference() ?? undefined,
      trace: {
        source: 'conversation_summary',
      },
    })) {
      if (event.type === 'delta' && event.content) {
        summaryText += event.content;
      }
    }
  } catch {
    // If summarization fails, just truncate the oldest messages
    summaryText = `[Previous conversation with ${toSummarize.length} messages was truncated to fit context window]`;
  }

  // Build the new message array
  const summaryMessage: ChatMessage = {
    role: 'system',
    content: `[Previous conversation summary]\n${summaryText}`,
  };

  return [summaryMessage, ...toKeep];
}
