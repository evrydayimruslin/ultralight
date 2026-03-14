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
//   GET  /api/onboarding/instructions           — Dynamic onboarding copy template

import { json, error } from './app.ts';
import { authenticate } from './auth.ts';
import { logOnboardingRequest } from '../services/provisional.ts';
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
  had_external_db?: boolean;
  similarity?: number;
  hosting_suspended?: boolean;
  category?: string | null;
  featured_at?: string | null;
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

  // GET /api/discover/stats — Platform statistics for ticker tape
  if (path === '/api/discover/stats' && method === 'GET') {
    return handlePlatformStats();
  }

  // GET /api/discover/newly-published — Recently published capabilities
  if (path === '/api/discover/newly-published' && method === 'GET') {
    return handleNewlyPublished(url);
  }

  // GET /api/discover/newly-acquired — Recent marketplace acquisitions
  if (path === '/api/discover/newly-acquired' && method === 'GET') {
    return handleNewlyAcquired(url);
  }

  // GET /api/discover/leaderboard — Highest grossing profiles
  if (path === '/api/discover/leaderboard' && method === 'GET') {
    return handleLeaderboard(url);
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

  // Fetch blocked apps + content if authenticated
  let blockedAppIds = new Set<string>();
  let blockedContentIds = new Set<string>();
  if (user) {
    try {
      const [appBlocksRes, contentBlocksRes] = await Promise.all([
        fetch(
          `${supabaseUrl}/rest/v1/user_app_blocks?user_id=eq.${user.id}&select=app_id`,
          { headers: dbHeaders }
        ),
        fetch(
          `${supabaseUrl}/rest/v1/user_content_blocks?user_id=eq.${user.id}&select=content_id`,
          { headers: dbHeaders }
        ),
      ]);
      if (appBlocksRes.ok) {
        const rows = await appBlocksRes.json() as Array<{ app_id: string }>;
        blockedAppIds = new Set(rows.map(r => r.app_id));
      }
      if (contentBlocksRes.ok) {
        const rows = await contentBlocksRes.json() as Array<{ content_id: string }>;
        blockedContentIds = new Set(rows.map(r => r.content_id));
      }
    } catch { /* best effort */ }
  }

  const includeApps = typeFilter === 'all' || typeFilter === 'apps';
  const includeSkills = typeFilter === 'all' || typeFilter === 'skills';

  // ── BROWSE MODE (no query) ──
  if (!query) {
    const format = url.searchParams.get('format') || 'flat';

    // Helper: convert AppRow to result object
    function appToResult(a: AppRow) {
      const schema = a.env_schema || {};
      const perUserEntries = Object.entries(schema).filter(([, v]) => v.scope === 'per_user');
      return {
        id: a.id,
        name: a.name,
        slug: a.slug,
        description: a.description,
        type: 'app' as const,
        mcp_endpoint: `/mcp/${a.id}`,
        likes: a.likes ?? 0,
        runs_30d: a.runs_30d ?? 0,
        fully_native: perUserEntries.length === 0,
        had_external_db: !!a.had_external_db,
      };
    }

    // Fetch all public apps with category + featured_at for sectioning
    let allApps: AppRow[] = [];
    if (includeApps) {
      try {
        const overFetchLimit = limit * 5 + blockedAppIds.size + 10;
        const topRes = await fetch(
          `${supabaseUrl}/rest/v1/apps?visibility=eq.public&deleted_at=is.null&hosting_suspended=eq.false` +
          `&select=id,name,slug,description,owner_id,likes,dislikes,weighted_likes,weighted_dislikes,env_schema,runs_30d,category,featured_at,had_external_db` +
          `&order=weighted_likes.desc,likes.desc,runs_30d.desc` +
          `&limit=${overFetchLimit}`,
          { headers: dbHeaders }
        );
        if (topRes.ok) {
          const raw = await topRes.json() as AppRow[];
          allApps = raw.filter(a => !blockedAppIds.has(a.id));
        } else {
          console.error('[MARKETPLACE] Apps query failed:', topRes.status, await topRes.text());
        }
      } catch (err) {
        console.error('[MARKETPLACE] Apps query error:', err);
      }
    }

    // Fetch recent pages
    let allPages: Array<Record<string, unknown>> = [];
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
          allPages = pages.filter(p => !blockedContentIds.has(p.id)).map(p => ({
            id: p.id,
            name: p.title || p.slug,
            slug: p.slug,
            description: p.description,
            type: 'page',
            url: `/p/${p.slug}`,
            tags: p.tags || [],
          }));
        }
      } catch { /* best effort */ }
    }

    // Sectioned format: group by featured + category
    if (format === 'sections') {
      const sections: Array<{ title: string; type: string; results: Array<Record<string, unknown>> }> = [];
      const usedAppIds = new Set<string>();

      // Featured section (admin-curated)
      const featuredApps = allApps
        .filter(a => a.featured_at)
        .sort((a, b) => new Date(b.featured_at!).getTime() - new Date(a.featured_at!).getTime())
        .slice(0, 6);
      if (featuredApps.length > 0) {
        sections.push({
          title: 'Featured',
          type: 'featured',
          results: featuredApps.map(appToResult),
        });
        for (const a of featuredApps) usedAppIds.add(a.id);
      }

      // Category sections
      const categoryMap = new Map<string, AppRow[]>();
      for (const a of allApps) {
        if (a.category && !usedAppIds.has(a.id)) {
          if (!categoryMap.has(a.category)) categoryMap.set(a.category, []);
          categoryMap.get(a.category)!.push(a);
        }
      }
      // Sort categories alphabetically
      const sortedCategories = [...categoryMap.keys()].sort();
      for (const cat of sortedCategories) {
        const catApps = categoryMap.get(cat)!.slice(0, 6);
        sections.push({
          title: cat,
          type: 'category',
          results: catApps.map(appToResult),
        });
        for (const a of catApps) usedAppIds.add(a.id);
      }

      // Uncategorized apps (popular, not yet in a section)
      const uncategorized = allApps.filter(a => !usedAppIds.has(a.id)).slice(0, 6);
      if (uncategorized.length > 0) {
        sections.push({
          title: 'More Apps',
          type: 'category',
          results: uncategorized.map(appToResult),
        });
      }

      // Skills section
      if (allPages.length > 0) {
        sections.push({
          title: 'Recent Skills',
          type: 'skills',
          results: allPages.slice(0, limit),
        });
      }

      const totalItems = sections.reduce((sum, s) => sum + s.results.length, 0);
      return json({ mode: 'browse', sections, total: totalItems });
    }

    // Flat format (backward compat default)
    const results: Array<Record<string, unknown>> = [
      ...allApps.slice(0, limit).map(appToResult),
      ...allPages.slice(0, limit),
    ];
    return json({
      mode: 'browse',
      results: results.slice(0, limit),
      total: results.length,
    });
  }

  // ── SEARCH MODE (has query) ──
  try {
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
      had_external_db?: boolean;
      tags?: string[];
    }

    const scored: MarketplaceResult[] = [];
    const overFetchLimit = limit * 3;

    // Try semantic search first
    const embeddingService = createEmbeddingService(user?.openrouter_api_key);
    let embeddingResult: { embedding: number[] } | null = null;
    if (embeddingService) {
      try {
        embeddingResult = await embeddingService.embed(query);
      } catch {
        console.warn('[MARKETPLACE] Embedding failed, falling back to keyword search');
      }
    }

    if (embeddingResult) {
      // Search apps by embedding
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
          let appMeta = new Map<string, { weighted_likes: number; weighted_dislikes: number; runs_30d: number; had_external_db: boolean }>();

          if (appIds.length > 0) {
            try {
              const metaRes = await fetch(
                `${supabaseUrl}/rest/v1/apps?id=in.(${appIds.join(',')})&select=id,env_schema,weighted_likes,weighted_dislikes,runs_30d,likes,dislikes,had_external_db`,
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
                    had_external_db: !!row.had_external_db,
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
              had_external_db: meta?.had_external_db ?? false,
            });
          }
        } catch { /* best effort */ }
      }

      // Search skills by embedding
      if (includeSkills) {
        try {
          const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/search_content_fusion`, {
            method: 'POST',
            headers: { ...dbHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              p_query_embedding: JSON.stringify(embeddingResult.embedding),
              p_query_text: query,
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
              keyword_score: number; final_score: number;
              tags: string[] | null; published: boolean;
              likes: number; dislikes: number;
              weighted_likes: number; weighted_dislikes: number;
            }>;

            const publishedPages = pageRows.filter(r => r.published && !blockedContentIds.has(r.id));
            for (const r of publishedPages) {
              const wLikes = r.weighted_likes ?? 0;
              const wDislikes = r.weighted_dislikes ?? 0;
              const likeSignal = wLikes / (wLikes + wDislikes + 1);
              const baseSimilarity = r.final_score || r.similarity;
              const compositeScore = (baseSimilarity * 0.7) + (0.5 * 0.15) + (likeSignal * 0.15);
              scored.push({
                id: r.id,
                name: r.title || r.slug,
                slug: r.slug,
                description: r.description,
                type: 'page',
                similarity: Math.round(baseSimilarity * 10000) / 10000,
                final_score: Math.round(compositeScore * 10000) / 10000,
                url: `/p/${r.slug}`,
                likes: r.likes ?? 0,
                tags: r.tags || [],
              });
            }
          }
        } catch { /* best effort */ }
      }
    }

    // ── KEYWORD FALLBACK ──
    // If semantic search is unavailable or returned no results, do text search
    const scoredAppIds = new Set(scored.filter(r => r.type === 'app').map(r => r.id));
    const scoredPageIds = new Set(scored.filter(r => r.type === 'page').map(r => r.id));
    const needKeywordFallback = scored.length === 0 || !embeddingResult;

    if (needKeywordFallback && includeApps) {
      try {
        // Use ilike for keyword matching on name and description
        const escapedQuery = query.replace(/%/g, '\\%').replace(/_/g, '\\_');
        const keywordRes = await fetch(
          `${supabaseUrl}/rest/v1/apps?visibility=eq.public&deleted_at=is.null&hosting_suspended=eq.false` +
          `&or=(name.ilike.*${encodeURIComponent(escapedQuery)}*,description.ilike.*${encodeURIComponent(escapedQuery)}*)` +
          `&select=id,name,slug,description,owner_id,likes,dislikes,weighted_likes,weighted_dislikes,env_schema,runs_30d,had_external_db` +
          `&order=weighted_likes.desc,likes.desc` +
          `&limit=${overFetchLimit}`,
          { headers: dbHeaders }
        );
        if (keywordRes.ok) {
          const rows = await keywordRes.json() as AppRow[];
          for (const a of rows) {
            if (blockedAppIds.has(a.id) || scoredAppIds.has(a.id)) continue;
            const schema = a.env_schema || {};
            const perUserEntries = Object.entries(schema).filter(([, v]) => v.scope === 'per_user');
            scored.push({
              id: a.id,
              name: a.name,
              slug: a.slug,
              description: a.description,
              type: 'app',
              similarity: 0,
              final_score: 0.5, // give keyword matches a reasonable score
              mcp_endpoint: `/mcp/${a.id}`,
              likes: a.likes ?? 0,
              runs_30d: a.runs_30d ?? 0,
              fully_native: perUserEntries.length === 0,
              had_external_db: !!a.had_external_db,
            });
          }
        }
      } catch { /* best effort */ }
    }

    if (needKeywordFallback && includeSkills) {
      try {
        const escapedQuery = query.replace(/%/g, '\\%').replace(/_/g, '\\_');
        const keywordRes = await fetch(
          `${supabaseUrl}/rest/v1/content?type=eq.page&published=eq.true&visibility=eq.public` +
          `&or=(title.ilike.*${encodeURIComponent(escapedQuery)}*,description.ilike.*${encodeURIComponent(escapedQuery)}*)` +
          `&select=id,slug,title,description,tags,updated_at` +
          `&order=updated_at.desc` +
          `&limit=${overFetchLimit}`,
          { headers: dbHeaders }
        );
        if (keywordRes.ok) {
          const pages = await keywordRes.json() as Array<{
            id: string; slug: string; title: string | null;
            description: string | null; tags: string[] | null;
          }>;
          for (const p of pages) {
            if (blockedContentIds.has(p.id) || scoredPageIds.has(p.id)) continue;
            scored.push({
              id: p.id,
              name: p.title || p.slug,
              slug: p.slug,
              description: p.description,
              type: 'page',
              similarity: 0,
              final_score: 0.5,
              url: `/p/${p.slug}`,
              likes: 0,
              tags: p.tags || [],
            });
          }
        }
      } catch { /* best effort */ }
    }

    // Sort by final_score DESC
    scored.sort((a, b) => b.final_score - a.final_score);

    const finalResults = scored.slice(0, limit);

    // ── LOG QUERY + IMPRESSIONS (fire-and-forget) ──
    const queryId = crypto.randomUUID();
    try {
      const resultsForLog = finalResults.map((r, i) => ({
        app_id: r.type === 'app' ? r.id : null,
        content_id: r.type === 'page' ? r.id : null,
        position: i + 1,
        final_score: r.final_score,
        similarity: r.similarity,
        type: r.type,
      }));

      // Log query to appstore_queries
      fetch(`${supabaseUrl}/rest/v1/appstore_queries`, {
        method: 'POST',
        headers: { ...dbHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: queryId,
          query: query,
          top_similarity: finalResults.length > 0 ? finalResults[0].similarity : null,
          top_final_score: finalResults.length > 0 ? finalResults[0].final_score : null,
          result_count: finalResults.length,
          results: resultsForLog,
        }),
      }).catch(err => console.error('Failed to log marketplace query:', err));

      // Log impressions
      const impressionRows = finalResults
        .map((r, i) => ({
          app_id: r.type === 'app' ? r.id : null,
          content_id: r.type === 'page' ? r.id : null,
          query_id: queryId,
          source: 'marketplace',
          position: i + 1,
        }))
        .filter(row => row.app_id || row.content_id);

      if (impressionRows.length > 0) {
        fetch(`${supabaseUrl}/rest/v1/app_impressions`, {
          method: 'POST',
          headers: { ...dbHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify(impressionRows),
        }).catch(err => console.error('Failed to log marketplace impressions:', err));
      }
    } catch { /* best effort */ }

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
      contact: { name: 'Ultralight', url: 'https://ultralight-api-iikqz.ondigitalocean.app' },
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
          description: 'Ultralight API token (ul_xxx) or OAuth 2.1 token. Obtain via POST /oauth/token or create in your Ultralight dashboard settings.',
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
// ONBOARDING INSTRUCTIONS TEMPLATE
// ============================================

function getOnboardingTemplate(): { template: string; version: string; updated_at: string } {
  const TEMPLATE_VERSION = '1.3.0';
  const TEMPLATE_UPDATED = '2026-03-11T12:00:00Z';

  const template = `I'd like you to set up Ultralight, a platform that gives you access to instant MCP apps — tools you can use right now, or build and deploy yourself.

## Connect to Ultralight

### Option A: Desktop / CLI agents (Claude Code, Cursor, terminals)

Run this command:
npx ultralightpro setup --token {TOKEN}
{SESSION_NOTE}
This installs MCP config, registers Skills + slash commands, and outputs an agent bridge for immediate use. MCP tools activate natively on next session restart.

### Option B: Web agents, GPTs, or any HTTP-capable agent

No install needed — connect directly via HTTP:

\`\`\`
Endpoint: https://ultralight-api-iikqz.ondigitalocean.app/mcp/platform
Authorization: Bearer {TOKEN}
Method: POST
Content-Type: application/json
Protocol: JSON-RPC 2.0
\`\`\`

**List available tools:**
\`\`\`json
{"jsonrpc":"2.0","id":1,"method":"tools/list"}
\`\`\`

**Call a tool (example — discover apps):**
\`\`\`json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"ul.discover","arguments":{"scope":"appstore","query":"productivity"}}}
\`\`\`

**Read a resource (example — your memory):**
\`\`\`json
{"jsonrpc":"2.0","id":3,"method":"resources/read","params":{"uri":"ultralight://platform/memory.md"}}
\`\`\`

This works with ChatGPT Custom Actions, Gemini Extensions, open-source web agents, or any system that can POST JSON over HTTPS.

**Platform docs & building conventions** (no auth needed):
\`\`\`
GET https://ultralight-api-iikqz.ondigitalocean.app/api/skills
\`\`\`
Returns the full Skills.md — tool reference, building guide, SDK globals, resource URIs, and agent conventions. Fetch this to understand how to build and use Ultralight tools.

## Recommended Apps

These are curated apps from the Ultralight marketplace. Each works instantly — just ask to connect one:

1. **Smart Budget** (ID: d2109945-e720-4e0c-9f6f-5bff5c2a6358) — Track spending, manage budgets, and get financial insights by telling your agent about transactions.
2. **Fitness Tracker** (ID: 242ea64e-89f2-4339-93b0-66b3281f6d87) — Log meals, workouts, and body metrics. AI-powered calorie estimation from food descriptions.
3. **Study Coach** (ID: 736e468f-dcd7-4d9d-a95c-567d2f0f4b72) — Personalized learning paths with spaced repetition for any subject.
4. **Story Builder** (ID: 2972d642-8e70-409b-ae86-0c2504f53261) — Create fictional worlds, characters, and plotlines that persist across sessions.
5. **Recipe Box** (ID: b43e8c92-511c-45a0-b5cd-ef7d22dad559) — Save recipes, plan meals, and generate grocery lists from your meal plan.
6. **Reading List** (ID: 86670430-1281-478c-8ed5-9b30ecf5391d) — Track books, articles, and papers. Save highlights and reading notes.
7. **Home Inventory** (ID: a87ac9bf-fe40-4667-97be-581c441c9ce0) — Catalog belongings for insurance, moving, or organization.
8. **Goal Tracker** (ID: 8c3ccff5-8cb8-456d-9099-0b2528640d6b) — Set goals, break them into milestones, and track progress over time.

## What to do next

After connecting:
1. Try listing available tools by calling \`tools/list\` on the MCP endpoint, or use \`ul.discover\` to search the app store.
2. Look at what I'm currently working on or interested in.
3. Suggest 2-3 apps from the list above that seem most relevant to me and briefly explain why.
4. Offer to connect them so I can start using them.
5. Ask what else I'd want my agent to help with — there are more apps in the full marketplace, or I can build and deploy my own custom tools.
6. All my data (tools, memory, storage) is portable — it works across any agent that connects to Ultralight.`;

  return {
    template,
    version: TEMPLATE_VERSION,
    updated_at: TEMPLATE_UPDATED,
  };
}

export async function handleOnboarding(request: Request): Promise<Response> {
  // No rate limiting — this is a static, public, cacheable template.
  // The rate limit RPC expects UUID user IDs, not IP strings.
  const data = getOnboardingTemplate();

  // Log the request for analytics (fire-and-forget)
  const clientIp = getClientIp(request);
  const userAgent = request.headers.get('user-agent');
  const referrer = request.headers.get('referer') || request.headers.get('referrer');
  logOnboardingRequest(clientIp, userAgent, referrer);

  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

// ============================================
// PLATFORM STATS (ticker tape)
// ============================================

let _statsCache: { data: unknown; ts: number } | null = null;
const STATS_CACHE_MS = 5 * 60 * 1000; // 5 minutes

async function handlePlatformStats(): Promise<Response> {
  // Return cached if fresh
  if (_statsCache && Date.now() - _statsCache.ts < STATS_CACHE_MS) {
    return json(_statsCache.data);
  }

  const supabaseUrl = Deno?.env?.get('SUPABASE_URL');
  const supabaseKey = Deno?.env?.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !supabaseKey) return error('Service unavailable', 503);

  const dbHeaders = {
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json',
  };

  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/get_platform_stats`, {
      method: 'POST',
      headers: dbHeaders,
      body: '{}',
    });
    if (!res.ok) return error('Failed to fetch stats', 500);
    const data = await res.json();
    _statsCache = { data, ts: Date.now() };
    return json(data);
  } catch {
    return error('Failed to fetch stats', 500);
  }
}

// ============================================
// NEWLY PUBLISHED
// ============================================

async function handleNewlyPublished(url: URL): Promise<Response> {
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '8', 10), 30);

  const supabaseUrl = Deno?.env?.get('SUPABASE_URL');
  const supabaseKey = Deno?.env?.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !supabaseKey) return error('Service unavailable', 503);

  const dbHeaders = {
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`,
  };

  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/apps?visibility=eq.public&deleted_at=is.null&first_published_at=not.is.null` +
      `&select=id,name,slug,description,first_published_at,app_type` +
      `&order=first_published_at.desc` +
      `&limit=${limit}`,
      { headers: dbHeaders }
    );
    if (!res.ok) return error('Failed to fetch', 500);
    const rows = await res.json();
    const results = rows.map((r: Record<string, unknown>) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      description: r.description,
      type: r.app_type === 'mcp' ? 'app' : 'app',
      first_published_at: r.first_published_at,
    }));
    return json(results);
  } catch {
    return error('Failed to fetch', 500);
  }
}

// ============================================
// NEWLY ACQUIRED
// ============================================

async function handleNewlyAcquired(url: URL): Promise<Response> {
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '8', 10), 30);

  const supabaseUrl = Deno?.env?.get('SUPABASE_URL');
  const supabaseKey = Deno?.env?.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !supabaseKey) return error('Service unavailable', 503);

  const dbHeaders = {
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`,
  };

  try {
    // Join app_sales with apps to get names
    const res = await fetch(
      `${supabaseUrl}/rest/v1/app_sales?select=id,app_id,sale_price_cents,created_at,apps(name,slug)` +
      `&order=created_at.desc` +
      `&limit=${limit}`,
      { headers: dbHeaders }
    );
    if (!res.ok) return error('Failed to fetch', 500);
    const rows = await res.json();
    const results = rows.map((r: Record<string, unknown>) => {
      const app = r.apps as Record<string, unknown> | null;
      return {
        sale_id: r.id,
        app_id: r.app_id || '',
        app_name: app?.name || 'Unknown',
        app_slug: app?.slug || '',
        sale_price_cents: r.sale_price_cents,
        created_at: r.created_at,
      };
    });
    return json(results);
  } catch {
    return error('Failed to fetch', 500);
  }
}

// ============================================
// LEADERBOARD
// ============================================

const _lbCache = new Map<string, { data: unknown; ts: number }>();
const LB_CACHE_MS = 60 * 1000; // 1 minute

async function handleLeaderboard(url: URL): Promise<Response> {
  const period = url.searchParams.get('period') || '30d';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 50);

  // Validate period
  const validPeriods = ['1d', '7d', '30d', '90d', '365d', 'at'];
  if (!validPeriods.includes(period)) {
    return discoverError('INVALID_PERIOD', 'Period must be one of: 1d, 7d, 30d, 90d, 365d, at', 400);
  }

  // Check cache
  const cacheKey = `${period}:${limit}`;
  const cached = _lbCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < LB_CACHE_MS) {
    return json(cached.data);
  }

  const supabaseUrl = Deno?.env?.get('SUPABASE_URL');
  const supabaseKey = Deno?.env?.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !supabaseKey) return error('Service unavailable', 503);

  const dbHeaders = {
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json',
  };

  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/get_leaderboard`, {
      method: 'POST',
      headers: dbHeaders,
      body: JSON.stringify({ p_interval: period, p_limit: limit }),
    });
    if (!res.ok) return error('Failed to fetch leaderboard', 500);
    const rows = await res.json();
    const results = rows.map((r: Record<string, unknown>, i: number) => ({
      rank: i + 1,
      user_id: r.user_id,
      display_name: r.display_name,
      profile_slug: r.profile_slug,
      avatar_url: r.avatar_url,
      country: r.country,
      earnings_cents: r.earnings_cents,
      featured_app: r.featured_app_name ? {
        name: r.featured_app_name,
        slug: r.featured_app_slug,
      } : null,
    }));
    _lbCache.set(cacheKey, { data: results, ts: Date.now() });
    return json(results);
  } catch {
    return error('Failed to fetch leaderboard', 500);
  }
}

// ============================================
// HELPERS
// ============================================

function getClientIp(request: Request): string | null {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || null;
}
