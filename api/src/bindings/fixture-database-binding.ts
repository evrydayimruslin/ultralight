import { WorkerEntrypoint } from "cloudflare:workers";

import {
  buildD1FixtureBatchResult,
  buildD1FixtureMissMessage,
  buildD1FixtureRunResult,
  findD1TestFixtureResponse,
  type D1TestFixtureConfig,
} from "../../services/d1-test-fixtures.ts";

interface FixtureDatabaseBindingProps {
  appId: string;
  userId: string;
  fixtures: D1TestFixtureConfig;
}

export class FixtureDatabaseBinding extends WorkerEntrypoint<
  unknown,
  FixtureDatabaseBindingProps
> {
  async run(sql: string, params?: unknown[]) {
    const response = findD1TestFixtureResponse(this.ctx.props.fixtures, {
      method: "run",
      sql,
      params,
    });
    if (!response || response.method !== "run") {
      throw new Error(buildD1FixtureMissMessage({ method: "run", sql, params }));
    }
    return buildD1FixtureRunResult(response.result);
  }

  async all(sql: string, params?: unknown[]) {
    const response = findD1TestFixtureResponse(this.ctx.props.fixtures, {
      method: "all",
      sql,
      params,
    });
    if (!response || response.method !== "all") {
      throw new Error(buildD1FixtureMissMessage({ method: "all", sql, params }));
    }
    return Array.isArray(response.result) ? response.result : [];
  }

  async first(sql: string, params?: unknown[]) {
    const response = findD1TestFixtureResponse(this.ctx.props.fixtures, {
      method: "first",
      sql,
      params,
    });
    if (!response || response.method !== "first") {
      throw new Error(buildD1FixtureMissMessage({ method: "first", sql, params }));
    }
    return response.result ?? null;
  }

  async batch(statements: Array<{ sql: string; params?: unknown[] }>) {
    const response = findD1TestFixtureResponse(this.ctx.props.fixtures, {
      method: "batch",
      statements,
    });
    if (!response || response.method !== "batch") {
      throw new Error(
        buildD1FixtureMissMessage({ method: "batch", statements }),
      );
    }
    return buildD1FixtureBatchResult(statements, response.result);
  }
}
