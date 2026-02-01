// App Data Service
// R2-based JSON storage for app data - zero config for users
// Each app gets its own data namespace: apps/{appId}/data/{key}.json

import { createR2Service, R2Service } from './storage.ts';

export interface AppDataService {
  store(key: string, value: unknown): Promise<void>;
  load(key: string): Promise<unknown>;
  remove(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}

/**
 * Create an app data service backed by R2
 * Data is stored at: apps/{appId}/data/{key}.json
 */
export function createAppDataService(appId: string): AppDataService {
  const r2 = createR2Service();
  const dataPrefix = `apps/${appId}/data/`;

  return {
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
      const sanitizedKey = sanitizeKey(key);
      const path = `${dataPrefix}${sanitizedKey}.json`;

      try {
        const content = await r2.fetchTextFile(path);
        const data = JSON.parse(content);
        return data.value;
      } catch (err) {
        // File not found or parse error - return null
        if (err instanceof Error && err.message.includes('not found')) {
          return null;
        }
        // Log other errors but still return null for resilience
        console.error(`AppData load error for key "${key}":`, err);
        return null;
      }
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
  };
}

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
