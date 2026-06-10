import { assertEquals } from 'https://deno.land/std@0.210.0/assert/assert_equals.ts';
import { isValidModelId } from './model-validation.ts';

Deno.test('model validation accepts provider-native model IDs', () => {
  const valid = [
    'gpt-4o-mini',
    'gemini-3-flash-preview',
    'deepseek-v4-flash',
    'grok-4.20-reasoning',
    'minimaxai/minimax-m2.7',
    'deepseek/deepseek-v4-flash',
    'deepseek-ai/deepseek-v4-pro',
    'google/gemini-3.1-flash-lite-preview:nitro',
  ];

  for (const model of valid) {
    assertEquals(isValidModelId(model), true, model);
  }
});

Deno.test('model validation rejects empty, unsafe, or malformed model IDs', () => {
  const invalid = [
    '',
    ' gpt-4o-mini',
    'gpt 4o',
    'https://api.example.com/model',
    '/deepseek-v4-flash',
    'deepseek/',
    'deepseek//deepseek-v4-flash',
    '../deepseek-v4-flash',
    'deepseek-v4-flash?key=value',
  ];

  for (const model of invalid) {
    assertEquals(isValidModelId(model), false, model);
  }
});
