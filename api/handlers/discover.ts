// Discovery Handler
// Semantic search API for finding apps by natural language queries
// Uses embeddings stored in pgvector for similarity search

import { json, error } from './app.ts';
import { authenticate } from './auth.ts';
import {
  createEmbeddingService,
  isEmbeddingAvailable,
  searchAppsByEmbedding
} from '../services/embedding.ts';
import { checkRateLimit } from '../services/ratelimit.ts';
import type { DiscoverRequest, DiscoverResult, DiscoveredApp } from '../../shared/types/index.ts';

// ============================================
// TYPES
// ============================================

interface User {
  id: string;
  openrouter_api_key?: string;
}

// ============================================
// HANDLER
// ============================================

/**
 * Handle discovery requests
 * POST /api/discover - Search apps by semantic query
 */
export async function handleDiscover(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // POST /api/discover - Semantic search
  if (path === '/api/discover' && method === 'POST') {
    return handleSearch(request);
  }

  // GET /api/discover/status - Check if discovery is available
  if (path === '/api/discover/status' && method === 'GET') {
    return handleStatus(request);
  }

  return error('Not found', 404);
}

/**
 * Search apps by semantic query
 * Requires authentication - searches owner's private apps + all public apps
 */
async function handleSearch(request: Request): Promise<Response> {
  // Authenticate user
  let user: User;
  try {
    user = await authenticate(request);
  } catch (err) {
    return error('Authentication required', 401);
  }

  // Rate limit check
  const rateLimitResult = await checkRateLimit(user.id, 'discover');
  if (!rateLimitResult.allowed) {
    return json(
      {
        error: 'Rate limit exceeded',
        resetAt: rateLimitResult.resetAt.toISOString(),
      },
      429
    );
  }

  // Parse request body
  let body: DiscoverRequest;
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON body', 400);
  }

  const { query, limit = 20, threshold = 0.5 } = body;

  if (!query || typeof query !== 'string') {
    return error('Query is required', 400);
  }

  if (query.length < 3) {
    return error('Query must be at least 3 characters', 400);
  }

  if (query.length > 500) {
    return error('Query must be at most 500 characters', 400);
  }

  // Check if embedding service is available
  const embeddingService = createEmbeddingService(user.openrouter_api_key);
  if (!embeddingService) {
    return json({
      error: 'Embedding service not available',
      message: 'Enable BYOK (Bring Your Own Key) with OpenRouter to use semantic search',
      apps: [],
      total: 0,
    }, 200);
  }

  try {
    // Generate embedding for the query
    const embeddingResult = await embeddingService.embed(query);

    // Search apps by embedding similarity
    const searchResults = await searchAppsByEmbedding(
      embeddingResult.embedding,
      user.id,
      { limit, threshold }
    );

    // Transform results to DiscoveredApp format
    const apps: DiscoveredApp[] = searchResults.map(result => ({
      id: result.id,
      name: result.name,
      slug: result.slug,
      description: result.description,
      isPublic: result.is_public,
      isOwner: result.owner_id === user.id,
      similarity: result.similarity,
      mcpEndpoint: `/mcp/${result.id}`,
    }));

    const response: DiscoverResult = {
      apps,
      total: apps.length,
      query,
      model: embeddingResult.model,
    };

    return json(response);

  } catch (err) {
    console.error('Discovery search error:', err);
    return json({
      error: 'Search failed',
      message: err instanceof Error ? err.message : String(err),
      apps: [],
      total: 0,
    }, 500);
  }
}

/**
 * Check discovery service status
 * Returns whether embedding is available and configuration info
 */
async function handleStatus(request: Request): Promise<Response> {
  // Authenticate user (optional - status can be checked without auth)
  let user: User | null = null;
  try {
    user = await authenticate(request);
  } catch {
    // Auth is optional for status check
  }

  const hasUserKey = !!user?.openrouter_api_key;
  const hasSystemKey = isEmbeddingAvailable();
  const isAvailable = hasUserKey || hasSystemKey;

  return json({
    available: isAvailable,
    hasUserKey,
    hasSystemKey,
    message: isAvailable
      ? 'Discovery service is available'
      : 'Enable BYOK (Bring Your Own Key) with OpenRouter to use semantic search',
  });
}
