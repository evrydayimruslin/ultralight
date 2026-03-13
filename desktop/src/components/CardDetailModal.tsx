// Kanban card detail modal — two-tab layout: Details + History.
// Details tab: editable fields (title, description, criteria, status, agent).
// History tab: chronological card reports from agents.
// Plan approval banner when assigned agent is waiting_for_approval.

import { useState, useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { KanbanCard, CardReport } from '../hooks/useKanban';
import type { Agent } from '../hooks/useAgentFleet';

interface CardDetailModalProps {
  card: KanbanCard;
  agents: Agent[];
  onUpdate: (id: string, updates: Partial<Pick<KanbanCard, 'title' | 'description' | 'acceptance_criteria' | 'status' | 'assigned_agent_id'>>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onCreateAgent: (card: KanbanCard) => void;
  onApproveAgent: (agentId: string, plan: string, card: KanbanCard) => Promise<void>;
  onRejectAgent: (agentId: string) => Promise<void>;
  onClose: () => void;
}

// ── Helpers ──

function reportTypeBadge(type: string): { bg: string; text: string; label: string } {
  switch (type) {
    case 'plan': return { bg: 'bg-amber-100', text: 'text-amber-800', label: 'Plan' };
    case 'progress': return { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Progress' };
    case 'completion': return { bg: 'bg-green-100', text: 'text-green-800', label: 'Completion' };
    case 'handoff': return { bg: 'bg-purple-100', text: 'text-purple-800', label: 'Handoff' };
    default: return { bg: 'bg-gray-100', text: 'text-gray-800', label: type };
  }
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

// ── Component ──

export default function CardDetailModal({
  card,
  agents,
  onUpdate,
  onDelete,
  onCreateAgent,
  onApproveAgent,
  onRejectAgent,
  onClose,
}: CardDetailModalProps) {
  const [activeTab, setActiveTab] = useState<'details' | 'history'>('details');
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description ?? '');
  const [acceptanceCriteria, setAcceptanceCriteria] = useState(card.acceptance_criteria ?? '');
  const [status, setStatus] = useState(card.status);
  const [assignedAgentId, setAssignedAgentId] = useState<string | null>(card.assigned_agent_id);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reports, setReports] = useState<CardReport[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [approving, setApproving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  // Focus title on open
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  // Load reports
  useEffect(() => {
    let mounted = true;
    setReportsLoading(true);
    invoke<CardReport[]>('db_list_card_reports', { cardId: card.id })
      .then(r => { if (mounted) setReports(r); })
      .catch(err => console.error('[CardDetail] Failed to load reports:', err))
      .finally(() => { if (mounted) setReportsLoading(false); });
    return () => { mounted = false; };
  }, [card.id]);

  // Reset confirm delete after timeout
  useEffect(() => {
    if (!confirmDelete) return;
    const t = setTimeout(() => setConfirmDelete(false), 3000);
    return () => clearTimeout(t);
  }, [confirmDelete]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

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

  const assignedAgent = assignedAgentId
    ? agents.find(a => a.id === assignedAgentId) ?? null
    : null;

  // Plan approval state
  const isWaitingForApproval = assignedAgent?.status === 'waiting_for_approval';
  const latestPlanReport = isWaitingForApproval
    ? [...reports].reverse().find(r => r.report_type === 'plan')
    : null;

  const handleApprove = useCallback(async () => {
    if (!assignedAgent || !latestPlanReport) return;
    setApproving(true);
    try {
      await onApproveAgent(assignedAgent.id, latestPlanReport.content, card);
      onClose();
    } catch (err) {
      console.error('[CardDetail] Approve failed:', err);
      setApproving(false);
    }
  }, [assignedAgent, latestPlanReport, card, onApproveAgent, onClose]);

  const handleReject = useCallback(async () => {
    if (!assignedAgent) return;
    await onRejectAgent(assignedAgent.id);
    onClose();
  }, [assignedAgent, onRejectAgent, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-2xl border border-ul-border max-w-lg w-full mx-4 overflow-hidden max-h-[85vh] flex flex-col">
        {/* Header — title + close */}
        <div className="px-5 pt-5 pb-2 flex items-start justify-between">
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

        {/* Plan approval banner */}
        {isWaitingForApproval && latestPlanReport && (
          <div className="mx-5 mb-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              <span className="text-small font-medium text-amber-900">
                {assignedAgent?.name} submitted a plan for review
              </span>
            </div>
            <div className="max-h-40 overflow-y-auto rounded bg-white border border-amber-200 p-2 mb-2">
              <pre className="text-caption text-ul-text whitespace-pre-wrap font-mono leading-relaxed">
                {latestPlanReport.content}
              </pre>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleApprove}
                disabled={approving}
                className="text-small px-3 py-1 rounded bg-green-600 text-white font-medium hover:bg-green-700 transition-colors disabled:opacity-50"
              >
                {approving ? 'Starting...' : 'Approve & Build'}
              </button>
              <button
                onClick={handleReject}
                className="text-small px-3 py-1 rounded border border-ul-border text-ul-text-secondary hover:bg-gray-100 transition-colors"
              >
                Reject
              </button>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-ul-border px-5">
          <button
            onClick={() => setActiveTab('details')}
            className={`text-small py-2 px-3 border-b-2 transition-colors ${
              activeTab === 'details'
                ? 'border-ul-text text-ul-text font-medium'
                : 'border-transparent text-ul-text-muted hover:text-ul-text'
            }`}
          >
            Details
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`text-small py-2 px-3 border-b-2 transition-colors ${
              activeTab === 'history'
                ? 'border-ul-text text-ul-text font-medium'
                : 'border-transparent text-ul-text-muted hover:text-ul-text'
            }`}
          >
            History{reports.length > 0 ? ` (${reports.length})` : ''}
          </button>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-5 pb-4">
          {activeTab === 'details' ? (
            <div className="space-y-4 pt-4">
              {/* Status + Agent row */}
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <label className="text-caption font-medium text-ul-text-secondary mb-1 block">Status</label>
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
                <div className="flex-1">
                  <label className="text-caption font-medium text-ul-text-secondary mb-1 block">Assigned Agent</label>
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
                    assignedAgent.status === 'waiting_for_approval' ? 'bg-amber-500' :
                    assignedAgent.status === 'completed' ? 'bg-blue-400' :
                    assignedAgent.status === 'error' ? 'bg-red-500' : 'bg-gray-400'
                  }`} />
                  <span className="text-small text-ul-text">{assignedAgent.name}</span>
                  <span className="text-caption text-ul-text-muted">{assignedAgent.role}</span>
                  <span className="text-caption text-ul-text-muted ml-auto">
                    {assignedAgent.status === 'waiting_for_approval' ? 'Awaiting Approval' : assignedAgent.status}
                  </span>
                </div>
              )}

              {/* Description */}
              <div>
                <label className="text-caption font-medium text-ul-text-secondary mb-1 block">Description</label>
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
                <label className="text-caption font-medium text-ul-text-secondary mb-1 block">Acceptance Criteria</label>
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
          ) : (
            /* History tab */
            <div className="pt-4">
              {reportsLoading ? (
                <p className="text-small text-ul-text-muted text-center py-8">Loading history...</p>
              ) : reports.length === 0 ? (
                <p className="text-small text-ul-text-muted text-center py-8">
                  No reports yet. Agents will post updates here as they work on this card.
                </p>
              ) : (
                <div className="space-y-3">
                  {reports.map(report => {
                    const badge = reportTypeBadge(report.report_type);
                    const agent = agents.find(a => a.id === report.agent_id);
                    return (
                      <div key={report.id} className="rounded-lg border border-ul-border p-3">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-small font-medium text-ul-text">
                            {agent?.name ?? 'Unknown Agent'}
                          </span>
                          <span className={`text-caption px-1.5 py-0.5 rounded ${badge.bg} ${badge.text}`}>
                            {badge.label}
                          </span>
                          <span className="text-caption text-ul-text-muted ml-auto">
                            {formatRelativeTime(report.created_at)}
                          </span>
                        </div>
                        <pre className="text-small text-ul-text whitespace-pre-wrap font-mono leading-relaxed bg-gray-50 rounded p-2 max-h-48 overflow-y-auto">
                          {report.content}
                        </pre>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
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
