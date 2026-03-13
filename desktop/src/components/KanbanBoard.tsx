// Kanban board — horizontal column layout with drag-and-drop cards.
// Receives data from useKanban hook, renders columns side-by-side.

import { useState, useCallback } from 'react';
import type { KanbanColumn, KanbanCard as KanbanCardType } from '../hooks/useKanban';
import type { Agent } from '../hooks/useAgentFleet';
import KanbanCard from './KanbanCard';

interface KanbanBoardProps {
  columns: KanbanColumn[];
  cards: KanbanCardType[];
  agents: Agent[];
  onCreateCard: (columnId: string, title: string) => Promise<void>;
  onMoveCard: (cardId: string, targetColumnId: string, position: number) => Promise<void>;
  onCardClick: (card: KanbanCardType) => void;
}

// ── Column Component ──

interface ColumnProps {
  column: KanbanColumn;
  cards: KanbanCardType[];
  agents: Agent[];
  onCreateCard: (columnId: string, title: string) => Promise<void>;
  onMoveCard: (cardId: string, targetColumnId: string, position: number) => Promise<void>;
  onCardClick: (card: KanbanCardType) => void;
}

function Column({ column, cards, agents, onCreateCard, onMoveCard, onCardClick }: ColumnProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const handleAdd = useCallback(async () => {
    const title = newTitle.trim();
    if (!title) return;
    await onCreateCard(column.id, title);
    setNewTitle('');
    setIsAdding(false);
  }, [newTitle, column.id, onCreateCard]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    } else if (e.key === 'Escape') {
      setIsAdding(false);
      setNewTitle('');
    }
  }, [handleAdd]);

  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const cardId = e.dataTransfer.getData('text/plain');
    if (cardId) {
      // Drop at end of column
      onMoveCard(cardId, column.id, cards.length);
    }
  }, [column.id, cards.length, onMoveCard]);

  // Sort cards by position
  const sortedCards = [...cards].sort((a, b) => a.position - b.position);

  return (
    <div
      className={`flex flex-col w-64 flex-shrink-0 rounded-lg transition-colors ${
        dragOver ? 'bg-blue-50 ring-2 ring-blue-200' : 'bg-gray-50'
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Column header */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <h3 className="text-small font-medium text-ul-text">{column.name}</h3>
          <span className="text-caption text-ul-text-muted bg-gray-200 px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
            {cards.length}
          </span>
        </div>
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2 min-h-[60px]">
        {sortedCards.map(card => (
          <KanbanCard
            key={card.id}
            card={card}
            assignedAgent={card.assigned_agent_id
              ? agents.find(a => a.id === card.assigned_agent_id) ?? null
              : null
            }
            onClick={onCardClick}
          />
        ))}

        {/* Add card inline */}
        {isAdding ? (
          <div className="bg-white rounded-lg border border-ul-border p-2">
            <input
              autoFocus
              type="text"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={() => {
                if (!newTitle.trim()) {
                  setIsAdding(false);
                }
              }}
              placeholder="Card title..."
              className="w-full text-small text-ul-text border-none outline-none bg-transparent"
            />
            <div className="flex items-center gap-1 mt-1.5">
              <button
                onClick={handleAdd}
                disabled={!newTitle.trim()}
                className="text-caption px-2 py-0.5 rounded bg-ul-accent text-white hover:bg-ul-accent-hover disabled:opacity-40 transition-colors"
              >
                Add
              </button>
              <button
                onClick={() => { setIsAdding(false); setNewTitle(''); }}
                className="text-caption px-2 py-0.5 rounded hover:bg-gray-100 text-ul-text-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setIsAdding(true)}
            className="w-full text-left px-2 py-1.5 text-caption text-ul-text-muted hover:text-ul-text-secondary hover:bg-white rounded transition-colors"
          >
            + Add card
          </button>
        )}
      </div>
    </div>
  );
}

// ── Board Component ──

export default function KanbanBoard({
  columns,
  cards,
  agents,
  onCreateCard,
  onMoveCard,
  onCardClick,
}: KanbanBoardProps) {
  if (columns.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-small text-ul-text-muted">
        No board loaded
      </div>
    );
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {columns.map(col => (
        <Column
          key={col.id}
          column={col}
          cards={cards.filter(c => c.column_id === col.id)}
          agents={agents}
          onCreateCard={onCreateCard}
          onMoveCard={onMoveCard}
          onCardClick={onCardClick}
        />
      ))}
    </div>
  );
}
