// Discovery Handler
// REST API for agent-accessible app discovery
// Supports both authenticated (private + public) and unauthenticated (public only) access
//
// Endpoints:
//   GET  /api/discover?q=<query>&limit=<n>     — Semantic search (no auth = public only)
//   POST /api/discover                          — Semantic search (body: { query, limit, threshold })
//   GET  /api/discover/featured?limit=<n>       — Top apps by community signal
//   GET  /api/discover/marketplace?q=&type=&limit= — Unified apps+skills browse/search
//   GET  /api/discover/status                   — Service health check
//   GET  /api/discover/openapi.json             — OpenAPI 3.1 spec for self-describing API

import { json, error } from './app.ts';
import { authenticate } from './auth.ts';
import {
  createEmbeddingService,
  isEmbeddingAvailable,
} from '../services/embedding.ts';
import { createAppsService } from '../services/apps.ts';
import { checkRateLimit } from '../services/ratelimit.ts';
import type { EnvSchemaEntry } from '../../shared/types/index.ts';

// @ts-ignore - Deno is available in Deno Deploy
const Deno = globalThis.Deno;

// ============================================
// TYPES
// ============================================

interface AuthUser {
  id: string;
  openrouter_api_key?: string;
}

interface AppRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  owner_id: string;
  visibility: string;
  likes: number;
  dislikes: number;
  weighted_likes: number;
  weighted_dislikes: number;
  runs_30d: number;
  env_schema: Record<string, EnvSchemaEntry> | null;
  similarity?: number;
  hosting_suspended?: boolean;
}

interface ScoredApp {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  similarity: number;
  final_score: number;
  type: 'app';
  mcp_endpoint: string;
  http_endpoint: string;
  likes: number;
  dislikes: number;
  runs_30d: number;
  fully_native: boolean;
  is_owner?: boolean;
}

const DISCOVER_VERSION = '1.1.0';

// ============================================
// STRUCTURED ERROR HELPER
// ============================================

function discoverError(
  code: string,
  message: string,
  status: number,
  hint?: string,
): Response {
  return json({
    code,
    error: message,
    ...(hint ? { hint } : {}),
    docs_url: '/api/discover/openapi.json',
  }, status);
}

// ============================================
// HANDLER
// ============================================

/**
 * Handle all /api/discover/* routes
 */
export async function handleDiscover(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // GET /api/discover — Semantic search via query params (agent-friendly)
  if (path === '/api/discover' && method === 'GET') {
    return handleGetSearch(request, url);
  }

  // POST /api/discover — Semantic search via JSON body (backward-compatible)
  if (path === '/api/discover' && method === 'POST') {
    return handlePostSearch(request);
  }

  // GET /api/discover/featured — Top apps by community signal (no embedding needed)
  if (path === '/api/discover/featured' && method === 'GET') {
    return handleFeatured(request, url);
  }

  // GET /api/discover/marketplace — Unified apps + skills browse/search
  if (path === '/api/discover/marketplace' && method === 'GET') {
    return handleMarketplace(request, url);
  }

  // GET /api/discover/status — Service health check
  if (path === '/api/discover/status' && method === 'GET') {
    return handleStatus(request);
  }

  // GET /api/discover/openapi.json — Self-describing API spec
  if (path === '/api/discover/openapi.json' && method === 'GET') {
    return handleOpenApiSpec();
  }

  return error('Not found', 404);
}

// ============================================
// GET /api/discover?q=<query>&limit=<n>
// ============================================
// The primary agent-accessible endpoint.
// Auth optional: with auth, includes private apps + personalized ranking.
// Without auth, returns public apps only.

async function handleGetSearch(request: Request, url: URL): Promise<Response> {
  const query = url.searchParams.get('q') || url.searchParams.get('query') || '';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '10', 10), 50);
  const threshold = parseFloat(url.searchParams.get('threshold') || '0.4');

  if (!query) {
    return discoverError(
      'MISSING_QUERY',
      'Missing query parameter: ?q=<search term>',
      400,
      'Try GET /api/discover?q=weather+api or GET /api/discover/featured for top apps',
    );
  }

  if (query.length < 2) {
    return discoverError('QUERY_TOO_SHORT', 'Query must be at least 2 characters', 400);
  }

  if (query.length > 500) {
    return discoverError('QUERY_TOO_LONG', 'Query must be at most 500 characters', 400);
  }

  // Optional auth — unauthenticated requests get public-only results
  let user: AuthUser | null = null;
  try {
    user = await authenticate(request);
  } catch {
    // No auth = public-only search, which is fine
  }

  // IP-based rate limiting for unauthenticated requests
  const rateLimitKey = user?.id || getClientIp(request) || 'anonymous';
  const rateLimitResult = await checkRateLimit(rateLimitKey, 'discover');
  if (!rateLimitResult.allowed) {
    return json({
      code: 'RATE_LIMITED',
      error: 'Rate limit exceeded',
      resetAt: rateLimitResult.resetAt.toISOString(),
      docs_url: '/api/discover/openapi.json',
    }, 429);
  }

  return executeSearch(query, limit, threshold, user);
}

// ============================================
// POST /api/discover (backward-compatible)
// ============================================

async function handlePostSearch(request: Request): Promise<Response> {
  // Auth required for POST (backward compat)
  let user: AuthUser;
  try {
    user = await authenticate(request);
  } catch {
    return error('Authentication required. Use GET /api/discover?q=<query> for unauthenticated access.', 401);
  }

  const rateLimitResult = await checkRateLimit(user.id, 'discover');
  if (!rateLimitResult.allowed) {
    return json({ error: 'Rate limit exceeded', resetAt: rateLimitResult.resetAt.toISOString() }, 429);
  }

  let body: { query?: string; limit?: number; threshold?: number };
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON body', 400);
  }

  const { query, limit = 20, threshold = 0.4 } = body;

  if (!query || typeof query !== 'string') {
    return error('Query is required', 400);
  }

  if (query.length < 2) {
    return error('Query must be at least 2 characters', 400);
  }

  if (query.length > 500) {
    return error('Query must be at most 500 characters', 400);
  }

  return executeSearch(query, Math.min(limit, 50), threshold, user);
}

// ============================================
// GET /api/discover/featured
// ============================================
// Returns top apps ranked by community signal — no embedding needed.
// Fast, cacheable, works without an API key.

async function handleFeatured(request: Request, url: URL): Promise<Response> {
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 50);

  const supabaseUrl = Deno?.env?.get('SUPABASE_URL');
  const supabaseKey = Deno?.env?.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseKey) {
    return error('Service unavailable', 503);
  }

  const headers = {
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`,
  };

  // Optional auth for personalization (blocked apps filtering)
  let user: AuthUser | null = null;
  try {
    user = await authenticate(request);
  } catch { /* public access is fine */ }

  // Fetch blocked apps if authenticated
  let blockedAppIds = new Set<string>();
  if (user) {
    try {
      const blocksRes = await fetch(
        `${supabaseUrl}/rest/v1/user_app_blocks?user_id=eq.${user.id}&select=app_id`,
        { headers }
      );
      if (blocksRes.ok) {
        const rows = await blocksRes.json() as Array<{ app_id: string }>;
        blockedAppIds = new Set(rows.map(r => r.app_id));
      }
    } catch { /* best effort */ }
  }

  const overFetchLimit = limit + blockedAppIds.size + 5;

  const topRes = await fetch(
    `${supabaseUrl}/rest/v1/apps?visibility=eq.public&deleted_at=is.null&hosting_suspended=eq.false` +
    `&select=id,name,slug,description,owner_id,likes,dislikes,weighted_likes,weighted_dislikes,env_schema,runs_30d` +
    `&order=weighted_likes.desc,likes.desc,runs_30d.desc` +
    `&limit=${overFetchLimit}`,
    { headers }
  );

  if (!topRes.ok) {
    return error('Failed to fetch featured apps', 500);
  }

  const topApps = await topRes.json() as AppRow[];
  const filtered = topApps.filter(a => !blockedAppIds.has(a.id)).slice(0, limit);

  const results = filtered.map(a => {
    const schema = a.env_schema || {};
    const perUserEntries = Object.entries(schema).filter(([, v]) => v.scope === 'per_user');
    const fullyNative = perUserEntries.length === 0;

    return {
      id: a.id,
      name: a.name,
      slug: a.slug,
      description: a.description,
      type: 'app' as const,
      mcp_endpoint: `/mcp/${a.id}`,
      http_endpoint: `/http/${a.id}`,
      likes: a.likes ?? 0,
      dislikes: a.dislikes ?? 0,
      runs_30d: a.runs_30d ?? 0,
      fully_native: fullyNative,
      ...(user ? { is_owner: a.owner_id === user.id } : {}),
    };
  });

  return json({
    mode: 'featured',
    results: results,
    total: results.length,
    _links: {
      search: '/api/discover?q={query}',
      openapi: '/api/discover/openapi.json',
      mcp_platform: '/mcp/platform',
      auth: '/.well-known/oauth-authorization-server',
    },
  });
}

// ============================================
// GET /api/discover/marketplace
// ============================================
// Unified endpoint for browsing/searching both apps (MCP tools) and skills (published pages).
// No query → browse mode (featured apps + recent pages).
// With query → semantic search across both types.

async function handleMarketplace(request: Request, url: URL): Promise<Response> {
  const query = url.searchParams.get('q') || '';
  const typeFilter = url.searchParams.get('type') || 'all'; // all | apps | skills
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 50);

  if (query && query.length < 2) {
    return discoverError('QUERY_TOO_SHORT', 'Query must be at least 2 characters', 400);
  }
  if (query.length > 500) {
    return discoverError('QUERY_TOO_LONG', 'Query must be at most 500 characters', 400);
  }

  const supabaseUrl = Deno?.env?.get('SUPABASE_URL');
  const supabaseKey = Deno?.env?.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !supabaseKey) {
    return error('Service unavailable', 503);
  }

  const dbHeaders = {
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`,
  };

  // Optional auth
  let user: AuthUser | null = null;
  try {
    user = await authenticate(request);
  } catch { /* public access is fine */ }

  // Rate limit
  const rateLimitKey = user?.id || getClientIp(request) || 'anonymous';
  const rateLimitResult = await checkRateLimit(rateLimitKey, 'discover');
  if (!rateLimitResult.allowed) {
    return json({
      code: 'RATE_LIMITED',
      error: 'Rate limit exceeded',
      resetAt: rateLimitResult.resetAt.toISOString(),
    }, 429);
  }

  // Fetch blocked apps if authenticated
  let blockedAppIds = new Set<string>();
  if (user) {
    try {
      const blocksRes = await fetch(
        `${supabaseUrl}/rest/v1/user_app_blocks?user_id=eq.${user.id}&select=app_id`,
        { headers: dbHeaders }
      );
      if (blocksRes.ok) {
        const rows = await blocksRes.json() as Array<{ app_id: string }>;
        blockedAppIds = new Set(rows.map(r => r.app_id));
      }
    } catch { /* best effort */ }
  }

  const includeApps = typeFilter === 'all' || typeFilter === 'apps';
  const includeSkills = typeFilter === 'all' || typeFilter === 'skills';

  // ── BROWSE MODE (no query) ──
  if (!query) {
    const results: Array<Record<string, unknown>> = [];

    // Featured apps
    if (includeApps) {
      try {
        const overFetchLimit = limit + blockedAppIds.size + 5;
        const topRes = await fetch(
          `${supabaseUrl}/rest/v1/apps?visibility=eq.public&deleted_at=is.null&hosting_suspended=eq.false` +
          `&select=id,name,slug,description,owner_id,likes,dislikes,weighted_likes,weighted_dislikes,env_schema,runs_30d` +
          `&order=weighted_likes.desc,likes.desc,runs_30d.desc` +
          `&limit=${overFetchLimit}`,
          { headers: dbHeaders }
        );
        if (topRes.ok) {
          const topApps = await topRes.json() as AppRow[];
          const filtered = topApps.filter(a => !blockedAppIds.has(a.id)).slice(0, limit);
          for (const a of filtered) {
            const schema = a.env_schema || {};
            const perUserEntries = Object.entries(schema).filter(([, v]) => v.scope === 'per_user');
            results.push({
              id: a.id,
              name: a.name,
              slug: a.slug,
              description: a.description,
              type: 'app',
              mcp_endpoint: `/mcp/${a.id}`,
              likes: a.likes ?? 0,
              runs_30d: a.runs_30d ?? 0,
              fully_native: perUserEntries.length === 0,
            });
          }
        }
      } catch { /* best effort */ }
    }

    // Recent published pages (skills)
    if (includeSkills) {
      try {
        const pagesRes = await fetch(
          `${supabaseUrl}/rest/v1/content?type=eq.page&published=eq.true&visibility=eq.public` +
          `&select=id,slug,title,description,tags,updated_at` +
          `&order=updated_at.desc` +
          `&limit=${limit}`,
          { headers: dbHeaders }
        );
        if (pagesRes.ok) {
          const pages = await pagesRes.json() as Array<{
            id: string; slug: string; title: string | null;
            description: string | null; tags: string[] | null; updated_at: string;
          }>;
          for (const p of pages) {
            results.push({
              id: p.id,
              name: p.title || p.slug,
              slug: p.slug,
              description: p.description,
              type: 'page',
              url: `/p/${p.slug}`,
              tags: p.tags || [],
            });
          }
        }
      } catch { /* best effort */ }
    }

    return json({
      mode: 'browse',
      results: results.slice(0, limit),
      total: results.length,
    });
  }

  // ── SEARCH MODE (has query) ──
  try {
    const embeddingService = createEmbeddingService(user?.openrouter_api_key);
    if (!embeddingService) {
      return json({
        error: 'Embedding service not available',
        message: 'Semantic search requires the embedding service.',
        results: [],
        total: 0,
      }, 503);
    }

    const embeddingResult = await embeddingService.embed(query);
    const overFetchLimit = limit * 3;

    interface MarketplaceResult {
      id: string;
      name: string;
      slug: string;
      description: string | null;
      type: 'app' | 'page';
      final_score: number;
      similarity: number;
      mcp_endpoint?: string;
      url?: string;
      likes?: number;
      runs_30d?: number;
      fully_native?: boolean;
      tags?: string[];
    }

    const scored: MarketplaceResult[] = [];

    // Search apps
    if (includeApps) {
      try {
        const appsService = createAppsService();
        const appResults = await appsService.searchByEmbedding(
          embeddingResult.embedding,
          user?.id || '00000000-0000-0000-0000-000000000000',
          false,
          overFetchLimit,
          0.4,
        );

        const filteredApps = appResults.filter(r =>
          !blockedAppIds.has(r.id) && !(r as Record<string, unknown>).hosting_suspended
        );

        // Fetch env schemas + metadata
        const appIds = filteredApps.map(r => r.id);
        let envSchemas = new Map<string, Record<string, EnvSchemaEntry>>();
        let appMeta = new Map<string, { weighted_likes: number; weighted_dislikes: number; runs_30d: number }>();

        if (appIds.length > 0) {
          try {
            const metaRes = await fetch(
              `${supabaseUrl}/rest/v1/apps?id=in.(${appIds.join(',')})&select=id,env_schema,weighted_likes,weighted_dislikes,runs_30d,likes,dislikes`,
              { headers: dbHeaders }
            );
            if (metaRes.ok) {
              const rows = await metaRes.json() as AppRow[];
              for (const row of rows) {
                if (row.env_schema) envSchemas.set(row.id, row.env_schema);
                appMeta.set(row.id, {
                  weighted_likes: row.weighted_likes ?? 0,
                  weighted_dislikes: row.weighted_dislikes ?? 0,
                  runs_30d: row.runs_30d ?? 0,
                });
              }
            }
          } catch { /* best effort */ }
        }

        for (const r of filteredApps) {
          const rr = r as AppRow & { similarity: number };
          const schema = envSchemas.get(rr.id) || {};
          const perUserEntries = Object.entries(schema).filter(([, v]) => v.scope === 'per_user');
          const requiredPerUser = perUserEntries.filter(([, v]) => v.required);

          let nativeBoost: number;
          if (perUserEntries.length === 0) {
            nativeBoost = 1.0;
          } else if (requiredPerUser.length === 0) {
            nativeBoost = 0.3;
          } else {
            nativeBoost = 0.0;
          }

          const meta = appMeta.get(rr.id);
          const wLikes = meta?.weighted_likes ?? 0;
          const wDislikes = meta?.weighted_dislikes ?? 0;
          const likeSignal = wLikes / (wLikes + wDislikes + 1);
          const finalScore = (rr.similarity * 0.7) + (nativeBoost * 0.15) + (likeSignal * 0.15);

          scored.push({
            id: rr.id,
            name: rr.name,
            slug: rr.slug,
            description: rr.description,
            type: 'app',
            similarity: Math.round(rr.similarity * 10000) / 10000,
            final_score: Math.round(finalScore * 10000) / 10000,
            mcp_endpoint: `/mcp/${rr.id}`,
            likes: rr.likes ?? 0,
            runs_30d: meta?.runs_30d ?? 0,
            fully_native: perUserEntries.length === 0,
          });
        }
      } catch { /* best effort */ }
    }

    // Search skills (published pages)
    if (includeSkills) {
      try {
        const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/search_content`, {
          method: 'POST',
          headers: { ...dbHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            p_query_embedding: JSON.stringify(embeddingResult.embedding),
            p_user_id: user?.id || '00000000-0000-0000-0000-000000000000',
            p_types: ['page'],
            p_visibility: 'public',
            p_limit: overFetchLimit,
          }),
        });

        if (rpcRes.ok) {
          const pageRows = await rpcRes.json() as Array<{
            id: string; slug: string; title: string | null;
            description: string | null; similarity: number;
            tags: string[] | null; published: boolean;
          }>;

          const publishedPages = pageRows.filter(r => r.published);
          for (const r of publishedPages) {
            const finalScore = (r.similarity * 0.7) + (0.5 * 0.15) + (0 * 0.15);
            scored.push({
              id: r.id,
              name: r.title || r.slug,
              slug: r.slug,
              description: r.description,
              type: 'page',
              similarity: Math.round(r.similarity * 10000) / 10000,
              final_score: Math.round(finalScore * 10000) / 10000,
              url: `/p/${r.slug}`,
              tags: r.tags || [],
            });
          }
        }
      } catch { /* best effort — page search failure shouldn't break app search */ }
    }

    // Sort by final_score DESC
    scored.sort((a, b) => b.final_score - a.final_score);

    const finalResults = scored.slice(0, limit);

    return json({
      mode: 'search',
      query: query,
      results: finalResults,
      total: finalResults.length,
    });

  } catch (err) {
    console.error('Marketplace search error:', err);
    return json({
      error: 'Search failed',
      message: err instanceof Error ? err.message : String(err),
      results: [],
      total: 0,
    }, 500);
  }
}

// ============================================
// CORE SEARCH — Full appstore ranking
// ============================================
// Composite score: (similarity * 0.7) + (native_boost * 0.15) + (like_signal * 0.15)
// Same algorithm as ul.discover.appstore in platform-mcp.ts

async function executeSearch(
  query: string,
  limit: number,
  threshold: number,
  user: AuthUser | null
): Promise<Response> {
  // Check embedding service
  const embeddingService = createEmbeddingService(user?.openrouter_api_key);
  if (!embeddingService) {
    return json({
      error: 'Embedding service not available',
      message: 'Semantic search requires the embedding service. Try GET /api/discover/featured instead.',
      results: [],
      total: 0,
    }, 503);
  }

  const supabaseUrl = Deno?.env?.get('SUPABASE_URL');
  const supabaseKey = Deno?.env?.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseKey) {
    return error('Service unavailable', 503);
  }

  const dbHeaders = {
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`,
  };

  try {
    // Generate query embedding
    const embeddingResult = await embeddingService.embed(query);

    // Over-fetch 3x for re-ranking pool
    const overFetchLimit = limit * 3;

    // Search apps by embedding similarity
    const appsService = createAppsService();
    const results = await appsService.searchByEmbedding(
      embeddingResult.embedding,
      user?.id || '00000000-0000-0000-0000-000000000000', // dummy UUID for public-only
      false, // public only (authenticated users also search public — private via MCP)
      overFetchLimit,
      threshold,
    );

    // Fetch blocked apps if authenticated
    let blockedAppIds = new Set<string>();
    if (user) {
      try {
        const blocksRes = await fetch(
          `${supabaseUrl}/rest/v1/user_app_blocks?user_id=eq.${user.id}&select=app_id`,
          { headers: dbHeaders }
        );
        if (blocksRes.ok) {
          const rows = await blocksRes.json() as Array<{ app_id: string }>;
          blockedAppIds = new Set(rows.map(r => r.app_id));
        }
      } catch { /* best effort */ }
    }

    // Filter blocked/suspended
    const filteredResults = results.filter(r =>
      !blockedAppIds.has(r.id) && !(r as Record<string, unknown>).hosting_suspended
    );

    // Fetch env schemas for native_boost calculation
    const appIds = filteredResults.map(r => r.id);

    let envSchemas = new Map<string, Record<string, EnvSchemaEntry>>();
    if (appIds.length > 0) {
      try {
        const schemaRes = await fetch(
          `${supabaseUrl}/rest/v1/apps?id=in.(${appIds.join(',')})&select=id,env_schema,likes,dislikes,weighted_likes,weighted_dislikes,runs_30d`,
          { headers: dbHeaders }
        );
        if (schemaRes.ok) {
          const rows = await schemaRes.json() as AppRow[];
          for (const row of rows) {
            if (row.env_schema) envSchemas.set(row.id, row.env_schema);
          }
        }
      } catch { /* best effort */ }
    }

    // Fetch app metadata for likes/runs (from the env_schema query above, we already have it)
    let appMeta = new Map<string, { weighted_likes: number; weighted_dislikes: number; runs_30d: number }>();
    if (appIds.length > 0) {
      try {
        const metaRes = await fetch(
          `${supabaseUrl}/rest/v1/apps?id=in.(${appIds.join(',')})&select=id,weighted_likes,weighted_dislikes,runs_30d`,
          { headers: dbHeaders }
        );
        if (metaRes.ok) {
          const rows = await metaRes.json() as Array<{ id: string; weighted_likes: number; weighted_dislikes: number; runs_30d: number }>;
          for (const row of rows) {
            appMeta.set(row.id, {
              weighted_likes: row.weighted_likes ?? 0,
              weighted_dislikes: row.weighted_dislikes ?? 0,
              runs_30d: row.runs_30d ?? 0,
            });
          }
        }
      } catch { /* best effort */ }
    }

    // Composite re-ranking
    const scored: ScoredApp[] = filteredResults.map(r => {
      const rr = r as AppRow & { similarity: number };

      const schema = envSchemas.get(rr.id) || {};
      const perUserEntries = Object.entries(schema).filter(([, v]) => v.scope === 'per_user');
      const requiredPerUser = perUserEntries.filter(([, v]) => v.required);

      let nativeBoost: number;
      if (perUserEntries.length === 0) {
        nativeBoost = 1.0;  // No integrations needed — fully native
      } else if (requiredPerUser.length === 0) {
        nativeBoost = 0.3;  // Optional integrations only
      } else {
        nativeBoost = 0.0;  // Requires setup (unauthenticated can't check connection)
      }

      const meta = appMeta.get(rr.id);
      const wLikes = meta?.weighted_likes ?? 0;
      const wDislikes = meta?.weighted_dislikes ?? 0;
      const likeSignal = wLikes / (wLikes + wDislikes + 1);

      const finalScore = (rr.similarity * 0.7) + (nativeBoost * 0.15) + (likeSignal * 0.15);

      return {
        id: rr.id,
        name: rr.name,
        slug: rr.slug,
        description: rr.description,
        similarity: Math.round(rr.similarity * 10000) / 10000,
        final_score: Math.round(finalScore * 10000) / 10000,
        type: 'app' as const,
        mcp_endpoint: `/mcp/${rr.id}`,
        http_endpoint: `/http/${rr.id}`,
        likes: rr.likes ?? 0,
        dislikes: rr.dislikes ?? 0,
        runs_30d: meta?.runs_30d ?? 0,
        fully_native: perUserEntries.length === 0,
        ...(user ? { is_owner: rr.owner_id === user.id } : {}),
      };
    });

    // Sort by final_score DESC
    scored.sort((a, b) => b.final_score - a.final_score);

    // Luck shuffle top 5
    if (scored.length >= 2) {
      const shuffleCount = Math.min(5, scored.length);
      const topSlice = scored.slice(0, shuffleCount);
      const topScore = topSlice[0].final_score;

      const shuffled = topSlice.map(item => {
        const gap = topScore - item.final_score;
        const luckBonus = Math.random() * gap * 0.5;
        return { item: item, shuffledScore: item.final_score + luckBonus };
      });
      shuffled.sort((a, b) => b.shuffledScore - a.shuffledScore);

      for (let i = 0; i < shuffleCount; i++) {
        scored[i] = shuffled[i].item;
      }
    }

    // Truncate
    const finalResults = scored.slice(0, limit);

    // Log query (fire-and-forget)
    const queryId = crypto.randomUUID();
    try {
      fetch(`${supabaseUrl}/rest/v1/appstore_queries`, {
        method: 'POST',
        headers: { ...dbHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: queryId,
          query: query,
          top_similarity: finalResults.length > 0 ? finalResults[0].similarity : null,
          top_final_score: finalResults.length > 0 ? finalResults[0].final_score : null,
          result_count: finalResults.length,
          results: finalResults.map((r, i) => ({
            app_id: r.id,
            content_id: null,
            position: i + 1,
            final_score: r.final_score,
            similarity: r.similarity,
            type: 'app',
          })),
        }),
      }).catch(err => console.error('Failed to log discovery query:', err));
    } catch { /* best effort */ }

    return json({
      mode: 'search',
      query: query,
      query_id: queryId,
      authenticated: !!user,
      results: finalResults,
      total: finalResults.length,
      _links: {
        featured: '/api/discover/featured',
        openapi: '/api/discover/openapi.json',
        mcp_platform: '/mcp/platform',
        auth: '/.well-known/oauth-authorization-server',
      },
    });

  } catch (err) {
    console.error('Discovery search error:', err);
    return json({
      error: 'Search failed',
      message: err instanceof Error ? err.message : String(err),
      results: [],
      total: 0,
    }, 500);
  }
}

// ============================================
// GET /api/discover/status
// ============================================

async function handleStatus(request: Request): Promise<Response> {
  let user: AuthUser | null = null;
  try {
    user = await authenticate(request);
  } catch {
    // Auth optional for status check
  }

  const hasUserKey = !!user?.openrouter_api_key;
  const hasSystemKey = isEmbeddingAvailable();
  const isAvailable = hasUserKey || hasSystemKey;

  // Fetch public app count for operational metrics
  let appCount = 0;
  try {
    const supabaseUrl = Deno?.env?.get('SUPABASE_URL');
    const supabaseKey = Deno?.env?.get('SUPABASE_SERVICE_ROLE_KEY');
    if (supabaseUrl && supabaseKey) {
      const countRes = await fetch(
        `${supabaseUrl}/rest/v1/apps?visibility=eq.public&deleted_at=is.null&select=id`,
        {
          method: 'HEAD',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Prefer': 'count=exact',
          },
        }
      );
      const contentRange = countRes.headers.get('content-range');
      if (contentRange) {
        const total = contentRange.split('/')[1];
        if (total && total !== '*') {
          appCount = parseInt(total, 10);
        }
      }
    }
  } catch { /* best effort */ }

  return json({
    available: isAvailable,
    authenticated: !!user,
    version: DISCOVER_VERSION,
    timestamp: new Date().toISOString(),
    app_count: appCount,
    endpoints: {
      search_get: 'GET /api/discover?q={query}&limit={n}',
      search_post: 'POST /api/discover { query, limit, threshold }',
      featured: 'GET /api/discover/featured?limit={n}',
      status: 'GET /api/discover/status',
      openapi: 'GET /api/discover/openapi.json',
      mcp_platform: 'POST /mcp/platform (full MCP access)',
    },
    message: isAvailable
      ? 'Discovery service is available. Use ?q=<query> to search.'
      : 'Semantic search available with system key. Authenticate for personalized results.',
  });
}

// ============================================
// GET /api/discover/openapi.json
// ============================================
// Self-describing API spec so agents can auto-discover our discovery endpoint.

function handleOpenApiSpec(): Response {
  const spec = {
    openapi: '3.1.0',
    info: {
      title: 'Ultralight Discovery API',
      description: 'Semantic search across the Ultralight MCP app ecosystem. Find agent-callable tools by natural language query. Every result includes an mcp_endpoint for direct JSON-RPC 2.0 access.',
      version: '1.0.0',
      contact: { name: 'Ultralight', url: 'https://ultralight.dev' },
    },
    servers: [
      { url: 'https://ultralight-api-iikqz.ondigitalocean.app', description: 'Production' },
    ],
    paths: {
      '/api/discover': {
        get: {
          operationId: 'searchApps',
          summary: 'Search for MCP apps by natural language query',
          description: 'Semantic search using pgvector embeddings with composite ranking (similarity * 0.7 + native_boost * 0.15 + community_signal * 0.15). Auth optional — unauthenticated requests return public apps only.',
          parameters: [
            { name: 'q', in: 'query', required: true, schema: { type: 'string', minLength: 2, maxLength: 500 }, description: 'Natural language search query', example: 'weather API' },
            { name: 'limit', in: 'query', required: false, schema: { type: 'integer', default: 10, maximum: 50 }, description: 'Max results to return' },
            { name: 'threshold', in: 'query', required: false, schema: { type: 'number', default: 0.4, minimum: 0, maximum: 1 }, description: 'Minimum similarity threshold' },
          ],
          security: [{ bearerAuth: [] }, {}],
          responses: {
            '200': {
              description: 'Search results with MCP endpoints',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      mode: { type: 'string', enum: ['search'] },
                      query: { type: 'string' },
                      query_id: { type: 'string', format: 'uuid' },
                      authenticated: { type: 'boolean' },
                      results: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            id: { type: 'string', format: 'uuid' },
                            name: { type: 'string' },
                            slug: { type: 'string' },
                            description: { type: 'string', nullable: true },
                            similarity: { type: 'number', description: 'Cosine similarity (0-1)' },
                            final_score: { type: 'number', description: 'Composite ranking score' },
                            mcp_endpoint: { type: 'string', description: 'JSON-RPC 2.0 endpoint for this app' },
                            http_endpoint: { type: 'string', description: 'HTTP REST endpoint base path for this app' },
                            likes: { type: 'integer' },
                            runs_30d: { type: 'integer' },
                            fully_native: { type: 'boolean', description: 'True if no per-user setup needed' },
                            is_owner: { type: 'boolean', description: 'True if authenticated user owns this app (only present when authenticated)' },
                          },
                        },
                      },
                      total: { type: 'integer' },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          operationId: 'searchAppsPost',
          summary: 'Search for MCP apps (POST, auth required)',
          description: 'Same as GET but accepts JSON body. Requires authentication.',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['query'],
                  properties: {
                    query: { type: 'string' },
                    limit: { type: 'integer', default: 20 },
                    threshold: { type: 'number', default: 0.4 },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Search results (same shape as GET)' } },
        },
      },
      '/api/discover/featured': {
        get: {
          operationId: 'getFeaturedApps',
          summary: 'Get top-ranked apps by community signal',
          description: 'No embedding needed. Returns apps ranked by weighted likes, total likes, and 30-day run count.',
          parameters: [
            { name: 'limit', in: 'query', required: false, schema: { type: 'integer', default: 20, maximum: 50 } },
          ],
          security: [{ bearerAuth: [] }, {}],
          responses: { '200': { description: 'Featured apps list' } },
        },
      },
      '/mcp/platform': {
        post: {
          operationId: 'mcpPlatform',
          summary: 'Full MCP platform access (JSON-RPC 2.0)',
          description: 'Complete platform MCP with 32 tools: upload, test, lint, scaffold, discover.desk/library/appstore, settings, permissions, and more. Use this for the richest agent experience.',
          security: [{ bearerAuth: [] }],
        },
      },
      '/api/mcp-config/{appId}': {
        get: {
          operationId: 'getMcpConfig',
          summary: 'Get ready-to-paste MCP client config for an app',
          description: 'Returns a JSON config snippet you can paste directly into Claude Desktop, Cursor, or other MCP clients.',
          parameters: [
            { name: 'appId', in: 'path', required: true, schema: { type: 'string' }, description: 'App ID' },
            { name: 'client', in: 'query', required: false, schema: { type: 'string', enum: ['claude', 'cursor', 'raw'], default: 'claude' }, description: 'Client format' },
          ],
          responses: {
            '200': { description: 'MCP client config JSON' },
            '404': { description: 'App not found or not public' },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'Ultralight API token (ul_xxx) or OAuth 2.1 token. Obtain via POST /oauth/token or create at ultralight.dev settings.',
        },
      },
    },
  };

  return new Response(JSON.stringify(spec, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

// ============================================
// HELPERS
// ============================================

function getClientIp(request: Request): string | null {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || null;
}
