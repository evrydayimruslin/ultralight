// Native R2 AppDataService for Workers
// Replaces HTTP-based R2 access with direct R2 bindings (~50-200ms → ~5-15ms per op)

import type { AppDataService, QueryOptions, QueryResult } from './types';

/**
 * Sanitize key to be safe for R2 paths
 * Allows: alphanumeric, dash, underscore, forward slash (for nesting)
 */
function sanitizeKey(key: string): string {
  return key
    .replace(/[^a-zA-Z0-9\-_\/]/g, '_')
    .replace(/\/+/g, '/')
    .replace(/^\//, '')
    .replace(/\/$/, '');
}

/**
 * Get a nested value from an object using dot notation
 */
function getNestedValue(obj: unknown, path: string): unknown {
  if (obj == null || typeof obj !== 'object') return undefined;
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Create an AppDataService backed by native R2 bindings
 *
 * Storage paths:
 * - With userId: apps/{appId}/users/{userId}/data/{key}.json (user-partitioned)
 * - Without userId: apps/{appId}/data/{key}.json (shared app data)
 */
export function createAppDataService(bucket: R2Bucket, appId: string, userId?: string): AppDataService {
  const dataPrefix = userId
    ? `apps/${appId}/users/${userId}/data/`
    : `apps/${appId}/data/`;

  async function loadRaw(key: string): Promise<{ key: string; value: unknown; updated_at: string } | null> {
    const sanitizedKey = sanitizeKey(key);
    const path = `${dataPrefix}${sanitizedKey}.json`;
    try {
      const obj = await bucket.get(path);
      if (!obj) return null;
      const text = await obj.text();
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  return {
    async store(key: string, value: unknown): Promise<void> {
      const sanitizedKey = sanitizeKey(key);
      const path = `${dataPrefix}${sanitizedKey}.json`;
      const data = JSON.stringify({
        key: sanitizedKey,
        value: value,
        updated_at: new Date().toISOString(),
      });
      await bucket.put(path, data, {
        httpMetadata: { contentType: 'application/json' },
      });
    },

    async load(key: string): Promise<unknown> {
      const data = await loadRaw(key);
      return data?.value ?? null;
    },

    async remove(key: string): Promise<void> {
      const sanitizedKey = sanitizeKey(key);
      const path = `${dataPrefix}${sanitizedKey}.json`;
      await bucket.delete(path);
    },

    async list(prefix?: string): Promise<string[]> {
      const searchPrefix = prefix
        ? `${dataPrefix}${sanitizeKey(prefix)}`
        : dataPrefix;

      try {
        const listed = await bucket.list({ prefix: searchPrefix });
        return listed.objects
          .filter(obj => obj.key.endsWith('.json'))
          .map(obj => {
            const withoutPrefix = obj.key.replace(dataPrefix, '');
            return withoutPrefix.replace('.json', '');
          });
      } catch {
        return [];
      }
    },

    async query(prefix: string, options?: QueryOptions): Promise<QueryResult[]> {
      const keys = await this.list(prefix);
      if (keys.length === 0) return [];

      const rawItems = await Promise.all(
        keys.map(async (key) => {
          const data = await loadRaw(key);
          if (!data) return null;
          return {
            key: key,
            value: data.value,
            updatedAt: data.updated_at,
          };
        })
      );

      let items = rawItems.filter((item): item is QueryResult => item !== null);

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
          if (aVal < bVal) return order === 'asc' ? -1 : 1;
          if (aVal > bVal) return order === 'asc' ? 1 : -1;
          return 0;
        });
      }

      const offset = options?.offset ?? 0;
      const limit = options?.limit ?? items.length;
      items = items.slice(offset, offset + limit);

      return items;
    },

    async batchStore(items: Array<{ key: string; value: unknown }>): Promise<void> {
      const BATCH_SIZE = 10;
      for (let i = 0; i < items.length; i += BATCH_SIZE) {
        const batch = items.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(item => this.store(item.key, item.value)));
      }
    },

    async batchLoad(keys: string[]): Promise<Array<{ key: string; value: unknown }>> {
      return await Promise.all(
        keys.map(async (key) => {
          const value = await this.load(key);
          return { key: key, value: value };
        })
      );
    },

    async batchRemove(keys: string[]): Promise<void> {
      // R2 supports bulk delete (up to 1000 keys at once)
      const BATCH_SIZE = 100;
      for (let i = 0; i < keys.length; i += BATCH_SIZE) {
        const batch = keys.slice(i, i + BATCH_SIZE);
        const paths = batch.map(key => `${dataPrefix}${sanitizeKey(key)}.json`);
        await bucket.delete(paths);
      }
    },
  };
}
