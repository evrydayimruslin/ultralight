// AI Service Implementation (BYOK)
// Handles calls to OpenRouter using user's own API key

import type { AIRequest, AIResponse } from '../../shared/types/index.ts';

export interface OpenRouterConfig {
  apiKey: string;
  defaultModel?: string;
}

export class AIService {
  private defaultModel: string;

  constructor(config?: { defaultModel?: string }) {
    this.defaultModel = config?.defaultModel || 'openrouter/auto';
  }

  async call(request: AIRequest, apiKey: string): Promise<AIResponse> {
    const model = request.model || this.defaultModel;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://ultralight.io', // Required by OpenRouter
        'X-Title': 'Ultralight',
      },
      body: JSON.stringify({
        model,
        messages: request.messages,
        temperature: request.temperature ?? 0.7,
        max_tokens: request.max_tokens,
        tools: request.tools,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter error: ${response.status} - ${error}`);
    }

    const data = await response.json();

    return {
      content: data.choices[0]?.message?.content || '',
      model: data.model,
      usage: {
        input_tokens: data.usage?.prompt_tokens || 0,
        output_tokens: data.usage?.completion_tokens || 0,
        cost_cents: 0, // User pays directly, we don't track
      },
    };
  }
}

// Factory function - no platform API key needed (BYOK only)
export function createAIService(): AIService {
  return new AIService({
    defaultModel: 'openrouter/auto',
  });
}
