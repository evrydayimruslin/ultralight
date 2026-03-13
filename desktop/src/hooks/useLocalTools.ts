// Local tool execution hook.
// Bridges the useChat tool-use loop to Tauri invoke() for filesystem, shell, and git commands.

import { useCallback, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { ChatTool } from '../lib/api';

// ── Local Tool Definitions ──

/** Local tools exposed to the chat model — maps to Rust #[tauri::command] functions */
const LOCAL_TOOLS: ChatTool[] = [
  // ── Filesystem ──
  {
    type: 'function',
    function: {
      name: 'file_read',
      description:
        'Read the contents of a file. Returns lines with line numbers (cat -n format). ' +
        'Files > 2MB require offset/limit. Paths are relative to project root.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File path relative to project root.',
          },
          offset: {
            type: 'number',
            description: 'Starting line number (1-based). Optional.',
          },
          limit: {
            type: 'number',
            description: 'Max lines to read. Optional.',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'file_write',
      description:
        'Write content to a file. Creates parent directories if needed. ' +
        'Use for creating new files or completely replacing file contents.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File path relative to project root.',
          },
          content: {
            type: 'string',
            description: 'Full file content to write.',
          },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'file_edit',
      description:
        'Make a surgical edit to a file by replacing a unique string. ' +
        'old_string must appear exactly once in the file. ' +
        'Include enough surrounding context to make it unique.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File path relative to project root.',
          },
          old_string: {
            type: 'string',
            description: 'Exact text to find (must be unique in the file).',
          },
          new_string: {
            type: 'string',
            description: 'Text to replace it with.',
          },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'glob',
      description:
        'Find files matching a glob pattern. Returns relative paths sorted by modification time (newest first). ' +
        'Example patterns: "**/*.ts", "src/**/*.tsx", "*.json".',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Glob pattern to match files.',
          },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'grep',
      description:
        'Search file contents with a regex pattern. Returns path:line:content format. ' +
        'Skips hidden directories, node_modules, and binary files.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Regex pattern to search for.',
          },
          include: {
            type: 'string',
            description: 'File glob filter (e.g., "*.ts"). Optional.',
          },
          max_results: {
            type: 'number',
            description: 'Maximum results (default 100). Optional.',
          },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ls',
      description:
        'List directory contents. Shows directories first (with "/"), then files with sizes. ' +
        'Omit path to list project root.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Directory path relative to project root. Optional (defaults to root).',
          },
        },
        required: [],
      },
    },
  },

  // ── Shell ──
  {
    type: 'function',
    function: {
      name: 'shell_exec',
      description:
        'Execute a shell command in the project directory. ' +
        'Runs via sh -c. Returns combined stdout + stderr. ' +
        'Default timeout: 2 minutes.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'Shell command to execute.',
          },
          timeout_ms: {
            type: 'number',
            description: 'Timeout in milliseconds (default 120000). Optional.',
          },
        },
        required: ['command'],
      },
    },
  },

  // ── Git ──
  {
    type: 'function',
    function: {
      name: 'git',
      description:
        'Run a git command in the project directory. ' +
        'Read-only subcommands: status, diff, log, show, branch, remote, stash list. ' +
        'Mutating subcommands: commit, push, pull, reset, rebase, checkout, stash, merge.',
      parameters: {
        type: 'object',
        properties: {
          subcommand: {
            type: 'string',
            description: 'Git subcommand (e.g., "status", "diff", "commit").',
          },
          args: {
            type: 'array',
            items: { type: 'string' },
            description: 'Additional arguments (e.g., ["-m", "commit msg"]). Optional.',
          },
        },
        required: ['subcommand'],
      },
    },
  },

  // ── Subagent Management ──
  {
    type: 'function',
    function: {
      name: 'spawn_agent',
      description:
        'Create a new autonomous subagent that runs in its own conversation with a specialized system prompt. ' +
        'Use for delegating distinct, well-scoped tasks. The agent gets all the same tools you have. ' +
        'Max tree depth: 3 levels.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Short name for the agent (e.g., "API Builder", "Test Writer").',
          },
          role: {
            type: 'string',
            enum: ['builder', 'analyst', 'support', 'general'],
            description: 'Agent specialization. builder=implement code, analyst=research/investigate, support=debug/maintain, general=anything.',
          },
          task: {
            type: 'string',
            description: 'The specific task for the agent to complete. Be detailed and precise.',
          },
          custom_instructions: {
            type: 'string',
            description: 'Optional additional system-level instructions for this agent.',
          },
        },
        required: ['name', 'role', 'task'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_agent',
      description:
        'Get detailed status of a subagent you previously spawned. ' +
        'Returns the agent status, task, and optionally recent messages.',
      parameters: {
        type: 'object',
        properties: {
          agent_id: {
            type: 'string',
            description: 'The ID of the agent to check.',
          },
          include_messages: {
            type: 'number',
            description: 'Number of recent messages to include (default 5). Set to 0 for status only.',
          },
        },
        required: ['agent_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_card_status',
      description:
        'Update the status of a kanban card assigned to you. ' +
        'Can only change status (todo, in_progress, done). Cannot edit card content.',
      parameters: {
        type: 'object',
        properties: {
          card_id: {
            type: 'string',
            description: 'The ID of the kanban card.',
          },
          status: {
            type: 'string',
            enum: ['todo', 'in_progress', 'done'],
            description: 'New status for the card.',
          },
        },
        required: ['card_id', 'status'],
      },
    },
  },
];

// ── Tool Name → Rust Command Mapping ──

/** Map from chat tool names to Tauri invoke command names */
const INVOKE_MAP: Record<string, string> = {
  'file_read': 'file_read',
  'file_write': 'file_write',
  'file_edit': 'file_edit',
  'glob': 'glob_search',
  'grep': 'grep_search',
  'ls': 'ls',
  'shell_exec': 'shell_exec',
  'git': 'git',
};

/** Set of all local tool names (includes JS-handled tools not in INVOKE_MAP) */
export const LOCAL_TOOL_NAMES = new Set([
  ...Object.keys(INVOKE_MAP),
  'spawn_agent',
  'check_agent',
  'update_card_status',
]);

// ── Agent Tool Context ──

import type { Agent, CreateAgentParams } from './useAgentFleet';
import type { AgentRunConfig } from '../lib/agentRunner';
import { agentRunner } from '../lib/agentRunner';
import { buildAgentSystemPrompt } from '../lib/systemPrompt';
import { getModel } from '../lib/storage';

/** Context passed from ChatView for JS-handled agent tools */
export interface AgentToolContext {
  createAgent: (params: CreateAgentParams) => Promise<Agent>;
  startAgent: (agentId: string, config: Omit<AgentRunConfig, 'agentId'>) => Promise<void>;
  parentAgentId: string | null;
  tools: ChatTool[];
  onToolCall: (name: string, args: Record<string, unknown>) => Promise<string>;
}

// ── Hook ──

export interface UseLocalToolsReturn {
  /** Tool definitions to pass to useChat */
  tools: ChatTool[];
  /** Execute a local tool call via Tauri invoke. Returns result string. */
  executeToolCall: (name: string, args: Record<string, unknown>, projectRoot: string, agentCtx?: AgentToolContext) => Promise<string>;
  /** Check if a tool name is a local tool */
  isLocalTool: (name: string) => boolean;
}

export function useLocalTools(): UseLocalToolsReturn {
  const executeToolCall = useCallback(async (
    name: string,
    args: Record<string, unknown>,
    projectRoot: string,
    agentCtx?: AgentToolContext,
  ): Promise<string> => {
    // ── JS-handled agent tools ──
    if (name === 'spawn_agent' && agentCtx) {
      try {
        const { name: agentName, role, task, custom_instructions } = args as {
          name: string; role: string; task: string; custom_instructions?: string;
        };
        const systemPrompt = buildAgentSystemPrompt(role, agentName, projectRoot, custom_instructions);
        const agent = await agentCtx.createAgent({
          name: agentName,
          role,
          initialTask: task,
          systemPrompt,
          projectDir: projectRoot,
          model: getModel(),
          parentAgentId: agentCtx.parentAgentId,
        });
        await agentCtx.startAgent(agent.id, {
          conversationId: agent.conversation_id,
          systemPrompt,
          initialTask: task,
          model: getModel(),
          tools: agentCtx.tools,
          onToolCall: agentCtx.onToolCall,
        });
        return JSON.stringify({
          agent_id: agent.id,
          status: 'running',
          message: `Agent "${agentName}" spawned and running. Use check_agent("${agent.id}") to monitor progress.`,
        });
      } catch (err) {
        return `Tool error: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    if (name === 'check_agent') {
      try {
        const { agent_id, include_messages = 5 } = args as { agent_id: string; include_messages?: number };
        const agent = await invoke<Agent | null>('db_get_agent', { id: agent_id });
        if (!agent) return JSON.stringify({ error: 'Agent not found' });
        const runtime = agentRunner.getStatus(agent_id);
        const result: Record<string, unknown> = {
          agent_id: agent.id,
          name: agent.name,
          role: agent.role,
          status: runtime?.status || agent.status,
          task: agent.initial_task,
        };
        if (include_messages > 0) {
          const msgs = agentRunner.getMessages(agent_id);
          if (msgs) {
            result.recent_messages = msgs
              .slice(-include_messages)
              .map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content.slice(0, 500) : '' }));
          }
        }
        return JSON.stringify(result);
      } catch (err) {
        return `Tool error: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    if (name === 'update_card_status') {
      try {
        const { card_id, status } = args as { card_id: string; status: string };
        await invoke('db_update_card', { id: card_id, status });
        return JSON.stringify({ card_id, status, message: `Card status updated to "${status}"` });
      } catch (err) {
        return `Tool error: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    // ── Rust-invoked tools ──
    const command = INVOKE_MAP[name];
    if (!command) {
      return `Unknown local tool: ${name}`;
    }

    try {
      // All Rust commands take project_root as first param
      const invokeArgs: Record<string, unknown> = {
        projectRoot,
        ...args,
      };

      const result = await invoke<string>(command, invokeArgs);
      return result;
    } catch (err) {
      return `Tool error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }, []);

  const isLocalTool = useCallback((name: string): boolean => {
    return LOCAL_TOOL_NAMES.has(name);
  }, []);

  const tools = useMemo(() => LOCAL_TOOLS, []);

  return { tools, executeToolCall, isLocalTool };
}
