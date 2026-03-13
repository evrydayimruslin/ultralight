// Token counting and context window management.
// Uses gpt-tokenizer for fast client-side token estimation.

import { encode } from 'gpt-tokenizer';
import type { ChatMessage } from './api';

// ── Context Window Sizes ──

/** Known context window sizes by model prefix */
const CONTEXT_WINDOWS: [string, number][] = [
  // Anthropic
  ['anthropic/claude', 200_000],
  // OpenAI
  ['openai/gpt-4o', 128_000],
  ['openai/gpt-4o-mini', 128_000],
  ['openai/o1', 200_000],
  ['openai/o3', 200_000],
  // Google
  ['google/gemini', 1_000_000],
  // DeepSeek
  ['deepseek/', 64_000],
];

/** Default context window if model not recognized */
const DEFAULT_CONTEXT = 128_000;

/**
 * Get the context window size for a model ID.
 */
export function getContextWindow(modelId: string): number {
  const lower = modelId.toLowerCase();
  for (const [prefix, size] of CONTEXT_WINDOWS) {
    if (lower.startsWith(prefix) || lower.includes(prefix)) {
      return size;
    }
  }
  return DEFAULT_CONTEXT;
}

// ── Token Counting ──

/**
 * Count tokens in a string. Uses GPT tokenizer as a reasonable
 * approximation across models (~10% variance for Claude).
 */
export function countTokens(text: string): number {
  if (!text) return 0;
  try {
    return encode(text).length;
  } catch {
    // Fallback: rough estimate (~4 chars per token)
    return Math.ceil(text.length / 4);
  }
}

/**
 * Count tokens in a single chat message.
 * Accounts for role overhead (~4 tokens per message for OpenAI format).
 */
export function countMessageTokens(msg: ChatMessage): number {
  let tokens = 4; // role overhead

  tokens += countTokens(msg.content);

  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      tokens += countTokens(tc.function.name);
      tokens += countTokens(tc.function.arguments);
      tokens += 4; // tool call overhead
    }
  }

  return tokens;
}

/**
 * Count total tokens across an array of messages.
 */
export function countAllTokens(messages: ChatMessage[]): number {
  let total = 3; // conversation overhead
  for (const msg of messages) {
    total += countMessageTokens(msg);
  }
  return total;
}

// ── Context Thresholds ──

/** Percentage of context window at which we trigger summarization */
export const SUMMARIZE_THRESHOLD = 0.7;

/** Minimum number of recent messages to keep verbatim (never summarize) */
export const KEEP_RECENT = 10;

/**
 * Check if context needs summarization.
 */
export function shouldSummarize(
  tokenCount: number,
  modelId: string,
): boolean {
  const window = getContextWindow(modelId);
  return tokenCount > window * SUMMARIZE_THRESHOLD;
}
