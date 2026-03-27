// MCP tool execution helper hook.
// Bridges the useChat tool-use loop to the Ultralight MCP platform.

import { useCallback, useMemo } from 'react';
import { executeMcpTool, type ChatTool } from '../lib/api';
import { isCodeModeCapable } from '../lib/systemPrompt';
import { getModel } from '../lib/storage';

// ── Platform Tools (Traditional Mode) ──

/** Full tool set for traditional mode — discover + call + memory */
const TRADITIONAL_TOOLS: ChatTool[] = [
  {
    type: 'function',
    function: {
      name: 'ul_discover',
      description:
        'Find and explore apps on the Ultralight platform. ' +
        'scope="desk": last 5 used apps (check first). ' +
        'scope="inspect": deep introspection of one app (requires app_id). ' +
        'scope="library": your owned+liked apps. ' +
        'scope="appstore": all published apps (use query/task for search).',
      parameters: {
        type: 'object',
        properties: {
          scope: {
            type: 'string',
            enum: ['desk', 'inspect', 'library', 'appstore'],
            description: 'Discovery scope.',
          },
          app_id: {
            type: 'string',
            description: 'Required for scope="inspect".',
          },
          query: {
            type: 'string',
            description: 'Semantic search query. For library + appstore.',
          },
          task: {
            type: 'string',
            description: 'Task description for context-aware search. For appstore.',
          },
          limit: {
            type: 'number',
            description: 'Max results. For appstore.',
          },
        },
        required: ['scope'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ul_call',
      description:
        "Call any app's function through the Ultralight platform. " +
        'No separate per-app connection needed. Uses your auth context.',
      parameters: {
        type: 'object',
        properties: {
          app_id: {
            type: 'string',
            description: 'App ID or slug of the target app.',
          },
          function_name: {
            type: 'string',
            description: 'Function to call (e.g. "search").',
          },
          args: {
            type: 'object',
            description: 'Arguments to pass to the function.',
          },
        },
        required: ['app_id', 'function_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ul_memory',
      description:
        'Persistent cross-session memory. ' +
        'action="read": read memory.md. ' +
        'action="write": overwrite/append memory.md. ' +
        'action="recall": get/set a KV key. ' +
        'action="query": list/delete KV keys.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['read', 'write', 'recall', 'query'],
            description: 'Memory operation.',
          },
          content: { type: 'string', description: 'Markdown content. For write.' },
          append: { type: 'boolean', description: 'Append instead of overwrite. For write.' },
          key: { type: 'string', description: 'KV key. For recall.' },
          value: { type: 'string', description: 'JSON value to store. Omit to retrieve. For recall.' },
          prefix: { type: 'string', description: 'Key prefix filter. For query.' },
        },
        required: ['action'],
      },
    },
  },
];

// ── Platform Tools (Code Mode) ──

/** Minimal tool set for code mode — codemode + memory only.
 *  All app functions are typed and available as `codemode.functionName()` inside recipes.
 *  Discovery via `codemode.discover_library()`. This forces the agent to write recipes. */
const CODE_MODE_TOOLS: ChatTool[] = [
  {
    type: 'function',
    function: {
      name: 'ul_codemode',
      description:
        'Write JavaScript to interact with your apps. ' +
        'All functions are typed and available on the `codemode` object. ' +
        'Write an async function body using `await codemode.functionName(args)` and return a result. ' +
        'Use `await codemode.discover_library({ query: "..." })` to find apps dynamically.',
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description:
              'JavaScript async function body. Use `await codemode.functionName(args)` to call tools. ' +
              'Example: const items = await codemode.email_ops_approvals_list({ status: "pending" }); return items;',
          },
        },
        required: ['code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ul_memory',
      description:
        'Persistent cross-session memory. ' +
        'action="read": read memory.md. ' +
        'action="write": overwrite/append memory.md. ' +
        'action="recall": get/set a KV key. ' +
        'action="query": list/delete KV keys.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['read', 'write', 'recall', 'query'],
            description: 'Memory operation.',
          },
          content: { type: 'string', description: 'Markdown content. For write.' },
          append: { type: 'boolean', description: 'Append instead of overwrite. For write.' },
          key: { type: 'string', description: 'KV key. For recall.' },
          value: { type: 'string', description: 'JSON value to store. Omit to retrieve. For recall.' },
          prefix: { type: 'string', description: 'Key prefix filter. For query.' },
        },
        required: ['action'],
      },
    },
  },
];

// ── Tool Name Mapping ──

/** Map from chat tool names (underscored) to MCP tool names (dotted) */
const TOOL_NAME_MAP: Record<string, string> = {
  'ul_discover': 'ul.discover',
  'ul_call': 'ul.call',
  'ul_codemode': 'ul.codemode',
  'ul_memory': 'ul.memory',
  'ul_rate': 'ul.rate',
};

// ── Hook ──

export interface UseMcpReturn {
  /** Tools to pass to useChat */
  tools: ChatTool[];
  /** Tool execution handler for useChat's onToolCall */
  executeToolCall: (name: string, args: Record<string, unknown>) => Promise<string>;
}

export function useMcp(): UseMcpReturn {
  const executeToolCall = useCallback(async (
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> => {
    // Map underscored names to dotted MCP names
    const mcpName = TOOL_NAME_MAP[name] || name;

    try {
      const result = await executeMcpTool(mcpName, args);

      if (result.isError) {
        return `Error: ${result.content.map(c => c.text).join('\n')}`;
      }

      return result.content.map(c => c.text).join('\n');
    } catch (err) {
      return `Tool execution failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }, []);

  const tools = useMemo(() => {
    const model = getModel();
    return isCodeModeCapable(model) ? CODE_MODE_TOOLS : TRADITIONAL_TOOLS;
  }, []);

  return { tools, executeToolCall };
}
