import { assertEquals, assertThrows } from "https://deno.land/std@0.210.0/assert/mod.ts";

import {
  buildD1FixtureBatchResult,
  buildD1FixtureMissMessage,
  buildD1FixtureRunResult,
  findD1TestFixtureResponse,
  normalizeD1FixtureSql,
  resolveD1TestFixtureConfig,
} from "./d1-test-fixtures.ts";

Deno.test("d1 test fixtures: normalizes SQL and validates config", () => {
  const fixtures = resolveD1TestFixtureConfig({
    responses: [
      {
        method: "all",
        sql: "SELECT   *  FROM items\nWHERE user_id = ?",
        params: ["user-1"],
        result: [{ id: "item-1" }],
      },
    ],
  });

  assertEquals(fixtures, {
    responses: [
      {
        method: "all",
        sql: "SELECT * FROM items WHERE user_id = ?",
        params: ["user-1"],
        result: [{ id: "item-1" }],
      },
    ],
  });
  assertEquals(
    normalizeD1FixtureSql(" SELECT   * \n FROM items "),
    "SELECT * FROM items",
  );
});

Deno.test("d1 test fixtures: matches query and batch fixtures by normalized SQL and params", () => {
  const fixtures = resolveD1TestFixtureConfig({
    responses: [
      {
        method: "first",
        sql: "SELECT * FROM items WHERE user_id = ? AND id = ?",
        params: ["user-1", "item-1"],
        result: { id: "item-1" },
      },
      {
        method: "batch",
        statements: [
          {
            sql: "INSERT INTO items (id, user_id) VALUES (?, ?)",
            params: ["item-1", "user-1"],
          },
          {
            sql: "UPDATE items SET name = ? WHERE user_id = ? AND id = ?",
            params: ["Name", "user-1", "item-1"],
          },
        ],
        result: [
          { meta: { changes: 1, rows_written: 1 } },
          { meta: { changes: 1, rows_written: 1 } },
        ],
      },
    ],
  });

  assertEquals(
    findD1TestFixtureResponse(fixtures, {
      method: "first",
      sql: " SELECT  * FROM items WHERE user_id = ? AND id = ? ",
      params: ["user-1", "item-1"],
    }),
    fixtures?.responses[0] || null,
  );

  assertEquals(
    findD1TestFixtureResponse(fixtures, {
      method: "batch",
      statements: [
        {
          sql: "INSERT INTO items (id, user_id) VALUES (?, ?)",
          params: ["item-1", "user-1"],
        },
        {
          sql: "UPDATE   items SET name = ? WHERE user_id = ? AND id = ?",
          params: ["Name", "user-1", "item-1"],
        },
      ],
    }),
    fixtures?.responses[1] || null,
  );
});

Deno.test("d1 test fixtures: builds D1-shaped defaults and miss messages", () => {
  assertEquals(buildD1FixtureRunResult(undefined), {
    success: true,
    meta: {
      changes: 0,
      last_row_id: 0,
      duration: 0,
      rows_read: 0,
      rows_written: 0,
    },
  });

  assertEquals(
    buildD1FixtureBatchResult([{ sql: "SELECT 1" }, { sql: "SELECT 2" }], [
      { meta: { changes: 1 } },
    ]),
    [
      {
        success: true,
        meta: {
          changes: 1,
          last_row_id: 0,
          duration: 0,
          rows_read: 0,
          rows_written: 0,
        },
      },
      {
        success: true,
        meta: {
          changes: 0,
          last_row_id: 0,
          duration: 0,
          rows_read: 0,
          rows_written: 0,
        },
      },
    ],
  );

  assertEquals(
    buildD1FixtureMissMessage({
      method: "run",
      sql: "INSERT INTO items VALUES (?)",
      params: ["item-1"],
    }),
    "No D1 fixture matched run(INSERT INTO items VALUES (?))",
  );
});

Deno.test("d1 test fixtures: rejects malformed configs", () => {
  assertThrows(
    () => resolveD1TestFixtureConfig({ responses: [{ method: "all", params: [] }] }),
    Error,
    ".sql must be a string",
  );
});
