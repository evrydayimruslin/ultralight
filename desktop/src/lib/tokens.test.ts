// Tests for token counting and context window management.

import { describe, it, expect } from 'vitest';
import {
  getContextWindow,
  countTokens,
  countMessageTokens,
  countAllTokens,
  shouldSummarize,
  SUMMARIZE_THRESHOLD,
} from './tokens';

// ── getContextWindow ──

describe('getContextWindow', () => {
  it('returns 200k for Claude models', () => {
    expect(getContextWindow('anthropic/claude-sonnet-4-20250514')).toBe(200_000);
    expect(getContextWindow('anthropic/claude-3.5-sonnet')).toBe(200_000);
    expect(getContextWindow('anthropic/claude-3-opus')).toBe(200_000);
  });

  it('returns 128k for GPT-4o models', () => {
    expect(getContextWindow('openai/gpt-4o')).toBe(128_000);
    expect(getContextWindow('openai/gpt-4o-mini')).toBe(128_000);
  });

  it('returns 1M for Gemini models', () => {
    expect(getContextWindow('google/gemini-pro-1.5')).toBe(1_000_000);
  });

  it('returns 64k for DeepSeek models', () => {
    expect(getContextWindow('deepseek/deepseek-chat')).toBe(64_000);
  });

  it('returns default 128k for unknown models', () => {
    expect(getContextWindow('some/unknown-model')).toBe(128_000);
  });
});

// ── countTokens ──

describe('countTokens', () => {
  it('returns 0 for empty string', () => {
    expect(countTokens('')).toBe(0);
  });

  it('counts tokens for simple text', () => {
    const count = countTokens('Hello, world!');
    // GPT tokenizer should produce ~4 tokens for "Hello, world!"
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(20);
  });

  it('counts tokens for longer text', () => {
    const text = 'The quick brown fox jumps over the lazy dog. '.repeat(10);
    const count = countTokens(text);
    expect(count).toBeGreaterThan(50);
    expect(count).toBeLessThan(200);
  });

  it('handles code content', () => {
    const code = 'function hello() {\n  console.log("Hello, world!");\n}\n';
    const count = countTokens(code);
    expect(count).toBeGreaterThan(5);
    expect(count).toBeLessThan(50);
  });
});

// ── countMessageTokens ──

describe('countMessageTokens', () => {
  it('counts a simple user message', () => {
    const count = countMessageTokens({
      role: 'user',
      content: 'What is 2+2?',
    });
    // Content tokens + ~4 overhead
    expect(count).toBeGreaterThan(4);
    expect(count).toBeLessThan(20);
  });

  it('counts a message with tool calls', () => {
    const count = countMessageTokens({
      role: 'assistant',
      content: 'Let me check that.',
      tool_calls: [
        {
          id: 'call_123',
          type: 'function',
          function: {
            name: 'file_read',
            arguments: '{"path": "src/index.ts"}',
          },
        },
      ],
    });
    // Should be more than just the content
    expect(count).toBeGreaterThan(10);
  });

  it('counts empty content', () => {
    const count = countMessageTokens({
      role: 'assistant',
      content: '',
    });
    // Just overhead
    expect(count).toBe(4);
  });
});

// ── countAllTokens ──

describe('countAllTokens', () => {
  it('counts a conversation', () => {
    const count = countAllTokens([
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello!' },
      { role: 'assistant', content: 'Hi there! How can I help you?' },
    ]);
    expect(count).toBeGreaterThan(15);
    expect(count).toBeLessThan(100);
  });

  it('returns minimal count for empty conversation', () => {
    const count = countAllTokens([]);
    expect(count).toBe(3); // conversation overhead only
  });
});

// ── shouldSummarize ──

describe('shouldSummarize', () => {
  it('returns false when under threshold', () => {
    // 200k context, 40% threshold = 80k
    expect(shouldSummarize(10_000, 'anthropic/claude-sonnet-4-20250514')).toBe(false);
    expect(shouldSummarize(70_000, 'anthropic/claude-sonnet-4-20250514')).toBe(false);
  });

  it('returns true when over threshold', () => {
    // 200k * 0.4 = 80k
    expect(shouldSummarize(90_000, 'anthropic/claude-sonnet-4-20250514')).toBe(true);
    expect(shouldSummarize(200_000, 'anthropic/claude-sonnet-4-20250514')).toBe(true);
  });

  it('uses model-specific context window', () => {
    // DeepSeek = 64k, threshold = 25.6k
    expect(shouldSummarize(50_000, 'deepseek/deepseek-chat')).toBe(true);
    // Same token count OK for Claude (200k context)
    expect(shouldSummarize(50_000, 'anthropic/claude-sonnet-4-20250514')).toBe(false);
  });

  it('has threshold at 40%', () => {
    expect(SUMMARIZE_THRESHOLD).toBe(0.4);
  });
});
