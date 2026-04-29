import { getEnv } from '../lib/env.ts';
import { createServerLogger } from './logging.ts';

type JsonRecord = Record<string, unknown>;

export interface CaptureInspectionFilters {
  conversationId?: string;
  anonUserId?: string;
  source?: string;
  since?: string;
  until?: string;
  limit?: number;
}

export interface CaptureThreadRow {
  conversation_id: string;
  anon_user_id: string;
  source: string;
  capture_region: string;
  trace_id: string | null;
  model_route: JsonRecord;
  scope: JsonRecord;
  metadata: JsonRecord;
  created_at: string;
  updated_at: string;
  first_captured_at: string;
  last_captured_at: string;
}

export interface CaptureMessageRow {
  message_id: string;
  conversation_id: string;
  anon_user_id: string;
  role: string;
  content: string;
  content_sha256: string | null;
  content_bytes: number;
  sort_order: number | null;
  model: string | null;
  usage: JsonRecord;
  cost_light: number | null;
  source: string;
  metadata: JsonRecord;
  created_at: string;
  captured_at: string;
}

export interface CaptureEventRow {
  id: string;
  trace_id: string;
  conversation_id: string;
  message_id: string | null;
  anon_user_id: string;
  event_type: string;
  event_sequence: number;
  payload: JsonRecord;
  payload_sha256: string | null;
  created_at: string;
}

export interface CaptureArtifactRow {
  id: string;
  idempotency_key: string;
  anon_user_id: string;
  conversation_id: string | null;
  message_id: string | null;
  event_id: string | null;
  source: string;
  sha256: string;
  storage_key: string;
  storage_region: string;
  mime_type: string;
  original_filename: string | null;
  size_bytes: number;
  text_preview: string | null;
  parser_status: string;
  sensitivity_class: string;
  training_eligibility: string;
  metadata: JsonRecord;
  created_at: string;
}

export interface CaptureArtifactLinkRow {
  id: string;
  idempotency_key: string;
  artifact_id: string;
  conversation_id: string | null;
  message_id: string | null;
  event_id: string | null;
  relationship: string;
  metadata: JsonRecord;
  created_at: string;
}

export interface CaptureExportBundle {
  export_meta: {
    generated_at: string;
    filters: CaptureInspectionFilters;
    thread_count: number;
    message_count: number;
    event_count: number;
    artifact_count: number;
    artifact_link_count: number;
  };
  threads: CaptureThreadRow[];
  messages: CaptureMessageRow[];
  events: CaptureEventRow[];
  artifact_links: CaptureArtifactLinkRow[];
  artifacts: CaptureArtifactRow[];
  integrity: CaptureIntegrityReport;
}

export interface CaptureIntegrityReport {
  assistant_without_prior_user: string[];
  empty_assistant_messages: string[];
  messages_missing_hash: string[];
  inline_fallback_messages: string[];
  event_artifact_spills: number;
  event_errors: Array<{
    event_id: string;
    conversation_id: string;
    message_id: string | null;
    message: string | null;
    phase: unknown;
    created_at: string;
  }>;
}

const captureInspectionLogger = createServerLogger('CAPTURE-INSPECTION');

function dbHeaders(prefer?: string): Record<string, string> {
  const key = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  return {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    ...(prefer ? { 'Prefer': prefer } : {}),
  };
}

function supabaseUrl(resource: string, params: Record<string, string | number | undefined>): string {
  const base = getEnv('SUPABASE_URL');
  const url = new URL(`${base}/rest/v1/${resource}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function getRows<T>(
  resource: string,
  params: Record<string, string | number | undefined>,
): Promise<T[]> {
  const response = await fetch(supabaseUrl(resource, params), {
    headers: dbHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Failed to read ${resource}: ${response.status} ${await response.text()}`);
  }
  return await response.json() as T[];
}

async function getCount(
  resource: string,
  params: Record<string, string | number | undefined>,
): Promise<number> {
  const response = await fetch(supabaseUrl(resource, params), {
    headers: {
      ...dbHeaders('count=exact'),
      'Range-Unit': 'items',
      'Range': '0-0',
    },
  });
  if (!response.ok) return 0;
  const range = response.headers.get('content-range') || '';
  const total = range.split('/')[1];
  const parsed = total ? Number(total) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function clampLimit(limit: number | undefined, fallback: number, max: number): number {
  if (!Number.isFinite(limit) || !limit || limit <= 0) return fallback;
  return Math.min(Math.floor(limit), max);
}

function applyThreadFilters(filters: CaptureInspectionFilters): Record<string, string | number | undefined> {
  const params = {
    conversation_id: filters.conversationId ? `eq.${filters.conversationId}` : undefined,
    anon_user_id: filters.anonUserId ? `eq.${filters.anonUserId}` : undefined,
    source: filters.source ? `eq.${filters.source}` : undefined,
  };
  return applyTimeRange(params, 'last_captured_at', filters.since, filters.until);
}

function tableFilterParams(
  filters: CaptureInspectionFilters,
  timeColumn: string,
): Record<string, string | number | undefined> {
  const params: Record<string, string | number | undefined> = {
    conversation_id: filters.conversationId ? `eq.${filters.conversationId}` : undefined,
    anon_user_id: filters.anonUserId ? `eq.${filters.anonUserId}` : undefined,
    source: filters.source ? `eq.${filters.source}` : undefined,
  };
  return applyTimeRange(params, timeColumn, filters.since, filters.until);
}

function linkFilterParams(
  filters: CaptureInspectionFilters,
): Record<string, string | number | undefined> {
  const params: Record<string, string | number | undefined> = {
    conversation_id: filters.conversationId ? `eq.${filters.conversationId}` : undefined,
  };
  return applyTimeRange(params, 'created_at', filters.since, filters.until);
}

function eventFilterParams(
  filters: CaptureInspectionFilters,
): Record<string, string | number | undefined> {
  const params: Record<string, string | number | undefined> = {
    conversation_id: filters.conversationId ? `eq.${filters.conversationId}` : undefined,
    anon_user_id: filters.anonUserId ? `eq.${filters.anonUserId}` : undefined,
  };
  return applyTimeRange(params, 'created_at', filters.since, filters.until);
}

function applyTimeRange(
  params: Record<string, string | number | undefined>,
  column: string,
  since?: string,
  until?: string,
): Record<string, string | number | undefined> {
  if (since && until) {
    return {
      ...params,
      and: `(${column}.gte.${since},${column}.lte.${until})`,
    };
  }
  if (since) return { ...params, [column]: `gte.${since}` };
  if (until) return { ...params, [column]: `lte.${until}` };
  return params;
}

function inFilter(values: string[]): string | undefined {
  if (values.length === 0) return undefined;
  return `in.(${values.join(',')})`;
}

function increment(map: Record<string, number>, key: string | null | undefined, amount = 1): void {
  const resolved = key || 'unknown';
  map[resolved] = (map[resolved] || 0) + amount;
}

function numberFrom(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function topEntries(map: Record<string, number>, limit = 20): Array<{ key: string; count: number }> {
  return Object.entries(map)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export async function getCaptureOverview(
  filters: CaptureInspectionFilters = {},
): Promise<JsonRecord> {
  const limit = clampLimit(filters.limit, 5000, 20000);
  const generatedAt = new Date().toISOString();
  const threadParams = applyThreadFilters(filters);

  const [
    threadCount,
    messageCount,
    eventCount,
    artifactCount,
    linkCount,
    recentThreads,
    recentMessages,
    recentEvents,
    recentArtifacts,
  ] = await Promise.all([
    getCount('chat_threads', {
      ...threadParams,
      select: 'conversation_id',
    }),
    getCount('chat_messages', {
      ...tableFilterParams(filters, 'captured_at'),
      select: 'message_id',
    }),
    getCount('chat_events', {
      ...eventFilterParams(filters),
      select: 'id',
    }),
    getCount('capture_artifacts', {
      ...tableFilterParams(filters, 'created_at'),
      select: 'id',
    }),
    getCount('capture_artifact_links', {
      ...linkFilterParams(filters),
      select: 'id',
    }),
    getRows<CaptureThreadRow>('chat_threads', {
      ...threadParams,
      select: 'conversation_id,anon_user_id,source,capture_region,trace_id,model_route,scope,metadata,created_at,updated_at,first_captured_at,last_captured_at',
      order: 'last_captured_at.desc',
      limit,
    }),
    getRows<CaptureMessageRow>('chat_messages', {
      ...tableFilterParams(filters, 'captured_at'),
      select: 'message_id,conversation_id,anon_user_id,role,content,content_sha256,content_bytes,sort_order,model,usage,cost_light,source,metadata,created_at,captured_at',
      order: 'captured_at.desc',
      limit,
    }),
    getRows<CaptureEventRow>('chat_events', {
      ...eventFilterParams(filters),
      select: 'id,trace_id,conversation_id,message_id,anon_user_id,event_type,event_sequence,payload,payload_sha256,created_at',
      order: 'created_at.desc',
      limit,
    }),
    getRows<CaptureArtifactRow>('capture_artifacts', {
      ...tableFilterParams(filters, 'created_at'),
      select: 'id,idempotency_key,anon_user_id,conversation_id,message_id,event_id,source,sha256,storage_key,storage_region,mime_type,original_filename,size_bytes,text_preview,parser_status,sensitivity_class,training_eligibility,metadata,created_at',
      order: 'created_at.desc',
      limit,
    }),
  ]);

  const sourceCounts: Record<string, number> = {};
  const roleCounts: Record<string, number> = {};
  const modelCounts: Record<string, number> = {};
  const eventCounts: Record<string, number> = {};
  const artifactSourceCounts: Record<string, number> = {};
  let totalTokens = 0;
  let totalCost = 0;
  let totalContentBytes = 0;

  for (const thread of recentThreads) increment(sourceCounts, thread.source);
  for (const message of recentMessages) {
    increment(roleCounts, message.role);
    increment(modelCounts, message.model);
    totalContentBytes += message.content_bytes || 0;
    totalTokens += numberFrom(message.usage?.total_tokens);
    totalCost += numberFrom(message.usage?.total_cost) + numberFrom(message.cost_light);
  }
  for (const event of recentEvents) increment(eventCounts, event.event_type);
  for (const artifact of recentArtifacts) increment(artifactSourceCounts, artifact.source);

  const integrity = buildIntegrityReport(recentThreads, recentMessages, recentEvents);

  await recordCaptureAccess({
    action: 'overview',
    filters,
    counts: { threadCount, messageCount, eventCount, artifactCount, linkCount },
  });

  return {
    success: true,
    generated_at: generatedAt,
    filters,
    sample_limit: limit,
    totals: {
      threads: threadCount,
      messages: messageCount,
      events: eventCount,
      artifacts: artifactCount,
      artifact_links: linkCount,
      sampled_threads: recentThreads.length,
      sampled_messages: recentMessages.length,
      sampled_events: recentEvents.length,
      sampled_artifacts: recentArtifacts.length,
      total_content_bytes_sampled: totalContentBytes,
      total_tokens_sampled: totalTokens,
      total_cost_sampled: totalCost,
    },
    by_source: topEntries(sourceCounts),
    by_role: topEntries(roleCounts),
    by_model: topEntries(modelCounts),
    by_event_type: topEntries(eventCounts),
    by_artifact_source: topEntries(artifactSourceCounts),
    integrity,
    recent_threads: recentThreads.slice(0, 50).map((thread) => ({
      conversation_id: thread.conversation_id,
      anon_user_id: thread.anon_user_id,
      source: thread.source,
      trace_id: thread.trace_id,
      model_route: thread.model_route,
      metadata: thread.metadata,
      first_captured_at: thread.first_captured_at,
      last_captured_at: thread.last_captured_at,
    })),
  };
}

export async function inspectCaptureConversation(
  conversationId: string,
): Promise<CaptureExportBundle> {
  const bundle = await buildCaptureExport({ conversationId, limit: 1 });
  await recordCaptureAccess({
    action: 'inspect_conversation',
    conversationId,
    counts: bundle.export_meta,
  });
  return bundle;
}

export async function buildCaptureExport(
  filters: CaptureInspectionFilters,
): Promise<CaptureExportBundle> {
  const limit = clampLimit(filters.limit, 100, 1000);
  const threads = await getRows<CaptureThreadRow>('chat_threads', {
    ...applyThreadFilters(filters),
    select: 'conversation_id,anon_user_id,source,capture_region,trace_id,model_route,scope,metadata,created_at,updated_at,first_captured_at,last_captured_at',
    order: 'last_captured_at.desc',
    limit,
  });

  const conversationIds = threads.map((thread) => thread.conversation_id);
  if (conversationIds.length === 0) {
    const emptyBundle: CaptureExportBundle = {
      export_meta: {
        generated_at: new Date().toISOString(),
        filters,
        thread_count: 0,
        message_count: 0,
        event_count: 0,
        artifact_count: 0,
        artifact_link_count: 0,
      },
      threads: [],
      messages: [],
      events: [],
      artifact_links: [],
      artifacts: [],
      integrity: buildIntegrityReport([], [], []),
    };
    await recordCaptureAccess({
      action: 'export',
      filters,
      counts: emptyBundle.export_meta,
    });
    return emptyBundle;
  }

  const conversationFilter = filters.conversationId
    ? `eq.${filters.conversationId}`
    : inFilter(conversationIds);

  const [messages, events, artifactLinks] = await Promise.all([
    getRows<CaptureMessageRow>('chat_messages', {
      conversation_id: conversationFilter,
      select: 'message_id,conversation_id,anon_user_id,role,content,content_sha256,content_bytes,sort_order,model,usage,cost_light,source,metadata,created_at,captured_at',
      order: 'conversation_id.asc,sort_order.asc,captured_at.asc',
      limit: filters.conversationId ? 10000 : Math.min(limit * 200, 20000),
    }),
    getRows<CaptureEventRow>('chat_events', {
      conversation_id: conversationFilter,
      select: 'id,trace_id,conversation_id,message_id,anon_user_id,event_type,event_sequence,payload,payload_sha256,created_at',
      order: 'conversation_id.asc,event_sequence.asc',
      limit: filters.conversationId ? 10000 : Math.min(limit * 300, 30000),
    }),
    getRows<CaptureArtifactLinkRow>('capture_artifact_links', {
      conversation_id: conversationFilter,
      select: 'id,idempotency_key,artifact_id,conversation_id,message_id,event_id,relationship,metadata,created_at',
      order: 'created_at.asc',
      limit: filters.conversationId ? 10000 : Math.min(limit * 100, 10000),
    }),
  ]);

  const artifactIds = [...new Set(artifactLinks.map((link) => link.artifact_id))];
  const artifacts = artifactIds.length > 0
    ? await getRows<CaptureArtifactRow>('capture_artifacts', {
      id: inFilter(artifactIds),
      select: 'id,idempotency_key,anon_user_id,conversation_id,message_id,event_id,source,sha256,storage_key,storage_region,mime_type,original_filename,size_bytes,text_preview,parser_status,sensitivity_class,training_eligibility,metadata,created_at',
      order: 'created_at.asc',
      limit: artifactIds.length,
    })
    : [];

  const bundle: CaptureExportBundle = {
    export_meta: {
      generated_at: new Date().toISOString(),
      filters,
      thread_count: threads.length,
      message_count: messages.length,
      event_count: events.length,
      artifact_count: artifacts.length,
      artifact_link_count: artifactLinks.length,
    },
    threads,
    messages,
    events,
    artifact_links: artifactLinks,
    artifacts,
    integrity: buildIntegrityReport(threads, messages, events),
  };

  await recordCaptureAccess({
    action: 'export',
    filters,
    counts: bundle.export_meta,
  });

  return bundle;
}

export function captureExportToJsonl(bundle: CaptureExportBundle): string {
  const lines: string[] = [
    JSON.stringify({ type: 'export_meta', data: bundle.export_meta }),
    JSON.stringify({ type: 'integrity', data: bundle.integrity }),
  ];
  for (const thread of bundle.threads) lines.push(JSON.stringify({ type: 'thread', data: thread }));
  for (const message of bundle.messages) lines.push(JSON.stringify({ type: 'message', data: message }));
  for (const event of bundle.events) lines.push(JSON.stringify({ type: 'event', data: event }));
  for (const link of bundle.artifact_links) lines.push(JSON.stringify({ type: 'artifact_link', data: link }));
  for (const artifact of bundle.artifacts) lines.push(JSON.stringify({ type: 'artifact', data: artifact }));
  return `${lines.join('\n')}\n`;
}

function buildIntegrityReport(
  threads: CaptureThreadRow[],
  messages: CaptureMessageRow[],
  events: CaptureEventRow[],
): CaptureIntegrityReport {
  const conversationHasUser = new Map<string, boolean>();
  const assistantWithoutUser: string[] = [];
  const emptyAssistants: string[] = [];
  const missingHash: string[] = [];
  const inlineFallback: string[] = [];

  const sortedMessages = [...messages].sort((a, b) => {
    const conversationCompare = a.conversation_id.localeCompare(b.conversation_id);
    if (conversationCompare !== 0) return conversationCompare;
    const sortA = a.sort_order ?? Number.MAX_SAFE_INTEGER;
    const sortB = b.sort_order ?? Number.MAX_SAFE_INTEGER;
    if (sortA !== sortB) return sortA - sortB;
    return a.captured_at.localeCompare(b.captured_at);
  });

  for (const thread of threads) {
    conversationHasUser.set(thread.conversation_id, false);
  }

  for (const message of sortedMessages) {
    if (!message.content_sha256) missingHash.push(message.message_id);
    if (message.metadata?.content_storage === 'inline_fallback') inlineFallback.push(message.message_id);
    if (message.role === 'user') {
      conversationHasUser.set(message.conversation_id, true);
    }
    if (message.role === 'assistant') {
      if (!conversationHasUser.get(message.conversation_id)) {
        assistantWithoutUser.push(message.message_id);
      }
      if (!message.content || message.content.trim().length === 0) {
        emptyAssistants.push(message.message_id);
      }
    }
  }

  const eventErrors: CaptureIntegrityReport['event_errors'] = [];
  let eventArtifactSpills = 0;
  for (const event of events) {
    if (event.payload?._spilled_to_artifact === true) eventArtifactSpills++;
    if (event.event_type.endsWith('error') || event.event_type === 'error') {
      eventErrors.push({
        event_id: event.id,
        conversation_id: event.conversation_id,
        message_id: event.message_id,
        message: typeof event.payload?.message === 'string' ? event.payload.message : null,
        phase: event.payload?.phase ?? null,
        created_at: event.created_at,
      });
    }
  }

  return {
    assistant_without_prior_user: assistantWithoutUser,
    empty_assistant_messages: emptyAssistants,
    messages_missing_hash: missingHash,
    inline_fallback_messages: inlineFallback,
    event_artifact_spills: eventArtifactSpills,
    event_errors: eventErrors.slice(0, 100),
  };
}

async function recordCaptureAccess(metadata: JsonRecord): Promise<void> {
  const action = typeof metadata.action === 'string' ? metadata.action : 'unknown';
  try {
    await fetch(supabaseUrl('capture_access_audit', {}), {
      method: 'POST',
      headers: {
        ...dbHeaders('return=minimal'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        actor_service: 'admin_capture_api',
        action,
        table_name: 'capture_export',
        reason: 'capture inspection/export',
        metadata,
      }),
    });
  } catch (err) {
    captureInspectionLogger.warn('Failed to write capture access audit', {
      action,
      error: err,
    });
  }
}
