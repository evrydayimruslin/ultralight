import { assertEquals } from 'https://deno.land/std@0.210.0/assert/assert_equals.ts';
import { assertStringIncludes } from 'https://deno.land/std@0.210.0/assert/assert_string_includes.ts';

import { handleMcp } from './mcp.ts';

const APP_ID = 'skill-app';
const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const CALLER_ID = '22222222-2222-4222-8222-222222222222';
const CALLER_TOKEN = 'caller-token';
const SECRET_SKILL_BODY = 'SECRET_FULL_SKILL_CONTEXT';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function rpcRequest(method: string, params?: unknown) {
  return { jsonrpc: '2.0', id: 'test-rpc', method, params };
}

function mcpRequest(method: string, params?: unknown): Request {
  return new Request(`https://ultralight.test/mcp/${APP_ID}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CALLER_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(rpcRequest(method, params)),
  });
}

async function parseJson(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

async function parseToolJson(
  response: Response,
): Promise<Record<string, unknown>> {
  const payload = await parseJson(response);
  const result = payload.result as {
    content: Array<{ type: string; text?: string }>;
  };
  const text = result.content.find((entry) => entry.type === 'text')?.text;
  return JSON.parse(text || '{}') as Record<string, unknown>;
}

function installMcpSkillHarness(): () => void {
  const originalFetch = globalThis.fetch;
  const originalEnv = globalThis.__env
    ? { ...globalThis.__env as Record<string, unknown> }
    : undefined;

  const app = {
    id: APP_ID,
    owner_id: OWNER_ID,
    slug: 'paid-skill',
    name: 'Paid Skill',
    description: 'Summarizes launch billing behavior.',
    visibility: 'public',
    runtime: 'deno',
    app_type: 'mcp',
    storage_key: 'apps/paid-skill',
    skills_md: `# Paid Skill\n\n${SECRET_SKILL_BODY}`,
    manifest: JSON.stringify({
      name: 'Paid Skill',
      version: '1.0.0',
      type: 'mcp',
      entry: { functions: 'index.ts' },
      functions: {},
      skills: {
        context: {
          name: 'Launch billing context',
          description: 'Full launch billing workflow context.',
          semantic_description: 'Paid context for launch billing agents.',
          resource: 'skills.md',
          format: 'markdown',
        },
      },
    }),
    pricing_config: {
      default_price_light: 0,
      default_skill_pull_price_light: 25,
      default_free_skill_pulls: 0,
    },
    rate_limit_config: null,
  };
  const user = {
    id: CALLER_ID,
    email: 'caller@example.com',
    display_name: 'Caller',
    avatar_url: null,
    tier: 'pro',
    country: null,
    featured_app_id: null,
    profile_slug: null,
    byok_enabled: false,
    byok_provider: null,
    byok_keys: null,
  };

  globalThis.__env = {
    ...(originalEnv || {}),
    SUPABASE_URL: 'https://supabase.test',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    SUPABASE_ANON_KEY: 'anon-key',
    BASE_URL: 'https://ultralight.test',
    ENVIRONMENT: 'test',
  } as typeof globalThis.__env;

  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request?.url || String(input));
    const method = init?.method || request?.method || 'GET';

    if (url.pathname === '/auth/v1/user') {
      return jsonResponse({
        id: CALLER_ID,
        email: 'caller@example.com',
        user_metadata: {},
      });
    }

    if (url.pathname === '/rest/v1/users') {
      return jsonResponse([user]);
    }

    if (url.pathname === '/rest/v1/pending_permissions') {
      return jsonResponse([]);
    }

    if (url.pathname === '/rest/v1/apps' && method === 'GET') {
      return jsonResponse([app]);
    }

    if (url.pathname === '/rest/v1/rpc/check_rate_limit') {
      return jsonResponse(true);
    }

    if (url.pathname === '/rest/v1/rpc/increment_weekly_calls') {
      return jsonResponse([{ current_count: 1 }]);
    }

    if (url.pathname === '/rest/v1/rpc/transfer_light') {
      return jsonResponse([{
        platform_fee: 4,
        transfer_id: 'transfer-1',
        fee_would_have_been: 4,
        fee_waived: 0,
        waiver_source: null,
        waiver_event_id: null,
      }]);
    }

    if (url.pathname === '/rest/v1/skill_pull_receipts') {
      return jsonResponse([{ id: 'receipt-1' }]);
    }

    throw new Error(`Unexpected ${method} ${url.pathname}${url.search}`);
  }) as typeof fetch;

  return () => {
    globalThis.fetch = originalFetch;
    if (originalEnv) {
      globalThis.__env = originalEnv as typeof globalThis.__env;
    }
  };
}

Deno.test('MCP monetized skills expose previews and gate full context behind pullSkill', async () => {
  const cleanup = installMcpSkillHarness();
  try {
    const initPayload = await parseJson(
      await handleMcp(mcpRequest('initialize'), APP_ID),
    );
    const instructions = ((initPayload.result as Record<string, unknown>)
      .instructions || '') as string;
    assertEquals(instructions.includes(SECRET_SKILL_BODY), false);
    assertStringIncludes(instructions, 'ultralight.pullSkill');

    const resourcePayload = await parseJson(
      await handleMcp(
        mcpRequest('resources/read', {
          uri: `ultralight://app/${APP_ID}/skills.md`,
        }),
        APP_ID,
      ),
    );
    const resourceText = ((resourcePayload.result as Record<string, unknown>).contents as Array<
      { text?: string }
    >)[0].text || '';
    assertEquals(resourceText.includes(SECRET_SKILL_BODY), false);
    assertStringIncludes(resourceText, 'ultralight.pullSkill');

    const skillsResult = await parseToolJson(
      await handleMcp(
        mcpRequest('tools/call', {
          name: 'ultralight.getSkills',
          arguments: {},
        }),
        APP_ID,
      ),
    );
    assertEquals(skillsResult.skills_md, null);
    assertEquals(
      (skillsResult.preview_md as string).includes(SECRET_SKILL_BODY),
      false,
    );
    assertEquals(skillsResult.full_context_requires_pull, true);

    const pullResult = await parseToolJson(
      await handleMcp(
        mcpRequest('tools/call', {
          name: 'ultralight.pullSkill',
          arguments: { skill_id: 'context' },
        }),
        APP_ID,
      ),
    );
    assertStringIncludes(pullResult.content as string, SECRET_SKILL_BODY);
    assertEquals(pullResult.charged_light, 25);
    assertEquals(pullResult.receipt_id, 'receipt-1');
  } finally {
    cleanup();
  }
});
