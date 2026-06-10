import { assert, assertEquals } from 'https://deno.land/std@0.210.0/assert/mod.ts';
import {
  createChatStreamCaptureSession,
  createOrchestrateCaptureSession,
} from './chat-capture.ts';

Deno.test('chat capture: disabled flag prevents session creation', () => {
  const previousEnv = globalThis.__env;
  globalThis.__env = {
    CHAT_CAPTURE_ENABLED: 'false',
  } as unknown as typeof globalThis.__env;

  try {
    const session = createOrchestrateCaptureSession({
      userId: 'user-123',
      conversationId: 'conv-123',
      userMessageId: 'msg-user',
      assistantMessageId: 'msg-assistant',
      traceId: 'trace-123',
      message: 'hello',
    });

    assertEquals(session, null);
  } finally {
    globalThis.__env = previousEnv;
  }
});

Deno.test('chat stream capture: disabled flag prevents session creation', () => {
  const previousEnv = globalThis.__env;
  globalThis.__env = {
    CHAT_CAPTURE_ENABLED: 'false',
  } as unknown as typeof globalThis.__env;

  try {
    const session = createChatStreamCaptureSession({
      userId: 'user-123',
      conversationId: 'conv-123',
      assistantMessageId: 'msg-assistant',
      traceId: 'trace-123',
      messages: [{ role: 'user', content: 'hello' }],
      requestedModel: 'openai/gpt-4o-mini',
      resolvedModel: 'openai/gpt-4o-mini',
      provider: 'openrouter',
      billingMode: 'light',
      keySource: 'platform_openrouter',
    });

    assertEquals(session, null);
  } finally {
    globalThis.__env = previousEnv;
  }
});

Deno.test('chat stream capture: stores request and assistant rows', async () => {
  const previousEnv = globalThis.__env;
  const previousFetch = globalThis.fetch;
  const posts: Array<{ url: string; body: unknown }> = [];

  globalThis.__env = {
    CHAT_CAPTURE_ENABLED: 'true',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    ANALYTICS_PEPPER_V1: 'test-pepper',
  } as unknown as typeof globalThis.__env;

  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    posts.push({
      url: typeof input === 'string' || input instanceof URL ? String(input) : input.url,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return Promise.resolve(new Response('', { status: 201 }));
  }) as typeof fetch;

  try {
    const session = createChatStreamCaptureSession({
      userId: '00000000-0000-4000-8000-000000000001',
      conversationId: 'conv-stream-test',
      assistantMessageId: 'assistant-stream-test',
      traceId: '00000000-0000-4000-8000-000000000002',
      source: 'unit_test_stream',
      messages: [{ role: 'user', content: 'hello' }],
      requestedModel: 'openai/gpt-4o-mini',
      resolvedModel: 'openai/gpt-4o-mini',
      provider: 'openrouter',
      billingMode: 'light',
      keySource: 'platform_openrouter',
    });

    assert(session);
    session.start();
    session.observeProviderChunk({
      choices: [{ delta: { content: 'hi ' } }],
    });
    session.observeProviderChunk({
      choices: [{ delta: { content: 'there' }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 4,
        completion_tokens: 2,
        total_tokens: 6,
        total_cost: 0.0001,
      },
    });
    await session.finish('unit_test_done');

    const chatMessagePosts = posts.filter((post) => post.url.includes('/chat_messages'));
    assertEquals(chatMessagePosts.length, 2);
    assertEquals((chatMessagePosts[0].body as Array<{ content: string; source: string }>)[0].content, 'hello');
    assertEquals((chatMessagePosts[0].body as Array<{ content: string; source: string }>)[0].source, 'unit_test_stream');

    const assistantRow = chatMessagePosts[1].body as {
      content: string;
      source: string;
      usage: { total_tokens: number; total_cost: number };
      metadata: { finish_reason: string; provider_chunk_count: number };
    };
    assertEquals(assistantRow.content, 'hi there');
    assertEquals(assistantRow.source, 'unit_test_stream');
    assertEquals(assistantRow.usage.total_tokens, 6);
    assertEquals(assistantRow.usage.total_cost, 0.0001);
    assertEquals(assistantRow.metadata.finish_reason, 'stop');
    assertEquals(assistantRow.metadata.provider_chunk_count, 2);

    const eventPosts = posts.filter((post) => post.url.includes('/chat_events'));
    assertEquals(eventPosts.length, 1);
    assert((eventPosts[0].body as Array<{ event_type: string }>).some((row) => row.event_type === 'chat_stream_request'));
    assert((eventPosts[0].body as Array<{ event_type: string }>).some((row) => row.event_type === 'chat_stream_done'));
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.__env = previousEnv;
  }
});
