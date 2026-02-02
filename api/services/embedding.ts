// Embedding Service
// Uses OpenRouter to generate embeddings for semantic search
// Default model: text-embedding-3-small (OpenAI via OpenRouter)

// @ts-ignore - Deno is available in Deno Deploy
const Deno = globalThis.Deno;

// ============================================
// TYPES
// ============================================

export interface EmbeddingConfig {
  apiKey: string;
  model?: string;
}

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

// ============================================
// CONSTANTS
// ============================================

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/embeddings';
const DEFAULT_MODEL = 'openai/text-embedding-3-small';

// ============================================
// EMBEDDING SERVICE
// ============================================

export class EmbeddingService {
  private apiKey: string;
  private model: string;

  constructor(config: EmbeddingConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model || DEFAULT_MODEL;
  }

  /**
   * Generate embedding for a single text input
   */
  async embed(text: string): Promise<EmbeddingResult> {
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://ultralight.dev',
        'X-Title': 'Ultralight',
      },
      body: JSON.stringify({
        model: this.model,
        input: text,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Embedding API error: ${response.status} - ${error}`);
    }

    const result = await response.json();

    if (!result.data?.[0]?.embedding) {
      throw new Error('Invalid embedding response: missing embedding data');
    }

    return {
      embedding: result.data[0].embedding,
      model: result.model || this.model,
      usage: result.usage || { prompt_tokens: 0, total_tokens: 0 },
    };
  }

  /**
   * Generate embeddings for multiple texts (batch)
   */
  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    // OpenRouter supports batch embeddings
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://ultralight.dev',
        'X-Title': 'Ultralight',
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Embedding API error: ${response.status} - ${error}`);
    }

    const result = await response.json();

    if (!result.data || !Array.isArray(result.data)) {
      throw new Error('Invalid embedding response: missing data array');
    }

    // Sort by index to ensure correct order
    const sortedData = result.data.sort((a: { index: number }, b: { index: number }) => a.index - b.index);

    return sortedData.map((item: { embedding: number[] }) => ({
      embedding: item.embedding,
      model: result.model || this.model,
      usage: {
        prompt_tokens: Math.floor((result.usage?.prompt_tokens || 0) / texts.length),
        total_tokens: Math.floor((result.usage?.total_tokens || 0) / texts.length),
      },
    }));
  }
}

// ============================================
// FACTORY
// ============================================

/**
 * Create an embedding service using user's BYOK API key
 * Returns null if no API key is available
 */
export function createEmbeddingService(userApiKey?: string): EmbeddingService | null {
  // Try user's BYOK key first
  if (userApiKey) {
    return new EmbeddingService({ apiKey: userApiKey });
  }

  // Try system-level key as fallback (for discovery indexing)
  const systemKey = Deno?.env?.get('OPENROUTER_API_KEY');
  if (systemKey) {
    return new EmbeddingService({ apiKey: systemKey });
  }

  return null;
}

/**
 * Check if embedding service is available
 */
export function isEmbeddingAvailable(userApiKey?: string): boolean {
  if (userApiKey) return true;
  return !!Deno?.env?.get('OPENROUTER_API_KEY');
}

// ============================================
// EMBEDDING STORAGE (Supabase)
// ============================================

/**
 * Store embedding for an app in Supabase
 * Uses the skills_embedding column with pgvector
 */
export async function storeAppEmbedding(
  appId: string,
  embedding: number[]
): Promise<void> {
  const supabaseUrl = Deno?.env?.get('SUPABASE_URL');
  const supabaseKey = Deno?.env?.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase credentials not configured');
  }

  // Format embedding as pgvector format: [x,y,z,...]
  const vectorString = `[${embedding.join(',')}]`;

  const response = await fetch(`${supabaseUrl}/rest/v1/apps?id=eq.${appId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${supabaseKey}`,
      'apikey': supabaseKey,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({
      skills_embedding: vectorString,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to store embedding: ${response.status} - ${error}`);
  }
}

/**
 * Search apps by semantic similarity
 * Uses the search_apps RPC function with pgvector
 */
export async function searchAppsByEmbedding(
  queryEmbedding: number[],
  userId: string,
  options: {
    limit?: number;
    threshold?: number;
  } = {}
): Promise<Array<{
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_public: boolean;
  owner_id: string;
  similarity: number;
}>> {
  const supabaseUrl = Deno?.env?.get('SUPABASE_URL');
  const supabaseKey = Deno?.env?.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase credentials not configured');
  }

  const { limit = 20, threshold = 0.5 } = options;

  // Format embedding as pgvector format
  const vectorString = `[${queryEmbedding.join(',')}]`;

  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/search_apps`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${supabaseKey}`,
      'apikey': supabaseKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query_embedding: vectorString,
      match_threshold: threshold,
      match_count: limit,
      p_user_id: userId,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to search apps: ${response.status} - ${error}`);
  }

  return await response.json();
}

/**
 * Clear embedding for an app
 * Used when skills are deleted or app is unpublished
 */
export async function clearAppEmbedding(appId: string): Promise<void> {
  const supabaseUrl = Deno?.env?.get('SUPABASE_URL');
  const supabaseKey = Deno?.env?.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase credentials not configured');
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/apps?id=eq.${appId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${supabaseKey}`,
      'apikey': supabaseKey,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({
      skills_embedding: null,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to clear embedding: ${response.status} - ${error}`);
  }
}
