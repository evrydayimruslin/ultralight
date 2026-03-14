// Create Agent Modal — agent creation form with template picker, context
// suggestions, and marketplace skills. Triggered from kanban card.

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { KanbanCard } from '../hooks/useKanban';
import { loadTemplates, loadBaseContext, type AgentTemplate, type ContextFile } from '../lib/templates';
import { suggestContext, type KnowledgeSuggestion } from '../lib/suggestions';
import { getAutoApproveCents } from '../lib/storage';

// ── Types ──

interface MarketplaceSkill {
  id: string;
  name: string;
  priceCents: number;
}

interface CreateAgentModalProps {
  card?: KanbanCard | null;
  defaultModel: string;
  projectDir: string | null;
  executeMcpTool?: (name: string, args: Record<string, unknown>) => Promise<string>;
  onCreateAndStart: (params: {
    name: string;
    role: string;
    task: string;
    model: string;
    permissionLevel: string;
    cardId?: string;
    launchMode: string;
    templateBody?: string;
    selectedContextPaths?: string[];
    selectedSkillIds?: Array<{ id: string; name: string; priceCents: number }>;
  }) => Promise<void>;
  onClose: () => void;
}

// Build task description from card content
function buildTaskFromCard(card: KanbanCard): string {
  const parts: string[] = [];
  parts.push(card.title);
  if (card.description) {
    parts.push(`\nDescription: ${card.description}`);
  }
  if (card.acceptance_criteria) {
    parts.push(`\nAcceptance Criteria: ${card.acceptance_criteria}`);
  }
  return parts.join('');
}

export default function CreateAgentModal({
  card,
  defaultModel,
  projectDir,
  executeMcpTool,
  onCreateAndStart,
  onClose,
}: CreateAgentModalProps) {
  const [name, setName] = useState(card ? card.title.slice(0, 40) : '');
  const [role, setRole] = useState('builder');
  const [task, setTask] = useState(card ? buildTaskFromCard(card) : '');
  const [model, setModel] = useState(defaultModel);
  const [permissionLevel, setPermissionLevel] = useState('auto_edit');
  const [launchMode, setLaunchMode] = useState<'build_now' | 'discuss_first'>('build_now');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // Template state
  const [templates, setTemplates] = useState<AgentTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<AgentTemplate | null>(null);

  // Context state
  const [baseContext, setBaseContext] = useState<ContextFile[]>([]);
  const [suggestions, setSuggestions] = useState<KnowledgeSuggestion[]>([]);
  const [selectedContextPaths, setSelectedContextPaths] = useState<Set<string>>(new Set());

  // Marketplace state
  const [marketplaceSkills, setMarketplaceSkills] = useState<MarketplaceSkill[]>([]);
  const [selectedSkillIds, setSelectedSkillIds] = useState<Set<string>>(new Set());
  const [skillBudgetCents, setSkillBudgetCents] = useState(() => Math.min(getAutoApproveCents() * 4, 1000));
  const [searchingSkills, setSearchingSkills] = useState(false);

  // Debounce ref
  const taskDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load templates + base context on mount ──

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  useEffect(() => {
    if (projectDir) {
      loadTemplates(projectDir).then(setTemplates);
      loadBaseContext(projectDir).then(ctx => {
        setBaseContext(ctx);
        // Auto-select base context files
        setSelectedContextPaths(new Set(ctx.map(f => f.path)));
      });
    }
  }, [projectDir]);

  // ── Debounced suggestion + marketplace search on task change ──

  useEffect(() => {
    if (taskDebounceRef.current) clearTimeout(taskDebounceRef.current);

    const trimmed = task.trim();
    if (!trimmed || trimmed.length < 5) {
      setSuggestions([]);
      setMarketplaceSkills([]);
      return;
    }

    taskDebounceRef.current = setTimeout(async () => {
      // Local suggestions
      if (projectDir) {
        const results = await suggestContext(trimmed, projectDir);
        setSuggestions(results);
        // Auto-select high-relevance suggestions
        setSelectedContextPaths(prev => {
          const next = new Set(prev);
          for (const s of results) {
            if (s.relevance_score > 5) next.add(s.path);
          }
          return next;
        });
      }

      // Marketplace discovery
      if (executeMcpTool) {
        setSearchingSkills(true);
        try {
          const result = await executeMcpTool('ul_discover', {
            scope: 'appstore',
            task: trimmed,
            types: ['memory_md', 'library_md'],
            limit: 5,
          });
          const parsed = JSON.parse(result);
          const skills: MarketplaceSkill[] = (parsed.results || [])
            .filter((s: { pricing_config?: { default_price_cents?: number } }) => {
              const price = s.pricing_config?.default_price_cents ?? 0;
              return price <= skillBudgetCents;
            })
            .map((s: { id: string; name: string; pricing_config?: { default_price_cents?: number } }) => ({
              id: s.id,
              name: s.name,
              priceCents: s.pricing_config?.default_price_cents ?? 0,
            }));
          setMarketplaceSkills(skills);
        } catch {
          setMarketplaceSkills([]);
        } finally {
          setSearchingSkills(false);
        }
      }
    }, 800);

    return () => {
      if (taskDebounceRef.current) clearTimeout(taskDebounceRef.current);
    };
  }, [task, projectDir, executeMcpTool, skillBudgetCents]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // ── Template selection handler ──

  const handleRoleChange = useCallback((value: string) => {
    // Check if it's a template selection (starts with "template:")
    if (value.startsWith('template:')) {
      const templatePath = value.slice('template:'.length);
      const tmpl = templates.find(t => t.path === templatePath);
      if (tmpl) {
        setSelectedTemplate(tmpl);
        setRole(tmpl.role);
        if (tmpl.launch_mode === 'discuss_first' || tmpl.launch_mode === 'build_now') {
          setLaunchMode(tmpl.launch_mode);
        }
        if (!name.trim()) setName(tmpl.name);
      }
    } else {
      setSelectedTemplate(null);
      setRole(value);
    }
  }, [templates, name]);

  // Current select value
  const selectValue = useMemo(() => {
    if (selectedTemplate) return `template:${selectedTemplate.path}`;
    return role;
  }, [selectedTemplate, role]);

  // ── Context checkbox toggle ──

  const toggleContext = useCallback((path: string) => {
    setSelectedContextPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const toggleSkill = useCallback((id: string) => {
    setSelectedSkillIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ── Submit ──

  const handleSubmit = useCallback(async () => {
    const trimName = name.trim();
    const trimTask = task.trim();
    if (!trimName || !trimTask) return;

    setCreating(true);
    setError(null);
    try {
      await onCreateAndStart({
        name: trimName,
        role,
        task: trimTask,
        model,
        permissionLevel,
        cardId: card?.id,
        launchMode,
        templateBody: selectedTemplate?.body,
        selectedContextPaths: Array.from(selectedContextPaths),
        selectedSkillIds: marketplaceSkills
          .filter(s => selectedSkillIds.has(s.id))
          .map(s => ({ id: s.id, name: s.name, priceCents: s.priceCents })),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCreating(false);
    }
  }, [name, role, task, model, permissionLevel, launchMode, card, selectedTemplate, selectedContextPaths, selectedSkillIds, marketplaceSkills, onCreateAndStart, onClose]);

  // ── Merge base context + suggestions for display ──

  const contextItems = useMemo(() => {
    const items: Array<{ path: string; name: string; type: 'base' | 'suggested'; score?: number }> = [];
    for (const ctx of baseContext) {
      items.push({ path: ctx.path, name: ctx.name, type: 'base' });
    }
    for (const sug of suggestions) {
      // Don't duplicate base context entries
      if (!baseContext.some(b => b.path === sug.path)) {
        items.push({ path: sug.path, name: sug.name, type: 'suggested', score: sug.relevance_score });
      }
    }
    return items;
  }, [baseContext, suggestions]);

  const hasContext = contextItems.length > 0;
  const hasSkills = marketplaceSkills.length > 0 || searchingSkills;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-2xl border border-ul-border max-w-lg w-full mx-4 overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-5 pt-5 pb-3 flex items-center justify-between shrink-0">
          <h2 className="text-body font-semibold text-ul-text">Create Agent</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-100 text-ul-text-muted"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <line x1="4" y1="4" x2="12" y2="12" />
              <line x1="12" y1="4" x2="4" y2="12" />
            </svg>
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="px-5 pb-4 space-y-4 overflow-y-auto">
          {/* Name */}
          <div>
            <label className="text-caption font-medium text-ul-text-secondary mb-1 block">Name</label>
            <input
              ref={nameRef}
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Agent name..."
              className="w-full text-small rounded border border-ul-border px-3 py-2 bg-white focus:outline-none focus:border-ul-border-focus"
            />
          </div>

          {/* Role/Template + Model row */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-caption font-medium text-ul-text-secondary mb-1 block">Role</label>
              <select
                value={selectValue}
                onChange={e => handleRoleChange(e.target.value)}
                className="w-full text-small rounded border border-ul-border px-2 py-2 bg-white focus:outline-none focus:border-ul-border-focus"
              >
                <optgroup label="Built-in Roles">
                  <option value="builder">Builder</option>
                  <option value="analyst">Analyst</option>
                  <option value="support">Support</option>
                  <option value="general">General</option>
                </optgroup>
                {templates.length > 0 && (
                  <optgroup label="Templates">
                    {templates.map(t => (
                      <option key={t.path} value={`template:${t.path}`}>
                        {t.name} ({t.source})
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
            <div className="flex-1">
              <label className="text-caption font-medium text-ul-text-secondary mb-1 block">Model</label>
              <input
                type="text"
                value={model}
                onChange={e => setModel(e.target.value)}
                className="w-full text-small rounded border border-ul-border px-3 py-2 bg-white focus:outline-none focus:border-ul-border-focus"
              />
            </div>
          </div>

          {/* Permission Level */}
          <div>
            <label className="text-caption font-medium text-ul-text-secondary mb-1 block">Permission Level</label>
            <select
              value={permissionLevel}
              onChange={e => setPermissionLevel(e.target.value)}
              className="w-full text-small rounded border border-ul-border px-2 py-2 bg-white focus:outline-none focus:border-ul-border-focus"
            >
              <option value="auto_edit">Auto Edit — ask only for shell commands</option>
              <option value="auto_all">Auto All — no prompts</option>
              <option value="ask_all">Ask All — prompt for everything</option>
            </select>
          </div>

          {/* Launch Mode */}
          <div>
            <label className="text-caption font-medium text-ul-text-secondary mb-1 block">Launch Mode</label>
            <div className="flex rounded border border-ul-border overflow-hidden">
              <button
                type="button"
                onClick={() => setLaunchMode('build_now')}
                className={`flex-1 text-small py-1.5 px-3 transition-colors ${
                  launchMode === 'build_now'
                    ? 'bg-ul-text text-white font-medium'
                    : 'bg-white text-ul-text-secondary hover:bg-gray-50'
                }`}
              >
                Build Now
              </button>
              <button
                type="button"
                onClick={() => setLaunchMode('discuss_first')}
                className={`flex-1 text-small py-1.5 px-3 border-l border-ul-border transition-colors ${
                  launchMode === 'discuss_first'
                    ? 'bg-amber-500 text-white font-medium'
                    : 'bg-white text-ul-text-secondary hover:bg-gray-50'
                }`}
              >
                Discuss First
              </button>
            </div>
            <p className="text-caption text-ul-text-muted mt-1">
              {launchMode === 'discuss_first'
                ? 'Agent will analyze and submit a plan for approval before building.'
                : 'Agent will start implementing the task immediately.'}
            </p>
          </div>

          {/* Task */}
          <div>
            <label className="text-caption font-medium text-ul-text-secondary mb-1 block">Task</label>
            <textarea
              value={task}
              onChange={e => setTask(e.target.value)}
              placeholder="Describe the task for this agent..."
              rows={4}
              className="w-full text-small rounded border border-ul-border px-3 py-2 bg-white focus:outline-none focus:border-ul-border-focus resize-y"
            />
          </div>

          {/* Context Files */}
          {hasContext && (
            <div>
              <label className="text-caption font-medium text-ul-text-secondary mb-1.5 block">Context Files</label>
              <div className="space-y-1 rounded border border-ul-border p-2 bg-gray-50/50">
                {contextItems.map(item => (
                  <label key={item.path} className="flex items-center gap-2 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={selectedContextPaths.has(item.path)}
                      onChange={() => toggleContext(item.path)}
                      className="rounded border-gray-300 text-ul-text focus:ring-ul-border-focus"
                    />
                    <span className="text-caption text-ul-text group-hover:text-ul-text-secondary truncate flex-1">
                      {item.name}
                    </span>
                    {item.type === 'base' && (
                      <span className="text-[10px] text-ul-text-muted bg-gray-100 px-1.5 py-0.5 rounded shrink-0">always</span>
                    )}
                    {item.type === 'suggested' && item.score && (
                      <span className="text-[10px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded shrink-0">
                        match {item.score.toFixed(1)}
                      </span>
                    )}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Marketplace Skills */}
          {hasSkills && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-caption font-medium text-ul-text-secondary">Marketplace Skills</label>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-ul-text-muted">Budget:</span>
                  <div className="flex items-center gap-0.5">
                    <span className="text-[10px] text-ul-text-muted">$</span>
                    <input
                      type="number"
                      step="0.25"
                      min="0"
                      max="10"
                      value={(skillBudgetCents / 100).toFixed(2)}
                      onChange={e => setSkillBudgetCents(Math.round(parseFloat(e.target.value || '0') * 100))}
                      className="w-14 text-[10px] text-center rounded border border-ul-border px-1 py-0.5 bg-white focus:outline-none focus:border-ul-border-focus"
                    />
                  </div>
                </div>
              </div>
              <div className="space-y-1 rounded border border-ul-border p-2 bg-gray-50/50">
                {searchingSkills && marketplaceSkills.length === 0 && (
                  <p className="text-[10px] text-ul-text-muted text-center py-1">Searching marketplace...</p>
                )}
                {marketplaceSkills.map(skill => (
                  <label key={skill.id} className="flex items-center gap-2 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={selectedSkillIds.has(skill.id)}
                      onChange={() => toggleSkill(skill.id)}
                      className="rounded border-gray-300 text-ul-text focus:ring-ul-border-focus"
                    />
                    <span className="text-caption text-ul-text group-hover:text-ul-text-secondary truncate flex-1">
                      {skill.name}
                    </span>
                    <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded shrink-0">
                      ${(skill.priceCents / 100).toFixed(2)}
                    </span>
                  </label>
                ))}
                {!searchingSkills && marketplaceSkills.length === 0 && (
                  <p className="text-[10px] text-ul-text-muted text-center py-1">No matching skills found</p>
                )}
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <p className="text-small text-ul-error">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 bg-gray-50 border-t border-ul-border shrink-0">
          <button
            onClick={onClose}
            className="text-small px-4 py-1.5 rounded border border-ul-border hover:bg-gray-100 text-ul-text-secondary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={creating || !name.trim() || !task.trim()}
            className="text-small px-4 py-1.5 rounded bg-ul-text text-white font-medium hover:bg-ul-text/90 transition-colors disabled:opacity-40"
          >
            {creating ? 'Creating...' : launchMode === 'discuss_first' ? 'Create & Discuss' : 'Create & Start'}
          </button>
        </div>
      </div>
    </div>
  );
}
