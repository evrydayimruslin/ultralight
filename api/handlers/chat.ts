// Chat Stream Handler
// Authenticated streaming proxy to OpenRouter with metered billing.
// Uses platform OPENROUTER_API_KEY; charges user's hosting_balance_cents.
//
// Architecture: Client-side tool dispatch — the Tauri app (Vercel AI SDK)
// handles the tool-use loop. This endpoint is a billing/auth proxy that
// streams tokens and captures usage for post-stream cost deduction.

import { authenticate } from './auth.ts';
import { json, error } from './app.ts';
import { checkRateLimit } from '../services/ratelimit.ts';
import { checkChatBalance, deductChatCost } from '../services/chat-billing.ts';
import {
  CHAT_MIN_BALANCE_CENTS,
  type ChatStreamRequest,
  type ChatUsage,
} from '../../shared/types/index.ts';

// @ts-ignore
const Deno = globalThis.Deno;

const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY') || '';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

// ============================================
// MODEL WHITELIST
// ============================================

/** Allowed models — prevents abuse and cost surprises. Easily extensible. */
const ALLOWED_MODELS = new Set([
  'anthropic/claude-sonnet-4-20250514',
  'anthropic/claude-3.5-sonnet',
  'anthropic/claude-3-opus',
  'openai/gpt-4o',
  'openai/gpt-4o-mini',
  'google/gemini-pro-1.5',
  'deepseek/deepseek-chat',
]);

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
  if (!ALLOWED_MODELS.has(body.model)) {
    console.error(`[CHAT] Model not allowed: ${body.model}`);
    return json({
      error: `Model not allowed: ${body.model}`,
      allowed_models: Array.from(ALLOWED_MODELS),
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

  // ── 3. Rate limit ──
  const rateResult = await checkRateLimit(user.id, 'chat:stream');
  if (!rateResult.allowed) {
    return json(
      { error: 'Rate limit exceeded', resetAt: rateResult.resetAt.toISOString() },
      429,
    );
  }

  // ── 4. Balance pre-check (temporarily bypassed for development) ──
  let balance: number;
  try {
    balance = await checkChatBalance(user.id);
    console.log(`[CHAT] Balance for ${user.id}: ${balance} cents (min: ${CHAT_MIN_BALANCE_CENTS})`);
  } catch (err) {
    console.error('[CHAT] Balance check failed:', err);
    balance = 0; // Don't block on balance check failure during dev
  }
  // TODO: Re-enable balance gate after billing is wired up
  // if (balance < CHAT_MIN_BALANCE_CENTS) {
  //   return json({ error: 'Insufficient balance', balance_cents: balance, minimum_cents: CHAT_MIN_BALANCE_CENTS, topup_url: '/settings/billing' }, 402);
  // }

  // ── 5. Verify platform key ──
  if (!OPENROUTER_API_KEY) {
    console.error('[CHAT] OPENROUTER_API_KEY not configured');
    return json({ error: 'Chat service unavailable — OPENROUTER_API_KEY not set', detail: 'Server missing OpenRouter API key' }, 503);
  }
  console.log(`[CHAT] OpenRouter key present: ${OPENROUTER_API_KEY.substring(0, 8)}...`);

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
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://ultralight-api-iikqz.ondigitalocean.app',
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
              `[CHAT] Billed ${userId}: ${result.cost_cents.toFixed(4)}c ` +
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

  const models = Array.from(ALLOWED_MODELS).map(id => {
    const [provider, name] = id.split('/');
    return { id, name, provider };
  });

  return json({ models });
}
