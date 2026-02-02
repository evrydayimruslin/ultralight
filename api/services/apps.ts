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
