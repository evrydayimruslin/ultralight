# Cloudflare Dynamic Workers + Codemode Integration Plan

## Overview

Replace our older `ul.execute` / `ul_execute` codemode bridge with Cloudflare's actual `@cloudflare/codemode` package running on Dynamic Workers. The agent gets ONE canonical tool (`codemode`) that lets it write JS recipes. All our MCP functions become typed methods inside the sandbox.

## Architecture

```
Agent has ONE tool: codemode
  ↓
Agent writes JS recipe
  ↓
@cloudflare/codemode runs it in a Dynamic Worker isolate
  ↓
Inside the sandbox, agent calls:
  - codemode.approvals_list({ status: "pending" })
  - codemode.conversations_list({ limit: 10 })
  - codemode.discover_library({ query: "email" })
  ↓
Each call is backed by a tool.execute() on the host
  ↓
Host routes calls to MCP endpoints via fetch()
  ↓
Results returned to sandbox → recipe composes response
  ↓
Agent gets { result, logs } back in ONE tool call
```

## Key Packages

- `@cloudflare/codemode` — creates the codemode tool, manages sandbox
- `@cloudflare/codemode/ai` — AI SDK integration (createCodeTool)
- Dynamic Worker Loader — Cloudflare binding for spinning up isolates

## Implementation

### 1. wrangler.toml — Add Loader Binding

```toml
[[worker_loaders]]
binding = "LOADER"
```

### 2. Define Tools from User's App Library

Each MCP function becomes a tool definition:

```typescript
import { tool } from "ai";
import { z } from "zod";

// Built dynamically from user's app library manifests
function buildToolsFromLibrary(apps: AppManifest[]): ToolSet {
  const tools: ToolSet = {};

  for (const app of apps) {
    for (const [fnName, fn] of Object.entries(app.functions)) {
      // Skip widget internal functions
      if (fnName.startsWith('widget_') && fnName.endsWith('_data')) continue;

      const toolKey = `${app.slug}_${fnName}`;
      tools[toolKey] = tool({
        description: `[${app.name}] ${fn.description}`,
        inputSchema: buildZodSchema(fn.parameters),
        execute: async (args) => {
          // Route to MCP endpoint
          return await callMcpFunction(app.id, fnName, args, authToken);
        }
      });
    }
  }

  // Add discovery tool
  tools['discover_library'] = tool({
    description: 'Search your app library for tools',
    inputSchema: z.object({ query: z.string().optional() }),
    execute: async ({ query }) => {
      return await executeDiscoverLibrary(userId, { query });
    }
  });

  tools['discover_appstore'] = tool({
    description: 'Search the app marketplace',
    inputSchema: z.object({ query: z.string() }),
    execute: async ({ query }) => {
      return await executeDiscoverAppstore(userId, { query });
    }
  });

  return tools;
}
```

### 3. Create Codemode Tool

```typescript
import { createCodeTool } from "@cloudflare/codemode/ai";
import { DynamicWorkerExecutor } from "@cloudflare/codemode";

// In the platform MCP handler:
case 'ul.codemode': {
  const executor = new DynamicWorkerExecutor({
    loader: env.LOADER,
    timeout: 60000,      // 60s for recipes
    globalOutbound: null, // no raw network access
  });

  // Build tools from user's library
  const userApps = await getUserLibraryApps(userId);
  const tools = buildToolsFromLibrary(userApps);

  const codemodeTool = createCodeTool({
    tools,
    executor,
    description: 'Write JavaScript to orchestrate your tools. {{types}}'
  });

  // Execute the agent's code
  const result = await codemodeTool.execute({ code: toolArgs.code });
  return result;
}
```

### 4. Desktop: Single Tool

The agent gets exactly ONE tool:

```typescript
const CODE_MODE_TOOLS: ChatTool[] = [
  {
    type: 'function',
    function: {
      name: 'codemode',
      description: 'Write JavaScript to find and use your tools. ' +
        'All your apps are available as typed functions. ' +
        'Use discover_library({query}) to find apps, then call their functions directly. ' +
        '{{types}}',  // Auto-generated from available tools
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'JavaScript async function body' }
        },
        required: ['code']
      }
    }
  },
  // Keep ul_memory separate (cross-session, not per-recipe)
  { ... ul_memory ... }
];
```

### 5. How the Agent Uses It

User: "Show me my pending emails"

Agent writes:
```javascript
codemode({
  code: `
    const pending = await codemode.approvals_list({ status: "pending" });
    return {
      text: "Here are your pending emails:",
      widget: { name: "email_inbox", app_id: "d90a446c-..." },
      data: pending
    };
  `
})
```

ONE tool call. ONE Dynamic Worker execution. Result includes text + widget signal.

User: "Approve all normal-priority emails and show high-priority ones"

Agent writes:
```javascript
codemode({
  code: `
    const all = await codemode.approvals_list({ status: "pending" });
    const normal = all.filter(a => a.priority === "normal");
    const high = all.filter(a => a.priority === "high");

    for (const item of normal) {
      await codemode.approvals_act({ approval_id: item.id, action: "approve" });
    }

    return {
      text: "Approved " + normal.length + " normal-priority emails. " + high.length + " high-priority remaining.",
      widget: { name: "email_inbox", app_id: "d90a446c-..." }
    };
  `
})
```

ONE tool call. All approvals + listing in one execution.

## What This Replaces

| Before | After |
|--------|-------|
| `ul_discover` (standalone tool) | `codemode.discover_library()` inside recipe |
| `ul_call` (standalone tool) | `codemode.app_function()` inside recipe |
| `ul.execute` / `ul_execute` (legacy codemode bridge) | `@cloudflare/codemode` + Dynamic Workers |
| 5+ tool call round-trips | 1 codemode call |
| Agent sees 12+ tools | Agent sees 1 tool (+ memory) |

## Spec/Type Generation

`@cloudflare/codemode` auto-generates TypeScript type definitions from the tool schemas. The `{{types}}` placeholder in the tool description gets replaced with:

```typescript
// Available functions:
codemode.approvals_list(args: { status?: string, type?: string, limit?: number }): Promise<...>
codemode.approvals_act(args: { approval_id: string, action: string, ... }): Promise<...>
codemode.discover_library(args: { query?: string }): Promise<...>
// ...
```

This gives the agent a compact API reference without us building our own.

## Implementation Steps

1. Install `@cloudflare/codemode` in the API project
2. Add `[[worker_loaders]]` binding to wrangler.toml
3. Build `buildToolsFromLibrary()` — converts app manifests to AI SDK tools
4. Create `ul.codemode` platform tool handler
5. Update desktop `useMcp.ts` — single codemode tool for capable models
6. Update system prompt — remove verbose discovery instructions, just describe codemode
7. Test with email-ops

## Security

- Dynamic Worker isolates have no filesystem, no env vars
- Network blocked by default (`globalOutbound: null`)
- Each recipe runs in a fresh isolate (millisecond startup)
- Tool execute() functions run on the HOST, not in the sandbox
- Auth token injected at the host level, never exposed to sandbox code

## Pricing

- $0.002 per unique Worker loaded per day (waived during beta)
- Standard CPU + invocation charges
- Massive savings vs N separate tool calls (fewer model inference rounds)
