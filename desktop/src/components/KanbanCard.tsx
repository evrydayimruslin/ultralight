// Kanban card — individual task card within a column.
// Supports drag-and-drop via HTML5 Drag API.

import type { KanbanCard as KanbanCardType } from '../hooks/useKanban';
import type { Agent } from '../hooks/useAgentFleet';

interface KanbanCardProps {
  card: KanbanCardType;
  assignedAgent: Agent | null;
  onClick: (card: KanbanCardType) => void;
}

// ── Helpers ──

function statusBadge(status: string): { bg: string; text: string; label: string } {
  switch (status) {
    case 'in_progress':
      return { bg: 'bg-blue-100', text: 'text-blue-700', label: 'In Progress' };
    case 'done':
      return { bg: 'bg-green-100', text: 'text-green-700', label: 'Done' };
    case 'todo':
    default:
      return { bg: 'bg-gray-100', text: 'text-gray-600', label: 'Todo' };
  }
}

// ── Component ──

export default function KanbanCard({ card, assignedAgent, onClick }: KanbanCardProps) {
  const badge = statusBadge(card.status);

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', card.id);
    e.dataTransfer.effectAllowed = 'move';
    // Add visual feedback
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '0.5';
    }
  };

  const handleDragEnd = (e: React.DragEvent) => {
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '1';
    }
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={() => onClick(card)}
      className="bg-white rounded-lg border border-ul-border p-3 cursor-pointer hover:shadow-sm hover:border-gray-300 transition-all group"
    >
      {/* Title */}
      <h4 className="text-small font-medium text-ul-text leading-snug">
        {card.title}
      </h4>

      {/* Description peek */}
      {card.description && (
        <p className="text-caption text-ul-text-muted mt-1 line-clamp-2">
          {card.description}
        </p>
      )}

      {/* Footer: status badge + assigned agent */}
      <div className="flex items-center gap-2 mt-2">
        {/* Status badge */}
        <span className={`text-caption px-1.5 py-0.5 rounded ${badge.bg} ${badge.text}`}>
          {badge.label}
        </span>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Assigned agent pill */}
        {assignedAgent && (
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-100 max-w-[120px]">
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
              assignedAgent.status === 'running' ? 'bg-green-500' :
              assignedAgent.status === 'completed' ? 'bg-blue-400' :
              assignedAgent.status === 'error' ? 'bg-red-500' : 'bg-gray-400'
            }`} />
            <span className="text-caption text-ul-text-secondary truncate">
              {assignedAgent.name}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
