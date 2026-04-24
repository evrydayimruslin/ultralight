import type { D1RunResult } from "./d1-data.ts";

export type D1FixtureMethod = "run" | "all" | "first" | "batch";

export interface D1FixtureStatement {
  sql: string;
  params?: unknown[];
}

export interface D1FixtureRunResult {
  success?: boolean;
  meta?: Partial<D1RunResult["meta"]>;
}

export interface D1FixtureRunResponse {
  method: "run";
  sql: string;
  params?: unknown[];
  result?: D1FixtureRunResult;
}

export interface D1FixtureBatchResponse {
  method: "batch";
  statements: D1FixtureStatement[];
  result?: D1FixtureRunResult[];
}

export interface D1FixtureAllResponse {
  method: "all";
  sql: string;
  params?: unknown[];
  result?: unknown;
}

export interface D1FixtureFirstResponse {
  method: "first";
  sql: string;
  params?: unknown[];
  result?: unknown;
}

export type D1FixtureResponse =
  | D1FixtureRunResponse
  | D1FixtureAllResponse
  | D1FixtureFirstResponse
  | D1FixtureBatchResponse;

export interface D1TestFixtureConfig {
  responses: D1FixtureResponse[];
}

interface D1FixtureRequestQuery {
  method: "run" | "all" | "first";
  sql: string;
  params?: unknown[];
}

interface D1FixtureRequestBatch {
  method: "batch";
  statements: D1FixtureStatement[];
}

export type D1FixtureRequest = D1FixtureRequestQuery | D1FixtureRequestBatch;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toParams(value: unknown, label: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
}

export function normalizeD1FixtureSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

export function resolveD1TestFixtureConfig(
  input: unknown,
): D1TestFixtureConfig | null {
  if (input === undefined || input === null) return null;
  if (!isRecord(input)) {
    throw new Error("d1_fixtures must be an object");
  }

  const responsesValue = input.responses;
  if (!Array.isArray(responsesValue)) {
    throw new Error("d1_fixtures.responses must be an array");
  }

  const responses = responsesValue.map((response, index) =>
    normalizeD1FixtureResponse(response, index)
  );
  return { responses };
}

function normalizeD1FixtureResponse(
  input: unknown,
  index: number,
): D1FixtureResponse {
  if (!isRecord(input)) {
    throw new Error(`d1_fixtures.responses[${index}] must be an object`);
  }

  const method = input.method;
  if (
    method !== "run" && method !== "all" && method !== "first" &&
    method !== "batch"
  ) {
    throw new Error(
      `d1_fixtures.responses[${index}].method must be one of run, all, first, batch`,
    );
  }

  if (method === "batch") {
    if (!Array.isArray(input.statements) || input.statements.length === 0) {
      throw new Error(
        `d1_fixtures.responses[${index}].statements must be a non-empty array`,
      );
    }

    return {
      method,
      statements: input.statements.map((statement, statementIndex) => {
        if (!isRecord(statement) || typeof statement.sql !== "string") {
          throw new Error(
            `d1_fixtures.responses[${index}].statements[${statementIndex}].sql must be a string`,
          );
        }
        return {
          sql: normalizeD1FixtureSql(statement.sql),
          params: toParams(
            statement.params,
            `d1_fixtures.responses[${index}].statements[${statementIndex}].params`,
          ),
        };
      }),
      result: Array.isArray(input.result)
        ? input.result.map((entry, resultIndex) =>
          normalizeD1FixtureRunResult(
            entry,
            `d1_fixtures.responses[${index}].result[${resultIndex}]`,
          )
        )
        : undefined,
    };
  }

  if (typeof input.sql !== "string") {
    throw new Error(`d1_fixtures.responses[${index}].sql must be a string`);
  }

  const sql = normalizeD1FixtureSql(input.sql);
  const params = toParams(
    input.params,
    `d1_fixtures.responses[${index}].params`,
  );

  if (method === "run") {
    return {
      method,
      sql,
      params,
      result: input.result === undefined
        ? undefined
        : normalizeD1FixtureRunResult(
          input.result,
          `d1_fixtures.responses[${index}].result`,
        ),
    };
  }

  if (method === "all") {
    return {
      method,
      sql,
      params,
      result: input.result,
    };
  }

  return {
    method,
    sql,
    params,
    result: input.result,
  };
}

function normalizeD1FixtureRunResult(
  input: unknown,
  label: string,
): D1FixtureRunResult {
  if (input === undefined) return {};
  if (!isRecord(input)) {
    throw new Error(`${label} must be an object`);
  }

  const meta = input.meta;
  if (meta !== undefined && !isRecord(meta)) {
    throw new Error(`${label}.meta must be an object`);
  }

  const normalized: D1FixtureRunResult = {};
  if (typeof input.success === "boolean") {
    normalized.success = input.success;
  }
  if (meta !== undefined) {
    normalized.meta = meta as Partial<D1RunResult["meta"]>;
  }
  return normalized;
}

function paramsMatch(left: unknown[] | undefined, right: unknown[] | undefined): boolean {
  return JSON.stringify(left || []) === JSON.stringify(right || []);
}

function statementsMatch(
  left: D1FixtureStatement[],
  right: D1FixtureStatement[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((statement, index) =>
    normalizeD1FixtureSql(statement.sql) === normalizeD1FixtureSql(right[index].sql) &&
    paramsMatch(statement.params, right[index].params)
  );
}

export function findD1TestFixtureResponse(
  fixtures: D1TestFixtureConfig | null | undefined,
  request: D1FixtureRequest,
): D1FixtureResponse | null {
  if (!fixtures) return null;

  return fixtures.responses.find((response) => {
    if (response.method !== request.method) return false;

    if (request.method === "batch" && response.method === "batch") {
      return statementsMatch(response.statements, request.statements);
    }

    if (response.method === "batch" || request.method === "batch") {
      return false;
    }

    return response.sql === normalizeD1FixtureSql(request.sql) &&
      paramsMatch(response.params, request.params);
  }) || null;
}

export function buildD1FixtureRunResult(
  result?: D1FixtureRunResult,
): D1RunResult {
  return {
    success: result?.success ?? true,
    meta: {
      changes: result?.meta?.changes ?? 0,
      last_row_id: result?.meta?.last_row_id ?? 0,
      duration: result?.meta?.duration ?? 0,
      rows_read: result?.meta?.rows_read ?? 0,
      rows_written: result?.meta?.rows_written ?? 0,
    },
  };
}

export function buildD1FixtureBatchResult(
  statements: D1FixtureStatement[],
  result?: D1FixtureRunResult[],
): D1RunResult[] {
  return statements.map((_, index) => buildD1FixtureRunResult(result?.[index]));
}

export function buildD1FixtureMissMessage(
  request: D1FixtureRequest,
): string {
  if (request.method === "batch") {
    return `No D1 fixture matched batch(${request.statements.length} statements)`;
  }
  return `No D1 fixture matched ${request.method}(${normalizeD1FixtureSql(request.sql)})`;
}
