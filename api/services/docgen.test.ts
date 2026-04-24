import { assert, assertStringIncludes } from "https://deno.land/std@0.210.0/assert/mod.ts";

import type { ParseResult } from "./parser.ts";
import { generateSkillsMd } from "./docgen.ts";

Deno.test("docgen: generated markdown uses actionable copy for empty function lists", () => {
  const parseResult: ParseResult = {
    functions: [],
    types: {},
    permissions: [],
    parseErrors: [],
    parseWarnings: [],
  };

  const markdown = generateSkillsMd("Starter App", parseResult);

  assertStringIncludes(
    markdown,
    "<!-- Generated from the current app source. Keep manual edits aligned with code changes. -->",
  );
  assertStringIncludes(
    markdown,
    "No exported functions were detected in the entry file. Add at least one exported function to publish app capabilities.",
  );
  assert(!markdown.includes("Edit with caution."));
  assert(!markdown.includes("*No exported functions found.*"));
});
