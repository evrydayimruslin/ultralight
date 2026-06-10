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
          template: {
            type: 'string',
            description: 'Template name from .ultralight/agents/ (without .md). Applies frontmatter config + body as instructions.',
          },
          context_files: {
            type: 'array',
            items: { type: 'string' },
            description: 'Filenames from .ultralight/knowledge/ to inject as context (without .md).',
          },
          discover_skills: {
            type: 'boolean',
            description: 'Search marketplace for relevant skills and inject into context.',
          },
          skill_budget_light: {
            type: 'number',
            description: 'Max cents to spend on marketplace skills (default: user auto-approve setting).',
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

  // ── Card Reports ──
  {
    type: 'function',
    function: {
      name: 'add_card_report',
      description:
        'Post a progress update or report to your assigned kanban card. ' +
        'Use to communicate what you did, what changed, and any follow-up items.',
      parameters: {
        type: 'object',
        properties: {
          card_id: {
            type: 'string',
            description: 'The ID of the kanban card.',
          },
          content: {
            type: 'string',
            description: 'Report content — concise summary of work done or status.',
          },
          report_type: {
            type: 'string',
            enum: ['progress', 'completion', 'plan'],
            description: 'Type of report. Default: progress.',
          },
        },
        required: ['card_id', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'submit_plan',
      description:
        'Submit your analysis plan for user approval. Pauses execution until approved. ' +
        'Only use in discuss-first mode. After calling this, STOP — do not implement anything.',
      parameters: {
        type: 'object',
        properties: {
          card_id: {
            type: 'string',
            description: 'The ID of the kanban card.',
          },
          plan: {
            type: 'string',
            description: 'Structured plan in markdown: summary, approach, files to modify, risks.',
          },
        },
        required: ['card_id', 'plan'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'hand_off_task',
      description:
        'Complete your work, write a handoff report, and pass the card to a new agent. ' +
        'Creates a successor agent with a different specialization assigned to the same card.',
      parameters: {
        type: 'object',
        properties: {
          card_id: {
            type: 'string',
            description: 'The ID of the kanban card.',
          },
          summary: {
            type: 'string',
            description: 'What you did + context for the successor agent.',
          },
          next_agent_name: {
            type: 'string',
            description: 'Name for the successor agent.',
          },
          next_agent_role: {
            type: 'string',
            enum: ['builder', 'analyst', 'support', 'general'],
            description: 'Role specialization for the successor.',
          },
          next_agent_task: {
            type: 'string',
            description: 'The specific task for the successor to complete.',
          },
        },
        required: ['card_id', 'summary', 'next_agent_name', 'next_agent_role', 'next_agent_task'],
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
  'add_card_report',
  'submit_plan',
  'hand_off_task',
]);

// ── Agent Tool Context ──

import type { Agent, CreateAgentParams } from './useAgentFleet';
import type { AgentRunConfig } from '../lib/agentRunner';
import { agentRunner } from '../lib/agentRunner';
import { buildAgentSystemPrompt, inspectAndBuildMcpSchemas } from '../lib/systemPrompt';
import { getModel, getAutoApproveLight } from '../lib/storage';
import { loadTemplates, loadBaseContext, readAbsoluteFile, fileNameWithoutExt } from '../lib/templates';

/** Context passed from ChatView for JS-handled agent tools */
export interface AgentToolContext {
  createAgent: (params: CreateAgentParams) => Promise<Agent>;
  startAgent: (agentId: string, config: Omit<AgentRunConfig, 'agentId'>) => Promise<void>;
  parentAgentId: string | null;
  /** The agent calling the tool (null if user-driven chat) */
  currentAgentId: string | null;
  /** Card assigned to this agent, if any */
  currentCardId: string | null;
  tools: ChatTool[];
  onToolCall: (name: string, args: Record<string, unknown>) => Promise<string>;
  /** Abort the current agent's run (for pause / handoff) */
  abortCurrentRun: () => void;
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
        const {
          name: agentName, role, task, custom_instructions,
          template, context_files, discover_skills, skill_budget_light,
        } = args as {
          name: string; role: string; task: string; custom_instructions?: string;
          template?: string; context_files?: string[]; discover_skills?: boolean; skill_budget_light?: number;
        };

        // 1. Load template if specified
        let effectiveRole = role;
        let templateBody: string | undefined;
        let templateMcps: string[] | undefined;
        if (template) {
          const templates = await loadTemplates(projectRoot);
          const match = templates.find(t =>
            t.path.endsWith(`/${template}.md`) || t.name === template
          );
          if (match) {
            effectiveRole = match.role;
            templateBody = match.body;
            templateMcps = match.mcps;
          }
        }

        // 2. Load base context
        const baseCtx = await loadBaseContext(projectRoot);

        // 3. Load specified knowledge files
        const extraCtx: Array<{ name: string; content: string }> = [];
        if (context_files) {
          for (const cf of context_files) {
            const path = cf.endsWith('.md') ? cf : `${cf}.md`;
            const absPath = `${projectRoot}/.ultralight/knowledge/${path}`;
            const content = await readAbsoluteFile(absPath);
            if (content) extraCtx.push({ name: fileNameWithoutExt(absPath), content });
          }
        }

        // 4. Marketplace discovery (if requested)
        const skillCtx: Array<{ name: string; content: string }> = [];
        if (discover_skills && agentCtx.onToolCall) {
          try {
            const discoverResult = await agentCtx.onToolCall('ul_discover', {
              scope: 'appstore', task, types: ['memory_md', 'library_md'], limit: 3,
            });
            const parsed = JSON.parse(discoverResult);
            const budget = skill_budget_light ?? getAutoApproveLight();
            for (const skill of (parsed.results || []).slice(0, 2)) {
              const price = skill.pricing_config?.default_price_light ?? 0;
              if (price > budget) continue;
              try {
                const content = await agentCtx.onToolCall('ul_call', {
                  app_id: skill.id, function_name: 'get_content',
                });
                skillCtx.push({ name: skill.name, content });
              } catch { /* skip failed fetches */ }
            }
          } catch { /* discover failed, continue without */ }
        }

        // 5. Inspect template MCPs
        let mcpSchemas: string | undefined;
        if (templateMcps?.length && agentCtx.onToolCall) {
          mcpSchemas = await inspectAndBuildMcpSchemas(templateMcps, agentCtx.onToolCall);
        }

        // 6. Build system prompt with all context
        const allContext = [...baseCtx.map(f => ({ name: f.name, content: f.content })), ...extraCtx];
        const combinedCustom = [templateBody, custom_instructions].filter(Boolean).join('\n\n');
        const systemPrompt = buildAgentSystemPrompt(
          effectiveRole, agentName, projectRoot,
          combinedCustom || undefined, undefined, undefined,
          allContext.length > 0 ? allContext : undefined,
          skillCtx.length > 0 ? skillCtx : undefined,
          mcpSchemas,
        );

        const agent = await agentCtx.createAgent({
          name: agentName,
          role: effectiveRole,
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

    if (name === 'add_card_report' && agentCtx) {
      try {
        const { card_id, content, report_type = 'progress' } = args as {
          card_id: string; content: string; report_type?: string;
        };
        const reportId = crypto.randomUUID();
        await invoke('db_create_card_report', {
          id: reportId,
          cardId: card_id,
          agentId: agentCtx.currentAgentId ?? 'unknown',
          reportType: report_type,
          content,
        });
        return JSON.stringify({ report_id: reportId, message: 'Report posted to card.' });
      } catch (err) {
        return `Tool error: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    if (name === 'submit_plan' && agentCtx) {
      try {
        const { card_id, plan } = args as { card_id: string; plan: string };
        // 1. Create a plan report on the card
        const reportId = crypto.randomUUID();
        await invoke('db_create_card_report', {
          id: reportId,
          cardId: card_id,
          agentId: agentCtx.currentAgentId ?? 'unknown',
          reportType: 'plan',
          content: plan,
        });
        // 2. Update agent status → waiting_for_approval
        if (agentCtx.currentAgentId) {
          await invoke('db_update_agent', {
            id: agentCtx.currentAgentId,
            status: 'waiting_for_approval',
          });
        }
        // 3. Abort the current run (agent pauses here)
        agentCtx.abortCurrentRun();
        return JSON.stringify({ status: 'waiting_for_approval', message: 'Plan submitted. Awaiting approval.' });
      } catch (err) {
        return `Tool error: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    if (name === 'hand_off_task' && agentCtx) {
      try {
        const { card_id, summary, next_agent_name, next_agent_role, next_agent_task } = args as {
          card_id: string; summary: string; next_agent_name: string;
          next_agent_role: string; next_agent_task: string;
        };
        // 1. Create a handoff report on the card
        const reportId = crypto.randomUUID();
        await invoke('db_create_card_report', {
          id: reportId,
          cardId: card_id,
          agentId: agentCtx.currentAgentId ?? 'unknown',
          reportType: 'handoff',
          content: summary,
        });
        // 2. Mark current agent completed
        if (agentCtx.currentAgentId) {
          await invoke('db_update_agent', {
            id: agentCtx.currentAgentId,
            status: 'completed',
          });
        }
        // 3. Create successor agent
        const systemPrompt = buildAgentSystemPrompt(next_agent_role, next_agent_name, projectRoot, undefined);
        const successor = await agentCtx.createAgent({
          name: next_agent_name,
          role: next_agent_role,
          initialTask: next_agent_task,
          systemPrompt,
          projectDir: projectRoot,
          model: getModel(),
          parentAgentId: agentCtx.currentAgentId,
          context: `Handoff from previous agent:\n${summary}`,
        });
        // 4. Reassign card to successor
        await invoke('db_update_card', {
          id: card_id,
          assignedAgentId: successor.id,
          columnId: null, title: null, description: null,
          acceptanceCriteria: null, position: null, status: null,
        });
        // 5. Start successor agent
        await agentCtx.startAgent(successor.id, {
          conversationId: successor.conversation_id,
          systemPrompt,
          initialTask: next_agent_task,
          model: getModel(),
          tools: agentCtx.tools,
          onToolCall: agentCtx.onToolCall,
        });
        // 6. Abort current agent's run — it's done
        agentCtx.abortCurrentRun();
        return JSON.stringify({
          handoff_agent_id: successor.id,
          message: `Handed off to ${next_agent_name} (${next_agent_role}).`,
        });
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
