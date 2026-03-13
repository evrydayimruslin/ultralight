// Conversation persistence hook — manages conversation list + CRUD via Rust SQLite.

import { useState, useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Message } from './useChat';

// ── Types ──

export interface Conversation {
  id: string;
  title: string;
  model: string;
  project_dir: string | null;
  created_at: number;
  updated_at: number;
  message_count: number;
  last_message_preview: string | null;
}

interface DbMessage {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  tool_calls: string | null;
  tool_call_id: string | null;
  usage: string | null;
  cost_cents: number | null;
  created_at: number;
  sort_order: number;
}

export interface UseConversationsReturn {
  conversations: Conversation[];
  activeId: string | null;
  isLoading: boolean;
  createConversation: (model: string, projectDir: string | null) => Promise<string>;
  loadConversation: (id: string) => Promise<Message[]>;
  switchConversation: (id: string | null) => void;
  saveMessages: (conversationId: string, messages: Message[]) => Promise<void>;
  updateTitle: (id: string, title: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  refreshList: () => Promise<void>;
  searchConversations: (query: string) => Promise<void>;
}

// ── Helpers ──

function messageToDb(msg: Message, conversationId: string, sortOrder: number): DbMessage {
  return {
    id: msg.id,
    conversation_id: conversationId,
    role: msg.role,
    content: msg.content,
    tool_calls: msg.tool_calls ? JSON.stringify(msg.tool_calls) : null,
    tool_call_id: msg.tool_call_id ?? null,
    usage: msg.usage ? JSON.stringify(msg.usage) : null,
    cost_cents: msg.cost_cents ?? null,
    created_at: msg.created_at,
    sort_order: sortOrder,
  };
}

function dbToMessage(db: DbMessage): Message {
  return {
    id: db.id,
    role: db.role as Message['role'],
    content: db.content,
    tool_calls: db.tool_calls ? JSON.parse(db.tool_calls) : undefined,
    tool_call_id: db.tool_call_id ?? undefined,
    usage: db.usage ? JSON.parse(db.usage) : undefined,
    cost_cents: db.cost_cents ?? undefined,
    created_at: db.created_at,
  };
}

/** Generate a title from the first user message */
function autoTitle(messages: Message[]): string {
  const firstUser = messages.find(m => m.role === 'user');
  if (!firstUser) return 'New Conversation';
  const text = firstUser.content.trim();
  if (text.length <= 50) return text;
  // Truncate at word boundary
  const truncated = text.slice(0, 50);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated) + '...';
}

// ── Hook ──

export function useConversations(): UseConversationsReturn {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const savedMessageIds = useRef(new Set<string>());

  // Load conversation list on mount
  useEffect(() => {
    refreshList();
  }, []);

  const refreshList = useCallback(async () => {
    try {
      const list = await invoke<Conversation[]>('db_list_conversations', {
        limit: 50,
      });
      setConversations(list);
    } catch (err) {
      console.error('[useConversations] Failed to load conversations:', err);
    }
  }, []);

  const searchConversations = useCallback(async (query: string) => {
    try {
      const list = await invoke<Conversation[]>('db_list_conversations', {
        limit: 50,
        search: query || null,
      });
      setConversations(list);
    } catch (err) {
      console.error('[useConversations] Search failed:', err);
    }
  }, []);

  const createConversation = useCallback(async (
    model: string,
    projectDir: string | null,
  ): Promise<string> => {
    const id = crypto.randomUUID();
    try {
      await invoke('db_create_conversation', {
        id,
        title: 'New Conversation',
        model,
        projectDir,
      });
      setActiveId(id);
      savedMessageIds.current = new Set();
      await refreshList();
      return id;
    } catch (err) {
      console.error('[useConversations] Failed to create conversation:', err);
      throw err;
    }
  }, [refreshList]);

  const loadConversation = useCallback(async (id: string): Promise<Message[]> => {
    setIsLoading(true);
    try {
      const dbMessages = await invoke<DbMessage[]>('db_load_messages', {
        conversationId: id,
      });
      const messages = dbMessages.map(dbToMessage);
      // Track which messages are already saved
      savedMessageIds.current = new Set(messages.map(m => m.id));
      return messages;
    } catch (err) {
      console.error('[useConversations] Failed to load messages:', err);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  const switchConversation = useCallback((id: string | null) => {
    setActiveId(id);
    savedMessageIds.current = new Set();
  }, []);

  const saveMessages = useCallback(async (
    conversationId: string,
    messages: Message[],
  ) => {
    // Only save messages we haven't saved yet
    const unsaved = messages.filter(m => !savedMessageIds.current.has(m.id));
    if (unsaved.length === 0) return;

    // Calculate sort_order based on position in full array
    const dbMessages: DbMessage[] = [];
    for (const msg of unsaved) {
      const sortOrder = messages.indexOf(msg);
      dbMessages.push(messageToDb(msg, conversationId, sortOrder));
    }

    try {
      await invoke('db_save_messages_batch', { messages: dbMessages });
      for (const msg of unsaved) {
        savedMessageIds.current.add(msg.id);
      }

      // Auto-title from first user message if still "New Conversation"
      const conv = conversations.find(c => c.id === conversationId);
      if (conv && conv.title === 'New Conversation') {
        const title = autoTitle(messages);
        if (title !== 'New Conversation') {
          await updateTitle(conversationId, title);
        }
      }

      // Refresh list to update timestamps and previews
      await refreshList();
    } catch (err) {
      console.error('[useConversations] Failed to save messages:', err);
    }
  }, [conversations, refreshList]);

  const updateTitle = useCallback(async (id: string, title: string) => {
    try {
      await invoke('db_update_conversation', { id, title });
      await refreshList();
    } catch (err) {
      console.error('[useConversations] Failed to update title:', err);
    }
  }, [refreshList]);

  const deleteConversation = useCallback(async (id: string) => {
    try {
      await invoke('db_delete_conversation', { id });
      if (activeId === id) {
        setActiveId(null);
        savedMessageIds.current = new Set();
      }
      await refreshList();
    } catch (err) {
      console.error('[useConversations] Failed to delete conversation:', err);
    }
  }, [activeId, refreshList]);

  return {
    conversations,
    activeId,
    isLoading,
    createConversation,
    loadConversation,
    switchConversation,
    saveMessages,
    updateTitle,
    deleteConversation,
    refreshList,
    searchConversations,
  };
}
