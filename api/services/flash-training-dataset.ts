import type {
  CaptureArtifactRow,
  CaptureEventRow,
  CaptureExportBundle,
  ExecutionFailureRow,
  LlmContextSnapshotRow,
  LlmInvocationRow,
  ToolInvocationRow,
  TrainingAnnotationRow,
} from "./capture-inspection.ts";
import {
  deriveFlashOutcomeLabels,
  type FlashOutcomeLabelResult,
  getFlashComponentId,
  isFlashInvocation,
} from "./flash-training-labels.ts";

type JsonRecord = Record<string, unknown>;

export const FLASH_TRAINING_DATASET_VERSION = "flash-training-dataset.v1";

export type FlashTrainingDatasetFilterMode =
  | "training_ready"
  | "human_accepted"
  | "needs_review"
  | "all";

export type FlashTrainingJsonlFormat = "ultralight" | "openai_messages";

export interface FlashTrainingDatasetRows {
  invocations: LlmInvocationRow[];
  contextSnapshots: LlmContextSnapshotRow[];
  artifacts?: CaptureArtifactRow[];
  events?: CaptureEventRow[];
  toolInvocations?: ToolInvocationRow[];
  executionFailures?: ExecutionFailureRow[];
  trainingAnnotations?: TrainingAnnotationRow[];
}

export interface BuildFlashTrainingDatasetOptions {
  generatedAt?: string;
  filterMode?: FlashTrainingDatasetFilterMode;
  componentIds?: readonly string[];
  schemaIds?: readonly string[];
  capabilities?: readonly string[];
  includeIncomplete?: boolean;
}

export interface FlashTrainingJsonlOptions {
  format?: FlashTrainingJsonlFormat;
  includeTools?: boolean;
  finalNewline?: boolean;
}

export interface FlashTrainingDataset {
  dataset_version: typeof FLASH_TRAINING_DATASET_VERSION;
  generated_at: string;
  example_count: number;
  total_flash_example_count: number;
  ready_example_count: number;
  incomplete_example_count: number;
  filtered_out_example_count: number;
  filter: FlashTrainingDatasetFilterSummary;
  examples: FlashTrainingExample[];
}

export interface FlashTrainingDatasetFilterSummary {
  mode: FlashTrainingDatasetFilterMode;
  component_ids: string[];
  schema_ids: string[];
  capabilities: string[];
  included_example_count: number;
  filtered_out_example_count: number;
  filtered_reason_counts: Record<string, number>;
}

export interface FlashTrainingExample {
  dataset_version: typeof FLASH_TRAINING_DATASET_VERSION;
  id: string;
  invocation_id: string;
  trace_id: string | null;
  conversation_id: string | null;
  anon_user_id: string | null;
  component_id: string;
  schema_id: string | null;
  capabilities: string[];
  input_features: JsonRecord;
  output_shape: string | null;
  provider: string | null;
  requested_model: string | null;
  resolved_model: string | null;
  status: string;
  finish_reason: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  usage: JsonRecord;
  request_params: JsonRecord;
  messages: unknown[];
  tools: unknown[];
  expected_output: unknown;
  request_snapshot: FlashTrainingSnapshotPayload;
  response_snapshot: FlashTrainingSnapshotPayload;
  outcome_taxonomy_version: FlashOutcomeLabelResult["taxonomy_version"];
  outcome_labels: JsonRecord;
  training_candidate: boolean;
  needs_human_review: boolean;
  build_warnings: string[];
  filter_reasons: string[];
  metadata: JsonRecord;
}

export interface FlashTrainingSnapshotPayload {
  snapshot_id: string | null;
  snapshot_type: string;
  artifact_id: string | null;
  sha256: string | null;
  size_bytes: number | null;
  source: string | null;
  status: "parsed" | "missing" | "unparseable";
  value: unknown;
  parse_error: string | null;
  parsed_from: "snapshot_text_preview" | "artifact_text_preview" | null;
}

export interface FlashTrainingJsonlExport {
  format: FlashTrainingJsonlFormat;
  example_count: number;
  jsonl: string;
}

export function buildFlashTrainingDatasetFromBundle(
  bundle: CaptureExportBundle,
  options: BuildFlashTrainingDatasetOptions = {},
): FlashTrainingDataset {
  return buildFlashTrainingDataset({
    invocations: bundle.llm_invocations,
    contextSnapshots: bundle.llm_context_snapshots,
    artifacts: bundle.artifacts,
    events: bundle.events,
    toolInvocations: bundle.tool_invocations,
    executionFailures: bundle.execution_failures,
    trainingAnnotations: bundle.training_annotations,
  }, options);
}

export function buildFlashTrainingDataset(
  rows: FlashTrainingDatasetRows,
  options: BuildFlashTrainingDatasetOptions = {},
): FlashTrainingDataset {
  const allExamples = buildAllFlashTrainingExamples(rows);
  const filter = resolveFilterOptions(options);
  const examples = filterFlashTrainingExamples(allExamples, options);
  const readyExampleCount =
    examples.filter((example) => example.training_candidate).length;

  return {
    dataset_version: FLASH_TRAINING_DATASET_VERSION,
    generated_at: options.generatedAt || new Date().toISOString(),
    example_count: examples.length,
    total_flash_example_count: allExamples.length,
    ready_example_count: readyExampleCount,
    incomplete_example_count: examples.length - readyExampleCount,
    filtered_out_example_count: allExamples.length - examples.length,
    filter: summarizeFilter(allExamples, filter),
    examples,
  };
}

export function buildFlashTrainingExamples(
  rows: FlashTrainingDatasetRows,
  options: BuildFlashTrainingDatasetOptions = {},
): FlashTrainingExample[] {
  return filterFlashTrainingExamples(
    buildAllFlashTrainingExamples(rows),
    options,
  );
}

export function filterFlashTrainingExamples(
  examples: FlashTrainingExample[],
  options: BuildFlashTrainingDatasetOptions = {},
): FlashTrainingExample[] {
  const filter = resolveFilterOptions(options);
  return examples.filter((example) =>
    filterFlashTrainingExample(example, filter).included
  );
}

export function getFlashTrainingReadinessReasons(
  input: {
    componentId: string;
    outcomeLabels: JsonRecord;
    buildWarnings: string[];
  },
): string[] {
  const labels = input.outcomeLabels;
  const reasons = [...input.buildWarnings];
  if (labels.provider_success !== true) reasons.push("provider_not_success");
  if (labels.parse_success !== true) reasons.push("parse_not_success");
  if (numberFrom(labels.rejected_annotation_count) > 0) {
    reasons.push("rejected_annotation");
  }
  if (numberFrom(labels.downstream_failure_count) > 0) {
    reasons.push("downstream_failure");
  }
  if (numberFrom(labels.downstream_tool_error_count) > 0) {
    reasons.push("downstream_tool_error");
  }
  if (labels.downstream_user_visible_error === true) {
    reasons.push("downstream_user_visible_error");
  }
  if (
    input.componentId === "flash_broker.prompt_builder" &&
    labels.downstream_recipe_parsed !== true
  ) {
    reasons.push("prompt_builder_recipe_not_parsed");
  }
  if (labels.training_candidate === false && reasons.length === 0) {
    reasons.push("outcome_training_candidate_false");
  }
  return uniqueStrings(reasons);
}

export function flashTrainingDatasetToJsonl(
  dataset: FlashTrainingDataset,
  options: FlashTrainingJsonlOptions = {},
): string {
  return flashTrainingExamplesToJsonl(dataset.examples, options);
}

export function exportFlashTrainingDatasetToJsonl(
  dataset: FlashTrainingDataset,
  options: FlashTrainingJsonlOptions = {},
): FlashTrainingJsonlExport {
  const format = options.format || "ultralight";
  return {
    format,
    example_count: dataset.examples.length,
    jsonl: flashTrainingDatasetToJsonl(dataset, { ...options, format }),
  };
}

export function flashTrainingExamplesToJsonl(
  examples: FlashTrainingExample[],
  options: FlashTrainingJsonlOptions = {},
): string {
  const records = examples.map((example) =>
    flashTrainingExampleToJsonlRecord(example, options)
  );
  return jsonlLines(records, options.finalNewline !== false);
}

export function flashTrainingExampleToJsonlRecord(
  example: FlashTrainingExample,
  options: FlashTrainingJsonlOptions = {},
): JsonRecord {
  const format = options.format || "ultralight";
  return format === "openai_messages"
    ? toOpenAiMessagesRecord(example, options)
    : toUltralightRecord(example);
}

function buildAllFlashTrainingExamples(
  rows: FlashTrainingDatasetRows,
): FlashTrainingExample[] {
  return rows.invocations
    .filter(isFlashInvocation)
    .map((invocation) => buildFlashTrainingExample(invocation, rows));
}

function toUltralightRecord(example: FlashTrainingExample): JsonRecord {
  return {
    type: "flash_training_example",
    id: example.id,
    dataset_version: example.dataset_version,
    component_id: example.component_id,
    schema_id: example.schema_id,
    capabilities: example.capabilities,
    input_features: example.input_features,
    output_shape: example.output_shape,
    messages: example.messages,
    tools: example.tools,
    expected_output: example.expected_output,
    outcome_taxonomy_version: example.outcome_taxonomy_version,
    outcome_labels: example.outcome_labels,
    training_candidate: example.training_candidate,
    needs_human_review: example.needs_human_review,
    build_warnings: example.build_warnings,
    filter_reasons: example.filter_reasons,
    source: {
      invocation_id: example.invocation_id,
      trace_id: example.trace_id,
      conversation_id: example.conversation_id,
      anon_user_id: example.anon_user_id,
      provider: example.provider,
      requested_model: example.requested_model,
      resolved_model: example.resolved_model,
      status: example.status,
      finish_reason: example.finish_reason,
      started_at: example.started_at,
      completed_at: example.completed_at,
      duration_ms: example.duration_ms,
      usage: example.usage,
      request_params: example.request_params,
      request_snapshot: snapshotReference(example.request_snapshot),
      response_snapshot: snapshotReference(example.response_snapshot),
      metadata: example.metadata,
    },
  };
}

function toOpenAiMessagesRecord(
  example: FlashTrainingExample,
  options: FlashTrainingJsonlOptions,
): JsonRecord {
  const record: JsonRecord = {
    messages: [
      ...normalizeOpenAiMessages(example.messages),
      {
        role: "assistant",
        content: assistantContent(example.expected_output),
      },
    ],
    metadata: {
      id: example.id,
      dataset_version: example.dataset_version,
      component_id: example.component_id,
      schema_id: example.schema_id,
      capabilities: example.capabilities,
      output_shape: example.output_shape,
      outcome_taxonomy_version: example.outcome_taxonomy_version,
      training_candidate: example.training_candidate,
      needs_human_review: example.needs_human_review,
      invocation_id: example.invocation_id,
      trace_id: example.trace_id,
      source_provider: example.provider,
      source_model: example.resolved_model || example.requested_model,
    },
  };
  if (options.includeTools && example.tools.length > 0) {
    record.tools = example.tools;
  }
  return record;
}

function normalizeOpenAiMessages(messages: unknown[]): JsonRecord[] {
  return messages
    .map(normalizeOpenAiMessage)
    .filter((message): message is JsonRecord => !!message);
}

function normalizeOpenAiMessage(message: unknown): JsonRecord | null {
  const record = asRecord(message);
  const role = stringFrom(record.role);
  if (!role) return null;
  const normalized: JsonRecord = { ...record, role };
  if (!Object.hasOwn(normalized, "content")) {
    normalized.content = "";
  } else if (typeof normalized.content !== "string") {
    normalized.content = assistantContent(normalized.content);
  }
  return normalized;
}

function assistantContent(value: unknown): string {
  if (typeof value === "string") return value;
  const serialized = JSON.stringify(value);
  return typeof serialized === "string" ? serialized : "";
}

function snapshotReference(snapshot: FlashTrainingSnapshotPayload): JsonRecord {
  return {
    snapshot_id: snapshot.snapshot_id,
    snapshot_type: snapshot.snapshot_type,
    artifact_id: snapshot.artifact_id,
    sha256: snapshot.sha256,
    size_bytes: snapshot.size_bytes,
    source: snapshot.source,
    status: snapshot.status,
    parse_error: snapshot.parse_error,
    parsed_from: snapshot.parsed_from,
  };
}

function jsonlLines(records: JsonRecord[], finalNewline: boolean): string {
  if (records.length === 0) return "";
  const text = records.map((record) => JSON.stringify(record)).join("\n");
  return finalNewline ? `${text}\n` : text;
}

function buildFlashTrainingExample(
  invocation: LlmInvocationRow,
  rows: FlashTrainingDatasetRows,
): FlashTrainingExample {
  const componentId = getFlashComponentId(invocation);
  const metadata = asRecord(invocation.metadata);
  const requestSnapshot = parseSnapshotPayload(
    selectRequestSnapshot(invocation, rows.contextSnapshots),
    rows.artifacts || [],
  );
  const responseSnapshot = parseSnapshotPayload(
    selectResponseSnapshot(invocation, rows.contextSnapshots),
    rows.artifacts || [],
  );
  const requestValue = asRecord(requestSnapshot.value);
  const responseValue = asRecord(responseSnapshot.value);
  const messages = asArray(requestValue.messages);
  const tools = asArray(requestValue.tools);
  const expectedOutput = Object.hasOwn(responseValue, "value")
    ? responseValue.value
    : null;
  const outcome = deriveFlashOutcomeLabels(invocation, {
    events: rows.events || [],
    toolInvocations: rows.toolInvocations || [],
    executionFailures: rows.executionFailures || [],
    trainingAnnotations: rows.trainingAnnotations || [],
  });
  const buildWarnings = buildExampleWarnings({
    requestSnapshot,
    responseSnapshot,
    messages,
    responseValue,
  });
  const filterReasons = getFlashTrainingReadinessReasons({
    componentId,
    outcomeLabels: outcome.labels,
    buildWarnings,
  });
  const trainingCandidate = filterReasons.length === 0;

  return {
    dataset_version: FLASH_TRAINING_DATASET_VERSION,
    id: `${componentId}:${invocation.invocation_id}`,
    invocation_id: invocation.invocation_id,
    trace_id: invocation.trace_id,
    conversation_id: invocation.conversation_id,
    anon_user_id: invocation.anon_user_id,
    component_id: componentId,
    schema_id: stringFrom(metadata.schema_id) || null,
    capabilities: stringArray(metadata.capabilities),
    input_features: asRecord(metadata.input_features),
    output_shape: stringFrom(metadata.output_shape) || null,
    provider: invocation.provider,
    requested_model: invocation.requested_model,
    resolved_model: invocation.resolved_model,
    status: invocation.status,
    finish_reason: invocation.finish_reason,
    started_at: invocation.started_at,
    completed_at: invocation.completed_at,
    duration_ms: invocation.duration_ms,
    usage: asRecord(invocation.usage),
    request_params: asRecord(requestValue.request_params),
    messages,
    tools,
    expected_output: expectedOutput,
    request_snapshot: requestSnapshot,
    response_snapshot: responseSnapshot,
    outcome_taxonomy_version: outcome.taxonomy_version,
    outcome_labels: outcome.labels,
    training_candidate: trainingCandidate,
    needs_human_review: outcome.labels.needs_human_review === true ||
      !trainingCandidate,
    build_warnings: buildWarnings,
    filter_reasons: filterReasons,
    metadata: {
      source: invocation.source,
      phase: invocation.phase,
      billing_mode: invocation.billing_mode,
      key_source: invocation.key_source,
      request_context_sha256: invocation.context_sha256,
      request_context_bytes: invocation.context_bytes,
      context_message_count: invocation.context_message_count,
      tool_schema_count: invocation.tool_schema_count,
    },
  };
}

function resolveFilterOptions(
  options: BuildFlashTrainingDatasetOptions,
):
  & Required<
    Pick<BuildFlashTrainingDatasetOptions, "filterMode">
  >
  & {
    componentIds: string[];
    schemaIds: string[];
    capabilities: string[];
  } {
  const mode = options.filterMode ||
    (options.includeIncomplete === true ? "all" : "training_ready");
  return {
    filterMode: mode,
    componentIds: uniqueStrings([...(options.componentIds || [])]),
    schemaIds: uniqueStrings([...(options.schemaIds || [])]),
    capabilities: uniqueStrings([...(options.capabilities || [])]),
  };
}

function filterFlashTrainingExample(
  example: FlashTrainingExample,
  filter: ReturnType<typeof resolveFilterOptions>,
): { included: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (
    filter.componentIds.length > 0 &&
    !filter.componentIds.includes(example.component_id)
  ) {
    reasons.push("component_not_selected");
  }
  if (
    filter.schemaIds.length > 0 &&
    (!example.schema_id || !filter.schemaIds.includes(example.schema_id))
  ) {
    reasons.push("schema_not_selected");
  }
  if (
    filter.capabilities.length > 0 &&
    !filter.capabilities.some((capability) =>
      example.capabilities.includes(capability)
    )
  ) {
    reasons.push("capability_not_selected");
  }

  if (filter.filterMode === "training_ready" && !example.training_candidate) {
    reasons.push(...example.filter_reasons);
  }
  if (
    filter.filterMode === "human_accepted" &&
    (!example.training_candidate || !hasAcceptedAnnotation(example))
  ) {
    if (!example.training_candidate) reasons.push(...example.filter_reasons);
    if (!hasAcceptedAnnotation(example)) {
      reasons.push("accepted_annotation_missing");
    }
  }
  if (
    filter.filterMode === "needs_review" &&
    example.training_candidate &&
    example.needs_human_review !== true
  ) {
    reasons.push("review_not_needed");
  }

  return {
    included: reasons.length === 0,
    reasons: uniqueStrings(reasons),
  };
}

function summarizeFilter(
  examples: FlashTrainingExample[],
  filter: ReturnType<typeof resolveFilterOptions>,
): FlashTrainingDatasetFilterSummary {
  const reasonCounts: Record<string, number> = {};
  let included = 0;
  for (const example of examples) {
    const result = filterFlashTrainingExample(example, filter);
    if (result.included) {
      included++;
    } else {
      for (const reason of result.reasons) increment(reasonCounts, reason);
    }
  }
  return {
    mode: filter.filterMode,
    component_ids: filter.componentIds,
    schema_ids: filter.schemaIds,
    capabilities: filter.capabilities,
    included_example_count: included,
    filtered_out_example_count: examples.length - included,
    filtered_reason_counts: reasonCounts,
  };
}

function hasAcceptedAnnotation(example: FlashTrainingExample): boolean {
  const labels = example.outcome_labels;
  const statuses = stringArray(labels.annotation_statuses);
  const annotationLabels = stringArray(labels.annotation_labels);
  return example.training_candidate &&
    numberFrom(labels.rejected_annotation_count) === 0 &&
    (statuses.includes("accepted") || annotationLabels.includes("accept"));
}

function buildExampleWarnings(input: {
  requestSnapshot: FlashTrainingSnapshotPayload;
  responseSnapshot: FlashTrainingSnapshotPayload;
  messages: unknown[];
  responseValue: JsonRecord;
}): string[] {
  const warnings: string[] = [];
  if (input.requestSnapshot.status !== "parsed") {
    warnings.push(`request_snapshot_${input.requestSnapshot.status}`);
  }
  if (input.responseSnapshot.status !== "parsed") {
    warnings.push(`response_snapshot_${input.responseSnapshot.status}`);
  }
  if (
    input.requestSnapshot.status === "parsed" && input.messages.length === 0
  ) {
    warnings.push("request_messages_missing");
  }
  if (
    input.responseSnapshot.status === "parsed" &&
    !Object.hasOwn(input.responseValue, "value")
  ) {
    warnings.push("response_value_missing");
  }
  return warnings;
}

function selectRequestSnapshot(
  invocation: LlmInvocationRow,
  snapshots: LlmContextSnapshotRow[],
): LlmContextSnapshotRow | null {
  const candidates = snapshots.filter((snapshot) =>
    snapshot.invocation_id === invocation.invocation_id &&
    snapshot.snapshot_type === "llm_request"
  );
  return candidates.find((snapshot) =>
    snapshot.id === invocation.context_snapshot_id
  ) || sortSnapshots(candidates)[0] || null;
}

function selectResponseSnapshot(
  invocation: LlmInvocationRow,
  snapshots: LlmContextSnapshotRow[],
): LlmContextSnapshotRow | null {
  const candidates = snapshots.filter((snapshot) =>
    snapshot.invocation_id === invocation.invocation_id &&
    snapshot.snapshot_type === "llm_response"
  );
  return sortSnapshots(candidates).at(-1) || null;
}

function parseSnapshotPayload(
  snapshot: LlmContextSnapshotRow | null,
  artifacts: CaptureArtifactRow[],
): FlashTrainingSnapshotPayload {
  if (!snapshot) {
    return {
      snapshot_id: null,
      snapshot_type: "missing",
      artifact_id: null,
      sha256: null,
      size_bytes: null,
      source: null,
      status: "missing",
      value: null,
      parse_error: null,
      parsed_from: null,
    };
  }

  const artifact = snapshot.artifact_id
    ? artifacts.find((candidate) => candidate.id === snapshot.artifact_id)
    : null;
  const parsedPreview = parseJsonText(snapshot.text_preview);
  const parsedArtifactPreview = parsedPreview.ok
    ? parsedPreview
    : parseJsonText(artifact?.text_preview || null);
  const parsedFrom = parsedPreview.ok
    ? "snapshot_text_preview"
    : parsedArtifactPreview.ok
    ? "artifact_text_preview"
    : null;
  const parsed = parsedPreview.ok ? parsedPreview : parsedArtifactPreview;

  return {
    snapshot_id: snapshot.id,
    snapshot_type: snapshot.snapshot_type,
    artifact_id: snapshot.artifact_id,
    sha256: snapshot.sha256,
    size_bytes: snapshot.size_bytes,
    source: snapshot.source,
    status: parsed.ok ? "parsed" : "unparseable",
    value: parsed.ok ? parsed.value : null,
    parse_error: parsed.ok ? null : parsed.error,
    parsed_from: parsedFrom,
  };
}

function parseJsonText(
  text: string | null | undefined,
): { ok: true; value: unknown } | { ok: false; error: string | null } {
  if (!text || !text.trim()) return { ok: false, error: "empty_preview" };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "invalid_json",
    };
  }
}

function sortSnapshots(
  snapshots: LlmContextSnapshotRow[],
): LlmContextSnapshotRow[] {
  return [...snapshots].sort((a, b) =>
    Date.parse(a.created_at) - Date.parse(b.created_at)
  );
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringFrom(value: unknown): string {
  return typeof value === "string" && value.trim() ? value : "";
}

function numberFrom(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string =>
    typeof item === "string" && item.trim().length > 0
  );
}

function uniqueStrings(values: readonly string[]): string[] {
  return [
    ...new Set(
      values.filter((value) =>
        typeof value === "string" && value.trim().length > 0
      ),
    ),
  ];
}

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] || 0) + 1;
}
