// Permission Cache Service
// In-memory LRU cache for user→app permission rows.
// Prevents redundant Supabase queries on every private app MCP call.
// Pattern matches CodeCache in api/services/codecache.ts.

import type { PermissionRow } from '../../shared/types/index.ts';

export interface CachedPermissions {
  /** Set of allowed function names (built from rows where allowed === true) */
  allowed: Set<string>;
  /** Raw permission rows with constraint data (for IP/time/budget/expiry checks) */
  rows: PermissionRow[];
  /** Timestamp when the entry was cached (ms since epoch) */
  cachedAt: number;
  /** Last access time for LRU eviction (ms since epoch) */
  accessedAt: number;
}

const DEFAULT_MAX_ENTRIES = 5000;
const DEFAULT_TTL_MS = 60 * 1000; // 60 seconds

export class PermissionCache {
  private cache = new Map<string, CachedPermissions>();
  private maxEntries: number;
  private ttlMs: number;
  private nowFn: () => number;

  // Stats for logging/monitoring
  private _hits = 0;
  private _misses = 0;

  constructor(
    maxEntries = DEFAULT_MAX_ENTRIES,
    ttlMs = DEFAULT_TTL_MS,
    nowFn: () => number = () => Date.now()
  ) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    this.nowFn = nowFn;
  }

  /**
   * Get cached permissions for a user+app pair.
   * Returns undefined on miss or TTL expiry (not null — null means "owner/no restrictions").
   */
  get(userId: string, appId: string): CachedPermissions | undefined {
    const key = `${userId}:${appId}`;
    const entry = this.cache.get(key);

    if (!entry) {
      this._misses++;
      return undefined;
    }

    // Check TTL
    if (this.nowFn() - entry.cachedAt > this.ttlMs) {
      this.cache.delete(key);
      this._misses++;
      return undefined;
    }

    // Update access time for LRU
    entry.accessedAt = this.nowFn();
    this._hits++;
    return entry;
  }

  /**
   * Store permissions in cache.
   */
  set(userId: string, appId: string, allowed: Set<string>, rows: PermissionRow[]): void {
    const key = `${userId}:${appId}`;

    // Evict if at capacity
    if (this.cache.size >= this.maxEntries && !this.cache.has(key)) {
      this.evictLRU();
    }

    const now = this.nowFn();
    this.cache.set(key, {
      allowed,
      rows,
      cachedAt: now,
      accessedAt: now,
    });
  }

  /**
   * Invalidate all cached entries for a given app (all users).
   * Called on grant/revoke via MCP tools where any user could be affected.
   */
  invalidateByApp(appId: string): void {
    const suffix = `:${appId}`;
    for (const key of this.cache.keys()) {
      if (key.endsWith(suffix)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Invalidate cache for a specific user+app pair.
   * Used by REST API handlers where the target user is known.
   */
  invalidateByUserAndApp(userId: string, appId: string): void {
    this.cache.delete(`${userId}:${appId}`);
  }

  /**
   * Increment budget_used in-place on a cached permission row.
   * Keeps the cache consistent with fire-and-forget DB writes.
   * Without this, a user could blow through their budget within the TTL window.
   * Returns true if the entry was found and updated, false otherwise.
   */
  incrementBudget(userId: string, appId: string, functionName: string): boolean {
    const key = `${userId}:${appId}`;
    const entry = this.cache.get(key);
    if (!entry) return false;

    const row = entry.rows.find(
      r => r.function_name === functionName && r.allowed
    );
    if (row && row.budget_limit !== null && row.budget_limit > 0) {
      row.budget_used = (row.budget_used || 0) + 1;
      return true;
    }
    return false;
  }

  /**
   * Get cache stats for monitoring.
   */
  get stats() {
    return {
      entries: this.cache.size,
      maxEntries: this.maxEntries,
      hits: this._hits,
      misses: this._misses,
      hitRate: this._hits + this._misses > 0
        ? (this._hits / (this._hits + this._misses) * 100).toFixed(1) + '%'
        : 'N/A',
    };
  }

  /**
   * Clear all cache entries. Used for testing.
   */
  clear(): void {
    this.cache.clear();
    this._hits = 0;
    this._misses = 0;
  }

  /**
   * Evict the least recently accessed entry.
   */
  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestAccess = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.accessedAt < oldestAccess) {
        oldestAccess = entry.accessedAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }
}

// Singleton instance shared across all request handlers
let _instance: PermissionCache | null = null;

export function getPermissionCache(): PermissionCache {
  if (!_instance) {
    _instance = new PermissionCache();
    console.log('[PERM_CACHE] Initialized (max=5000, TTL=60s)');
  }
  return _instance;
}

// For testing: replace the singleton
export function _setPermissionCacheForTest(cache: PermissionCache | null): void {
  _instance = cache;
}
