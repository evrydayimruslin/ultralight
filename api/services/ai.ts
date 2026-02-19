// AI Service Implementation (BYOK)
// Single provider: OpenRouter (covers 100+ models via one API key)

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
// PROVIDER CONFIGURATION (OpenRouter only)
// ============================================

const OPENROUTER_CONFIG: ProviderConfig = {
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
};

// All providers route through OpenRouter (legacy provider values accepted but use OpenRouter)
const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  openrouter: OPENROUTER_CONFIG,
  // Legacy providers — route through OpenRouter
  openai: OPENROUTER_CONFIG,
  anthropic: OPENROUTER_CONFIG,
  deepseek: OPENROUTER_CONFIG,
  moonshot: OPENROUTER_CONFIG,
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
    this.defaultModel = config.defaultModel || OPENROUTER_CONFIG.defaultModel;
  }

  /**
   * Make an AI call using OpenRouter
   */
  async call(request: AIRequest): Promise<AIResponse> {
    const providerConfig = PROVIDER_CONFIGS[this.provider] || OPENROUTER_CONFIG;
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

      throw new Error(`OpenRouter API error (${response.status}): ${errorMessage}`);
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
 * Create an AI service for a specific provider with an API key.
 * All providers now route through OpenRouter.
 */
export function createAIService(provider: BYOKProvider = 'openrouter', apiKey: string = '', defaultModel?: string): AIService {
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
  return ['openrouter'];
}

/**
 * Get the default model for a provider
 */
export function getDefaultModel(_provider: BYOKProvider): string {
  return OPENROUTER_CONFIG.defaultModel;
}
