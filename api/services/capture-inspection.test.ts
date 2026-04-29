import { assert, assertEquals } from 'https://deno.land/std@0.210.0/assert/mod.ts';
import {
  buildCaptureExport,
  captureExportToJsonl,
  getCaptureOverview,
} from './capture-inspection.ts';

Deno.test('capture inspection: exports conversation bundle and integrity metadata', async () => {
  const previousEnv = globalThis.__env;
  const previousFetch = globalThis.fetch;

  globalThis.__env = {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  } as unknown as typeof globalThis.__env;

  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
    const path = url.pathname;

    if (path.endsWith('/capture_access_audit')) {
      assertEquals(init?.method, 'POST');
      return Promise.resolve(new Response('', { status: 201 }));
    }

    if (path.endsWith('/chat_threads')) {
      return jsonRows([{
        conversation_id: 'conv-1',
        anon_user_id: 'anon-1',
        source: 'chat_view',
        capture_region: 'us',
        trace_id: '00000000-0000-4000-8000-000000000001',
        model_route: { provider: 'openrouter' },
        scope: {},
        metadata: {},
        created_at: '2026-04-29T12:00:00Z',
        updated_at: '2026-04-29T12:00:02Z',
        first_captured_at: '2026-04-29T12:00:00Z',
        last_captured_at: '2026-04-29T12:00:02Z',
      }]);
    }

    if (path.endsWith('/chat_messages')) {
      return jsonRows([
        {
          message_id: 'msg-user',
          conversation_id: 'conv-1',
          anon_user_id: 'anon-1',
          role: 'user',
          content: 'hello',
          content_sha256: 'hash-user',
          content_bytes: 5,
          sort_order: 0,
          model: null,
          usage: {},
          cost_light: null,
          source: 'chat_view',
          metadata: {},
          created_at: '2026-04-29T12:00:00Z',
          captured_at: '2026-04-29T12:00:00Z',
        },
        {
          message_id: 'msg-assistant',
          conversation_id: 'conv-1',
          anon_user_id: 'anon-1',
          role: 'assistant',
          content: 'hi',
          content_sha256: 'hash-assistant',
          content_bytes: 2,
          sort_order: 1,
          model: 'openai/gpt-4o-mini',
          usage: { total_tokens: 10, total_cost: 0.001 },
          cost_light: null,
          source: 'chat_view',
          metadata: {},
          created_at: '2026-04-29T12:00:02Z',
          captured_at: '2026-04-29T12:00:02Z',
        },
      ]);
    }

    if (path.endsWith('/chat_events')) {
      return jsonRows([{
        id: '00000000-0000-4000-8000-000000000010',
        trace_id: '00000000-0000-4000-8000-000000000001',
        conversation_id: 'conv-1',
        message_id: 'msg-assistant',
        anon_user_id: 'anon-1',
        event_type: 'chat_stream_done',
        event_sequence: 1,
        payload: { reason: 'stream_flush' },
        payload_sha256: 'event-hash',
        created_at: '2026-04-29T12:00:02Z',
      }]);
    }

    if (path.endsWith('/capture_artifact_links')) {
      return jsonRows([{
        id: '00000000-0000-4000-8000-000000000020',
        idempotency_key: 'link-key',
        artifact_id: '00000000-0000-4000-8000-000000000030',
        conversation_id: 'conv-1',
        message_id: 'msg-user',
        event_id: null,
        relationship: 'uploaded_file',
        metadata: {},
        created_at: '2026-04-29T12:00:00Z',
      }]);
    }

    if (path.endsWith('/capture_artifacts')) {
      return jsonRows([{
        id: '00000000-0000-4000-8000-000000000030',
        idempotency_key: 'artifact-key',
        anon_user_id: 'anon-1',
        conversation_id: 'conv-1',
        message_id: 'msg-user',
        event_id: null,
        source: 'upload',
        sha256: 'artifact-hash',
        storage_key: 'raw-artifacts/us/aa/artifact-hash',
        storage_region: 'us',
        mime_type: 'text/plain',
        original_filename: 'note.txt',
        size_bytes: 12,
        text_preview: 'hello world',
        parser_status: 'pending',
        sensitivity_class: 'unknown',
        training_eligibility: 'pending',
        metadata: {},
        created_at: '2026-04-29T12:00:00Z',
      }]);
    }

    return Promise.resolve(new Response('not found', { status: 404 }));
  }) as typeof fetch;

  try {
    const bundle = await buildCaptureExport({ conversationId: 'conv-1' });

    assertEquals(bundle.export_meta.thread_count, 1);
    assertEquals(bundle.export_meta.message_count, 2);
    assertEquals(bundle.export_meta.event_count, 1);
    assertEquals(bundle.export_meta.artifact_count, 1);
    assertEquals(bundle.integrity.empty_assistant_messages, []);

    const jsonl = captureExportToJsonl(bundle);
    assert(jsonl.includes('"type":"message"'));
    assert(jsonl.includes('"type":"artifact"'));
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.__env = previousEnv;
  }
});

Deno.test('capture inspection: overview summarizes sampled rows', async () => {
  const previousEnv = globalThis.__env;
  const previousFetch = globalThis.fetch;

  globalThis.__env = {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  } as unknown as typeof globalThis.__env;

  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
    const path = url.pathname;

    if (init?.headers && path.includes('/rest/v1/') && url.searchParams.get('select')) {
      const headers = new Headers({ 'content-range': '0-0/2' });
      if ((init.headers as Record<string, string>)['Range'] === '0-0') {
        return Promise.resolve(new Response('[]', { status: 206, headers }));
      }
    }

    if (path.endsWith('/capture_access_audit')) {
      return Promise.resolve(new Response('', { status: 201 }));
    }
    if (path.endsWith('/chat_threads')) {
      return jsonRows([{ conversation_id: 'conv-1', anon_user_id: 'anon-1', source: 'chat_view', capture_region: 'us', trace_id: null, model_route: {}, scope: {}, metadata: {}, created_at: '', updated_at: '', first_captured_at: '', last_captured_at: '' }]);
    }
    if (path.endsWith('/chat_messages')) {
      return jsonRows([{ message_id: 'msg-1', conversation_id: 'conv-1', anon_user_id: 'anon-1', role: 'assistant', content: '', content_sha256: null, content_bytes: 0, sort_order: 0, model: 'm', usage: { total_tokens: 3 }, cost_light: null, source: 'chat_view', metadata: {}, created_at: '', captured_at: '' }]);
    }
    if (path.endsWith('/chat_events')) return jsonRows([]);
    if (path.endsWith('/capture_artifacts')) return jsonRows([]);
    return jsonRows([]);
  }) as typeof fetch;

  try {
    const overview = await getCaptureOverview({ limit: 10 });
    assertEquals(overview.success, true);
    assertEquals((overview.totals as Record<string, unknown>).threads, 2);
    assertEquals((overview.by_source as Array<{ key: string; count: number }>)[0].key, 'chat_view');
    assertEquals((overview.integrity as Record<string, unknown>).empty_assistant_messages, ['msg-1']);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.__env = previousEnv;
  }
});

function jsonRows(rows: unknown[]): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(rows), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));
}
