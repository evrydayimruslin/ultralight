// Chat Stream Handler
// Authenticated streaming proxy to OpenRouter with metered billing.
// Uses per-user OpenRouter API keys (provisioned via management key).
//
// Architecture: Client-side tool dispatch — the Tauri app
// handles the tool-use loop. This endpoint is a billing/auth proxy that
// streams tokens and captures usage for post-stream cost deduction.

import { authenticate } from './auth.ts';
import { json, error } from './app.ts';
import { checkRateLimit } from '../services/ratelimit.ts';
import { checkChatBalance, deductChatCost } from '../services/chat-billing.ts';
import { getOrCreateOpenRouterKey } from '../services/openrouter-keys.ts';
import { createUserService } from '../services/user.ts';
import {
  CHAT_MIN_BALANCE_LIGHT,
  type ChatStreamRequest,
  type ChatUsage,
} from '../../shared/types/index.ts';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

// ============================================
// MODEL VALIDATION
// ============================================

/** Basic model ID format validation — must be provider/model-name */
function isValidModelId(model: string): boolean {
  return /^[a-z0-9_-]+\/[a-z0-9._-]+(:[a-z0-9_-]+)?$/i.test(model);
}

async function enforceChatGuards(
  userId: string,
  resource: string,
): Promise<{ balance: number } | Response> {
  const rateResult = await checkRateLimit(userId, 'chat:stream', undefined, undefined, {
    mode: 'fail_closed',
    resource,
  });
  if (!rateResult.allowed) {
    if (rateResult.reason === 'service_unavailable') {
      return json({
        error: 'Chat is temporarily unavailable while usage controls recover. Please try again shortly.',
      }, 503);
    }

    return json(
      { error: 'Rate limit exceeded', resetAt: rateResult.resetAt.toISOString() },
      429,
    );
  }

  try {
    const balance = await checkChatBalance(userId);
    console.log(`[CHAT] Balance for ${userId}: ${balance} cents (min: ${CHAT_MIN_BALANCE_LIGHT})`);

    if (balance < CHAT_MIN_BALANCE_LIGHT) {
      return json({
        error: 'Insufficient balance',
        balance_light: balance,
        minimum_light: CHAT_MIN_BALANCE_LIGHT,
        topup_url: '/settings/billing',
      }, 402);
    }

    return { balance };
  } catch (err) {
    console.error(`[CHAT] Balance check unavailable for ${userId}, blocking ${resource}:`, err);
    return json({
      error: 'Billing service temporarily unavailable. Please try again shortly.',
    }, 503);
  }
}

// ============================================
// POST /chat/stream — Streaming proxy
// ============================================

export async function handleChatStream(request: Request): Promise<Response> {
  // ── 1. Auth ──
  const authHeader = request.headers.get('Authorization');
  console.log(`[CHAT] Auth attempt — header present: ${!!authHeader}, prefix: ${authHeader?.substring(0, 12)}...`);

  let user: { id: string; email: string; tier: string; provisional?: boolean };
  try {
    user = await authenticate(request);
    console.log(`[CHAT] Auth success — user: ${user.id}, email: ${user.email}, tier: ${user.tier}, provisional: ${user.provisional}`);
  } catch (err) {
    console.error(`[CHAT] Auth FAILED:`, err instanceof Error ? err.message : err);
    return json({ error: 'Unauthorized', detail: err instanceof Error ? err.message : 'Auth failed' }, 401);
  }

  // Block provisional users (no balance, no billing)
  if (user.provisional) {
    console.log(`[CHAT] Blocked provisional user: ${user.id}`);
    return json({ error: 'Chat requires a full account. Sign in at ultralight.dev' }, 403);
  }

  // ── 2. Parse & validate request body ──
  let body: ChatStreamRequest;
  try {
    body = await request.json() as ChatStreamRequest;
    console.log(`[CHAT] Request body — model: ${body.model}, messages: ${body.messages?.length}, tools: ${body.tools?.length || 0}`);
  } catch (parseErr) {
    console.error('[CHAT] JSON parse failed:', parseErr);
    return error('Invalid JSON body', 400);
  }

  if (!body.model || typeof body.model !== 'string') {
    console.error('[CHAT] Missing model field');
    return error('model is required', 400);
  }
  if (!isValidModelId(body.model)) {
    console.error(`[CHAT] Invalid model ID format: ${body.model}`);
    return json({
      error: `Invalid model ID format: ${body.model}. Expected format: provider/model-name`,
    }, 400);
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return error('messages array is required and must not be empty', 400);
  }
  for (const msg of body.messages) {
    if (!msg.role || !['system', 'user', 'assistant', 'tool'].includes(msg.role)) {
      return error(`Invalid message role: ${msg.role}`, 400);
    }
  }

  // ── 3. Rate limit + balance gate ──
  const guardResult = await enforceChatGuards(user.id, 'chat stream');
  if (guardResult instanceof Response) {
    return guardResult;
  }

  // ── 5. Get API key — prefer BYOK if configured, fallback to platform key ──
  let userOpenRouterKey: string;
  try {
    // Check if user has BYOK configured
    const userService = createUserService();
    const fullUser = await userService.getUser(user.id);
    if (fullUser?.byok_enabled && fullUser?.byok_provider === 'openrouter') {
      try {
        const byokKey = await userService.getDecryptedApiKey(user.id, 'openrouter');
        if (byokKey) {
          userOpenRouterKey = byokKey;
          console.log(`[CHAT] Using BYOK OpenRouter key for ${user.id}`);
        } else {
          throw new Error('Empty BYOK key');
        }
      } catch (byokErr) {
        console.warn(`[CHAT] BYOK key failed for ${user.id}, falling back to platform key:`, byokErr);
        userOpenRouterKey = await getOrCreateOpenRouterKey(user.id, user.email);
      }
    } else {
      userOpenRouterKey = await getOrCreateOpenRouterKey(user.id, user.email);
    }
    console.log(`[CHAT] OpenRouter key ready for ${user.id}`);
  } catch (err) {
    console.error(`[CHAT] Failed to get/create OpenRouter key for ${user.id}:`, err);
    return json({
      error: 'Chat service unavailable',
      detail: err instanceof Error ? err.message : 'OpenRouter key provisioning failed',
    }, 503);
  }

  // ── 6. Forward to OpenRouter with streaming ──
  const openRouterBody = {
    model: body.model,
    messages: body.messages,
    temperature: body.temperature ?? 0.7,
    max_tokens: body.max_tokens ?? 4096,
    stream: true,
    stream_options: { include_usage: true },
    ...(body.tools && body.tools.length > 0 ? { tools: body.tools } : {}),
  };

  console.log(`[CHAT] Forwarding to OpenRouter — model: ${body.model}, messages: ${body.messages.length}`);

  let openRouterRes: Response;
  try {
    openRouterRes = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${userOpenRouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://ultralight-api.rgn4jz429m.workers.dev',
        'X-Title': 'Ultralight Chat',
      },
      body: JSON.stringify(openRouterBody),
    });
    console.log(`[CHAT] OpenRouter responded — status: ${openRouterRes.status}`);
  } catch (err) {
    console.error('[CHAT] OpenRouter fetch failed:', err);
    return json({ error: 'Upstream service unavailable', detail: err instanceof Error ? err.message : 'fetch failed' }, 502);
  }

  // Handle non-streaming error from OpenRouter
  if (!openRouterRes.ok) {
    let errMsg = 'Upstream error';
    try {
      const errBody = await openRouterRes.json() as { error?: { message?: string } };
      errMsg = errBody?.error?.message || errMsg;
      console.error(`[CHAT] OpenRouter error ${openRouterRes.status}: ${errMsg}`);
    } catch { /* use default */ }
    return json(
      { error: errMsg, detail: `OpenRouter returned ${openRouterRes.status}` },
      openRouterRes.status >= 500 ? 502 : openRouterRes.status,
    );
  }

  if (!openRouterRes.body) {
    return error('No response body from upstream', 502);
  }

  // ── 7. Create pass-through transform that captures usage ──
  let capturedUsage: ChatUsage | null = null;
  let capturedTotalCost: number | undefined = undefined;
  const userId = user.id;
  const model = body.model;
  const decoder = new TextDecoder();

  const transformStream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk: Uint8Array, controller: TransformStreamDefaultController<Uint8Array>) {
      // Pass chunk through immediately (zero added latency)
      controller.enqueue(chunk);

      // Best-effort parse of SSE data lines to capture usage from final chunk
      try {
        const text = decoder.decode(chunk, { stream: true });
        const lines = text.split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data) as {
              usage?: {
                prompt_tokens?: number;
                completion_tokens?: number;
                total_tokens?: number;
                total_cost?: number;
              };
            };
            if (parsed.usage) {
              capturedUsage = {
                prompt_tokens: parsed.usage.prompt_tokens || 0,
                completion_tokens: parsed.usage.completion_tokens || 0,
                total_tokens: parsed.usage.total_tokens || 0,
              };
              if (parsed.usage.total_cost !== undefined) {
                capturedTotalCost = parsed.usage.total_cost;
              }
            }
          } catch {
            // Not valid JSON or partial chunk — skip, usage appears in the final event
          }
        }
      } catch {
        // Decode error — data still passes through to client
      }
    },

    flush() {
      // Stream complete — deduct billing (fire-and-forget)
      if (capturedUsage && capturedUsage.total_tokens > 0) {
        deductChatCost(userId, capturedUsage, model, capturedTotalCost)
          .then(result => {
            console.log(
              `[CHAT] Billed ${userId}: ${result.cost_light.toFixed(4)}✦ ` +
              `(${capturedUsage!.prompt_tokens}+${capturedUsage!.completion_tokens} tokens, ${model})` +
              `${result.was_depleted ? ' [BALANCE DEPLETED]' : ''}`
            );
          })
          .catch(err => {
            console.error(`[CHAT] Post-stream billing failed for ${userId}:`, err);
          });
      } else {
        console.warn(`[CHAT] No usage captured for ${userId} (model=${model})`);
      }
    },
  });

  // Pipe OpenRouter response through the transform (runs in background)
  openRouterRes.body.pipeTo(transformStream.writable).catch(err => {
    console.error(`[CHAT] Stream pipe error for ${userId}:`, err);
  });

  // ── 8. Return streaming response ──
  return new Response(transformStream.readable, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Prevent DigitalOcean/nginx buffering
    },
  });
}

// ============================================
// GET /chat/models — Available model list
// ============================================

export async function handleChatModels(request: Request): Promise<Response> {
  // Optional auth — rate limit by user ID or IP
  let userId: string;
  try {
    const user = await authenticate(request);
    userId = user.id;
  } catch {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'anonymous';
    userId = ip;
  }

  const rateResult = await checkRateLimit(userId, 'chat:models');
  if (!rateResult.allowed) {
    return json({ error: 'Rate limit exceeded' }, 429);
  }

  // Suggested models — not an allowlist, just popular options for the UI
  const suggested = [
    'google/gemini-3.1-flash-lite-preview:nitro',
    'anthropic/claude-sonnet-4.6',
    'anthropic/claude-sonnet-4-20250514',
    'openai/gpt-4o',
    'google/gemini-2.5-pro-preview-05-06',
    'deepseek/deepseek-chat',
    'meta-llama/llama-3.1-405b-instruct',
    'qwen/qwen3-235b-a22b',
  ];
  const models = suggested.map(id => {
    const [provider, name] = id.split('/');
    return { id, name, provider };
  });

  return json({ models });
}

// ============================================
// GET /chat/function-index — Per-user function index for codemode
// ============================================

/**
 * Returns the user's function index: all available app functions
 * with TypeScript type declarations for codemode recipes.
 * Cached in R2, rebuilt on app upload/version change.
 */
export async function handleFunctionIndex(request: Request): Promise<Response> {
  const { authenticate } = await import('./auth.ts');
  const user = await authenticate(request);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { getFunctionIndex, rebuildFunctionIndex } = await import('../services/function-index.ts');

  // Try to read cached index
  let index = await getFunctionIndex(user.id);

  // If no index exists, build it on demand
  if (!index) {
    try {
      index = await rebuildFunctionIndex(user.id);
    } catch (err) {
      console.error('Failed to build function index:', err);
      return json({ functions: {}, widgets: [], types: '', updatedAt: null });
    }
  }

  return json(index);
}

// ============================================
// POST /chat/context — Resolve task context for a prompt
// ============================================

/**
 * Given a user prompt, resolves relevant entities, functions, and conventions
 * from pre-built indexes. Returns a TaskContext with a formatted promptBlock
 * for system prompt injection.
 */
export async function handleChatContext(request: Request): Promise<Response> {
  // Auth
  let user: { id: string; email: string; tier: string; provisional?: boolean };
  try {
    user = await authenticate(request);
  } catch (err) {
    return json({ error: 'Unauthorized', detail: err instanceof Error ? err.message : 'Auth failed' }, 401);
  }

  // Parse body
  let body: { prompt: string };
  try {
    body = await request.json() as { prompt: string };
  } catch {
    return error('Invalid JSON body', 400);
  }

  if (!body.prompt || typeof body.prompt !== 'string') {
    return error('prompt is required', 400);
  }

  // Resolve context
  try {
    const { resolveContext } = await import('../services/context-resolver.ts');
    const context = await resolveContext(body.prompt, user.id);
    return json(context);
  } catch (err) {
    console.error('[CHAT] Context resolution failed:', err);
    return json({
      entities: [],
      functions: [],
      conventions: [],
      promptBlock: '',
    });
  }
}

// ============================================
// POST /chat/provision-key — Pre-provision OpenRouter key
// ============================================

/**
 * Create per-user OpenRouter key ahead of first chat.
 * Called by the desktop app after login so the key is ready
 * when the user sends their first message (avoids 504 timeout).
 */
export async function handleProvisionKey(request: Request): Promise<Response> {
  // Auth
  let user: { id: string; email: string; tier: string; provisional?: boolean };
  try {
    user = await authenticate(request);
  } catch (err) {
    return json({ error: 'Unauthorized', detail: err instanceof Error ? err.message : 'Auth failed' }, 401);
  }

  if (user.provisional) {
    return json({ error: 'Full account required' }, 403);
  }

  // Get or create key
  try {
    await getOrCreateOpenRouterKey(user.id, user.email);
    console.log(`[CHAT] Provisioned OpenRouter key for ${user.id}`);
    return json({ ok: true, provisioned: true });
  } catch (err) {
    console.error(`[CHAT] Key provisioning failed for ${user.id}:`, err);
    return json({
      ok: false,
      error: err instanceof Error ? err.message : 'Key provisioning failed',
    }, 500);
  }
}

// ============================================
// POST /chat/orchestrate — Server-side Flash orchestration
// ============================================

/**
 * Server-side orchestration endpoint.
 * Replaces the client-side agent loop with Flash broker + heavy model + recipe execution.
 * Returns an SSE stream of typed orchestration events.
 */
export async function handleOrchestrate(request: Request): Promise<Response> {
  // ── 1. Auth ──
  let user: { id: string; email: string; tier: string; provisional?: boolean };
  try {
    user = await authenticate(request);
  } catch (err) {
    return json({ error: 'Unauthorized', detail: err instanceof Error ? err.message : 'Auth failed' }, 401);
  }

  if (user.provisional) {
    return json({ error: 'Orchestration requires a full account.' }, 403);
  }

  // ── 2. Parse request body ──
  let body: {
    message: string;
    conversationHistory?: Array<{ role: string; content: string }>;
    preferredModel?: string;
    interpreterModel?: string;
    heavyModel?: string;
    scope?: Record<string, { access: 'all' | 'functions' | 'data'; functions?: string[] }>;
    systemAgentContext?: { type: string; persona: string; skillsPath: string };
    projectContext?: string;
    conversationId?: string;
    files?: Array<{ name: string; size: number; mimeType: string; content: string }>;
  };
  try {
    body = await request.json() as typeof body;
  } catch {
    return error('Invalid JSON body', 400);
  }

  if (!body.message || typeof body.message !== 'string') {
    return error('message is required', 400);
  }

  // ── 3. Rate limit + balance gate ──
  const guardResult = await enforceChatGuards(user.id, 'chat orchestration');
  if (guardResult instanceof Response) {
    return guardResult;
  }

  // ── 4. Stream orchestration events as SSE ──
  const { orchestrate } = await import('../services/orchestrator.ts');

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of orchestrate(
          {
            message: body.message,
            conversationHistory: body.conversationHistory,
            interpreterModel: body.interpreterModel,
            heavyModel: body.heavyModel || body.preferredModel,
            scope: body.scope,
            systemAgentContext: body.systemAgentContext,
            projectContext: body.projectContext,
            conversationId: body.conversationId,
            files: body.files,
          },
          user.id,
          user.email,
        )) {
          const sseData = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(sseData));

          // Close stream on done or error
          if (event.type === 'done') {
            controller.close();
            return;
          }
        }
        // Safety close if generator ends without 'done'
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
        controller.close();
      } catch (err) {
        const errEvent = { type: 'error', message: err instanceof Error ? err.message : String(err) };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(errEvent)}\n\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
