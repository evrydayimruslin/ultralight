// RPC AI Binding for Dynamic Workers
// Wraps AI service calls behind a WorkerEntrypoint.
// The Dynamic Worker sees env.AI.call() but never has the API key.

import { WorkerEntrypoint } from 'cloudflare:workers';
import { getEnv } from '../../lib/env.ts';

// ============================================
// TYPES
// ============================================

interface AIBindingProps {
  userId: string;
  apiKey: string | null;
  provider: string | null;
}

interface AIRequest {
  model?: string;
  messages: Array<{ role: string; content: string }>;
  max_tokens?: number;
  temperature?: number;
}

// ============================================
// RPC BINDING
// ============================================

export class AIBinding extends WorkerEntrypoint<unknown, AIBindingProps> {

  async call(request: AIRequest) {
    const { apiKey, provider } = this.ctx.props;

    if (!apiKey || !provider) {
      return {
        content: '',
        model: 'none',
        usage: { input_tokens: 0, output_tokens: 0, cost_light: 0 },
        error: 'BYOK not configured. Please add your API key in Settings.',
      };
    }

    // Route through OpenRouter (same as existing AI service)
    const openRouterKey = apiKey;
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://ultralight.dev',
        'X-Title': 'Ultralight',
      },
      body: JSON.stringify({
        model: request.model || 'openai/gpt-4o-mini',
        messages: request.messages,
        max_tokens: request.max_tokens || 4096,
        temperature: request.temperature ?? 0.7,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return {
        content: '',
        model: request.model || 'unknown',
        usage: { input_tokens: 0, output_tokens: 0, cost_light: 0 },
        error: `AI call failed (${response.status}): ${errText}`,
      };
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
      model: string;
      usage: { prompt_tokens: number; completion_tokens: number };
    };

    return {
      content: data.choices?.[0]?.message?.content || '',
      model: data.model || request.model || 'unknown',
      usage: {
        input_tokens: data.usage?.prompt_tokens || 0,
        output_tokens: data.usage?.completion_tokens || 0,
        cost_light: 0, // Computed by caller
      },
    };
  }
}
