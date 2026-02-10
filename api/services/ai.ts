// AI Service Implementation (BYOK)
// Multi-provider support: OpenRouter, OpenAI, Anthropic, DeepSeek, Moonshot

import type { AIRequest, AIResponse, BYOKProvider } from '../../shared/types/index.ts';

// ============================================
// TYPES
// ============================================

export interface AIServiceConfig {
  provider: BYOKProvider;
  apiKey: string;
  defaultModel?: string;
}

interface ProviderConfig {
  baseUrl: string;
  defaultModel: string;
  formatRequest: (request: AIRequest, model: string) => unknown;
  formatHeaders: (apiKey: string) => Record<string, string>;
  parseResponse: (data: unknown) => AIResponse;
  endpoint: string;
}

// ============================================
// PROVIDER CONFIGURATIONS
// ============================================

const PROVIDER_CONFIGS: Record<BYOKProvider, ProviderConfig> = {
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    endpoint: '/chat/completions',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    formatHeaders: (apiKey: string) => ({
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://ultralight.dev',
      'X-Title': 'Ultralight',
    }),
    formatRequest: (request: AIRequest, model: string) => ({
      model,
      messages: request.messages,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.max_tokens,
      tools: request.tools,
    }),
    parseResponse: (data: unknown): AIResponse => {
      const d = data as {
        choices?: Array<{ message?: { content?: string } }>;
        model?: string;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      return {
        content: d.choices?.[0]?.message?.content || '',
        model: d.model || 'unknown',
        usage: {
          input_tokens: d.usage?.prompt_tokens || 0,
          output_tokens: d.usage?.completion_tokens || 0,
          cost_cents: 0,
        },
      };
    },
  },

  openai: {
    baseUrl: 'https://api.openai.com/v1',
    endpoint: '/chat/completions',
    defaultModel: 'gpt-4o',
    formatHeaders: (apiKey: string) => ({
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    }),
    formatRequest: (request: AIRequest, model: string) => ({
      model,
      messages: request.messages,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.max_tokens,
      tools: request.tools?.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      })),
    }),
    parseResponse: (data: unknown): AIResponse => {
      const d = data as {
        choices?: Array<{ message?: { content?: string } }>;
        model?: string;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      return {
        content: d.choices?.[0]?.message?.content || '',
        model: d.model || 'unknown',
        usage: {
          input_tokens: d.usage?.prompt_tokens || 0,
          output_tokens: d.usage?.completion_tokens || 0,
          cost_cents: 0,
        },
      };
    },
  },

  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1',
    endpoint: '/messages',
    defaultModel: 'claude-3-5-sonnet-20241022',
    formatHeaders: (apiKey: string) => ({
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    }),
    formatRequest: (request: AIRequest, model: string) => {
      // Anthropic has different message format - extract system message
      const systemMessage = request.messages.find(m => m.role === 'system');
      const otherMessages = request.messages.filter(m => m.role !== 'system');

      return {
        model,
        max_tokens: request.max_tokens || 4096,
        system: systemMessage?.content,
        messages: otherMessages.map(m => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content,
        })),
        temperature: request.temperature ?? 0.7,
        tools: request.tools?.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        })),
      };
    },
    parseResponse: (data: unknown): AIResponse => {
      const d = data as {
        content?: Array<{ type: string; text?: string }>;
        model?: string;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const textContent = d.content?.find(c => c.type === 'text');
      return {
        content: textContent?.text || '',
        model: d.model || 'unknown',
        usage: {
          input_tokens: d.usage?.input_tokens || 0,
          output_tokens: d.usage?.output_tokens || 0,
          cost_cents: 0,
        },
      };
    },
  },

  deepseek: {
    baseUrl: 'https://api.deepseek.com',
    endpoint: '/chat/completions',
    defaultModel: 'deepseek-chat',
    formatHeaders: (apiKey: string) => ({
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    }),
    formatRequest: (request: AIRequest, model: string) => ({
      model,
      messages: request.messages,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.max_tokens,
    }),
    parseResponse: (data: unknown): AIResponse => {
      const d = data as {
        choices?: Array<{ message?: { content?: string } }>;
        model?: string;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      return {
        content: d.choices?.[0]?.message?.content || '',
        model: d.model || 'unknown',
        usage: {
          input_tokens: d.usage?.prompt_tokens || 0,
          output_tokens: d.usage?.completion_tokens || 0,
          cost_cents: 0,
        },
      };
    },
  },

  moonshot: {
    baseUrl: 'https://api.moonshot.cn/v1',
    endpoint: '/chat/completions',
    defaultModel: 'moonshot-v1-8k',
    formatHeaders: (apiKey: string) => ({
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    }),
    formatRequest: (request: AIRequest, model: string) => ({
      model,
      messages: request.messages,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.max_tokens,
    }),
    parseResponse: (data: unknown): AIResponse => {
      const d = data as {
        choices?: Array<{ message?: { content?: string } }>;
        model?: string;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      return {
        content: d.choices?.[0]?.message?.content || '',
        model: d.model || 'unknown',
        usage: {
          input_tokens: d.usage?.prompt_tokens || 0,
          output_tokens: d.usage?.completion_tokens || 0,
          cost_cents: 0,
        },
      };
    },
  },
};

// ============================================
// AI SERVICE CLASS
// ============================================

export class AIService {
  private provider: BYOKProvider;
  private apiKey: string;
  private defaultModel: string;

  constructor(config: AIServiceConfig) {
    this.provider = config.provider;
    this.apiKey = config.apiKey;
    this.defaultModel = config.defaultModel || PROVIDER_CONFIGS[config.provider].defaultModel;
  }

  /**
   * Make an AI call using the configured provider
   */
  async call(request: AIRequest): Promise<AIResponse> {
    const providerConfig = PROVIDER_CONFIGS[this.provider];
    const model = request.model || this.defaultModel;

    const url = `${providerConfig.baseUrl}${providerConfig.endpoint}`;
    const headers = providerConfig.formatHeaders(this.apiKey);
    const body = providerConfig.formatRequest(request, model);

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage: string;

      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error?.message || errorJson.message || errorText;
      } catch {
        errorMessage = errorText;
      }

      throw new Error(`${this.provider} API error (${response.status}): ${errorMessage}`);
    }

    const data = await response.json();
    return providerConfig.parseResponse(data);
  }

  /**
   * Get the current provider
   */
  getProvider(): BYOKProvider {
    return this.provider;
  }

  /**
   * Get the default model for this service
   */
  getDefaultModel(): string {
    return this.defaultModel;
  }
}

// ============================================
// FACTORY FUNCTIONS
// ============================================

/**
 * Create an AI service for a specific provider with an API key
 */
export function createAIService(provider: BYOKProvider, apiKey: string, defaultModel?: string): AIService {
  return new AIService({
    provider,
    apiKey,
    defaultModel,
  });
}

/**
 * Validate an API key by making a minimal request
 * Returns true if the key is valid, throws an error otherwise
 */
export async function validateAPIKey(provider: BYOKProvider, apiKey: string): Promise<boolean> {
  const service = createAIService(provider, apiKey);

  try {
    // Make a minimal request to validate the key
    await service.call({
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 1,
    });
    return true;
  } catch (error) {
    // Check if it's an auth error vs other error
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('401') || message.includes('403') || message.includes('invalid') || message.includes('unauthorized')) {
      throw new Error(`Invalid API key for ${provider}`);
    }
    // For other errors (rate limit, etc), assume key is valid
    return true;
  }
}

/**
 * Get the list of supported providers
 */
export function getSupportedProviders(): BYOKProvider[] {
  return Object.keys(PROVIDER_CONFIGS) as BYOKProvider[];
}

/**
 * Get the default model for a provider
 */
export function getDefaultModel(provider: BYOKProvider): string {
  return PROVIDER_CONFIGS[provider].defaultModel;
}
