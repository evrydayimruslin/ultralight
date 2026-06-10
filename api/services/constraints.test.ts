/**
 * Tests for Permission Constraint Enforcement
 *
 * Covers: checkConstraints, checkAllowedArgs, isIpAllowed, isWithinTimeWindow, getBudgetPeriodStart
 */

import { assertEquals } from 'https://deno.land/std@0.210.0/assert/assert_equals.ts';
import { assertObjectMatch } from 'https://deno.land/std@0.210.0/assert/assert_object_match.ts';
import {
  checkConstraints,
  checkAllowedArgs,
  isIpAllowed,
  isWithinTimeWindow,
  getBudgetPeriodStart,
} from './constraints.ts';
import type { PermissionRow, TimeWindow } from '../../shared/types/index.ts';

// ── Helper: build a minimal PermissionRow with defaults ──

function makeRow(overrides: Partial<PermissionRow> = {}): PermissionRow {
  return {
    app_id: 'app-test',
    granted_to_user_id: 'user-1',
    granted_by_user_id: 'user-2',
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
// checkConstraints — overall orchestration
// ============================================

Deno.test('checkConstraints: allows when no constraints set', () => {
  const result = checkConstraints(makeRow(), null);
  assertEquals(result.allowed, true);
  assertEquals(result.reason, undefined);
});

Deno.test('checkConstraints: allows when all constraints pass', () => {
  const row = makeRow({
    expires_at: '2099-12-31T23:59:59Z',
    allowed_ips: ['10.0.0.0/8'],
    budget_limit: 100,
    budget_used: 50,
    time_window: { start_hour: 0, end_hour: 23 },
    allowed_args: { region: ['us-east'] },
  });
  const result = checkConstraints(row, '10.0.0.1', new Date('2025-06-15T12:00:00Z'), { region: 'us-east' });
  assertEquals(result.allowed, true);
});

// ── Expiry ──

Deno.test('checkConstraints: blocks expired permission', () => {
  const row = makeRow({ expires_at: '2024-01-01T00:00:00Z' });
  const result = checkConstraints(row, null, new Date('2025-01-01T00:00:00Z'));
  assertEquals(result.allowed, false);
  assertEquals(result.reason?.includes('expired'), true);
});

Deno.test('checkConstraints: allows non-expired permission', () => {
  const row = makeRow({ expires_at: '2099-12-31T23:59:59Z' });
  const result = checkConstraints(row, null, new Date('2025-01-01T00:00:00Z'));
  assertEquals(result.allowed, true);
});

Deno.test('checkConstraints: blocks at exact expiry time', () => {
  const row = makeRow({ expires_at: '2025-06-15T12:00:00Z' });
  const result = checkConstraints(row, null, new Date('2025-06-15T12:00:00Z'));
  assertEquals(result.allowed, false);
});

// ── IP Allowlist ──

Deno.test('checkConstraints: blocks IP not in allowlist', () => {
  const row = makeRow({ allowed_ips: ['192.168.1.0/24'] });
  const result = checkConstraints(row, '10.0.0.1');
  assertEquals(result.allowed, false);
  assertEquals(result.reason?.includes('10.0.0.1'), true);
});

Deno.test('checkConstraints: allows IP in allowlist', () => {
  const row = makeRow({ allowed_ips: ['10.0.0.0/8'] });
  const result = checkConstraints(row, '10.0.0.1');
  assertEquals(result.allowed, true);
});

Deno.test('checkConstraints: skips IP check when clientIp is null', () => {
  const row = makeRow({ allowed_ips: ['192.168.1.0/24'] });
  const result = checkConstraints(row, null);
  assertEquals(result.allowed, true);
});

Deno.test('checkConstraints: skips IP check when allowlist is empty', () => {
  const row = makeRow({ allowed_ips: [] });
  const result = checkConstraints(row, '10.0.0.1');
  assertEquals(result.allowed, true);
});

// ── Budget ──

Deno.test('checkConstraints: blocks when budget exhausted', () => {
  const row = makeRow({ budget_limit: 10, budget_used: 10 });
  const result = checkConstraints(row, null);
  assertEquals(result.allowed, false);
  assertEquals(result.reason?.includes('budget'), true);
});

Deno.test('checkConstraints: allows when budget has remaining', () => {
  const row = makeRow({ budget_limit: 10, budget_used: 9 });
  const result = checkConstraints(row, null);
  assertEquals(result.allowed, true);
});

Deno.test('checkConstraints: allows when budget_limit is null (unlimited)', () => {
  const row = makeRow({ budget_limit: null, budget_used: 999 });
  const result = checkConstraints(row, null);
  assertEquals(result.allowed, true);
});

Deno.test('checkConstraints: blocks when budget_used exceeds limit', () => {
  const row = makeRow({ budget_limit: 5, budget_used: 50 });
  const result = checkConstraints(row, null);
  assertEquals(result.allowed, false);
});

// ── Constraint priority (first failure wins) ──

Deno.test('checkConstraints: expiry checked before IP', () => {
  const row = makeRow({
    expires_at: '2020-01-01T00:00:00Z',
    allowed_ips: ['192.168.1.0/24'],
  });
  const result = checkConstraints(row, '10.0.0.1', new Date('2025-01-01T00:00:00Z'));
  assertEquals(result.allowed, false);
  assertEquals(result.reason?.includes('expired'), true);
});

// ============================================
// isIpAllowed — IP matching
// ============================================

Deno.test('isIpAllowed: exact match', () => {
  assertEquals(isIpAllowed('192.168.1.100', ['192.168.1.100']), true);
});

Deno.test('isIpAllowed: exact match miss', () => {
  assertEquals(isIpAllowed('192.168.1.101', ['192.168.1.100']), false);
});

Deno.test('isIpAllowed: CIDR /24 match', () => {
  assertEquals(isIpAllowed('192.168.1.100', ['192.168.1.0/24']), true);
});

Deno.test('isIpAllowed: CIDR /24 miss', () => {
  assertEquals(isIpAllowed('192.168.2.1', ['192.168.1.0/24']), false);
});

Deno.test('isIpAllowed: CIDR /8 match (10.x.x.x)', () => {
  assertEquals(isIpAllowed('10.255.255.255', ['10.0.0.0/8']), true);
});

Deno.test('isIpAllowed: CIDR /8 miss', () => {
  assertEquals(isIpAllowed('11.0.0.1', ['10.0.0.0/8']), false);
});

Deno.test('isIpAllowed: CIDR /32 exact match', () => {
  assertEquals(isIpAllowed('1.2.3.4', ['1.2.3.4/32']), true);
});

Deno.test('isIpAllowed: CIDR /32 miss', () => {
  assertEquals(isIpAllowed('1.2.3.5', ['1.2.3.4/32']), false);
});

Deno.test('isIpAllowed: CIDR /0 matches everything', () => {
  assertEquals(isIpAllowed('255.255.255.255', ['0.0.0.0/0']), true);
});

Deno.test('isIpAllowed: CIDR /16 match', () => {
  assertEquals(isIpAllowed('172.16.5.100', ['172.16.0.0/16']), true);
});

Deno.test('isIpAllowed: CIDR /16 miss', () => {
  assertEquals(isIpAllowed('172.17.0.1', ['172.16.0.0/16']), false);
});

Deno.test('isIpAllowed: multiple entries, one matches', () => {
  assertEquals(isIpAllowed('10.0.0.5', ['192.168.1.0/24', '10.0.0.0/8']), true);
});

Deno.test('isIpAllowed: multiple entries, none match', () => {
  assertEquals(isIpAllowed('11.0.0.5', ['192.168.1.0/24', '10.0.0.0/8']), false);
});

Deno.test('isIpAllowed: mixed exact and CIDR', () => {
  assertEquals(isIpAllowed('1.2.3.4', ['1.2.3.4', '10.0.0.0/8']), true);
});

Deno.test('isIpAllowed: invalid IP returns false', () => {
  assertEquals(isIpAllowed('not-an-ip', ['10.0.0.0/8']), false);
});

Deno.test('isIpAllowed: invalid CIDR prefix returns false', () => {
  assertEquals(isIpAllowed('10.0.0.1', ['10.0.0.0/33']), false);
});

// ============================================
// isWithinTimeWindow — time-based access
// ============================================

Deno.test('isWithinTimeWindow: inside normal range (9-17)', () => {
  const tw: TimeWindow = { start_hour: 9, end_hour: 17 };
  const noon = new Date('2025-06-15T12:00:00Z');
  assertEquals(isWithinTimeWindow(tw, noon), true);
});

Deno.test('isWithinTimeWindow: at start boundary (9am)', () => {
  const tw: TimeWindow = { start_hour: 9, end_hour: 17 };
  const nine = new Date('2025-06-15T09:00:00Z');
  assertEquals(isWithinTimeWindow(tw, nine), true);
});

Deno.test('isWithinTimeWindow: at end boundary (5pm)', () => {
  const tw: TimeWindow = { start_hour: 9, end_hour: 17 };
  const five = new Date('2025-06-15T17:00:00Z');
  // end_hour is exclusive (localHour < end_hour)
  assertEquals(isWithinTimeWindow(tw, five), false);
});

Deno.test('isWithinTimeWindow: before range', () => {
  const tw: TimeWindow = { start_hour: 9, end_hour: 17 };
  const early = new Date('2025-06-15T08:00:00Z');
  assertEquals(isWithinTimeWindow(tw, early), false);
});

Deno.test('isWithinTimeWindow: after range', () => {
  const tw: TimeWindow = { start_hour: 9, end_hour: 17 };
  const late = new Date('2025-06-15T18:00:00Z');
  assertEquals(isWithinTimeWindow(tw, late), false);
});

Deno.test('isWithinTimeWindow: wrapping past midnight (22-6), inside', () => {
  const tw: TimeWindow = { start_hour: 22, end_hour: 6 };
  const midnight = new Date('2025-06-15T00:00:00Z');
  assertEquals(isWithinTimeWindow(tw, midnight), true);
});

Deno.test('isWithinTimeWindow: wrapping past midnight (22-6), at 23:00', () => {
  const tw: TimeWindow = { start_hour: 22, end_hour: 6 };
  const late = new Date('2025-06-15T23:00:00Z');
  assertEquals(isWithinTimeWindow(tw, late), true);
});

Deno.test('isWithinTimeWindow: wrapping past midnight (22-6), outside at 12:00', () => {
  const tw: TimeWindow = { start_hour: 22, end_hour: 6 };
  const noon = new Date('2025-06-15T12:00:00Z');
  assertEquals(isWithinTimeWindow(tw, noon), false);
});

Deno.test('isWithinTimeWindow: day filter, correct day', () => {
  // 2025-06-15 is a Sunday (day 0)
  const tw: TimeWindow = { start_hour: 0, end_hour: 23, days: [0] };
  const sunday = new Date('2025-06-15T12:00:00Z');
  assertEquals(isWithinTimeWindow(tw, sunday), true);
});

Deno.test('isWithinTimeWindow: day filter, wrong day', () => {
  // 2025-06-16 is a Monday (day 1)
  const tw: TimeWindow = { start_hour: 0, end_hour: 23, days: [0] }; // Sunday only
  const monday = new Date('2025-06-16T12:00:00Z');
  assertEquals(isWithinTimeWindow(tw, monday), false);
});

Deno.test('isWithinTimeWindow: weekday filter (Mon-Fri)', () => {
  const tw: TimeWindow = { start_hour: 9, end_hour: 17, days: [1, 2, 3, 4, 5] };
  // 2025-06-16 is Monday
  const monday = new Date('2025-06-16T12:00:00Z');
  assertEquals(isWithinTimeWindow(tw, monday), true);
  // 2025-06-15 is Sunday
  const sunday = new Date('2025-06-15T12:00:00Z');
  assertEquals(isWithinTimeWindow(tw, sunday), false);
});

Deno.test('isWithinTimeWindow: empty days array allows all days', () => {
  const tw: TimeWindow = { start_hour: 0, end_hour: 23, days: [] };
  const monday = new Date('2025-06-16T12:00:00Z');
  assertEquals(isWithinTimeWindow(tw, monday), true);
});

Deno.test('isWithinTimeWindow: timezone support', () => {
  // 2025-06-15T17:00:00Z = 2025-06-15T13:00 in America/New_York (EDT, UTC-4)
  const tw: TimeWindow = { start_hour: 9, end_hour: 17, timezone: 'America/New_York' };
  const time = new Date('2025-06-15T17:00:00Z'); // 1pm ET
  assertEquals(isWithinTimeWindow(tw, time), true);
});

Deno.test('isWithinTimeWindow: timezone outside range', () => {
  // 2025-06-15T22:00:00Z = 2025-06-15T18:00 in America/New_York (EDT, UTC-4)
  const tw: TimeWindow = { start_hour: 9, end_hour: 17, timezone: 'America/New_York' };
  const time = new Date('2025-06-15T22:00:00Z'); // 6pm ET, outside 9-17
  assertEquals(isWithinTimeWindow(tw, time), false);
});

// ============================================
// checkAllowedArgs — argument-value whitelisting
// ============================================

Deno.test('checkAllowedArgs: allows when arg matches whitelist', () => {
  const result = checkAllowedArgs(
    { region: ['us-east', 'eu-west'] },
    { region: 'us-east' }
  );
  assertEquals(result.allowed, true);
});

Deno.test('checkAllowedArgs: blocks when arg not in whitelist', () => {
  const result = checkAllowedArgs(
    { region: ['us-east', 'eu-west'] },
    { region: 'ap-south' }
  );
  assertEquals(result.allowed, false);
  assertEquals(result.reason?.includes("'region'"), true);
  assertEquals(result.reason?.includes('ap-south'), true);
});

Deno.test('checkAllowedArgs: skips args not in whitelist (unrestricted)', () => {
  const result = checkAllowedArgs(
    { region: ['us-east'] },
    { region: 'us-east', format: 'csv' }
  );
  assertEquals(result.allowed, true);
});

Deno.test('checkAllowedArgs: skips when whitelisted param not provided', () => {
  const result = checkAllowedArgs(
    { region: ['us-east'] },
    { format: 'json' }
  );
  assertEquals(result.allowed, true);
});

Deno.test('checkAllowedArgs: number values', () => {
  const result = checkAllowedArgs(
    { limit: [10, 50, 100] },
    { limit: 50 }
  );
  assertEquals(result.allowed, true);
});

Deno.test('checkAllowedArgs: number value not in whitelist', () => {
  const result = checkAllowedArgs(
    { limit: [10, 50, 100] },
    { limit: 25 }
  );
  assertEquals(result.allowed, false);
});

Deno.test('checkAllowedArgs: boolean values', () => {
  const result = checkAllowedArgs(
    { confirmed: [true] },
    { confirmed: true }
  );
  assertEquals(result.allowed, true);
});

Deno.test('checkAllowedArgs: boolean false blocked when only true allowed', () => {
  const result = checkAllowedArgs(
    { confirmed: [true] },
    { confirmed: false }
  );
  assertEquals(result.allowed, false);
});

Deno.test('checkAllowedArgs: multiple params, all valid', () => {
  const result = checkAllowedArgs(
    { region: ['us-east'], format: ['json', 'csv'] },
    { region: 'us-east', format: 'json' }
  );
  assertEquals(result.allowed, true);
});

Deno.test('checkAllowedArgs: multiple params, second invalid', () => {
  const result = checkAllowedArgs(
    { region: ['us-east'], format: ['json', 'csv'] },
    { region: 'us-east', format: 'xml' }
  );
  assertEquals(result.allowed, false);
  assertEquals(result.reason?.includes("'format'"), true);
});

Deno.test('checkAllowedArgs: empty whitelist blocks all values', () => {
  const result = checkAllowedArgs(
    { region: [] },
    { region: 'us-east' }
  );
  assertEquals(result.allowed, false);
});

Deno.test('checkAllowedArgs: empty callArgs always passes', () => {
  const result = checkAllowedArgs(
    { region: ['us-east'] },
    {}
  );
  assertEquals(result.allowed, true);
});

// ============================================
// getBudgetPeriodStart — budget period calculations
// ============================================

Deno.test('getBudgetPeriodStart: hourly period', () => {
  const now = new Date('2025-06-15T14:37:22Z');
  const start = getBudgetPeriodStart('hour', now);
  assertEquals(start.getMinutes(), 0);
  assertEquals(start.getSeconds(), 0);
});

Deno.test('getBudgetPeriodStart: daily period', () => {
  const now = new Date('2025-06-15T14:37:22Z');
  const start = getBudgetPeriodStart('day', now);
  assertEquals(start.getUTCHours(), 0);
  assertEquals(start.getUTCMinutes(), 0);
  assertEquals(start.getUTCDate(), 15);
});

Deno.test('getBudgetPeriodStart: weekly period starts Sunday', () => {
  // 2025-06-18 is Wednesday
  const now = new Date('2025-06-18T14:37:22Z');
  const start = getBudgetPeriodStart('week', now);
  assertEquals(start.getUTCDay(), 0); // Sunday
  assertEquals(start.getUTCHours(), 0);
});

Deno.test('getBudgetPeriodStart: monthly period', () => {
  const now = new Date('2025-06-15T14:37:22Z');
  const start = getBudgetPeriodStart('month', now);
  assertEquals(start.getUTCDate(), 1);
  assertEquals(start.getUTCHours(), 0);
  assertEquals(start.getUTCMonth(), 5); // June = 5
});

Deno.test('getBudgetPeriodStart: unknown period returns epoch', () => {
  const start = getBudgetPeriodStart('lifetime');
  assertEquals(start.getTime(), 0);
});
