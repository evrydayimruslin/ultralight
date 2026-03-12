// MCP tool execution helper hook.
// Bridges the useChat tool-use loop to the Ultralight MCP platform.

import { useCallback, useMemo } from 'react';
import { executeMcpTool, type ChatTool } from '../lib/api';

// ── Platform Tools ──

/** MCP tools exposed to the chat model */
const PLATFORM_TOOLS: ChatTool[] = [
  {
    type: 'function',
    function: {
      name: 'ul_discover',
      description: 'Search the Ultralight app registry. Find deployed functions/APIs by keyword, category, or capability. Returns app names, descriptions, and available endpoints.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query to find apps (e.g., "weather API", "image processing", "data analysis")',
          },
          category: {
            type: 'string',
            description: 'Optional category filter',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ul_call',
      description: 'Call a deployed Ultralight app/function. Execute any discovered function with the given arguments. The function runs on the Ultralight platform and returns results.',
      parameters: {
        type: 'object',
        properties: {
          app: {
            type: 'string',
            description: 'App name or ID to call (from ul_discover results)',
          },
          path: {
            type: 'string',
            description: 'Endpoint path (e.g., "/" or "/analyze")',
          },
          method: {
            type: 'string',
            enum: ['GET', 'POST', 'PUT', 'DELETE'],
            description: 'HTTP method (default: POST)',
          },
          body: {
            type: 'object',
            description: 'Request body (for POST/PUT)',
          },
        },
        required: ['app'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ul_memory',
      description: 'Read or write persistent memory/notes. Store information across conversations for later recall.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['read', 'write', 'list'],
            description: 'Memory action',
          },
          key: {
            type: 'string',
            description: 'Memory key (for read/write)',
          },
          value: {
            type: 'string',
            description: 'Value to store (for write)',
          },
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
  'ul_memory': 'ul.memory',
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

  const tools = useMemo(() => PLATFORM_TOOLS, []);

  return { tools, executeToolCall };
}
