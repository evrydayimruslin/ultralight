import {
  normalizeOptionalString,
  normalizeRequiredString,
  readJsonObject,
  RequestValidationError,
} from "./request-validation.ts";
import {
  CAPABILITY_SUGGESTION_EVENT_TYPES,
  type CapabilitySuggestionEventType,
} from "./capability-suggestion-telemetry.ts";
import {
  isSuggestionTarget,
  type SuggestionTarget,
} from "../../shared/contracts/suggestions.ts";

type JsonRecord = Record<string, unknown>;

export interface CapabilitySuggestionEventPayload {
  eventType: CapabilitySuggestionEventType;
  intentId?: string;
  suggestionSetId?: string;
  suggestionId?: string;
  conversationId?: string;
  traceId?: string;
  messageId?: string;
  appId?: string;
  appSlug?: string;
  eventSource?: string;
  installOnAccept?: boolean;
  metadata?: JsonRecord;
}

const EVENT_TYPE_SET = new Set<string>(CAPABILITY_SUGGESTION_EVENT_TYPES);
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeOptionalUuid(value: unknown, field: string): string | undefined {
  const normalized = normalizeOptionalString(value, field, { maxLength: 80 });
  if (!normalized) return undefined;
  if (!UUID_RE.test(normalized)) {
    throw new RequestValidationError(`${field} must be a valid UUID`);
  }
  return normalized;
}

function normalizeOptionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    throw new RequestValidationError(`${field} must be a boolean`);
  }
  return value;
}

function normalizeMetadata(value: unknown): JsonRecord | undefined {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestValidationError("metadata must be a JSON object");
  }
  return value as JsonRecord;
}

function normalizeMetadataTarget(
  metadata: JsonRecord | undefined,
): SuggestionTarget | undefined {
  if (!metadata || metadata.target === undefined || metadata.target === null) {
    return undefined;
  }
  if (!isSuggestionTarget(metadata.target)) {
    throw new RequestValidationError(
      "metadata.target must be a valid suggestion target",
    );
  }
  return metadata.target;
}

export async function validateCapabilitySuggestionEventRequest(
  request: Request,
): Promise<CapabilitySuggestionEventPayload> {
  const body = await readJsonObject(request, {
    allowedKeys: [
      "event_type",
      "intent_id",
      "suggestion_set_id",
      "suggestion_id",
      "conversation_id",
      "trace_id",
      "message_id",
      "app_id",
      "app_slug",
      "event_source",
      "install_on_accept",
      "metadata",
    ],
  });

  const eventType = normalizeRequiredString(body.event_type, "event_type", {
    maxLength: 80,
  });
  if (!EVENT_TYPE_SET.has(eventType)) {
    throw new RequestValidationError(
      `event_type must be one of: ${CAPABILITY_SUGGESTION_EVENT_TYPES.join(", ")}`,
    );
  }

  const appId = normalizeOptionalUuid(body.app_id, "app_id");
  const installOnAccept = normalizeOptionalBoolean(
    body.install_on_accept,
    "install_on_accept",
  );
  const metadata = normalizeMetadata(body.metadata);
  const target = normalizeMetadataTarget(metadata);
  const appInstallTarget = !target || target.kind === "app";
  if (
    eventType === "accepted" &&
    installOnAccept !== false &&
    appInstallTarget &&
    !appId
  ) {
    throw new RequestValidationError("app_id is required when accepting a suggestion");
  }

  return {
    eventType: eventType as CapabilitySuggestionEventType,
    intentId: normalizeOptionalUuid(body.intent_id, "intent_id"),
    suggestionSetId: normalizeOptionalUuid(body.suggestion_set_id, "suggestion_set_id"),
    suggestionId: normalizeOptionalUuid(body.suggestion_id, "suggestion_id"),
    conversationId: normalizeOptionalString(body.conversation_id, "conversation_id", {
      maxLength: 200,
    }),
    traceId: normalizeOptionalUuid(body.trace_id, "trace_id"),
    messageId: normalizeOptionalString(body.message_id, "message_id", { maxLength: 200 }),
    appId,
    appSlug: normalizeOptionalString(body.app_slug, "app_slug", { maxLength: 200 }),
    eventSource: normalizeOptionalString(body.event_source, "event_source", {
      maxLength: 80,
    }),
    installOnAccept,
    metadata,
  };
}
