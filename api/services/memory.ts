// Memory Service Implementation
// Handles remember/recall operations

import type { MemoryEntry } from '../../shared/types/index.ts';

export interface SupabaseConfig {
  url: string;
  serviceKey: string;
}

export class MemoryService {
  private supabaseUrl: string;
  private supabaseKey: string;

  constructor(config: SupabaseConfig) {
    this.supabaseUrl = config.url;
    this.supabaseKey = config.serviceKey;
  }

  async remember(userId: string, scope: string, key: string, value: unknown): Promise<void> {
    const url = `${this.supabaseUrl}/rest/v1/memory`;

    const entry = {
      user_id: userId,
      scope,
      key,
      value,
      updated_at: new Date().toISOString(),
    };

    // Upsert: insert or update on conflict
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.supabaseKey}`,
        'apikey': this.supabaseKey,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates', // Upsert
      },
      body: JSON.stringify(entry),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Memory write failed: ${error}`);
    }
  }

  async recall(userId: string, scope: string, key: string): Promise<unknown> {
    const url = new URL(`${this.supabaseUrl}/rest/v1/memory`);
    url.searchParams.set('user_id', `eq.${userId}`);
    url.searchParams.set('scope', `eq.${scope}`);
    url.searchParams.set('key', `eq.${key}`);
    url.searchParams.set('select', 'value');
    url.searchParams.set('limit', '1');

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.supabaseKey}`,
        'apikey': this.supabaseKey,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Memory read failed: ${error}`);
    }

    const results = await response.json();
    return results[0]?.value ?? null;
  }

  /**
   * Query memory with filtering
   */
  async query(
    userId: string,
    options: {
      scope?: string;
      keyPrefix?: string;
      limit?: number;
    } = {},
  ): Promise<Array<{ key: string; value: unknown }>> {
    const url = new URL(`${this.supabaseUrl}/rest/v1/memory`);
    url.searchParams.set('user_id', `eq.${userId}`);

    if (options.scope) {
      url.searchParams.set('scope', `eq.${options.scope}`);
    }

    if (options.keyPrefix) {
      url.searchParams.set('key', `like.${options.keyPrefix}*`);
    }

    url.searchParams.set('select', 'key,value');
    url.searchParams.set('limit', String(options.limit || 100));
    url.searchParams.set('order', 'updated_at.desc');

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.supabaseKey}`,
        'apikey': this.supabaseKey,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Memory query failed: ${error}`);
    }

    return await response.json();
  }

  /**
   * Delete a memory entry
   */
  async forget(userId: string, scope: string, key: string): Promise<void> {
    const url = new URL(`${this.supabaseUrl}/rest/v1/memory`);
    url.searchParams.set('user_id', `eq.${userId}`);
    url.searchParams.set('scope', `eq.${scope}`);
    url.searchParams.set('key', `eq.${key}`);

    const response = await fetch(url.toString(), {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${this.supabaseKey}`,
        'apikey': this.supabaseKey,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Memory delete failed: ${error}`);
    }
  }
}

// Factory function
export function createMemoryService(): MemoryService {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!url || !key) {
    throw new Error('Supabase credentials not configured');
  }

  return new MemoryService({ url, serviceKey: key });
}
