// Apps Service
// Handles app CRUD operations via Supabase

// @ts-ignore - Deno is available in Deno Deploy
const Deno = globalThis.Deno;

import type { App } from '../../shared/types/index.ts';

export interface SupabaseConfig {
  url: string;
  serviceKey: string;
}

export class AppsService {
  private supabaseUrl: string;
  private supabaseKey: string;

  constructor(config: SupabaseConfig) {
    this.supabaseUrl = config.url;
    this.supabaseKey = config.serviceKey;
  }

  /**
   * Create a new app record
   */
  async create(app: Partial<App>): Promise<App> {
    const url = `${this.supabaseUrl}/rest/v1/apps`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.supabaseKey}`,
        'apikey': this.supabaseKey,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify(app),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`App create failed: ${error}`);
    }

    const results = await response.json();
    return results[0];
  }

  /**
   * Find app by ID
   */
  async findById(appId: string): Promise<App | null> {
    const url = new URL(`${this.supabaseUrl}/rest/v1/apps`);
    url.searchParams.set('id', `eq.${appId}`);
    url.searchParams.set('select', '*');
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
      throw new Error(`App fetch failed: ${error}`);
    }

    const results = await response.json();
    return results[0] ?? null;
  }

  /**
   * List apps for a user
   */
  async listByOwner(userId: string): Promise<App[]> {
    const url = new URL(`${this.supabaseUrl}/rest/v1/apps`);
    url.searchParams.set('owner_id', `eq.${userId}`);
    url.searchParams.set('select', '*');
    url.searchParams.set('deleted_at', 'is.null');
    url.searchParams.set('order', 'created_at.desc');

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.supabaseKey}`,
        'apikey': this.supabaseKey,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`App list failed: ${error}`);
    }

    return await response.json();
  }

  /**
   * Update app
   */
  async update(appId: string, updates: Partial<App>): Promise<App> {
    const url = new URL(`${this.supabaseUrl}/rest/v1/apps`);
    url.searchParams.set('id', `eq.${appId}`);

    const response = await fetch(url.toString(), {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${this.supabaseKey}`,
        'apikey': this.supabaseKey,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify({
        ...updates,
        updated_at: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`App update failed: ${error}`);
    }

    const results = await response.json();
    return results[0];
  }

  /**
   * Increment run count using Supabase RPC for atomic increment
   */
  async incrementRuns(appId: string): Promise<void> {
    // Use Supabase RPC to atomically increment the counter
    const url = `${this.supabaseUrl}/rest/v1/rpc/increment_app_runs`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.supabaseKey}`,
        'apikey': this.supabaseKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ app_id: appId }),
    });

    if (!response.ok) {
      const error = await response.text();
      // Log but don't throw - run counting shouldn't break execution
      console.error(`App increment runs failed: ${error}`);
    }
  }

  /**
   * Find app by slug for a specific owner
   */
  async findBySlug(ownerId: string, slug: string): Promise<App | null> {
    const url = new URL(`${this.supabaseUrl}/rest/v1/apps`);
    url.searchParams.set('owner_id', `eq.${ownerId}`);
    url.searchParams.set('slug', `eq.${slug}`);
    url.searchParams.set('select', '*');
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
      throw new Error(`App fetch by slug failed: ${error}`);
    }

    const results = await response.json();
    return results[0] ?? null;
  }

  /**
   * List public apps
   */
  async listPublic(limit = 100): Promise<App[]> {
    const url = new URL(`${this.supabaseUrl}/rest/v1/apps`);
    url.searchParams.set('visibility', 'eq.public');
    url.searchParams.set('select', '*');
    url.searchParams.set('order', 'runs_30d.desc');
    url.searchParams.set('limit', String(limit));

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.supabaseKey}`,
        'apikey': this.supabaseKey,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`App list public failed: ${error}`);
    }

    return await response.json();
  }

  /**
   * Soft delete an app
   */
  async softDelete(appId: string): Promise<void> {
    const url = new URL(`${this.supabaseUrl}/rest/v1/apps`);
    url.searchParams.set('id', `eq.${appId}`);

    const response = await fetch(url.toString(), {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${this.supabaseKey}`,
        'apikey': this.supabaseKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`App soft delete failed: ${error}`);
    }
  }

  /**
   * Update embedding for an app
   */
  async updateEmbedding(appId: string, embedding: number[]): Promise<void> {
    // Use RPC function to update embedding (pgvector column)
    const url = `${this.supabaseUrl}/rest/v1/rpc/update_app_embedding`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.supabaseKey}`,
        'apikey': this.supabaseKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_app_id: appId,
        p_embedding: embedding,
      }),
    });

    if (!response.ok) {
      // Try direct update as fallback
      const directUrl = new URL(`${this.supabaseUrl}/rest/v1/apps`);
      directUrl.searchParams.set('id', `eq.${appId}`);

      const directResponse = await fetch(directUrl.toString(), {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${this.supabaseKey}`,
          'apikey': this.supabaseKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          skills_embedding: `[${embedding.join(',')}]`,
          updated_at: new Date().toISOString(),
        }),
      });

      if (!directResponse.ok) {
        console.error('Failed to update embedding');
      }
    }
  }

  /**
   * Search apps by embedding similarity
   */
  async searchByEmbedding(
    queryEmbedding: number[],
    userId: string,
    includePrivate: boolean,
    limit: number,
    minSimilarity: number
  ): Promise<Array<App & { similarity: number }>> {
    // Use RPC function for vector similarity search
    const url = `${this.supabaseUrl}/rest/v1/rpc/search_apps`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.supabaseKey}`,
        'apikey': this.supabaseKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_query_embedding: queryEmbedding,
        p_user_id: includePrivate ? userId : null,
        p_limit: limit,
        p_offset: 0,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Search failed: ${error}`);
    }

    const results = await response.json();

    // Filter by similarity threshold
    return results.filter((r: { similarity: number }) => r.similarity >= minSimilarity);
  }
}

// Factory function
export function createAppsService(): AppsService {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!url || !key) {
    throw new Error('Supabase credentials not configured');
  }

  return new AppsService({ url, serviceKey: key });
}
