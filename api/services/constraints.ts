/**
 * Granular Permission Constraint Enforcement
 *
 * Checks IP allowlists, time windows, usage budgets, and expiry dates
 * against permission rows at MCP call time. Pro-only feature.
 */

import type { PermissionRow, TimeWindow } from '../../shared/types/index.ts';

export interface ConstraintCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Check all constraints on a permission row.
 * Returns { allowed: true } if all pass, or { allowed: false, reason } on first failure.
 */
export function checkConstraints(
  row: PermissionRow,
  clientIp: string | null,
  now?: Date
): ConstraintCheckResult {
  const currentTime = now || new Date();

  // 1. Expiry check
  if (row.expires_at) {
    const expiresAt = new Date(row.expires_at);
    if (currentTime >= expiresAt) {
      return { allowed: false, reason: `Permission expired at ${row.expires_at}` };
    }
  }

  // 2. IP allowlist check
  if (row.allowed_ips && row.allowed_ips.length > 0 && clientIp) {
    if (!isIpAllowed(clientIp, row.allowed_ips)) {
      return { allowed: false, reason: `IP ${clientIp} not in allowlist` };
    }
  }

  // 3. Time window check
  if (row.time_window) {
    const timeResult = isWithinTimeWindow(row.time_window, currentTime);
    if (!timeResult) {
      return { allowed: false, reason: 'Outside allowed time window' };
    }
  }

  // 4. Budget check (budget_used is checked but NOT incremented here — see incrementBudget)
  if (row.budget_limit !== null && row.budget_limit > 0) {
    if (row.budget_used >= row.budget_limit) {
      return { allowed: false, reason: `Usage budget exhausted (${row.budget_used}/${row.budget_limit})` };
    }
  }

  return { allowed: true };
}

/**
 * Check if a client IP is in the allowed list.
 * Supports exact match and CIDR notation (e.g. "10.0.0.0/8").
 */
export function isIpAllowed(clientIp: string, allowedIps: string[]): boolean {
  for (const entry of allowedIps) {
    if (entry.includes('/')) {
      // CIDR match
      if (isIpInCidr(clientIp, entry)) return true;
    } else {
      // Exact match
      if (clientIp === entry) return true;
    }
  }
  return false;
}

/**
 * Check if an IP address falls within a CIDR range.
 * Supports IPv4 only (covers vast majority of use cases).
 */
function isIpInCidr(ip: string, cidr: string): boolean {
  const [cidrIp, prefixStr] = cidr.split('/');
  const prefix = parseInt(prefixStr, 10);
  if (isNaN(prefix) || prefix < 0 || prefix > 32) return false;

  const ipNum = ipToNumber(ip);
  const cidrNum = ipToNumber(cidrIp);
  if (ipNum === null || cidrNum === null) return false;

  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipNum & mask) === (cidrNum & mask);
}

function ipToNumber(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let num = 0;
  for (const part of parts) {
    const n = parseInt(part, 10);
    if (isNaN(n) || n < 0 || n > 255) return null;
    num = (num << 8) | n;
  }
  return num >>> 0; // Convert to unsigned
}

/**
 * Check if the current time falls within a time window.
 */
export function isWithinTimeWindow(tw: TimeWindow, now: Date): boolean {
  // Convert to the specified timezone
  const tz = tw.timezone || 'UTC';
  let localHour: number;
  let localDay: number;

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      hour12: false,
      weekday: 'short',
    });
    const parts = formatter.formatToParts(now);
    const hourPart = parts.find(p => p.type === 'hour');
    const dayPart = parts.find(p => p.type === 'weekday');

    localHour = parseInt(hourPart?.value || '0', 10);

    // Map weekday short name to number (0=Sunday)
    const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    localDay = dayMap[dayPart?.value || 'Sun'] ?? 0;
  } catch {
    // Fallback to UTC
    localHour = now.getUTCHours();
    localDay = now.getUTCDay();
  }

  // Check day of week
  if (tw.days && tw.days.length > 0) {
    if (!tw.days.includes(localDay)) return false;
  }

  // Check hour range
  const { start_hour, end_hour } = tw;
  if (start_hour <= end_hour) {
    // Normal range: e.g. 9-17
    return localHour >= start_hour && localHour < end_hour;
  } else {
    // Wraps past midnight: e.g. 22-6 (10pm to 6am)
    return localHour >= start_hour || localHour < end_hour;
  }
}

/**
 * Get the budget period start for the current period.
 * Used to determine if budget_used should be reset.
 */
export function getBudgetPeriodStart(period: string, now?: Date): Date {
  const currentTime = now || new Date();

  switch (period) {
    case 'hour': {
      const d = new Date(currentTime);
      d.setMinutes(0, 0, 0);
      return d;
    }
    case 'day': {
      const d = new Date(currentTime);
      d.setUTCHours(0, 0, 0, 0);
      return d;
    }
    case 'week': {
      const d = new Date(currentTime);
      const day = d.getUTCDay();
      d.setUTCDate(d.getUTCDate() - day);
      d.setUTCHours(0, 0, 0, 0);
      return d;
    }
    case 'month': {
      const d = new Date(currentTime);
      d.setUTCDate(1);
      d.setUTCHours(0, 0, 0, 0);
      return d;
    }
    default:
      // No period = lifetime budget, never resets
      return new Date(0);
  }
}
