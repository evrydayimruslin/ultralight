// Rate Limiting Service
// Uses Supabase table + RPC function for persistent, distributed rate limiting

// @ts-ignore - Deno is available in Deno Deploy
const Deno = globalThis.Deno;

// ============================================
// TYPES
// ============================================

export interface RateLimitConfig {
  endpoint: string;
  limit: number;
  windowMinutes: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

// Default rate limits by endpoint
export const RATE_LIMITS: Record<string, RateLimitConfig> = {
  'mcp:tools/list': { endpoint: 'mcp:tools/list', limit: 30, windowMinutes: 1 },
  'mcp:tools/call': { endpoint: 'mcp:tools/call', limit: 100, windowMinutes: 1 },
  'mcp:initialize': { endpoint: 'mcp:initialize', limit: 10, windowMinutes: 1 },
  'generate-docs': { endpoint: 'generate-docs', limit: 10, windowMinutes: 60 },
  'discover': { endpoint: 'discover', limit: 60, windowMinutes: 1 },
};

// ============================================
// RATE LIMIT SERVICE
// ============================================

export class RateLimitService {
  private supabaseUrl: string;
  private supabaseKey: string;

  constructor() {
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!url || !key) {
      throw new Error('Supabase credentials not configured');
    }

    this.supabaseUrl = url;
    this.supabaseKey = key;
  }

  /**
   * Check if a request is allowed under rate limits
   * Uses Supabase RPC function for atomic increment + check
   */
  async checkLimit(
    userId: string,
    endpoint: string,
    limit?: number,
    windowMinutes?: number
  ): Promise<RateLimitResult> {
    // Get config for this endpoint, or use defaults
    const config = RATE_LIMITS[endpoint] || { endpoint, limit: 100, windowMinutes: 1 };
    const effectiveLimit = limit ?? config.limit;
    const effectiveWindow = windowMinutes ?? config.windowMinutes;

    try {
      // Call Supabase RPC function
      const response = await fetch(`${this.supabaseUrl}/rest/v1/rpc/check_rate_limit`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.supabaseKey}`,
          'apikey': this.supabaseKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          p_user_id: userId,
          p_endpoint: endpoint,
          p_limit: effectiveLimit,
          p_window_minutes: effectiveWindow,
        }),
      });

      if (!response.ok) {
        // If rate limit table/function doesn't exist yet, allow the request
        // This gracefully handles the case before migration is run
        console.warn('Rate limit check failed, allowing request:', await response.text());
        return {
          allowed: true,
          remaining: effectiveLimit,
          resetAt: new Date(Date.now() + effectiveWindow * 60 * 1000),
        };
      }

      const allowed = await response.json();

      // Calculate remaining and reset time
      const windowStart = new Date();
      windowStart.setSeconds(0, 0); // Truncate to minute
      const resetAt = new Date(windowStart.getTime() + effectiveWindow * 60 * 1000);

      return {
        allowed: allowed === true,
        remaining: allowed ? effectiveLimit - 1 : 0, // Approximate
        resetAt,
      };

    } catch (err) {
      // On error, allow the request but log it
      console.error('Rate limit error:', err);
      return {
        allowed: true,
        remaining: effectiveLimit,
        resetAt: new Date(Date.now() + effectiveWindow * 60 * 1000),
      };
    }
  }

  /**
   * Get rate limit headers for response
   */
  getRateLimitHeaders(result: RateLimitResult, endpoint: string): Record<string, string> {
    const config = RATE_LIMITS[endpoint] || { limit: 100 };
    return {
      'X-RateLimit-Limit': String(config.limit),
      'X-RateLimit-Remaining': String(result.remaining),
      'X-RateLimit-Reset': String(Math.floor(result.resetAt.getTime() / 1000)),
    };
  }
}

// ============================================
// IN-MEMORY FALLBACK (for development/testing)
// ============================================

const inMemoryLimits = new Map<string, { count: number; resetAt: number }>();

/**
 * Simple in-memory rate limiter (fallback when Supabase not available)
 */
export function checkInMemoryLimit(
  userId: string,
  endpoint: string,
  limit = 100,
  windowMs = 60000
): RateLimitResult {
  const key = `${userId}:${endpoint}`;
  const now = Date.now();

  let entry = inMemoryLimits.get(key);

  // Reset if window expired
  if (!entry || entry.resetAt < now) {
    entry = { count: 0, resetAt: now + windowMs };
    inMemoryLimits.set(key, entry);
  }

  entry.count++;
  const allowed = entry.count <= limit;

  return {
    allowed,
    remaining: Math.max(0, limit - entry.count),
    resetAt: new Date(entry.resetAt),
  };
}

// Cleanup old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of inMemoryLimits) {
    if (entry.resetAt < now) {
      inMemoryLimits.delete(key);
    }
  }
}, 60000); // Every minute

// ============================================
// FACTORY
// ============================================

let rateLimitService: RateLimitService | null = null;

export function createRateLimitService(): RateLimitService {
  if (!rateLimitService) {
    rateLimitService = new RateLimitService();
  }
  return rateLimitService;
}

/**
 * Check rate limit with fallback to in-memory if Supabase fails
 */
export async function checkRateLimit(
  userId: string,
  endpoint: string,
  limit?: number,
  windowMinutes?: number
): Promise<RateLimitResult> {
  try {
    const service = createRateLimitService();
    return await service.checkLimit(userId, endpoint, limit, windowMinutes);
  } catch {
    // Fallback to in-memory
    const config = RATE_LIMITS[endpoint] || { limit: 100, windowMinutes: 1 };
    return checkInMemoryLimit(
      userId,
      endpoint,
      limit ?? config.limit,
      (windowMinutes ?? config.windowMinutes) * 60 * 1000
    );
  }
}
