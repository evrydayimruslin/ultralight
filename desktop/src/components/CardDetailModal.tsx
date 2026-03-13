// Kanban card detail modal — editable fields for a kanban card.
// Fixed z-50 backdrop, follows PermissionModal pattern.
// All fields save on blur via db_update_card.

import { useState, useCallback, useEffect, useRef } from 'react';
import type { KanbanCard } from '../hooks/useKanban';
import type { Agent } from '../hooks/useAgentFleet';

interface CardDetailModalProps {
  card: KanbanCard;
  agents: Agent[];
  onUpdate: (id: string, updates: Partial<Pick<KanbanCard, 'title' | 'description' | 'acceptance_criteria' | 'status' | 'assigned_agent_id'>>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onCreateAgent: (card: KanbanCard) => void;
  onClose: () => void;
}

export default function CardDetailModal({
  card,
  agents,
  onUpdate,
  onDelete,
  onCreateAgent,
  onClose,
}: CardDetailModalProps) {
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description ?? '');
  const [acceptanceCriteria, setAcceptanceCriteria] = useState(card.acceptance_criteria ?? '');
  const [status, setStatus] = useState(card.status);
  const [assignedAgentId, setAssignedAgentId] = useState<string | null>(card.assigned_agent_id);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  // Focus title on open
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  // Reset confirm delete after timeout
  useEffect(() => {
    if (!confirmDelete) return;
    const t = setTimeout(() => setConfirmDelete(false), 3000);
    return () => clearTimeout(t);
  }, [confirmDelete]);

  // Save handlers — save on blur
  const handleTitleBlur = useCallback(() => {
    const trimmed = title.trim();
    if (trimmed && trimmed !== card.title) {
      onUpdate(card.id, { title: trimmed });
    }
  }, [title, card.id, card.title, onUpdate]);

  const handleDescriptionBlur = useCallback(() => {
    const val = description.trim();
    if (val !== (card.description ?? '')) {
      onUpdate(card.id, { description: val || undefined });
    }
  }, [description, card.id, card.description, onUpdate]);

  const handleAcceptanceCriteriaBlur = useCallback(() => {
    const val = acceptanceCriteria.trim();
    if (val !== (card.acceptance_criteria ?? '')) {
      onUpdate(card.id, { acceptance_criteria: val || undefined });
    }
  }, [acceptanceCriteria, card.id, card.acceptance_criteria, onUpdate]);

  const handleStatusChange = useCallback((newStatus: string) => {
    setStatus(newStatus);
    onUpdate(card.id, { status: newStatus });
  }, [card.id, onUpdate]);

  const handleAgentChange = useCallback((value: string) => {
    if (value === '__create__') {
      onCreateAgent(card);
      return;
    }
    const agentId = value === '__none__' ? null : value;
    setAssignedAgentId(agentId);
    onUpdate(card.id, { assigned_agent_id: agentId ?? undefined });
  }, [card, onUpdate, onCreateAgent]);

  const handleDelete = useCallback(() => {
    if (confirmDelete) {
      onDelete(card.id);
      onClose();
    } else {
      setConfirmDelete(true);
    }
  }, [confirmDelete, card.id, onDelete, onClose]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const assignedAgent = assignedAgentId
    ? agents.find(a => a.id === assignedAgentId) ?? null
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-2xl border border-ul-border max-w-lg w-full mx-4 overflow-hidden max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="px-5 pt-5 pb-3 flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <input
              ref={titleRef}
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              onBlur={handleTitleBlur}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
              className="w-full text-body font-semibold text-ul-text border-none outline-none bg-transparent hover:bg-gray-50 focus:bg-gray-50 rounded px-1 -ml-1 transition-colors"
              placeholder="Card title..."
            />
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-100 text-ul-text-muted ml-2 flex-shrink-0"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <line x1="4" y1="4" x2="12" y2="12" />
              <line x1="12" y1="4" x2="4" y2="12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-4">
          {/* Status + Agent row */}
          <div className="flex items-center gap-4">
            {/* Status */}
            <div className="flex-1">
              <label className="text-caption font-medium text-ul-text-secondary mb-1 block">
                Status
              </label>
              <select
                value={status}
                onChange={e => handleStatusChange(e.target.value)}
                className="w-full text-small rounded border border-ul-border px-2 py-1.5 bg-white focus:outline-none focus:border-ul-border-focus"
              >
                <option value="todo">Todo</option>
                <option value="in_progress">In Progress</option>
                <option value="done">Done</option>
              </select>
            </div>

            {/* Assigned Agent */}
            <div className="flex-1">
              <label className="text-caption font-medium text-ul-text-secondary mb-1 block">
                Assigned Agent
              </label>
              <select
                value={assignedAgentId ?? '__none__'}
                onChange={e => handleAgentChange(e.target.value)}
                className="w-full text-small rounded border border-ul-border px-2 py-1.5 bg-white focus:outline-none focus:border-ul-border-focus"
              >
                <option value="__none__">Unassigned</option>
                {agents.map(agent => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name} ({agent.role})
                  </option>
                ))}
                <option value="__create__">+ Create New Agent...</option>
              </select>
            </div>
          </div>

          {/* Assigned agent indicator */}
          {assignedAgent && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 border border-ul-border">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                assignedAgent.status === 'running' ? 'bg-green-500' :
                assignedAgent.status === 'completed' ? 'bg-blue-400' :
                assignedAgent.status === 'error' ? 'bg-red-500' : 'bg-gray-400'
              }`} />
              <span className="text-small text-ul-text">{assignedAgent.name}</span>
              <span className="text-caption text-ul-text-muted">{assignedAgent.role}</span>
              <span className="text-caption text-ul-text-muted ml-auto">{assignedAgent.status}</span>
            </div>
          )}

          {/* Description */}
          <div>
            <label className="text-caption font-medium text-ul-text-secondary mb-1 block">
              Description
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              onBlur={handleDescriptionBlur}
              placeholder="Add a description..."
              rows={3}
              className="w-full text-small rounded border border-ul-border px-3 py-2 bg-white focus:outline-none focus:border-ul-border-focus resize-y"
            />
          </div>

          {/* Acceptance Criteria */}
          <div>
            <label className="text-caption font-medium text-ul-text-secondary mb-1 block">
              Acceptance Criteria
            </label>
            <textarea
              value={acceptanceCriteria}
              onChange={e => setAcceptanceCriteria(e.target.value)}
              onBlur={handleAcceptanceCriteriaBlur}
              placeholder="Define success criteria..."
              rows={3}
              className="w-full text-small rounded border border-ul-border px-3 py-2 bg-white focus:outline-none focus:border-ul-border-focus resize-y"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center px-5 py-3 bg-gray-50 border-t border-ul-border">
          <button
            onClick={handleDelete}
            className={`text-small px-3 py-1.5 rounded transition-colors ${
              confirmDelete
                ? 'bg-red-100 text-red-700 font-medium'
                : 'text-ul-text-muted hover:text-red-600 hover:bg-red-50'
            }`}
          >
            {confirmDelete ? 'Confirm Delete' : 'Delete Card'}
          </button>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="text-small px-4 py-1.5 rounded border border-ul-border hover:bg-gray-100 text-ul-text-secondary transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
