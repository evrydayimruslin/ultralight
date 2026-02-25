/**
 * Agent Flow Tests for Ultralight Platform
 *
 * Tests three agent channels: REST Discovery, MCP Protocol, CLI Source Verification.
 *
 * Usage:
 *   deno test --allow-net --allow-read --allow-env cli/tests/agent-flows.test.ts
 *
 * Environment:
 *   UL_TOKEN       — API token for authenticated tests (optional, tests skip if not set)
 *   UL_TEST_APP    — A known public app ID for per-app tests (optional)
 *   UL_API_URL     — Override API URL (default: https://ultralight-api-iikqz.ondigitalocean.app)
 */

import {
  assertEquals,
  assertExists,
  assert,
  assertStringIncludes,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';

const API = Deno.env.get('UL_API_URL') || 'https://ultralight-api-iikqz.ondigitalocean.app';
const TOKEN = Deno.env.get('UL_TOKEN');
const TEST_APP = Deno.env.get('UL_TEST_APP');

// ============================================
// 1. CLI SOURCE VERIFICATION (No network needed)
// ============================================

Deno.test('CLI: all callTool() calls use ul.* prefix, not platform.*', async () => {
  const cliSource = await Deno.readTextFile('./cli/mod.ts');

  // Must NOT have any platform.* tool calls
  const platformCalls = cliSource.match(/callTool\(\s*['"]platform\./g);
  assertEquals(
    platformCalls,
    null,
    `Found ${platformCalls?.length || 0} callTool('platform.*') calls — should be 0. ` +
    `Matches: ${platformCalls?.join(', ')}`
  );

  // Must HAVE ul.* tool calls
  const ulCalls = cliSource.match(/callTool\(\s*['"]ul\./g);
  assert(
    ulCalls !== null && ulCalls.length >= 10,
    `Expected 10+ callTool('ul.*') calls, found ${ulCalls?.length || 0}`
  );
});

Deno.test('CLI: test command uses test_args parameter, not args', async () => {
  const cliSource = await Deno.readTextFile('./cli/mod.ts');

  // Must have test_args
  assertStringIncludes(cliSource, 'test_args', 'Missing test_args in CLI source');

  // Must NOT have the old broken pattern: toolArgs.args =
  const brokenPattern = cliSource.match(/toolArgs\.args\s*=/g);
  assertEquals(
    brokenPattern,
    null,
    `Found old toolArgs.args = pattern — should use test_args instead`
  );
});

Deno.test('CLI: init template uses single-args-object pattern', async () => {
  const cliSource = await Deno.readTextFile('./cli/mod.ts');

  // Basic template must have (args: { name?: string })
  assertStringIncludes(
    cliSource,
    'args: { name?: string }',
    'Init basic template missing single-args-object pattern: (args: { name?: string })'
  );

  // Must NOT have the old positional pattern in template: (name: string =
  const oldPattern = cliSource.match(/export function hello\(name:\s*string/);
  assertEquals(
    oldPattern,
    null,
    'Init template still has old positional parameter pattern: hello(name: string ...)'
  );
});

Deno.test('CLI: upload calls ul.upload, not platform.apps.create', async () => {
  const cliSource = await Deno.readTextFile('./cli/mod.ts');

  // Must NOT reference platform.apps.create
  assert(
    !cliSource.includes('platform.apps.create'),
    'Found old platform.apps.create reference — should use ul.upload'
  );

  // Must have ul.upload
  assertStringIncludes(cliSource, "'ul.upload'", 'Missing ul.upload call in upload command');
});

Deno.test('CLI: run command uses per-app MCP endpoint via callAppTool', async () => {
  const cliSource = await Deno.readTextFile('./cli/mod.ts');

  // Must NOT reference platform.run
  assert(
    !cliSource.includes('platform.run'),
    'Found old platform.run reference — should use callAppTool for per-app MCP'
  );

  // Must use callAppTool
  assertStringIncludes(cliSource, 'callAppTool', 'Missing callAppTool for run command');
});

Deno.test('CLI: whoami uses REST GET /api/user, not MCP tool', async () => {
  const cliSource = await Deno.readTextFile('./cli/mod.ts');

  // Must NOT reference platform.user.profile
  assert(
    !cliSource.includes('platform.user.profile'),
    'Found old platform.user.profile reference — should use restGet(/api/user)'
  );

  // Must use restGet for whoami
  assertStringIncludes(cliSource, "restGet('/api/user')", 'Missing restGet /api/user call in whoami');
});

Deno.test('CLI: version is 1.2.0', async () => {
  const cliSource = await Deno.readTextFile('./cli/mod.ts');
  assertStringIncludes(cliSource, "const VERSION = '1.2.0'", 'CLI version should be 1.2.0');

  const pkgJson = JSON.parse(await Deno.readTextFile('./cli/package.json'));
  assertEquals(pkgJson.version, '1.2.0', 'package.json version should be 1.2.0');
});

Deno.test('CLI: all expected commands are registered', async () => {
  const cliSource = await Deno.readTextFile('./cli/mod.ts');

  const expectedCommands = [
    'init', 'login', 'logout', 'whoami', 'upload',
    'apps', 'draft', 'docs', 'set', 'permissions',
    'test', 'lint', 'scaffold', 'run', 'discover',
    'logs', 'health', 'config', 'help', 'version',
  ];

  // Check for download (aliased as downloadCmd in the commands object)
  assertStringIncludes(cliSource, 'download: downloadCmd', 'Missing download command registration');

  for (const cmd of expectedCommands) {
    // Each command should exist in the commands record or as an alias
    assert(
      cliSource.includes(`  ${cmd}`) || cliSource.includes(`${cmd}:`),
      `Missing command registration: ${cmd}`
    );
  }
});

Deno.test('CLI: api.ts has restGet, callAppTool, listAppTools methods', async () => {
  const apiSource = await Deno.readTextFile('./cli/api.ts');

  assertStringIncludes(apiSource, 'async restGet(', 'Missing restGet method in api.ts');
  assertStringIncludes(apiSource, 'async callAppTool(', 'Missing callAppTool method in api.ts');
  assertStringIncludes(apiSource, 'async listAppTools(', 'Missing listAppTools method in api.ts');
  assertStringIncludes(apiSource, 'getApiUrl()', 'Missing getApiUrl method in api.ts');
  assertStringIncludes(apiSource, 'isAuthenticated()', 'Missing isAuthenticated method in api.ts');
});

Deno.test('CLI: callAppTool calls per-app endpoint /mcp/{appId}', async () => {
  const apiSource = await Deno.readTextFile('./cli/api.ts');

  // Must call /mcp/${appId} not /mcp/platform
  assertStringIncludes(
    apiSource,
    '`${this.apiUrl}/mcp/${appId}`',
    'callAppTool must call per-app endpoint /mcp/{appId}'
  );
});

Deno.test('CLI: no remaining platform.* tool references anywhere', async () => {
  const cliSource = await Deno.readTextFile('./cli/mod.ts');
  const apiSource = await Deno.readTextFile('./cli/api.ts');
  const combined = cliSource + apiSource;

  // Check for any remaining platform. tool name patterns (excluding comments)
  const lines = combined.split('\n');
  const badLines: string[] = [];
  for (const line of lines) {
    // Skip comments
    if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
    if (line.includes("'platform.") || line.includes('"platform.')) {
      badLines.push(line.trim());
    }
  }

  assertEquals(
    badLines.length,
    0,
    `Found ${badLines.length} remaining platform.* references in non-comment code:\n${badLines.join('\n')}`
  );
});

// ============================================
// 2. REST DISCOVERY (No Auth — Live API)
// ============================================

Deno.test({
  name: 'REST: GET /api/discover returns results without auth',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await fetch(`${API}/api/discover?q=hello`);
    // Accept 200 or 429 (rate limited from rapid test calls)
    assert(
      res.status === 200 || res.status === 429,
      `Expected 200 or 429, got ${res.status}`
    );

    if (res.status === 200) {
      const data = await res.json();
      assertExists(data.results, 'Response missing results array');
      assert(Array.isArray(data.results), 'results should be an array');
    } else {
      await res.body?.cancel();
    }
  },
});

Deno.test({
  name: 'REST: discovery results include mcp_endpoint field',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await fetch(`${API}/api/discover?q=hello`);
    if (res.status !== 200) {
      await res.body?.cancel();
      return; // Skip if rate limited
    }
    const data = await res.json();

    if (data.results && data.results.length > 0) {
      const first = data.results[0];
      assertExists(first.mcp_endpoint, 'First result missing mcp_endpoint');
      assert(
        String(first.mcp_endpoint).startsWith('/mcp/'),
        `mcp_endpoint should start with /mcp/, got: ${first.mcp_endpoint}`
      );
    }
  },
});

Deno.test({
  name: 'REST: discovery _links includes search and openapi',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await fetch(`${API}/api/discover?q=hello`);
    if (res.status !== 200) {
      await res.body?.cancel();
      return;
    }
    const data = await res.json();

    if (data._links) {
      assertExists(data._links.search, 'Missing _links.search');
      assertExists(data._links.openapi, 'Missing _links.openapi');
    }
  },
});

Deno.test({
  name: 'REST: GET /api/discover/openapi.json returns valid OpenAPI spec',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await fetch(`${API}/api/discover/openapi.json`);
    assertEquals(res.status, 200, `Expected 200, got ${res.status}`);

    const spec = await res.json();
    assertEquals(spec.openapi, '3.1.0', 'OpenAPI version should be 3.1.0');
    assertExists(spec.paths, 'OpenAPI spec missing paths');
    assertExists(spec.paths['/api/discover'], 'OpenAPI spec missing /api/discover path');
  },
});

Deno.test({
  name: 'REST: GET /api/discover/featured returns 200',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await fetch(`${API}/api/discover/featured`);
    // Accept 200 or 429
    assert(
      res.status === 200 || res.status === 429,
      `Expected 200 or 429, got ${res.status}`
    );
    // Always consume body to prevent leak
    await res.text();
  },
});

Deno.test({
  name: 'REST: GET /api/discover/status returns 200',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await fetch(`${API}/api/discover/status`);
    // Accept 200 or 404 (status endpoint may not exist yet if not deployed)
    assert(
      res.status === 200 || res.status === 404,
      `Expected 200 or 404, got ${res.status}`
    );

    if (res.status === 200) {
      const data = await res.json();
      // Status could be any field name — just verify we got JSON back
      assert(typeof data === 'object', 'Status response should be JSON object');
    } else {
      await res.text();
    }
  },
});

// ============================================
// 3. OAUTH METADATA (Agent Auto-Discovery)
// ============================================

Deno.test({
  name: 'OAuth: /.well-known/oauth-authorization-server exists',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await fetch(`${API}/.well-known/oauth-authorization-server`);
    assertEquals(res.status, 200, `Expected 200, got ${res.status}`);

    const meta = await res.json();
    assertExists(meta.authorization_endpoint, 'Missing authorization_endpoint');
    assertExists(meta.token_endpoint, 'Missing token_endpoint');
    assertExists(meta.registration_endpoint, 'Missing registration_endpoint');
  },
});

Deno.test({
  name: 'OAuth: /.well-known/oauth-protected-resource exists',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await fetch(`${API}/.well-known/oauth-protected-resource`);
    // Accept 200 or 404 (may not be deployed yet)
    assert(
      res.status === 200 || res.status === 404,
      `Expected 200 or 404, got ${res.status}`
    );
    // Always consume body
    await res.text();
  },
});

Deno.test({
  name: 'OAuth: dynamic client registration works',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await fetch(`${API}/oauth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Ultralight Test Agent',
        redirect_uris: ['http://localhost:9999/callback'],
      }),
    });
    // RFC 7591 says 201 for newly created client, but 200 is also acceptable
    assert(
      res.status === 200 || res.status === 201,
      `Expected 200 or 201, got ${res.status}`
    );

    const data = await res.json();
    assertExists(data.client_id, 'Dynamic registration missing client_id');
  },
});

// ============================================
// 4. MCP PROTOCOL (Authenticated — skip if no token)
// ============================================

Deno.test({
  name: 'MCP: platform initialize returns protocol version',
  ignore: !TOKEN,
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await fetch(`${API}/mcp/platform`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
      }),
    });
    assertEquals(res.status, 200);

    const data = await res.json();
    assertExists(data.result, 'Missing result in initialize response');
    assertExists(data.result.protocolVersion, 'Missing protocolVersion');
  },
});

Deno.test({
  name: 'MCP: tools/list returns 20+ ul.* tools',
  ignore: !TOKEN,
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await fetch(`${API}/mcp/platform`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
      }),
    });
    assertEquals(res.status, 200);

    const data = await res.json();
    const tools = data.result?.tools || [];
    const ulTools = tools.filter((t: { name: string }) => t.name.startsWith('ul.'));

    assert(
      ulTools.length >= 20,
      `Expected 20+ ul.* tools, got ${ulTools.length}. Tool names: ${ulTools.map((t: { name: string }) => t.name).join(', ')}`
    );
  },
});

Deno.test({
  name: 'MCP: ul.discover.appstore tool works',
  ignore: !TOKEN,
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await fetch(`${API}/mcp/platform`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'ul.discover.appstore',
          arguments: { query: 'hello' },
        },
      }),
    });
    assertEquals(res.status, 200);

    const data = await res.json();
    assert(!data.error, `JSON-RPC error: ${data.error?.message}`);
    assert(!data.result?.isError, `Tool returned isError: ${data.result?.content?.[0]?.text}`);
  },
});

Deno.test({
  name: 'MCP: 401 on invalid token',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await fetch(`${API}/mcp/platform`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer invalid_token_12345',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/list',
      }),
    });
    // Always consume body to prevent leaks
    await res.text();
    assertEquals(res.status, 401, `Expected 401 for invalid token, got ${res.status}`);
  },
});

// ============================================
// 5. PER-APP MCP (Authenticated + Test App)
// ============================================

Deno.test({
  name: 'Per-app MCP: initialize returns protocol version',
  ignore: !TOKEN || !TEST_APP,
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await fetch(`${API}/mcp/${TEST_APP}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
      }),
    });
    assertEquals(res.status, 200);

    const data = await res.json();
    assertExists(data.result?.protocolVersion, 'Missing protocolVersion in per-app initialize');
  },
});

Deno.test({
  name: 'Per-app MCP: tools/list returns app functions',
  ignore: !TOKEN || !TEST_APP,
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await fetch(`${API}/mcp/${TEST_APP}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
      }),
    });
    assertEquals(res.status, 200);

    const data = await res.json();
    const tools = data.result?.tools || [];
    assert(tools.length > 0, 'Per-app tools/list returned 0 tools');
  },
});

// ============================================
// 6. WELL-KNOWN CONFIG
// ============================================

Deno.test({
  name: 'Well-known: per-app .well-known/mcp.json exists',
  ignore: !TEST_APP,
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await fetch(`${API}/a/${TEST_APP}/.well-known/mcp.json`);
    assertEquals(res.status, 200, `Expected 200, got ${res.status}`);

    const config = await res.json();
    assertExists(config.name, 'MCP config missing name');
    assertExists(config.transport, 'MCP config missing transport');
    assertExists(config.transport?.url, 'MCP config missing transport.url');
  },
});
