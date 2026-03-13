// Create Agent Modal — quick agent creation form, triggered from kanban card.
// Pre-fills task from card title + description + acceptance criteria.

import { useState, useCallback, useEffect, useRef } from 'react';
import type { KanbanCard } from '../hooks/useKanban';

interface CreateAgentModalProps {
  /** Source card to pre-fill task from (optional) */
  card?: KanbanCard | null;
  /** Available model options */
  defaultModel: string;
  onCreateAndStart: (params: {
    name: string;
    role: string;
    task: string;
    model: string;
    permissionLevel: string;
    cardId?: string;
    launchMode: string;
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

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

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
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCreating(false);
    }
  }, [name, role, task, model, permissionLevel, launchMode, card, onCreateAndStart, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-2xl border border-ul-border max-w-lg w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-5 pt-5 pb-3 flex items-center justify-between">
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

        {/* Body */}
        <div className="px-5 pb-4 space-y-4">
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

          {/* Role + Model row */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-caption font-medium text-ul-text-secondary mb-1 block">Role</label>
              <select
                value={role}
                onChange={e => setRole(e.target.value)}
                className="w-full text-small rounded border border-ul-border px-2 py-2 bg-white focus:outline-none focus:border-ul-border-focus"
              >
                <option value="builder">Builder</option>
                <option value="analyst">Analyst</option>
                <option value="support">Support</option>
                <option value="general">General</option>
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
              rows={5}
              className="w-full text-small rounded border border-ul-border px-3 py-2 bg-white focus:outline-none focus:border-ul-border-focus resize-y"
            />
          </div>

          {/* Error */}
          {error && (
            <p className="text-small text-ul-error">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 bg-gray-50 border-t border-ul-border">
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
