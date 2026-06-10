import { getEnv } from '../lib/env.ts';
import { createServerLogger } from './logging.ts';
import { sha256Bytes, utf8ByteLength } from './analytics-identity.ts';

const artifactLogger = createServerLogger('CAPTURE-ARTIFACTS');
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface StoreCaptureArtifactInput {
  anonUserId: string;
  conversationId?: string;
  messageId?: string;
  eventId?: string;
  source: string;
  relationship?: string;
  bytes: Uint8Array;
  mimeType?: string;
  originalFilename?: string;
  textPreview?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

export interface StoredCaptureArtifact {
  artifactId: string;
  sha256: string;
  storageKey: string;
  sizeBytes: number;
}

function dbWriteHeaders(
  prefer = 'return=minimal,resolution=ignore-duplicates',
): Record<string, string> {
  const key = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  return {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
    'Prefer': prefer,
  };
}

async function insertArtifactLink(input: {
  artifactId: string;
  idempotencyKey: string;
  conversationId?: string;
  messageId?: string;
  eventId?: string;
  relationship?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  if (!input.conversationId && !input.messageId && !input.eventId) return;

  const supabaseUrl = getEnv('SUPABASE_URL');
  const response = await fetch(
    `${supabaseUrl}/rest/v1/capture_artifact_links?on_conflict=idempotency_key`,
    {
      method: 'POST',
      headers: dbWriteHeaders('return=minimal,resolution=ignore-duplicates'),
      body: JSON.stringify({
        idempotency_key: `${input.idempotencyKey}:link:${input.relationship || 'attached_to'}`,
        artifact_id: input.artifactId,
        conversation_id: input.conversationId || null,
        message_id: input.messageId || null,
        event_id: input.eventId || null,
        relationship: input.relationship || 'attached_to',
        metadata: input.metadata || {},
      }),
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `Failed to insert capture artifact link: ${response.status} ${detail}`,
    );
  }
}

function artifactCaptureEnabled(): boolean {
  const value = getEnv('CHAT_CAPTURE_ARTIFACTS_ENABLED');
  return !['0', 'false', 'off', 'disabled', 'no'].includes(
    value.trim().toLowerCase(),
  );
}

function buildStorageKey(sha256: string): string {
  return `raw-artifacts/us/${sha256.slice(0, 2)}/${sha256}`;
}

function previewBytes(bytes: Uint8Array, mimeType: string): string | null {
  if (
    !mimeType.startsWith('text/') && !mimeType.includes('json') &&
    !mimeType.includes('xml')
  ) {
    return null;
  }
  try {
    return decoder.decode(bytes.slice(0, 4000));
  } catch {
    return null;
  }
}

export async function storeCaptureArtifact(
  input: StoreCaptureArtifactInput,
): Promise<StoredCaptureArtifact | null> {
  if (!artifactCaptureEnabled()) return null;

  const bucket = getEnv().R2_BUCKET;
  const supabaseUrl = getEnv('SUPABASE_URL');
  const supabaseKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!bucket || !supabaseUrl || !supabaseKey) {
    artifactLogger.warn(
      'Artifact storage skipped because capture dependencies are unavailable',
      {
        has_bucket: !!bucket,
        has_supabase_url: !!supabaseUrl,
        has_service_key: !!supabaseKey,
        source: input.source,
      },
    );
    return null;
  }

  const mimeType = input.mimeType || 'application/octet-stream';
  const sha256 = await sha256Bytes(input.bytes);
  const storageKey = buildStorageKey(sha256);
  const textPreview = input.textPreview ?? previewBytes(input.bytes, mimeType);
  const idempotencyKey = input.idempotencyKey ||
    [
      input.anonUserId,
      input.conversationId || 'none',
      input.messageId || 'none',
      input.eventId || 'none',
      input.source,
      sha256,
    ].join(':');

  await bucket.put(storageKey, input.bytes, {
    httpMetadata: { contentType: mimeType },
    customMetadata: {
      source: input.source,
      anon_user_id: input.anonUserId,
      conversation_id: input.conversationId || '',
      sha256,
      storage_region: 'us',
    },
  });

  const row = {
    idempotency_key: idempotencyKey,
    anon_user_id: input.anonUserId,
    conversation_id: input.conversationId || null,
    message_id: input.messageId || null,
    event_id: input.eventId || null,
    source: input.source,
    sha256,
    storage_key: storageKey,
    storage_region: 'us',
    mime_type: mimeType,
    original_filename: input.originalFilename || null,
    size_bytes: input.bytes.byteLength,
    text_preview: textPreview,
    metadata: input.metadata || {},
  };

  const response = await fetch(
    `${supabaseUrl}/rest/v1/capture_artifacts?on_conflict=idempotency_key`,
    {
      method: 'POST',
      headers: dbWriteHeaders('return=representation,resolution=merge-duplicates'),
      body: JSON.stringify(row),
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `Failed to insert capture artifact: ${response.status} ${detail}`,
    );
  }

  const rows = await response.json().catch(() => []) as Array<{ id?: string }>;
  const artifactId = rows[0]?.id;
  if (!artifactId) {
    throw new Error('Capture artifact insert did not return an id');
  }

  await insertArtifactLink({
    artifactId,
    idempotencyKey,
    conversationId: input.conversationId,
    messageId: input.messageId,
    eventId: input.eventId,
    relationship: input.relationship,
    metadata: input.metadata,
  });

  return { artifactId, sha256, storageKey, sizeBytes: input.bytes.byteLength };
}

export function storeTextArtifact(
  input: Omit<StoreCaptureArtifactInput, 'bytes'> & {
    text: string;
    mimeType?: string;
  },
): Promise<StoredCaptureArtifact | null> {
  return storeCaptureArtifact({
    ...input,
    bytes: encoder.encode(input.text),
    mimeType: input.mimeType || 'text/plain; charset=utf-8',
    metadata: {
      ...(input.metadata || {}),
      text_bytes: utf8ByteLength(input.text),
    },
  });
}

export function decodeDataUrlOrBase64(
  content: string,
  fallbackMimeType = 'application/octet-stream',
): {
  bytes: Uint8Array;
  mimeType: string;
  encoding: 'data-url' | 'base64' | 'utf-8';
} {
  const match = content.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (match) {
    const mimeType = match[1] || fallbackMimeType;
    const isBase64 = !!match[2];
    const payload = match[3] || '';
    if (isBase64) {
      const binary = atob(payload);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      return { bytes, mimeType, encoding: 'data-url' };
    }
    return {
      bytes: encoder.encode(decodeURIComponent(payload)),
      mimeType,
      encoding: 'data-url',
    };
  }

  try {
    const binary = atob(content);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return { bytes, mimeType: fallbackMimeType, encoding: 'base64' };
  } catch {
    return {
      bytes: encoder.encode(content),
      mimeType: fallbackMimeType,
      encoding: 'utf-8',
    };
  }
}
