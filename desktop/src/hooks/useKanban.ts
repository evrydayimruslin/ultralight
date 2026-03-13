// Kanban board data hook.
// Loads/auto-creates a board for a given project directory.
// Wraps Rust kanban CRUD commands.

import { useState, useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';

// ── Types ──

export interface KanbanBoard {
  id: string;
  name: string;
  project_dir: string | null;
  created_at: number;
  updated_at: number;
}

export interface KanbanColumn {
  id: string;
  board_id: string;
  name: string;
  position: number;
  created_at: number;
}

export interface KanbanCard {
  id: string;
  column_id: string;
  title: string;
  description: string | null;
  acceptance_criteria: string | null;
  assigned_agent_id: string | null;
  status: string;
  position: number;
  created_at: number;
  updated_at: number;
}

export interface CardReport {
  id: string;
  card_id: string;
  agent_id: string;
  report_type: 'plan' | 'progress' | 'completion' | 'handoff';
  content: string;
  created_at: number;
}

export interface UseKanbanReturn {
  /** Current board (null if loading or no project) */
  board: KanbanBoard | null;
  /** Columns for the current board, ordered by position */
  columns: KanbanColumn[];
  /** All cards across all columns */
  cards: KanbanCard[];
  /** Whether the board is loading */
  loading: boolean;
  /** Create a new card in a column */
  createCard: (columnId: string, title: string, description?: string) => Promise<KanbanCard>;
  /** Update card fields */
  updateCard: (id: string, updates: Partial<Pick<KanbanCard, 'column_id' | 'title' | 'description' | 'acceptance_criteria' | 'position' | 'assigned_agent_id' | 'status'>>) => Promise<void>;
  /** Move a card to a different column (with position) */
  moveCard: (cardId: string, targetColumnId: string, position: number) => Promise<void>;
  /** Delete a card */
  deleteCard: (id: string) => Promise<void>;
  /** Assign an agent to a card */
  assignAgent: (cardId: string, agentId: string | null) => Promise<void>;
  /** Refresh board data from DB */
  refreshBoard: () => Promise<void>;
  /** Load reports for a card (chronological) */
  loadReports: (cardId: string) => Promise<CardReport[]>;
  /** Create a report on a card */
  createReport: (cardId: string, agentId: string, reportType: CardReport['report_type'], content: string) => Promise<CardReport>;
}

// ── Hook ──

export function useKanban(projectDir: string | null): UseKanbanReturn {
  const [board, setBoard] = useState<KanbanBoard | null>(null);
  const [columns, setColumns] = useState<KanbanColumn[]>([]);
  const [cards, setCards] = useState<KanbanCard[]>([]);
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);

  // Load or auto-create board for project
  const loadBoard = useCallback(async (dir: string) => {
    setLoading(true);
    try {
      // Check if board exists for this project
      const boards = await invoke<KanbanBoard[]>('db_list_boards', { projectDir: dir });
      let currentBoard: KanbanBoard;

      if (boards.length > 0) {
        currentBoard = boards[0]; // Use most recent board
      } else {
        // Auto-create a board with default columns
        const id = crypto.randomUUID();
        const name = dir.split('/').pop() || 'Project';
        currentBoard = await invoke<KanbanBoard>('db_create_board', {
          id,
          name,
          projectDir: dir,
        });
      }

      if (!mountedRef.current) return;
      setBoard(currentBoard);

      // Load columns + cards
      const [cols, allCards] = await Promise.all([
        invoke<KanbanColumn[]>('db_list_columns', { boardId: currentBoard.id }),
        invoke<KanbanCard[]>('db_list_cards', { boardId: currentBoard.id }),
      ]);

      if (!mountedRef.current) return;
      setColumns(cols);
      setCards(allCards);
    } catch (err) {
      console.error('[useKanban] Failed to load board:', err);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  // Refresh columns + cards (without re-creating board)
  const refreshBoard = useCallback(async () => {
    if (!board) return;
    try {
      const [cols, allCards] = await Promise.all([
        invoke<KanbanColumn[]>('db_list_columns', { boardId: board.id }),
        invoke<KanbanCard[]>('db_list_cards', { boardId: board.id }),
      ]);
      if (mountedRef.current) {
        setColumns(cols);
        setCards(allCards);
      }
    } catch (err) {
      console.error('[useKanban] Failed to refresh board:', err);
    }
  }, [board]);

  // Load board when project dir changes
  useEffect(() => {
    mountedRef.current = true;
    if (projectDir) {
      loadBoard(projectDir);
    } else {
      setBoard(null);
      setColumns([]);
      setCards([]);
    }
    return () => { mountedRef.current = false; };
  }, [projectDir, loadBoard]);

  // Create card
  const createCard = useCallback(async (
    columnId: string,
    title: string,
    description?: string,
  ): Promise<KanbanCard> => {
    const id = crypto.randomUUID();
    // Position at end: count existing cards in this column
    const existingInColumn = cards.filter(c => c.column_id === columnId);
    const position = existingInColumn.length;

    const card = await invoke<KanbanCard>('db_create_card', {
      id,
      columnId,
      title,
      description: description ?? null,
      acceptanceCriteria: null,
      position,
    });

    // Optimistic add
    setCards(prev => [...prev, card]);
    return card;
  }, [cards]);

  // Update card
  const updateCard = useCallback(async (
    id: string,
    updates: Partial<Pick<KanbanCard, 'column_id' | 'title' | 'description' | 'acceptance_criteria' | 'position' | 'assigned_agent_id' | 'status'>>,
  ) => {
    await invoke('db_update_card', {
      id,
      columnId: updates.column_id ?? null,
      title: updates.title ?? null,
      description: updates.description ?? null,
      acceptanceCriteria: updates.acceptance_criteria ?? null,
      position: updates.position ?? null,
      assignedAgentId: updates.assigned_agent_id ?? null,
      status: updates.status ?? null,
    });

    // Optimistic update
    setCards(prev => prev.map(c =>
      c.id === id ? { ...c, ...updates, updated_at: Date.now() } : c
    ));
  }, []);

  // Move card to different column
  const moveCard = useCallback(async (cardId: string, targetColumnId: string, position: number) => {
    await invoke('db_update_card', {
      id: cardId,
      columnId: targetColumnId,
      title: null,
      description: null,
      acceptanceCriteria: null,
      position,
      assignedAgentId: null,
      status: null,
    });

    // Optimistic update
    setCards(prev => prev.map(c =>
      c.id === cardId ? { ...c, column_id: targetColumnId, position, updated_at: Date.now() } : c
    ));
  }, []);

  // Delete card
  const deleteCard = useCallback(async (id: string) => {
    await invoke('db_delete_card', { id });
    setCards(prev => prev.filter(c => c.id !== id));
  }, []);

  // Assign agent to card
  const assignAgent = useCallback(async (cardId: string, agentId: string | null) => {
    await invoke('db_update_card', {
      id: cardId,
      columnId: null,
      title: null,
      description: null,
      acceptanceCriteria: null,
      position: null,
      assignedAgentId: agentId,
      status: null,
    });

    setCards(prev => prev.map(c =>
      c.id === cardId ? { ...c, assigned_agent_id: agentId, updated_at: Date.now() } : c
    ));
  }, []);

  // Load reports for a card
  const loadReports = useCallback(async (cardId: string): Promise<CardReport[]> => {
    try {
      return await invoke<CardReport[]>('db_list_card_reports', { cardId });
    } catch (err) {
      console.error('[useKanban] Failed to load reports:', err);
      return [];
    }
  }, []);

  // Create a report on a card
  const createReport = useCallback(async (
    cardId: string,
    agentId: string,
    reportType: CardReport['report_type'],
    content: string,
  ): Promise<CardReport> => {
    const id = crypto.randomUUID();
    return await invoke<CardReport>('db_create_card_report', {
      id,
      cardId,
      agentId,
      reportType,
      content,
    });
  }, []);

  return {
    board,
    columns,
    cards,
    loading,
    createCard,
    updateCard,
    moveCard,
    deleteCard,
    assignAgent,
    refreshBoard,
    loadReports,
    createReport,
  };
}
