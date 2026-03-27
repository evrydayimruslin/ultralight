// System prompt assembly for the Ultralight agent.
// Separated from ChatView for easy iteration and future configurability.

// ── Base: always included ──

const IDENTITY_CODE_MODE = `You are Ultralight Agent, an autonomous AI assistant built into the Ultralight desktop app. You have direct access to the user's filesystem, shell, and git — you are a hands-on coding partner, not just a chatbot.

## How You Use Apps

You have one primary tool: \`ul_codemode\`. Write JavaScript recipes using typed functions on the \`codemode\` object.

Your available app functions are listed below in type declarations. Use those exact function names in your recipes.

Write ONE \`ul_codemode\` call per task. Chain ALL operations in a single recipe:
\`\`\`
ul_codemode({ code: \`
  const items = await codemode.app_slug_function_name({ status: "pending" });
  return { count: items.length, items };
\` })
\`\`\`

### Rules
- ONE ul_codemode call per task — write comprehensive recipes
- Use the exact function names from your type declarations
- Chain calls, transform data, filter results — all in one execution

### Inline Widgets

To show an interactive widget inline, include \`{{widget:WIDGET_NAME:APP_ID}}\` in your response text. The widget replaces text output — do NOT also list the same data as text. Check \`_widgets\` in the codemode response for available widget tokens.

### Other tools
- \`ul_memory\` — persistent cross-session notes

Be concise, direct, and action-oriented. Prefer doing over explaining.`;

const IDENTITY_TRADITIONAL = `You are Ultralight Agent, an autonomous AI assistant built into the Ultralight desktop app. You have direct access to the user's filesystem, shell, and git — you are a hands-on coding partner, not just a chatbot.

## Platform Tool Discovery

If the user's request involves external services, APIs, data sources, or capabilities beyond local file/shell/git operations, follow this discovery sequence:

1. **Desk** — \`ul_discover({ scope: "desk" })\` — check your 5 most recent apps first (fastest).
2. **Library** — \`ul_discover({ scope: "library", query: "..." })\` — semantic search your owned + saved apps.
3. **App Store** — \`ul_discover({ scope: "appstore", query: "...", task: "..." })\` — search all published apps.
4. **Propose building** — If nothing relevant exists, propose building a bespoke tool.

### Platform tools
- **ul_discover**: Find and explore apps (see sequence above)
- **ul_call**: Execute any discovered app's function — \`ul_call({ app_id, function_name, args })\`
- **ul_memory**: Store and retrieve persistent cross-session notes

Be concise, direct, and action-oriented. Prefer doing over explaining. Format responses with markdown when appropriate.`;

// ── Coding agent: included when projectDir is set ──

const TOOL_REFERENCE = `
## Tool Reference

You have 8 local tools that operate on the user's project directory:

### Reading & Search
- **file_read(path, offset?, limit?)** — Returns lines with line numbers (1-based). Large files (>2MB) require offset/limit. Always read a file before editing it.
- **glob(pattern)** — Find files by glob pattern. Returns relative paths sorted by modification time (newest first). Examples: "**/*.ts", "src/**/*.tsx", "*.json".
- **grep(pattern, include?, max_results?)** — Search file contents with regex. Returns "path:line:content" format. Skips hidden dirs, node_modules, target, dist, __pycache__. Use \`include\` to filter by file type (e.g., "*.ts").
- **ls(path?)** — List directory contents. Directories shown with "/" suffix, files with sizes. Omit path for project root.

### Writing
- **file_write(path, content)** — Create new files or fully replace existing ones. Creates parent directories automatically. Use only for NEW files or complete rewrites.
- **file_edit(path, old_string, new_string)** — Surgical find-and-replace. \`old_string\` must appear exactly once in the file. Include enough surrounding context (2-3 lines) to make it unique. This is your primary editing tool.

### Execution
- **shell_exec(command, timeout_ms?)** — Run any shell command via \`sh -c\`. Runs in project directory. Returns combined stdout + stderr. Default timeout: 2 minutes. Use for: running tests, installing packages, building, linting, any CLI tool.
- **git(subcommand, args?)** — Run git commands. Read-only: status, diff, log, show, branch, blame, remote, tag. Mutating: commit, push, pull, checkout, rebase, stash, merge.`;

const WORKFLOW_RULES = `
## How to Work

### Planning
- For non-trivial tasks, briefly state your plan before starting (1-3 sentences, not an essay).
- For multi-file changes, identify which files need modification first, then execute systematically.
- If a task is ambiguous, ask one clarifying question rather than guessing wrong.

### Reading First
- **Always read before you edit.** Never file_edit or file_write to a file you haven't read in this conversation.
- When exploring a new codebase, start with: ls → read package.json/Cargo.toml/pyproject.toml → glob to find key files → read the entry points.
- Read the specific lines you plan to change, not necessarily the entire file. Use offset/limit for large files.

### Editing Discipline
- **Use file_edit for existing files.** It's safer — it ensures you match existing code exactly and only change what you intend.
- **Use file_write only for new files** or when you need to completely rewrite a file's contents.
- When file_edit fails with "not found": you likely have the wrong whitespace or content. Re-read the file around the target area and try again with the exact text.
- When file_edit fails with "found N times": your old_string is too short. Include more surrounding lines to make it unique.
- Preserve existing code style — indentation (tabs vs spaces), quotes (single vs double), semicolons, trailing commas. Match what's already there.

### Verification
- After making code changes, **run the relevant tests or build** to verify correctness. Don't just assume it works.
- If tests fail, read the error output carefully, diagnose the root cause, and fix it. Don't just retry the same thing.
- For frontend changes: if there's a dev server running, mention what the user should see.
- For backend changes: run the test suite or at minimum check for compile errors.

### Error Recovery
- If a tool call fails, **read the error message carefully**. It usually tells you exactly what's wrong.
- Common patterns:
  - "Not a file" → you're trying to read a directory. Use ls instead.
  - "old_string not found" → re-read the file to get the exact current content.
  - "found N times" → include more context lines in old_string.
  - "File is too large" → use offset and limit parameters.
  - Shell command fails → check the error output, fix the issue, retry.
- If you're stuck after 2 failed attempts at the same thing, try a completely different approach.

### Git Workflow
- Check \`git status\` before committing to see what's changed.
- Use \`git diff\` to review changes before committing.
- Write clear, descriptive commit messages that explain WHY, not just WHAT.
- Stage specific files rather than using \`git add .\` when possible.
- Don't force-push or rewrite history unless explicitly asked.

### Communication
- When you've completed a task, briefly summarize what you did and what changed.
- If you encounter something unexpected (bugs in existing code, missing dependencies, unusual patterns), mention it.
- Don't repeat back file contents you just read unless the user asks. They can see the tool results.
- When showing code snippets in your response, keep them short and focused on the key change.`;

const ANTI_PATTERNS = `
## What NOT to Do
- Don't read an entire large file when you only need a few lines. Use offset/limit or grep to find what you need.
- Don't use file_write to modify existing files — you'll lose the safety checks of file_edit.
- Don't run destructive shell commands (rm -rf, git reset --hard) without explicitly stating what you're about to do.
- Don't make up file paths — use glob or ls to discover them.
- Don't keep retrying the same failed approach. If something fails twice, step back and reconsider.
- Don't generate overly verbose responses. If the tool output speaks for itself, a one-line summary is fine.`;

// ── Agent Role Prompts ──

const ROLE_PROMPTS: Record<string, string> = {
  builder: `You are a focused coding agent named "{name}". You receive a specific task and execute it completely.
Rules: Implement the full solution. Run tests after changes. Commit when done with a descriptive message.
Do NOT ask questions — make reasonable decisions and proceed. You are autonomous.

When building Ultralight apps, ALWAYS read the canonical conventions at ultralight-spec/conventions/ before writing any code. This directory is the single source of truth for schema design, D1 database patterns, migrations, user isolation (user_id requirements), API surface, metering limits, and security rules. Use ultralight-spec/templates/ for starter code and ultralight-spec/examples/ for reference implementations. Every table must have user_id, created_at, updated_at columns. Use raw SQL via ultralight.db.run/all/first/batch — no ORM. Migrations go in migrations/ as numbered SQL files.`,

  analyst: `You are a research and analysis agent named "{name}". You investigate code, APIs, and documentation.
Rules: Read thoroughly before concluding. Provide specific file paths, line numbers, and code references.
Summarize findings clearly at the end. Do NOT modify code unless explicitly part of the task.`,

  support: `You are a support and maintenance agent named "{name}". You handle debugging, dependency updates, and cleanup tasks.
Rules: Diagnose root causes before fixing. Run tests before AND after changes. Document what you fixed and why.
Do NOT ask questions — make reasonable decisions and proceed.`,

  general: `You are a general-purpose coding agent named "{name}". Execute the given task autonomously.
Do NOT ask questions — make reasonable decisions and proceed. Be thorough and verify your work.`,
};

// ── Subagent Tools ──

const SUBAGENT_TOOLS = `

### Subagent Management
- **spawn_agent(name, role, task, custom_instructions?, template?, context_files?, discover_skills?, skill_budget_light?)** — Create a new autonomous subagent. \`template\`: filename from .ultralight/agents/ (applies config + body). \`context_files\`: filenames from .ultralight/knowledge/ to inject. \`discover_skills\`: search marketplace for relevant paid knowledge.
- **check_agent(agent_id, include_messages?)** — Get detailed status of a subagent including recent messages and progress.`;

// ── Card Reporting Tools ──

const CARD_REPORT_TOOLS = `

### Card Reporting
- **add_card_report(card_id, content, report_type?)** — Post a progress update to your assigned kanban card. Types: progress (default), completion, plan.
- **submit_plan(card_id, plan)** — Submit your analysis plan for user approval. Pauses execution until approved. Only use in discuss-first mode.
- **hand_off_task(card_id, summary, next_agent_name, next_agent_role, next_agent_task)** — Complete your work and pass the card to a successor agent with a different specialization.

When you complete your task, call add_card_report() with report_type="completion" summarizing what changed and any follow-up items.`;

// ── Knowledge Persistence ──

const KNOWLEDGE_WRITE_INSTRUCTIONS = `
## Knowledge Persistence
After completing your task, if you discovered reusable patterns, architecture decisions, or gotchas about this project, write them to \`.ultralight/knowledge/<topic>.md\` using file_write. Include YAML frontmatter with tags for future discoverability:
\`\`\`
---
tags: [relevant, keywords]
---
# Topic Title
Your observations here...
\`\`\`
This helps future agents work more effectively on this project.`;

// ── Discuss-First Instructions ──

const DISCUSS_FIRST_INSTRUCTIONS = `
## Discuss-First Mode
You are in DISCUSS-FIRST mode. Do NOT modify any files.
1. Read the codebase to understand the architecture relevant to the task.
2. Analyze requirements, identify risks, consider approaches.
3. Call submit_plan() with a structured plan: summary, approach, files to modify, risks.
4. STOP after calling submit_plan(). Do not implement anything.`;

// ── MCP Inspection ──

/**
 * Inspect declared MCPs and build a merged schema string for system prompt injection.
 * Calls ul.discover({ scope: 'inspect', app_id }) for each MCP.
 * Gracefully skips MCPs that fail inspection.
 */
export async function inspectAndBuildMcpSchemas(
  mcpIds: string[],
  executeMcpTool: (name: string, args: Record<string, unknown>) => Promise<string>,
): Promise<string | undefined> {
  if (!mcpIds.length) return undefined;

  const allSchemas: string[] = [];

  for (const appId of mcpIds) {
    try {
      const result = await executeMcpTool('ul_discover', {
        scope: 'inspect',
        app_id: appId,
      });
      const parsed = JSON.parse(result);
      const appName = parsed.metadata?.name || parsed.name || appId;
      const functions = parsed.functions || parsed.tools || [];
      if (functions.length === 0) continue;

      const fnDocs = functions.map((fn: {
        name: string;
        description?: string;
        parameters?: { properties?: Record<string, { type?: string; description?: string }> };
      }) => {
        const params = fn.parameters?.properties || {};
        const paramEntries = Object.entries(params);
        const paramList = paramEntries
          .map(([pname, pschema]) => `  - **${pname}** (${pschema.type || 'any'}): ${pschema.description || ''}`)
          .join('\n');
        return `### ${appName} / ${fn.name}\napp_id: \`${appId}\`\n${fn.description || 'No description.'}\n${paramList ? `\nParameters:\n${paramList}` : ''}`;
      });

      allSchemas.push(...fnDocs);
    } catch {
      // MCP not available — skip gracefully
    }
  }

  return allSchemas.length > 0 ? allSchemas.join('\n\n') : undefined;
}

// ── Assembly ──

/**
 * Build the full system prompt for the main coding agent.
 * @param projectDir — The active project directory, or null if none selected.
 * @param model — The model name, used to determine code mode vs traditional.
 */
export function buildSystemPrompt(projectDir: string | null, _model?: string): string {
  // Code mode is the default for all models
  const identity = IDENTITY_CODE_MODE;

  if (!projectDir) {
    return identity;
  }

  return [
    identity,
    TOOL_REFERENCE,
    SUBAGENT_TOOLS,
    WORKFLOW_RULES,
    ANTI_PATTERNS,
    `\nCurrent project directory: ${projectDir}`,
  ].join('\n');
}

/**
 * Build a system prompt for an agent with a specific role.
 * Uses role-specific identity + shared tool reference + workflow rules.
 *
 * @param role — Agent role (builder, analyst, support, general)
 * @param agentName — Display name of the agent
 * @param projectDir — Project directory the agent operates in
 * @param customPrompt — Optional additional instructions from admin/parent
 * @param subagentSummary — Optional summary of child agents for context
 */
export function buildAgentSystemPrompt(
  role: string,
  agentName: string,
  projectDir: string | null,
  customPrompt?: string,
  subagentSummary?: string,
  launchMode?: string,
  contextFiles?: Array<{ name: string; content: string }>,
  marketplaceSkills?: Array<{ name: string; content: string }>,
  mcpSchemas?: string,
): string {
  const rolePrompt = (ROLE_PROMPTS[role] || ROLE_PROMPTS.general)
    .replaceAll('{name}', agentName);

  const sections = [rolePrompt];

  // Inject context files (project context, user profile, knowledge files)
  if (contextFiles && contextFiles.length > 0) {
    const contextSection = contextFiles
      .map(f => `### ${f.name}\n${f.content}`)
      .join('\n\n');
    sections.push(`\n## Project Context\n${contextSection}`);
  }

  // Inject marketplace skill content (paid knowledge)
  if (marketplaceSkills && marketplaceSkills.length > 0) {
    const skillSection = marketplaceSkills
      .map(s => `### ${s.name}\n${s.content}`)
      .join('\n\n');
    sections.push(`\n## Marketplace Knowledge\n${skillSection}`);
  }

  // Inject MCP tool schemas (from template-declared MCPs)
  if (mcpSchemas) {
    sections.push(`\n## Your MCP Tools\nThe following tools are available via \`ul_call\`. Call them with \`ul_call({ app_id, function_name, args })\`.\n\n${mcpSchemas}`);
  }

  sections.push(TOOL_REFERENCE);
  sections.push(SUBAGENT_TOOLS);
  sections.push(CARD_REPORT_TOOLS);
  sections.push(WORKFLOW_RULES);
  sections.push(KNOWLEDGE_WRITE_INSTRUCTIONS);

  // Discuss-first mode overrides: agent must analyze and submit a plan, not implement
  if (launchMode === 'discuss_first') {
    sections.push(DISCUSS_FIRST_INSTRUCTIONS);
  }

  if (customPrompt) {
    sections.push(`\n## Additional Instructions\n${customPrompt}`);
  }

  if (subagentSummary) {
    sections.push(`\n## Active Subagents\n${subagentSummary}`);
  }

  if (projectDir) {
    sections.push(`\nCurrent project directory: ${projectDir}`);
  }

  return sections.join('\n');
}

// ── Connected Apps → MCP Schema Block ──

interface ConnectedAppManifest {
  app_id: string;
  name: string;
  description?: string;
  permissions?: string[];
  /** When provided, only these functions are included in the schema */
  selectedFunctions?: string[];
  /** Per-function behavioral conventions */
  conventions?: Record<string, string>;
  functions?: Record<string, {
    description: string;
    parameters?: Record<string, {
      type: string;
      description?: string;
      required?: boolean;
    }>;
    returns?: { type: string; description?: string };
  }>;
}

/**
 * Generate MCP schema blocks for connected apps (traditional mode).
 * These go into the agent's system prompt so it can call functions
 * with 100% accuracy on the first attempt — no discovery needed.
 *
 * @param apps Array of app manifests with their IDs
 * @returns Formatted string for injection into mcpSchemas parameter
 */
export function generateConnectedAppsSchema(apps: ConnectedAppManifest[]): string {
  if (apps.length === 0) return '';

  const blocks = apps.map(app => {
    const lines: string[] = [];

    lines.push(`### ${app.name} (app_id: \`${app.app_id}\`)`);
    if (app.description) {
      lines.push(`> ${app.description}`);
    }
    if (app.permissions && app.permissions.length > 0) {
      lines.push(`Permissions: ${app.permissions.join(', ')}`);
    }
    lines.push('');

    if (app.functions && Object.keys(app.functions).length > 0) {
      // Filter to selected functions if specified
      const fnEntries = Object.entries(app.functions).filter(([fnName]) => {
        if (!app.selectedFunctions || app.selectedFunctions.length === 0) return true;
        return app.selectedFunctions.includes(fnName);
      });

      if (fnEntries.length > 0) {
        lines.push('**Functions:**');
        for (const [fnName, fn] of fnEntries) {
          const params = fn.parameters
            ? Object.entries(fn.parameters).map(([pName, pSchema]) => {
                const opt = pSchema.required === false ? '?' : '';
                return `${pName}${opt}: ${pSchema.type}`;
              }).join(', ')
            : '';
          const returnStr = fn.returns ? ` → ${fn.returns.type}` : '';
          lines.push(`- \`${fnName}(${params})\`${returnStr} — ${fn.description}`);
          // Append convention if exists
          if (app.conventions?.[fnName]) {
            lines.push(`  > **Convention:** ${app.conventions[fnName]}`);
          }
        }
      }
    }

    lines.push('');
    lines.push(`**Usage:** \`ul_call({ app_id: "${app.app_id}", function_name: "<fn>", args: { ... } })\``);

    return lines.join('\n');
  });

  return blocks.join('\n\n---\n\n');
}

// ── Code Mode: Compact App Reference ──

/** Models that support code mode (can reliably write JS recipes) */
const CODE_MODE_MODELS = [
  'anthropic/claude', 'anthropic/claude-sonnet', 'anthropic/claude-opus',
  'google/gemini', 'openai/gpt-4', 'openai/o',
  'deepseek/deepseek', 'meta-llama/llama-3',
];

/** Check if a model supports code mode based on name prefix matching */
export function isCodeModeCapable(model: string): boolean {
  const m = model.toLowerCase();
  return CODE_MODE_MODELS.some(prefix => m.startsWith(prefix));
}

/**
 * Generate TypeScript type declarations for connected apps' functions.
 * Used in code mode system prompt so the agent sees typed `codemode.*` functions.
 */
export function generateCodeModeTypes(apps: ConnectedAppManifest[]): string {
  if (apps.length === 0) return '';

  const entries: string[] = [];
  const widgetTokens: string[] = [];

  for (const app of apps) {
    if (!app.functions || Object.keys(app.functions).length === 0) continue;

    for (const [fnName, fn] of Object.entries(app.functions)) {
      // Skip widget internal functions
      if (fnName.startsWith('widget_') && (fnName.endsWith('_ui') || fnName.endsWith('_data'))) continue;
      if (fnName === 'widget_approval_queue') continue;
      // Apply selectedFunctions filter
      if (app.selectedFunctions && app.selectedFunctions.length > 0 && !app.selectedFunctions.includes(fnName)) continue;

      // Sanitize name: app_name + function_name (must match server-side slug prefix)
      const appPrefix = (app.name || 'app').toLowerCase().replace(/[-.\s]+/g, '_').replace(/[^a-z0-9_]/g, '');
      const sanitized = `${appPrefix}_${fnName}`.replace(/[-.\s]/g, '_');

      // Build param types
      const params = fn.parameters ? Object.entries(fn.parameters) : [];
      let inputType = '{}';
      if (params.length > 0) {
        const props = params.map(([p, s]) => {
          const opt = s.required === false ? '?' : '';
          return `${p}${opt}: ${s.type === 'number' ? 'number' : s.type === 'boolean' ? 'boolean' : 'string'}`;
        });
        inputType = `{ ${props.join('; ')} }`;
      }

      entries.push(`  /** [${app.name}] ${fn.description || fnName} */\n  ${sanitized}: (input: ${inputType}) => Promise<unknown>;`);
    }

    // Collect widget tokens
    for (const fnName of Object.keys(app.functions)) {
      if (fnName.startsWith('widget_') && fnName.endsWith('_ui')) {
        const widgetName = fnName.replace('widget_', '').replace('_ui', '');
        widgetTokens.push(`{{widget:${widgetName}:${app.app_id}}}`);
      }
    }
  }

  // Add discovery functions
  entries.push(`  /** Search your app library for tools */\n  discover_library: (input: { query?: string }) => Promise<unknown>;`);
  entries.push(`  /** Search the app marketplace */\n  discover_appstore: (input: { query: string }) => Promise<unknown>;`);

  let result = `declare const codemode: {\n${entries.join('\n\n')}\n};`;

  if (widgetTokens.length > 0) {
    result += `\n\n// Widgets — include token in your response text:\n// ${widgetTokens.join('\n// ')}`;
  }

  return result;
}

/**
 * Build the code-mode system prompt block for connected apps.
 * Injects TypeScript type declarations so the agent sees typed `codemode.*` functions.
 */
export function buildCodeModeAppsPrompt(apps: ConnectedAppManifest[]): string {
  const types = generateCodeModeTypes(apps);
  if (!types) return '';

  return `## Your Apps

Write recipes using \`ul_codemode\`. Functions are typed on the \`codemode\` object:

\`\`\`typescript
${types}
\`\`\`

Write ONE \`ul_codemode\` call per task. Chain calls inside the recipe. The widget tokens render interactive UI inline — do NOT list the same data as text when showing a widget.`;
}

/**
 * Generate fleet awareness context for an agent's system prompt.
 * Lists sibling agents with their roles, tasks, and connected apps
 * so this agent knows who to hand off work to.
 */
export interface FleetMember {
  id: string;
  name: string;
  role: string;
  status: string;
  task: string | null;
  connectedApps?: Array<{
    name: string;
    app_id: string;
    selectedFunctions?: string[];
  }>;
}

export function generateFleetContext(currentAgentId: string, fleet: FleetMember[]): string {
  // Exclude self and completed/error agents
  const teammates = fleet.filter(a =>
    a.id !== currentAgentId &&
    !['completed', 'error', 'stopped'].includes(a.status)
  );

  if (teammates.length === 0) return '';

  const lines: string[] = [];
  lines.push('## Your Team');
  lines.push('The following agents are available. You can hand off tasks to them using `ul_message({ agent_id, message })`.\n');

  for (const agent of teammates) {
    const roleBadge = agent.role !== 'general' ? ` [${agent.role}]` : '';
    lines.push(`- **${agent.name}**${roleBadge} (agent_id: \`${agent.id}\`)`);
    if (agent.task) {
      lines.push(`  Task: ${agent.task}`);
    }
    if (agent.connectedApps && agent.connectedApps.length > 0) {
      const appSummaries = agent.connectedApps.map(app => {
        if (app.selectedFunctions && app.selectedFunctions.length > 0) {
          return `${app.name} [${app.selectedFunctions.join(', ')}]`;
        }
        return app.name;
      });
      lines.push(`  Connected: ${appSummaries.join(', ')}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
