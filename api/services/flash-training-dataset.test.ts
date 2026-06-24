import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.210.0/assert/mod.ts";
import type {
  CaptureArtifactRow,
  CaptureExportBundle,
  ExecutionFailureRow,
  LlmContextSnapshotRow,
  LlmInvocationRow,
  TrainingAnnotationRow,
} from "./capture-inspection.ts";
import {
  buildFlashTrainingDataset,
  buildFlashTrainingDatasetFromBundle,
  buildFlashTrainingExamples,
  exportFlashTrainingDatasetToJsonl,
  filterFlashTrainingExamples,
  FLASH_TRAINING_DATASET_VERSION,
  flashTrainingDatasetToJsonl,
  flashTrainingExamplesToJsonl,
  flashTrainingExampleToJsonlRecord,
} from "./flash-training-dataset.ts";

function invocation(
  overrides: Partial<LlmInvocationRow> = {},
): LlmInvocationRow {
  return {
    id: "row-1",
    invocation_id: "flash-1",
    trace_id: "trace-1",
    conversation_id: "conv-1",
    anon_user_id: "anon-1",
    source: "orchestrator",
    phase: "flash_broker.analyze",
    provider: "openrouter",
    requested_model: "deepseek/deepseek-chat-v3-0324:free",
    resolved_model: "deepseek/deepseek-chat-v3-0324:free",
    billing_mode: "light",
    key_source: "platform_openrouter",
    request_params: { temperature: 0 },
    context_snapshot_id: "request-snapshot",
    context_sha256: "request-sha",
    context_bytes: 512,
    context_message_count: 2,
    tool_schema_count: 1,
    started_at: "2026-05-06T12:00:00Z",
    completed_at: "2026-05-06T12:00:01Z",
    duration_ms: 1000,
    status: "success",
    finish_reason: "stop",
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    cost_light: 0.001,
    error_type: null,
    error_message: null,
    metadata: {
      tier: "flash",
      component_id: "flash_broker.analyze",
      schema_id: "flash_broker.analyze.v1",
      output_shape: "json",
      capabilities: [
        "turn_mode_classification",
        "escalation_selection",
      ],
      input_features: {
        has_files: false,
        conversation_history_count: 1,
      },
      output_labels: {
        parse_success: true,
        mode: "write",
        escalation_target: "heavy_codemode",
      },
    },
    ...overrides,
  };
}

function invocationMetadata(overrides: Record<string, unknown> = {}) {
  const metadata = invocation().metadata as Record<string, unknown>;
  const outputLabels = metadata.output_labels as Record<string, unknown>;
  return {
    ...metadata,
    output_labels: {
      ...outputLabels,
      ...(overrides.output_labels as Record<string, unknown> | undefined),
    },
    ...overrides,
  };
}

function snapshot(
  overrides: Partial<LlmContextSnapshotRow> = {},
): LlmContextSnapshotRow {
  return {
    id: "request-snapshot",
    invocation_id: "flash-1",
    trace_id: "trace-1",
    conversation_id: "conv-1",
    anon_user_id: "anon-1",
    source: "orchestrator",
    snapshot_type: "llm_request",
    message_count: 2,
    tool_schema_count: 1,
    artifact_id: null,
    sha256: "snapshot-sha",
    size_bytes: 256,
    text_preview: JSON.stringify({
      messages: [
        { role: "system", content: "You are Flash." },
        { role: "user", content: "Build me a chart." },
      ],
      tools: [{ type: "function", function: { name: "chart" } }],
      request_params: { response_format: { type: "json_object" } },
      metadata: { component_id: "flash_broker.analyze" },
    }),
    metadata: {},
    created_at: "2026-05-06T12:00:00Z",
    ...overrides,
  };
}

function responseSnapshot(
  overrides: Partial<LlmContextSnapshotRow> = {},
): LlmContextSnapshotRow {
  return snapshot({
    id: "response-snapshot",
    snapshot_type: "llm_response",
    message_count: 0,
    tool_schema_count: 0,
    sha256: "response-sha",
    size_bytes: 128,
    text_preview: JSON.stringify({
      status: "success",
      finish_reason: "stop",
      usage: { total_tokens: 120 },
      value: {
        mode: "write",
        needsTool: true,
        relevantApps: [{ id: "chart-app" }],
      },
    }),
    created_at: "2026-05-06T12:00:01Z",
    ...overrides,
  });
}

function annotation(
  overrides: Partial<TrainingAnnotationRow> = {},
): TrainingAnnotationRow {
  return {
    id: "annotation-1",
    target_type: "llm_invocation",
    target_id: "flash-1",
    conversation_id: "conv-1",
    message_id: null,
    llm_invocation_id: "flash-1",
    tool_invocation_id: null,
    artifact_id: null,
    annotation_type: "quality",
    label: "accept",
    confidence: 1,
    payload: {},
    taxonomy_version: "manual.v1",
    classifier_model: null,
    classifier_version: null,
    status: "accepted",
    reviewed_by: "test",
    reviewed_at: "2026-05-06T12:00:02Z",
    metadata: {},
    created_at: "2026-05-06T12:00:02Z",
    ...overrides,
  };
}

function failure(
  overrides: Partial<ExecutionFailureRow> = {},
): ExecutionFailureRow {
  return {
    id: "failure-row-1",
    failure_id: "failure-1",
    trace_id: "trace-1",
    conversation_id: "conv-1",
    invocation_id: "flash-1",
    anon_user_id: "anon-1",
    source: "orchestrator",
    phase: "execute",
    failure_type: "tool_execution_error",
    severity: "error",
    message: "Tool failed",
    retryable: false,
    aborted_by: null,
    metadata: {},
    created_at: "2026-05-06T12:00:02Z",
    ...overrides,
  };
}

Deno.test("flash training dataset: builds normalized examples from request and response snapshots", () => {
  const dataset = buildFlashTrainingDataset({
    invocations: [invocation()],
    contextSnapshots: [snapshot(), responseSnapshot()],
    trainingAnnotations: [annotation()],
  }, { generatedAt: "2026-05-06T12:00:03Z" });

  assertEquals(dataset.dataset_version, FLASH_TRAINING_DATASET_VERSION);
  assertEquals(dataset.generated_at, "2026-05-06T12:00:03Z");
  assertEquals(dataset.example_count, 1);
  assertEquals(dataset.total_flash_example_count, 1);
  assertEquals(dataset.ready_example_count, 1);
  assertEquals(dataset.filtered_out_example_count, 0);
  assertEquals(dataset.filter.mode, "training_ready");

  const example = dataset.examples[0];
  assertEquals(example.id, "flash_broker.analyze:flash-1");
  assertEquals(example.component_id, "flash_broker.analyze");
  assertEquals(example.schema_id, "flash_broker.analyze.v1");
  assertEquals(example.capabilities, [
    "turn_mode_classification",
    "escalation_selection",
  ]);
  assertEquals(example.messages.length, 2);
  assertEquals(example.tools.length, 1);
  assertEquals(example.request_params, {
    response_format: { type: "json_object" },
  });
  assertEquals(example.expected_output, {
    mode: "write",
    needsTool: true,
    relevantApps: [{ id: "chart-app" }],
  });
  assertEquals(example.request_snapshot.status, "parsed");
  assertEquals(example.response_snapshot.status, "parsed");
  assertEquals(example.training_candidate, true);
  assertEquals(example.needs_human_review, false);
  assertEquals(example.build_warnings, []);
  assertEquals(example.filter_reasons, []);
  assertEquals(
    example.outcome_labels.model_output_escalation_target,
    "heavy_codemode",
  );
});

Deno.test("flash training dataset: marks incomplete examples when response snapshot is unavailable", () => {
  const examples = buildFlashTrainingExamples({
    invocations: [invocation()],
    contextSnapshots: [snapshot()],
    trainingAnnotations: [annotation()],
  }, { filterMode: "all" });

  assertEquals(examples.length, 1);
  assertEquals(examples[0].response_snapshot.status, "missing");
  assertEquals(examples[0].training_candidate, false);
  assertEquals(examples[0].needs_human_review, true);
  assertEquals(examples[0].build_warnings, ["response_snapshot_missing"]);
  assertEquals(examples[0].filter_reasons, ["response_snapshot_missing"]);
});

Deno.test("flash training dataset: filters incomplete examples by default", () => {
  const examples = buildFlashTrainingExamples({
    invocations: [invocation()],
    contextSnapshots: [snapshot()],
    trainingAnnotations: [annotation()],
  });

  assertEquals(examples, []);
});

Deno.test("flash training dataset: only builds examples for Flash invocations", () => {
  const examples = buildFlashTrainingExamples({
    invocations: [
      invocation(),
      invocation({
        invocation_id: "heavy-1",
        phase: "orchestrate",
        metadata: { tier: "heavy", component_id: "codemode.plan" },
      }),
    ],
    contextSnapshots: [snapshot(), responseSnapshot()],
    trainingAnnotations: [annotation()],
  });

  assertEquals(examples.map((example) => example.invocation_id), ["flash-1"]);
});

Deno.test("flash training dataset: default filter excludes parse failures and reports reasons", () => {
  const parseFailure = invocation({
    invocation_id: "flash-parse-fail",
    trace_id: "trace-parse-fail",
    conversation_id: "conv-parse-fail",
    context_snapshot_id: "request-parse-fail",
    metadata: invocationMetadata({
      output_labels: { parse_success: false },
    }),
  });
  const dataset = buildFlashTrainingDataset({
    invocations: [invocation(), parseFailure],
    contextSnapshots: [
      snapshot(),
      responseSnapshot(),
      snapshot({
        id: "request-parse-fail",
        invocation_id: "flash-parse-fail",
        trace_id: "trace-parse-fail",
        conversation_id: "conv-parse-fail",
      }),
      responseSnapshot({
        id: "response-parse-fail",
        invocation_id: "flash-parse-fail",
        trace_id: "trace-parse-fail",
        conversation_id: "conv-parse-fail",
      }),
    ],
    trainingAnnotations: [
      annotation(),
      annotation({
        id: "annotation-parse-fail",
        target_id: "flash-parse-fail",
        conversation_id: "conv-parse-fail",
        llm_invocation_id: "flash-parse-fail",
      }),
    ],
  });

  assertEquals(dataset.example_count, 1);
  assertEquals(dataset.total_flash_example_count, 2);
  assertEquals(dataset.filtered_out_example_count, 1);
  assertEquals(dataset.filter.filtered_reason_counts.parse_not_success, 1);
  assertEquals(dataset.examples[0].invocation_id, "flash-1");

  const allExamples = buildFlashTrainingExamples({
    invocations: [parseFailure],
    contextSnapshots: [
      snapshot({
        id: "request-parse-fail",
        invocation_id: "flash-parse-fail",
        trace_id: "trace-parse-fail",
        conversation_id: "conv-parse-fail",
      }),
      responseSnapshot({
        id: "response-parse-fail",
        invocation_id: "flash-parse-fail",
        trace_id: "trace-parse-fail",
        conversation_id: "conv-parse-fail",
      }),
    ],
    trainingAnnotations: [
      annotation({
        id: "annotation-parse-fail",
        target_id: "flash-parse-fail",
        conversation_id: "conv-parse-fail",
        llm_invocation_id: "flash-parse-fail",
      }),
    ],
  }, { filterMode: "all" });
  assertEquals(allExamples[0].filter_reasons, ["parse_not_success"]);
});

Deno.test("flash training dataset: filters rejected annotations and downstream failures", () => {
  const rejected = invocation({
    invocation_id: "flash-rejected",
    trace_id: "trace-rejected",
    conversation_id: "conv-rejected",
    context_snapshot_id: "request-rejected",
  });
  const failed = invocation({
    invocation_id: "flash-failed-downstream",
    trace_id: "trace-failed-downstream",
    conversation_id: "conv-failed-downstream",
    context_snapshot_id: "request-failed-downstream",
  });
  const dataset = buildFlashTrainingDataset({
    invocations: [rejected, failed],
    contextSnapshots: [
      snapshot({
        id: "request-rejected",
        invocation_id: "flash-rejected",
        trace_id: "trace-rejected",
        conversation_id: "conv-rejected",
      }),
      responseSnapshot({
        id: "response-rejected",
        invocation_id: "flash-rejected",
        trace_id: "trace-rejected",
        conversation_id: "conv-rejected",
      }),
      snapshot({
        id: "request-failed-downstream",
        invocation_id: "flash-failed-downstream",
        trace_id: "trace-failed-downstream",
        conversation_id: "conv-failed-downstream",
      }),
      responseSnapshot({
        id: "response-failed-downstream",
        invocation_id: "flash-failed-downstream",
        trace_id: "trace-failed-downstream",
        conversation_id: "conv-failed-downstream",
      }),
    ],
    executionFailures: [
      failure({
        id: "failure-failed-downstream",
        failure_id: "failure-failed-downstream",
        trace_id: "trace-failed-downstream",
        conversation_id: "conv-failed-downstream",
        invocation_id: "flash-failed-downstream",
      }),
    ],
    trainingAnnotations: [
      annotation({
        id: "annotation-rejected",
        target_id: "flash-rejected",
        conversation_id: "conv-rejected",
        llm_invocation_id: "flash-rejected",
        label: "reject",
        status: "rejected",
      }),
      annotation({
        id: "annotation-failed-downstream",
        target_id: "flash-failed-downstream",
        conversation_id: "conv-failed-downstream",
        llm_invocation_id: "flash-failed-downstream",
      }),
    ],
  });

  assertEquals(dataset.example_count, 0);
  assertEquals(dataset.filtered_out_example_count, 2);
  assertEquals(dataset.filter.filtered_reason_counts.rejected_annotation, 1);
  assertEquals(dataset.filter.filtered_reason_counts.downstream_failure, 1);
});

Deno.test("flash training dataset: supports human accepted and review queue modes", () => {
  const unreviewed = invocation({
    invocation_id: "flash-unreviewed",
    trace_id: "trace-unreviewed",
    conversation_id: "conv-unreviewed",
    context_snapshot_id: "request-unreviewed",
  });
  const rows = {
    invocations: [invocation(), unreviewed],
    contextSnapshots: [
      snapshot(),
      responseSnapshot(),
      snapshot({
        id: "request-unreviewed",
        invocation_id: "flash-unreviewed",
        trace_id: "trace-unreviewed",
        conversation_id: "conv-unreviewed",
      }),
      responseSnapshot({
        id: "response-unreviewed",
        invocation_id: "flash-unreviewed",
        trace_id: "trace-unreviewed",
        conversation_id: "conv-unreviewed",
      }),
    ],
    trainingAnnotations: [annotation()],
  };

  const defaultExamples = buildFlashTrainingExamples(rows);
  assertEquals(defaultExamples.map((example) => example.invocation_id), [
    "flash-1",
    "flash-unreviewed",
  ]);

  const acceptedOnly = buildFlashTrainingDataset(rows, {
    filterMode: "human_accepted",
  });
  assertEquals(acceptedOnly.examples.map((example) => example.invocation_id), [
    "flash-1",
  ]);
  assertEquals(
    acceptedOnly.filter.filtered_reason_counts.accepted_annotation_missing,
    1,
  );

  const reviewQueue = buildFlashTrainingDataset(rows, {
    filterMode: "needs_review",
  });
  assertEquals(reviewQueue.examples.map((example) => example.invocation_id), [
    "flash-unreviewed",
  ]);
});

Deno.test("flash training dataset: filters by component, schema, and capability", () => {
  const examples = buildFlashTrainingExamples({
    invocations: [invocation()],
    contextSnapshots: [snapshot(), responseSnapshot()],
    trainingAnnotations: [annotation()],
  }, { filterMode: "all" });

  assertEquals(
    filterFlashTrainingExamples(examples, {
      componentIds: ["flash_broker.prompt_builder"],
      filterMode: "all",
    }),
    [],
  );
  assertEquals(
    filterFlashTrainingExamples(examples, {
      schemaIds: ["flash_broker.analyze.v1"],
      capabilities: ["escalation_selection"],
      filterMode: "all",
    }).map((example) => example.invocation_id),
    ["flash-1"],
  );
});

Deno.test("flash training dataset: falls back to artifact preview when snapshot preview is not parseable", () => {
  const artifacts: CaptureArtifactRow[] = [{
    id: "artifact-request",
    idempotency_key: "artifact-request-key",
    anon_user_id: "anon-1",
    conversation_id: "conv-1",
    message_id: null,
    event_id: null,
    source: "llm_context_snapshot",
    sha256: "artifact-sha",
    storage_key: "raw-artifacts/us/aa/artifact-sha",
    storage_region: "us",
    mime_type: "application/json",
    original_filename: "request.json",
    size_bytes: 256,
    text_preview: JSON.stringify({
      messages: [{ role: "user", content: "Escalate this." }],
      tools: [],
      request_params: {},
    }),
    parser_status: "pending",
    sensitivity_class: "unknown",
    training_eligibility: "pending",
    metadata: {},
    created_at: "2026-05-06T12:00:00Z",
  }];

  const examples = buildFlashTrainingExamples({
    invocations: [invocation()],
    contextSnapshots: [
      snapshot({
        artifact_id: "artifact-request",
        text_preview: "{",
      }),
      responseSnapshot(),
    ],
    artifacts,
    trainingAnnotations: [annotation()],
  });

  assertEquals(examples[0].request_snapshot.status, "parsed");
  assertEquals(
    examples[0].request_snapshot.parsed_from,
    "artifact_text_preview",
  );
  assertEquals(examples[0].messages, [
    { role: "user", content: "Escalate this." },
  ]);
});

Deno.test("flash training dataset: builds from capture export bundles", () => {
  const bundle = {
    export_meta: {
      generated_at: "2026-05-06T12:00:03Z",
      filters: {},
      thread_count: 0,
      message_count: 0,
      event_count: 0,
      artifact_count: 0,
      artifact_link_count: 0,
      llm_invocation_count: 1,
      llm_context_snapshot_count: 2,
      tool_invocation_count: 0,
      execution_failure_count: 0,
      training_annotation_count: 1,
      capability_intent_count: 0,
      capability_suggestion_set_count: 0,
      capability_suggestion_count: 0,
      capability_suggestion_event_count: 0,
    },
    threads: [],
    messages: [],
    events: [],
    artifact_links: [],
    artifacts: [],
    llm_invocations: [invocation()],
    llm_context_snapshots: [snapshot(), responseSnapshot()],
    tool_invocations: [],
    execution_failures: [],
    training_annotations: [annotation()],
    capability_intents: [],
    capability_suggestion_sets: [],
    capability_suggestions: [],
    capability_suggestion_events: [],
    integrity: {
      assistant_without_prior_user: [],
      empty_assistant_messages: [],
      messages_missing_hash: [],
      inline_fallback_messages: [],
      event_artifact_spills: 0,
      event_errors: [],
    },
  } satisfies CaptureExportBundle;

  const dataset = buildFlashTrainingDatasetFromBundle(bundle, {
    generatedAt: "2026-05-06T12:00:04Z",
  });

  assertEquals(dataset.example_count, 1);
  assert(dataset.examples[0].training_candidate);
});

Deno.test("flash training dataset: exports canonical Galactic JSONL records", () => {
  const dataset = buildFlashTrainingDataset({
    invocations: [invocation()],
    contextSnapshots: [snapshot(), responseSnapshot()],
    trainingAnnotations: [annotation()],
  }, { generatedAt: "2026-05-06T12:00:03Z" });

  const jsonl = flashTrainingDatasetToJsonl(dataset);
  assert(jsonl.endsWith("\n"));

  const records = parseJsonl(jsonl);
  assertEquals(records.length, 1);
  assertEquals(records[0].type, "flash_training_example");
  assertEquals(records[0].id, "flash_broker.analyze:flash-1");
  assertEquals(records[0].component_id, "flash_broker.analyze");
  assertEquals(records[0].schema_id, "flash_broker.analyze.v1");
  assertEquals(records[0].capabilities, [
    "turn_mode_classification",
    "escalation_selection",
  ]);
  assertEquals(records[0].expected_output, {
    mode: "write",
    needsTool: true,
    relevantApps: [{ id: "chart-app" }],
  });
  const source = records[0].source as Record<string, Record<string, unknown>>;
  assertEquals(source.request_snapshot.status, "parsed");
  assertEquals(source.request_snapshot.value, undefined);
  assertEquals(source.response_snapshot.status, "parsed");
  assertEquals(records[0].training_candidate, true);
});

Deno.test("flash training dataset: exports OpenAI-compatible message JSONL records", () => {
  const examples = buildFlashTrainingExamples({
    invocations: [invocation()],
    contextSnapshots: [snapshot(), responseSnapshot()],
    trainingAnnotations: [annotation()],
  });

  const jsonl = flashTrainingExamplesToJsonl(examples, {
    format: "openai_messages",
    includeTools: true,
    finalNewline: false,
  });
  assert(!jsonl.endsWith("\n"));

  const records = parseJsonl(jsonl);
  assertEquals(records.length, 1);
  const messages = records[0].messages as Array<Record<string, unknown>>;
  const tools = records[0].tools as unknown[];
  const metadata = records[0].metadata as Record<string, unknown>;
  assertEquals(messages.length, 3);
  assertEquals(messages[0].role, "system");
  assertEquals(messages[1].role, "user");
  assertEquals(messages[2], {
    role: "assistant",
    content:
      '{"mode":"write","needsTool":true,"relevantApps":[{"id":"chart-app"}]}',
  });
  assertEquals(tools.length, 1);
  assertEquals(metadata.component_id, "flash_broker.analyze");
  assertEquals(metadata.schema_id, "flash_broker.analyze.v1");
  assertEquals(
    metadata.source_model,
    "deepseek/deepseek-chat-v3-0324:free",
  );
});

Deno.test("flash training dataset: omits tools from OpenAI JSONL by default", () => {
  const [example] = buildFlashTrainingExamples({
    invocations: [invocation()],
    contextSnapshots: [snapshot(), responseSnapshot()],
    trainingAnnotations: [annotation()],
  });

  const record = flashTrainingExampleToJsonlRecord(example, {
    format: "openai_messages",
  });

  assertEquals(record.tools, undefined);
  assertEquals(
    (record.messages as Array<{ role: string }>).map((message) => message.role),
    ["system", "user", "assistant"],
  );
});

Deno.test("flash training dataset: export wrapper reports format and line count", () => {
  const dataset = buildFlashTrainingDataset({
    invocations: [invocation()],
    contextSnapshots: [snapshot(), responseSnapshot()],
    trainingAnnotations: [annotation()],
  });

  const exported = exportFlashTrainingDatasetToJsonl(dataset, {
    format: "openai_messages",
  });

  assertEquals(exported.format, "openai_messages");
  assertEquals(exported.example_count, 1);
  assertEquals(parseJsonl(exported.jsonl).length, 1);
});

Deno.test("flash training dataset: JSONL exporter returns an empty string for empty sets", () => {
  assertEquals(flashTrainingExamplesToJsonl([]), "");
});

function parseJsonl(jsonl: string): Record<string, unknown>[] {
  return jsonl
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
