/**
 * Tests for Permission Cache Service
 *
 * Covers: get/set, TTL expiry, LRU eviction, invalidation, budget increment, stats
 */

import { assertEquals } from 'https://deno.land/std@0.210.0/assert/assert_equals.ts';
import { assert } from 'https://deno.land/std@0.210.0/assert/assert.ts';
import { PermissionCache } from './permission-cache.ts';
import type { PermissionRow } from '../../shared/types/index.ts';

// ── Helper: build a minimal PermissionRow ──

function makeRow(overrides: Partial<PermissionRow> = {}): PermissionRow {
  return {
    app_id: 'app-test',
    granted_to_user_id: 'user-1',
    granted_by_user_id: 'owner-1',
    function_name: 'doThing',
    allowed: true,
    allowed_ips: null,
    time_window: null,
    budget_limit: null,
    budget_used: 0,
    budget_period: null,
    expires_at: null,
    allowed_args: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

// ============================================
// Basic get/set
// ============================================

Deno.test('PermissionCache: get returns undefined on miss', () => {
  const cache = new PermissionCache(100, 60_000);
  assertEquals(cache.get('user-1', 'app-1'), undefined);
});

Deno.test('PermissionCache: set then get returns cached entry', () => {
  const cache = new PermissionCache(100, 60_000);
  const rows = [makeRow({ function_name: 'fn_a' })];
  const allowed = new Set(['fn_a']);
  cache.set('user-1', 'app-1', allowed, rows);

  const result = cache.get('user-1', 'app-1');
  assert(result !== undefined);
  assertEquals(result!.allowed.has('fn_a'), true);
  assertEquals(result!.rows.length, 1);
});

Deno.test('PermissionCache: caches empty permission set (denied user)', () => {
  const cache = new PermissionCache(100, 60_000);
  cache.set('user-1', 'app-1', new Set<string>(), []);

  const result = cache.get('user-1', 'app-1');
  assert(result !== undefined);
  assertEquals(result!.allowed.size, 0);
  assertEquals(result!.rows.length, 0);
});

Deno.test('PermissionCache: different user+app keys are independent', () => {
  const cache = new PermissionCache(100, 60_000);
  cache.set('user-1', 'app-1', new Set(['fn_a']), [makeRow({ function_name: 'fn_a' })]);
  cache.set('user-2', 'app-1', new Set(['fn_b']), [makeRow({ function_name: 'fn_b' })]);

  const r1 = cache.get('user-1', 'app-1');
  const r2 = cache.get('user-2', 'app-1');
  assertEquals(r1!.allowed.has('fn_a'), true);
  assertEquals(r2!.allowed.has('fn_b'), true);
});

Deno.test('PermissionCache: set overwrites existing entry', () => {
  const cache = new PermissionCache(100, 60_000);
  cache.set('user-1', 'app-1', new Set(['fn_a']), [makeRow({ function_name: 'fn_a' })]);
  cache.set('user-1', 'app-1', new Set(['fn_a', 'fn_b']), [
    makeRow({ function_name: 'fn_a' }),
    makeRow({ function_name: 'fn_b' }),
  ]);

  const result = cache.get('user-1', 'app-1');
  assertEquals(result!.allowed.size, 2);
  assertEquals(result!.rows.length, 2);
});

// ============================================
// TTL expiry
// ============================================

Deno.test('PermissionCache: entry expires after TTL', () => {
  let now = 1000;
  const cache = new PermissionCache(100, 60_000, () => now);
  cache.set('user-1', 'app-1', new Set(['fn_a']), [makeRow()]);

  // Still fresh
  now = 30_000;
  assert(cache.get('user-1', 'app-1') !== undefined);

  // Expired
  now = 62_000;
  assertEquals(cache.get('user-1', 'app-1'), undefined);
});

Deno.test('PermissionCache: entry at exact TTL boundary is expired', () => {
  let now = 0;
  const cache = new PermissionCache(100, 60_000, () => now);
  cache.set('user-1', 'app-1', new Set(['fn_a']), [makeRow()]);

  now = 60_001; // 1ms past TTL
  assertEquals(cache.get('user-1', 'app-1'), undefined);
});

// ============================================
// LRU eviction
// ============================================

Deno.test('PermissionCache: evicts LRU entry when at capacity', () => {
  let now = 1000;
  const cache = new PermissionCache(2, 60_000, () => now);

  // Fill to capacity
  cache.set('user-1', 'app-1', new Set(['a']), [makeRow()]);
  now = 2000;
  cache.set('user-2', 'app-1', new Set(['b']), [makeRow()]);

  // Add third entry — should evict user-1:app-1 (oldest accessed)
  now = 3000;
  cache.set('user-3', 'app-1', new Set(['c']), [makeRow()]);

  assertEquals(cache.get('user-1', 'app-1'), undefined); // evicted
  assert(cache.get('user-2', 'app-1') !== undefined); // kept
  assert(cache.get('user-3', 'app-1') !== undefined); // kept
});

Deno.test('PermissionCache: accessing entry refreshes LRU access time', () => {
  let now = 1000;
  const cache = new PermissionCache(2, 60_000, () => now);

  cache.set('user-1', 'app-1', new Set(['a']), [makeRow()]);
  now = 2000;
  cache.set('user-2', 'app-1', new Set(['b']), [makeRow()]);

  // Access user-1 to refresh its accessedAt
  now = 3000;
  cache.get('user-1', 'app-1');

  // Add third entry — should evict user-2 (now the oldest accessed)
  now = 4000;
  cache.set('user-3', 'app-1', new Set(['c']), [makeRow()]);

  assert(cache.get('user-1', 'app-1') !== undefined); // refreshed, kept
  assertEquals(cache.get('user-2', 'app-1'), undefined); // evicted
  assert(cache.get('user-3', 'app-1') !== undefined); // kept
});

// ============================================
// invalidateByApp
// ============================================

Deno.test('PermissionCache: invalidateByApp removes all users for that app', () => {
  const cache = new PermissionCache(100, 60_000);
  cache.set('user-1', 'app-1', new Set(['fn']), [makeRow()]);
  cache.set('user-2', 'app-1', new Set(['fn']), [makeRow()]);
  cache.set('user-1', 'app-2', new Set(['fn']), [makeRow()]);

  cache.invalidateByApp('app-1');

  assertEquals(cache.get('user-1', 'app-1'), undefined);
  assertEquals(cache.get('user-2', 'app-1'), undefined);
  assert(cache.get('user-1', 'app-2') !== undefined); // unaffected
});

Deno.test('PermissionCache: invalidateByApp is no-op for unknown app', () => {
  const cache = new PermissionCache(100, 60_000);
  cache.set('user-1', 'app-1', new Set(['fn']), [makeRow()]);

  cache.invalidateByApp('app-unknown');

  assert(cache.get('user-1', 'app-1') !== undefined); // untouched
});

// ============================================
// invalidateByUserAndApp
// ============================================

Deno.test('PermissionCache: invalidateByUserAndApp removes only targeted entry', () => {
  const cache = new PermissionCache(100, 60_000);
  cache.set('user-1', 'app-1', new Set(['fn']), [makeRow()]);
  cache.set('user-2', 'app-1', new Set(['fn']), [makeRow()]);
  cache.set('user-1', 'app-2', new Set(['fn']), [makeRow()]);

  cache.invalidateByUserAndApp('user-1', 'app-1');

  assertEquals(cache.get('user-1', 'app-1'), undefined); // removed
  assert(cache.get('user-2', 'app-1') !== undefined); // kept
  assert(cache.get('user-1', 'app-2') !== undefined); // kept
});

// ============================================
// incrementBudget
// ============================================

Deno.test('PermissionCache: incrementBudget updates cached row in-place', () => {
  const cache = new PermissionCache(100, 60_000);
  const rows = [makeRow({ function_name: 'fn_a', budget_limit: 10, budget_used: 5 })];
  cache.set('user-1', 'app-1', new Set(['fn_a']), rows);

  const updated = cache.incrementBudget('user-1', 'app-1', 'fn_a');
  assertEquals(updated, true);

  const cached = cache.get('user-1', 'app-1');
  const row = cached!.rows.find(r => r.function_name === 'fn_a');
  assertEquals(row!.budget_used, 6);
});

Deno.test('PermissionCache: incrementBudget returns false on cache miss', () => {
  const cache = new PermissionCache(100, 60_000);
  assertEquals(cache.incrementBudget('user-1', 'app-1', 'fn_a'), false);
});

Deno.test('PermissionCache: incrementBudget ignores rows without budget_limit', () => {
  const cache = new PermissionCache(100, 60_000);
  const rows = [makeRow({ function_name: 'fn_a', budget_limit: null })];
  cache.set('user-1', 'app-1', new Set(['fn_a']), rows);

  assertEquals(cache.incrementBudget('user-1', 'app-1', 'fn_a'), false);
});

Deno.test('PermissionCache: incrementBudget targets correct function only', () => {
  const cache = new PermissionCache(100, 60_000);
  const rows = [
    makeRow({ function_name: 'fn_a', budget_limit: 10, budget_used: 5 }),
    makeRow({ function_name: 'fn_b', budget_limit: 20, budget_used: 10 }),
  ];
  cache.set('user-1', 'app-1', new Set(['fn_a', 'fn_b']), rows);

  cache.incrementBudget('user-1', 'app-1', 'fn_a');

  const cached = cache.get('user-1', 'app-1');
  assertEquals(cached!.rows.find(r => r.function_name === 'fn_a')!.budget_used, 6);
  assertEquals(cached!.rows.find(r => r.function_name === 'fn_b')!.budget_used, 10); // unchanged
});

Deno.test('PermissionCache: multiple increments accumulate correctly', () => {
  const cache = new PermissionCache(100, 60_000);
  const rows = [makeRow({ function_name: 'fn_a', budget_limit: 10, budget_used: 0 })];
  cache.set('user-1', 'app-1', new Set(['fn_a']), rows);

  cache.incrementBudget('user-1', 'app-1', 'fn_a');
  cache.incrementBudget('user-1', 'app-1', 'fn_a');
  cache.incrementBudget('user-1', 'app-1', 'fn_a');

  const cached = cache.get('user-1', 'app-1');
  assertEquals(cached!.rows.find(r => r.function_name === 'fn_a')!.budget_used, 3);
});

// ============================================
// Stats
// ============================================

Deno.test('PermissionCache: stats track hits and misses', () => {
  const cache = new PermissionCache(100, 60_000);
  cache.set('user-1', 'app-1', new Set(['fn']), [makeRow()]);

  cache.get('user-1', 'app-1'); // hit
  cache.get('user-1', 'app-1'); // hit
  cache.get('user-2', 'app-1'); // miss

  assertEquals(cache.stats.hits, 2);
  assertEquals(cache.stats.misses, 1);
  assertEquals(cache.stats.entries, 1);
  assertEquals(cache.stats.hitRate, '66.7%');
});

// ============================================
// Clear
// ============================================

Deno.test('PermissionCache: clear removes all entries and resets stats', () => {
  const cache = new PermissionCache(100, 60_000);
  cache.set('user-1', 'app-1', new Set(['fn']), [makeRow()]);
  cache.set('user-2', 'app-1', new Set(['fn']), [makeRow()]);
  cache.get('user-1', 'app-1'); // hit

  cache.clear();

  assertEquals(cache.stats.entries, 0);
  assertEquals(cache.stats.hits, 0);
  assertEquals(cache.stats.misses, 0);
  assertEquals(cache.get('user-1', 'app-1'), undefined);
});
