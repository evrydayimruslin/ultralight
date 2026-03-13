// Home view — project kanban board + agent fleet overview.
// Layout: ProjectDropdown → KanbanBoard → Active Agents → Recent Agents.

import { useState, useCallback, useEffect, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useKanban, type KanbanCard as KanbanCardType } from '../hooks/useKanban';
import type { Agent, CreateAgentParams } from '../hooks/useAgentFleet';
import { useAgentFleet } from '../hooks/useAgentFleet';
import { buildAgentSystemPrompt } from '../lib/systemPrompt';
import ProjectDropdown from './ProjectDropdown';
import KanbanBoard from './KanbanBoard';
import CardDetailModal from './CardDetailModal';
import CreateAgentModal from './CreateAgentModal';

// ── Types ──

interface HomeViewProps {
  selectedProjectDir: string | null;
  onSelectProjectDir: (dir: string | null) => void;
  onNavigateToAgent: (agentId: string) => void;
}

// ── Helpers ──

function statusDot(status: string): string {
  switch (status) {
    case 'running': return 'bg-green-500';
    case 'pending': return 'bg-gray-300';
    case 'completed': return 'bg-blue-400';
    case 'error': return 'bg-red-500';
    case 'stopped': return 'bg-amber-400';
    default: return 'bg-gray-300';
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

export default function HomeView({
  selectedProjectDir,
  onSelectProjectDir,
  onNavigateToAgent,
}: HomeViewProps) {
  const {
    columns,
    cards,
    loading: kanbanLoading,
    createCard,
    updateCard,
    moveCard,
    deleteCard,
    assignAgent,
  } = useKanban(selectedProjectDir);

  const {
    agents,
    createAgent,
    startAgent,
  } = useAgentFleet();

  const [selectedCard, setSelectedCard] = useState<KanbanCardType | null>(null);
  const [createAgentCard, setCreateAgentCard] = useState<KanbanCardType | null>(null);

  // Filter agents for current project
  const projectAgents = useMemo(() => {
    if (!selectedProjectDir) return agents;
    return agents.filter(a => a.project_dir === selectedProjectDir || !a.project_dir);
  }, [agents, selectedProjectDir]);

  const activeAgents = useMemo(
    () => projectAgents.filter(a => a.status === 'running' || a.status === 'pending'),
    [projectAgents]
  );

  const recentAgents = useMemo(
    () => projectAgents
      .filter(a => a.status !== 'running' && a.status !== 'pending')
      .slice(0, 8),
    [projectAgents]
  );

  const handleCreateCard = useCallback(async (columnId: string, title: string) => {
    await createCard(columnId, title);
  }, [createCard]);

  const handleMoveCard = useCallback(async (cardId: string, targetColumnId: string, position: number) => {
    await moveCard(cardId, targetColumnId, position);
  }, [moveCard]);

  const handleCardClick = useCallback((card: KanbanCardType) => {
    setSelectedCard(card);
  }, []);

  const handleCardUpdate = useCallback(async (
    id: string,
    updates: Partial<Pick<KanbanCardType, 'title' | 'description' | 'acceptance_criteria' | 'status' | 'assigned_agent_id'>>,
  ) => {
    await updateCard(id, updates);
    // Update local selected card state
    setSelectedCard(prev => prev?.id === id ? { ...prev, ...updates, updated_at: Date.now() } : prev);
  }, [updateCard]);

  const handleCardDelete = useCallback(async (id: string) => {
    await deleteCard(id);
    setSelectedCard(null);
  }, [deleteCard]);

  const handleCreateAgentFromCard = useCallback((card: KanbanCardType) => {
    // Close card detail modal and open create agent modal
    setSelectedCard(null);
    setCreateAgentCard(card);
  }, []);

  const handleCreateAndStartAgent = useCallback(async (params: {
    name: string;
    role: string;
    task: string;
    model: string;
    permissionLevel: string;
    cardId?: string;
  }) => {
    const systemPrompt = buildAgentSystemPrompt(params.role, params.name, selectedProjectDir, undefined);
    const agent = await createAgent({
      name: params.name,
      role: params.role,
      initialTask: params.task,
      systemPrompt,
      projectDir: selectedProjectDir,
      model: params.model,
      parentAgentId: null,
      permissionLevel: params.permissionLevel,
    });

    // Assign agent to card if created from card
    if (params.cardId) {
      await assignAgent(params.cardId, agent.id);
    }

    // Navigate to the agent's chat
    onNavigateToAgent(agent.id);
  }, [selectedProjectDir, createAgent, assignAgent, onNavigateToAgent]);

  return (
    <div className="flex-1 flex flex-col h-full bg-white overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-ul-border">
        <ProjectDropdown
          selectedDir={selectedProjectDir}
          onSelect={onSelectProjectDir}
        />
      </div>

      {/* Content */}
      <div className="flex-1 px-6 py-4 space-y-6">
        {/* Kanban Board */}
        {selectedProjectDir ? (
          <section>
            {kanbanLoading ? (
              <div className="flex items-center justify-center h-32 text-small text-ul-text-muted">
                Loading board...
              </div>
            ) : (
              <KanbanBoard
                columns={columns}
                cards={cards}
                agents={agents}
                onCreateCard={handleCreateCard}
                onMoveCard={handleMoveCard}
                onCardClick={handleCardClick}
              />
            )}
          </section>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-300 mb-4">
              <path d="M6 14V38C6 39.6569 7.34315 41 9 41H39C40.6569 41 42 39.6569 42 38V20C42 18.3431 40.6569 17 39 17H24L20 11H9C7.34315 11 6 12.3431 6 14Z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <h2 className="text-body font-medium text-ul-text mb-1">No project selected</h2>
            <p className="text-small text-ul-text-muted">
              Select a project folder to see your kanban board and agents.
            </p>
          </div>
        )}

        {/* Active Agents */}
        {activeAgents.length > 0 && (
          <section>
            <h2 className="text-small font-medium text-ul-text-secondary uppercase tracking-wider mb-3">
              Active Agents
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {activeAgents.map(agent => (
                <button
                  key={agent.id}
                  onClick={() => onNavigateToAgent(agent.id)}
                  className="flex items-start gap-3 p-3 rounded-lg border border-ul-border bg-white hover:bg-gray-50 hover:shadow-sm transition-all text-left"
                >
                  <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${statusDot(agent.status)}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-small font-medium text-ul-text truncate">
                        {agent.name}
                      </span>
                      <span className="text-caption px-1.5 py-0.5 rounded bg-gray-100 text-ul-text-secondary flex-shrink-0">
                        {agent.role}
                      </span>
                    </div>
                    {agent.initial_task && (
                      <p className="text-caption text-ul-text-muted mt-0.5 truncate">
                        {agent.initial_task}
                      </p>
                    )}
                    <p className="text-caption text-ul-text-muted mt-1">
                      {formatRelativeTime(agent.updated_at)}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Recent Agents */}
        {recentAgents.length > 0 && (
          <section>
            <h2 className="text-small font-medium text-ul-text-secondary uppercase tracking-wider mb-3">
              Recent Agents
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {recentAgents.map(agent => (
                <button
                  key={agent.id}
                  onClick={() => onNavigateToAgent(agent.id)}
                  className="flex items-start gap-3 p-3 rounded-lg border border-ul-border bg-white hover:bg-gray-50 hover:shadow-sm transition-all text-left"
                >
                  <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${statusDot(agent.status)}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-small font-medium text-ul-text truncate">
                        {agent.name}
                      </span>
                      <span className="text-caption px-1.5 py-0.5 rounded bg-gray-100 text-ul-text-secondary flex-shrink-0">
                        {agent.role}
                      </span>
                    </div>
                    {agent.last_message_preview && (
                      <p className="text-caption text-ul-text-muted mt-0.5 truncate">
                        {agent.last_message_preview}
                      </p>
                    )}
                    <p className="text-caption text-ul-text-muted mt-1">
                      {formatRelativeTime(agent.updated_at)}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Empty state when no agents */}
        {selectedProjectDir && activeAgents.length === 0 && recentAgents.length === 0 && (
          <div className="text-center py-8">
            <p className="text-small text-ul-text-muted">
              No agents yet. Create one from the sidebar or assign an agent to a kanban card.
            </p>
          </div>
        )}
      </div>

      {/* Card detail modal */}
      {selectedCard && (
        <CardDetailModal
          card={selectedCard}
          agents={agents}
          onUpdate={handleCardUpdate}
          onDelete={handleCardDelete}
          onCreateAgent={handleCreateAgentFromCard}
          onClose={() => setSelectedCard(null)}
        />
      )}

      {/* Create agent modal (from kanban card) */}
      {createAgentCard && (
        <CreateAgentModal
          card={createAgentCard}
          defaultModel="anthropic/claude-sonnet-4"
          onCreateAndStart={handleCreateAndStartAgent}
          onClose={() => setCreateAgentCard(null)}
        />
      )}
    </div>
  );
}
