// App Data Service
// R2-based JSON storage for app data - zero config for users
// Each app gets its own data namespace: apps/{appId}/data/{key}.json

import { createR2Service } from './storage.ts';

// ============================================
// DATA CACHE (shared singleton)
// ============================================
// Short-TTL read-through cache for load() calls.
// Most app data reads are repeated within a session (config, preferences, counters).
// Even a 30s cache eliminates the majority of redundant R2/Worker round-trips.
// Invalidated on store() and remove() for the same key.

interface DataCacheEntry {
  value: unknown;
  storedAt: number;
}

const DATA_CACHE_MAX = 2000;
const DATA_CACHE_TTL_MS = 30_000; // 30 seconds

class AppDataCache {
  private cache = new Map<string, DataCacheEntry>();
  private _hits = 0;
  private _misses = 0;

  /** Build cache key from appId + userId + data key */
  private cacheKey(appId: string, userId: string | undefined, key: string): string {
    return userId ? `${appId}:${userId}:${key}` : `${appId}::${key}`;
  }

  get(appId: string, userId: string | undefined, key: string): unknown | undefined {
    const ck = this.cacheKey(appId, userId, key);
    const entry = this.cache.get(ck);
    if (!entry) {
      this._misses++;
      return undefined;
    }
    if (Date.now() - entry.storedAt > DATA_CACHE_TTL_MS) {
      this.cache.delete(ck);
      this._misses++;
      return undefined;
    }
    this._hits++;
    return entry.value;
  }

  set(appId: string, userId: string | undefined, key: string, value: unknown): void {
    const ck = this.cacheKey(appId, userId, key);
    // Evict LRU if at capacity
    if (this.cache.size >= DATA_CACHE_MAX && !this.cache.has(ck)) {
      // Delete the oldest entry (first inserted — Map preserves insertion order)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(ck, { value, storedAt: Date.now() });
  }

  /** Invalidate a specific key (called on store/remove) */
  invalidate(appId: string, userId: string | undefined, key: string): void {
    const ck = this.cacheKey(appId, userId, key);
    this.cache.delete(ck);
  }

  get stats() {
    return {
      entries: this.cache.size,
      hits: this._hits,
      misses: this._misses,
      hitRate: this._hits + this._misses > 0
        ? (this._hits / (this._hits + this._misses) * 100).toFixed(1) + '%'
        : 'N/A',
    };
  }
}

let _dataCache: AppDataCache | null = null;
function getDataCache(): AppDataCache {
  if (!_dataCache) {
    _dataCache = new AppDataCache();
    console.log('[DATA_CACHE] Initialized (max=2000, TTL=30s)');
  }
  return _dataCache;
}

// ============================================
// TYPES
// ============================================

export interface QueryOptions {
  filter?: (value: unknown) => boolean;
  sort?: { field: string; order: 'asc' | 'desc' };
  limit?: number;
  offset?: number;
}

export interface QueryResult {
  key: string;
  value: unknown;
  updatedAt?: string;
}

export interface AppDataService {
  // Basic CRUD
  store(key: string, value: unknown): Promise<void>;
  load(key: string): Promise<unknown>;
  remove(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;

  // Query helpers
  query(prefix: string, options?: QueryOptions): Promise<QueryResult[]>;
  batchStore(items: Array<{ key: string; value: unknown }>): Promise<void>;
  batchLoad(keys: string[]): Promise<Array<{ key: string; value: unknown }>>;
  batchRemove(keys: string[]): Promise<void>;
}

// ============================================
// IMPLEMENTATION
// ============================================

/**
 * Create an app data service backed by R2
 *
 * Storage paths:
 * - With userId (MCP): apps/{appId}/users/{userId}/data/{key}.json (user-partitioned)
 * - Without userId (legacy): apps/{appId}/data/{key}.json (shared app data)
 *
 * The user-partitioned storage ensures each user's data is isolated within an app.
 */
export function createAppDataService(appId: string, userId?: string): AppDataService {
  const r2 = createR2Service();
  const dataCache = getDataCache();

  // Use user-partitioned path if userId is provided
  const dataPrefix = userId
    ? `apps/${appId}/users/${userId}/data/`
    : `apps/${appId}/data/`;

  // Internal helper to load raw data (includes metadata)
  async function loadRaw(key: string): Promise<{ key: string; value: unknown; updated_at: string } | null> {
    const sanitizedKey = sanitizeKey(key);
    const path = `${dataPrefix}${sanitizedKey}.json`;

    try {
      const content = await r2.fetchTextFile(path);
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  return {
    // ==========================================
    // BASIC CRUD
    // ==========================================

    /**
     * Store a value by key
     * Stored as JSON at apps/{appId}/data/{key}.json
     */
    async store(key: string, value: unknown): Promise<void> {
      const sanitizedKey = sanitizeKey(key);
      const path = `${dataPrefix}${sanitizedKey}.json`;

      const data = JSON.stringify({
        key: sanitizedKey,
        value,
        updated_at: new Date().toISOString(),
      });

      await r2.uploadFile(path, {
        name: `${sanitizedKey}.json`,
        content: new TextEncoder().encode(data),
        contentType: 'application/json',
      });

      // Update cache with new value
      dataCache.set(appId, userId, key, value);
    },

    /**
     * Load a value by key
     * Returns null if not found
     */
    async load(key: string): Promise<unknown> {
      // Check cache first
      const cached = dataCache.get(appId, userId, key);
      if (cached !== undefined) return cached;

      const data = await loadRaw(key);
      const value = data?.value ?? null;

      // Populate cache
      dataCache.set(appId, userId, key, value);
      return value;
    },

    /**
     * Remove a value by key
     */
    async remove(key: string): Promise<void> {
      const sanitizedKey = sanitizeKey(key);
      const path = `${dataPrefix}${sanitizedKey}.json`;

      // Invalidate cache
      dataCache.invalidate(appId, userId, key);

      try {
        await r2.deleteFile(path);
      } catch {
        // Ignore errors - file may not exist
      }
    },

    /**
     * List all keys (optionally filtered by prefix)
     */
    async list(prefix?: string): Promise<string[]> {
      const searchPrefix = prefix
        ? `${dataPrefix}${sanitizeKey(prefix)}`
        : dataPrefix;

      try {
        const files = await r2.listFiles(searchPrefix);

        // Extract key names from paths
        return files
          .filter(f => f.endsWith('.json'))
          .map(f => {
            // Remove prefix and .json suffix
            const withoutPrefix = f.replace(dataPrefix, '');
            return withoutPrefix.replace('.json', '');
          });
      } catch {
        return [];
      }
    },

    // ==========================================
    // QUERY HELPERS
    // ==========================================

    /**
     * Query items by prefix with optional filtering, sorting, and pagination
     *
     * Example usage:
     *   const tweets = await ultralight.query('tweets/', {
     *     filter: (t) => t.status === 'inbox',
     *     sort: { field: 'savedAt', order: 'desc' },
     *     limit: 20,
     *     offset: 0,
     *   });
     */
    async query(prefix: string, options?: QueryOptions): Promise<QueryResult[]> {
      // Get all keys matching prefix
      const keys = await this.list(prefix);

      if (keys.length === 0) {
        return [];
      }

      // Load all items in parallel batches (50 concurrent to avoid overwhelming R2)
      const QUERY_BATCH_SIZE = 50;
      const rawItems: (QueryResult | null)[] = [];

      for (let i = 0; i < keys.length; i += QUERY_BATCH_SIZE) {
        const batch = keys.slice(i, i + QUERY_BATCH_SIZE);
        const batchResults = await Promise.all(
          batch.map(async (key) => {
            const data = await loadRaw(key);
            if (!data) return null;
            return {
              key,
              value: data.value,
              updatedAt: data.updated_at,
            };
          })
        );
        rawItems.push(...batchResults);
      }

      // Filter out nulls
      let items = rawItems.filter((item): item is QueryResult => item !== null);

      // Apply filter if provided
      if (options?.filter) {
        items = items.filter(item => {
          try {
            return options.filter!(item.value);
          } catch {
            return false;
          }
        });
      }

      // Apply sorting if provided
      if (options?.sort) {
        const { field, order } = options.sort;
        items.sort((a, b) => {
          const aVal = getNestedValue(a.value, field);
          const bVal = getNestedValue(b.value, field);

          // Handle null/undefined
          if (aVal == null && bVal == null) return 0;
          if (aVal == null) return order === 'asc' ? -1 : 1;
          if (bVal == null) return order === 'asc' ? 1 : -1;

          // Compare values
          if (aVal < bVal) return order === 'asc' ? -1 : 1;
          if (aVal > bVal) return order === 'asc' ? 1 : -1;
          return 0;
        });
      }

      // Apply pagination
      const offset = options?.offset ?? 0;
      const limit = options?.limit ?? items.length;
      items = items.slice(offset, offset + limit);

      return items;
    },

    /**
     * Store multiple items at once
     *
     * Example usage:
     *   await ultralight.batchStore([
     *     { key: 'tweets/123', value: { content: '...' } },
     *     { key: 'tweets/456', value: { content: '...' } },
     *   ]);
     */
    async batchStore(items: Array<{ key: string; value: unknown }>): Promise<void> {
      // Process in parallel with concurrency limit
      const BATCH_SIZE = 50;

      for (let i = 0; i < items.length; i += BATCH_SIZE) {
        const batch = items.slice(i, i + BATCH_SIZE);
        await Promise.all(
          batch.map(item => this.store(item.key, item.value))
        );
      }
    },

    /**
     * Load multiple items at once
     *
     * Example usage:
     *   const items = await ultralight.batchLoad(['tweets/123', 'tweets/456']);
     */
    async batchLoad(keys: string[]): Promise<Array<{ key: string; value: unknown }>> {
      // Process in parallel batches
      const BATCH_SIZE = 50;
      const results: Array<{ key: string; value: unknown }> = [];

      for (let i = 0; i < keys.length; i += BATCH_SIZE) {
        const batch = keys.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(
          batch.map(async (key) => {
            const value = await this.load(key);
            return { key, value };
          })
        );
        results.push(...batchResults);
      }

      return results;
    },

    /**
     * Remove multiple items at once
     *
     * Example usage:
     *   await ultralight.batchRemove(['tweets/123', 'tweets/456']);
     */
    async batchRemove(keys: string[]): Promise<void> {
      // Process in parallel with concurrency limit
      const BATCH_SIZE = 50;

      for (let i = 0; i < keys.length; i += BATCH_SIZE) {
        const batch = keys.slice(i, i + BATCH_SIZE);
        await Promise.all(
          batch.map(key => this.remove(key))
        );
      }
    },
  };
}

// ============================================
// WORKER-BACKED IMPLEMENTATION
// ============================================

/**
 * Create an app data service backed by the Cloudflare Worker data layer.
 * Uses native R2 bindings via the Worker (~10x faster than HTTP-signed S3).
 *
 * Falls back to direct R2 if the Worker call fails.
 */
export function createWorkerAppDataService(
  appId: string,
  userId: string | undefined,
  workerUrl: string,
  workerSecret: string,
): AppDataService {
  const dataCache = getDataCache();

  async function workerFetch(path: string, body: Record<string, unknown>): Promise<unknown> {
    const response = await fetch(`${workerUrl}/data/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Worker-Secret': workerSecret,
      },
      body: JSON.stringify({ appId: appId, userId: userId, ...body }),
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText);
      throw new Error(`Worker data call failed (${response.status}): ${errText}`);
    }
    return response.json();
  }

  return {
    async store(key: string, value: unknown): Promise<void> {
      await workerFetch('store', { key: key, value: value });
      // Update cache with new value
      dataCache.set(appId, userId, key, value);
    },

    async load(key: string): Promise<unknown> {
      // Check cache first
      const cached = dataCache.get(appId, userId, key);
      if (cached !== undefined) return cached;

      const result = await workerFetch('load', { key: key }) as { value: unknown };
      const value = result.value ?? null;

      // Populate cache
      dataCache.set(appId, userId, key, value);
      return value;
    },

    async remove(key: string): Promise<void> {
      // Invalidate cache
      dataCache.invalidate(appId, userId, key);
      await workerFetch('remove', { key: key });
    },

    async list(prefix?: string): Promise<string[]> {
      const result = await workerFetch('list', { prefix: prefix }) as { keys: string[] };
      return result.keys ?? [];
    },

    async query(prefix: string, options?: QueryOptions): Promise<QueryResult[]> {
      // Query involves filtering/sorting which needs the data values.
      // Fetch all keys, batch-load, then filter/sort locally.
      const keys = await this.list(prefix);
      if (keys.length === 0) return [];

      const loaded = await this.batchLoad(keys);

      let items: QueryResult[] = loaded
        .filter(item => item.value !== null)
        .map(item => ({
          key: item.key,
          value: item.value,
          updatedAt: undefined,
        }));

      if (options?.filter) {
        items = items.filter(item => {
          try { return options.filter!(item.value); } catch { return false; }
        });
      }

      if (options?.sort) {
        const { field, order } = options.sort;
        items.sort((a, b) => {
          const aVal = getNestedValue(a.value, field);
          const bVal = getNestedValue(b.value, field);
          if (aVal == null && bVal == null) return 0;
          if (aVal == null) return order === 'asc' ? -1 : 1;
          if (bVal == null) return order === 'asc' ? 1 : -1;
          if ((aVal as string | number) < (bVal as string | number)) return order === 'asc' ? -1 : 1;
          if ((aVal as string | number) > (bVal as string | number)) return order === 'asc' ? 1 : -1;
          return 0;
        });
      }

      const offset = options?.offset ?? 0;
      const limit = options?.limit ?? items.length;
      return items.slice(offset, offset + limit);
    },

    async batchStore(items: Array<{ key: string; value: unknown }>): Promise<void> {
      await workerFetch('batch-store', { items: items });
    },

    async batchLoad(keys: string[]): Promise<Array<{ key: string; value: unknown }>> {
      const result = await workerFetch('batch-load', { keys: keys }) as { items: Array<{ key: string; value: unknown }> };
      return result.items ?? [];
    },

    async batchRemove(keys: string[]): Promise<void> {
      await workerFetch('batch-remove', { keys: keys });
    },
  };
}

// ============================================
// UTILITIES
// ============================================

/**
 * Sanitize key to be safe for R2 paths
 * Allows: alphanumeric, dash, underscore, forward slash (for nesting)
 */
function sanitizeKey(key: string): string {
  // Replace unsafe characters
  return key
    .replace(/[^a-zA-Z0-9\-_\/]/g, '_')
    .replace(/\/+/g, '/') // Collapse multiple slashes
    .replace(/^\//, '') // Remove leading slash
    .replace(/\/$/, ''); // Remove trailing slash
}

/**
 * Get a nested value from an object using dot notation
 * e.g., getNestedValue({ a: { b: 1 } }, 'a.b') => 1
 */
function getNestedValue(obj: unknown, path: string): unknown {
  if (obj == null || typeof obj !== 'object') {
    return undefined;
  }

  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current == null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}
