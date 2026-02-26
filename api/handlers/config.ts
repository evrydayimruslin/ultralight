// MCP Config Generator
// Returns ready-to-paste MCP client configs for Claude Desktop, Cursor, etc.
//
// Endpoints:
//   GET /api/mcp-config/:appId                 — Claude Desktop format (default)
//   GET /api/mcp-config/:appId?client=cursor   — Cursor format
//   GET /api/mcp-config/:appId?client=raw      — Minimal JSON

import { json, error } from './app.ts';
import { createAppsService } from '../services/apps.ts';
import { authenticate } from './auth.ts';

// @ts-ignore - Deno is available in Deno Deploy
const Deno = globalThis.Deno;

const BASE_URL = Deno?.env?.get('BASE_URL') || 'https://ultralight-api-iikqz.ondigitalocean.app';

interface AppInfo {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  visibility: string;
  owner_id?: string;
}

/**
 * Handle GET /api/mcp-config/:appId
 */
export async function handleMcpConfig(request: Request, appId: string): Promise<Response> {
  if (!appId || appId.length < 3) {
    return error('Invalid app ID', 400);
  }

  // Look up the app
  const appsService = createAppsService();
  const app = await appsService.findById(appId) as AppInfo | null;

  if (!app) {
    return json({ error: 'App not found', code: 'APP_NOT_FOUND' }, 404);
  }

  // Allow public apps (anyone) or private/unlisted apps (owner only)
  if (app.visibility !== 'public') {
    let isOwner = false;
    try {
      const user = await authenticate(request);
      isOwner = user.id === app.owner_id;
    } catch {
      // Not authenticated
    }
    if (!isOwner) {
      return json({ error: 'Config generation only available for public apps', code: 'APP_NOT_PUBLIC' }, 403);
    }
  }

  const url = new URL(request.url);
  const client = url.searchParams.get('client') || 'claude';
  const serverName = `ultralight-${app.slug || app.id}`;
  const mcpUrl = `${BASE_URL}/mcp/${app.id}`;
  const httpUrl = `${BASE_URL}/http/${app.id}`;

  switch (client) {
    case 'cursor': {
      return json({
        mcp: {
          servers: {
            [serverName]: {
              url: mcpUrl,
              type: 'http',
            },
          },
        },
        _meta: {
          app_name: app.name,
          app_id: app.id,
          description: app.description,
          generated_at: new Date().toISOString(),
          docs: `${BASE_URL}/api/discover/openapi.json`,
        },
      });
    }

    case 'raw': {
      return json({
        name: app.name,
        app_id: app.id,
        slug: app.slug,
        description: app.description,
        url: mcpUrl,
        http_url: httpUrl,
        transport: 'http-post',
        oauth: `${BASE_URL}/.well-known/oauth-authorization-server`,
        well_known: `${BASE_URL}/a/${app.id}/.well-known/mcp.json`,
        generated_at: new Date().toISOString(),
      });
    }

    case 'claude':
    default: {
      return json({
        mcpServers: {
          [serverName]: {
            url: mcpUrl,
            transport: 'http-post',
          },
        },
        _meta: {
          app_name: app.name,
          app_id: app.id,
          description: app.description,
          generated_at: new Date().toISOString(),
          docs: `${BASE_URL}/api/discover/openapi.json`,
        },
      });
    }
  }
}
