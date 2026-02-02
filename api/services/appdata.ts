// App Data Service
// R2-based JSON storage for app data - zero config for users
// Each app gets its own data namespace: apps/{appId}/data/{key}.json

import { createR2Service } from './storage.ts';

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
    },

    /**
     * Load a value by key
     * Returns null if not found
     */
    async load(key: string): Promise<unknown> {
      const data = await loadRaw(key);
      return data?.value ?? null;
    },

    /**
     * Remove a value by key
     */
    async remove(key: string): Promise<void> {
      const sanitizedKey = sanitizeKey(key);
      const path = `${dataPrefix}${sanitizedKey}.json`;

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

      // Load all items in parallel
      const rawItems = await Promise.all(
        keys.map(async (key) => {
          const data = await loadRaw(key);
          if (!data) return null;
          return {
            key,
            value: data.value,
            updatedAt: data.updated_at,
          };
        })
      );

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
      const BATCH_SIZE = 10;

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
      const results = await Promise.all(
        keys.map(async (key) => {
          const value = await this.load(key);
          return { key, value };
        })
      );

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
      const BATCH_SIZE = 10;

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
