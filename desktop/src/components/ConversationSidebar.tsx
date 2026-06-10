// Conversation sidebar — list of past conversations with search.

import { useState, useRef, useEffect } from 'react';
import type { Conversation } from '../hooks/useConversations';

interface ConversationSidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  isOpen: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onSearch: (query: string) => void;
  onClose: () => void;
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

export default function ConversationSidebar({
  conversations,
  activeId,
  isOpen,
  onSelect,
  onNew,
  onDelete,
  onSearch,
  onClose,
}: ConversationSidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Focus search on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => searchRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const handleSearch = (value: string) => {
    setSearchQuery(value);
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      onSearch(value);
    }, 300);
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirmDelete === id) {
      onDelete(id);
      setConfirmDelete(null);
    } else {
      setConfirmDelete(id);
      // Reset confirm after 3s
      setTimeout(() => setConfirmDelete(null), 3000);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="flex flex-col w-64 h-full border-r border-ul-border bg-gray-50 flex-shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-ul-border">
        <span className="text-small font-medium text-ul-text">Conversations</span>
        <div className="flex items-center gap-1">
          <button
            onClick={onNew}
            className="p-1 rounded hover:bg-gray-200 text-ul-text-secondary"
            title="New conversation"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <line x1="8" y1="3" x2="8" y2="13" />
              <line x1="3" y1="8" x2="13" y2="8" />
            </svg>
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-200 text-ul-text-secondary"
            title="Close sidebar"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <line x1="4" y1="4" x2="12" y2="12" />
              <line x1="12" y1="4" x2="4" y2="12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-ul-border">
        <input
          ref={searchRef}
          type="text"
          value={searchQuery}
          onChange={e => handleSearch(e.target.value)}
          placeholder="Search conversations..."
          className="w-full px-2 py-1 text-small rounded border border-ul-border bg-white focus:outline-none focus:border-ul-primary"
        />
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <div className="px-3 py-8 text-center text-caption text-ul-text-muted">
            {searchQuery ? 'No conversations found' : 'No conversations yet'}
          </div>
        ) : (
          conversations.map(conv => (
            <button
              key={conv.id}
              onClick={() => onSelect(conv.id)}
              className={`
                w-full text-left px-3 py-2 border-b border-gray-100
                hover:bg-gray-100 transition-colors group
                ${activeId === conv.id ? 'bg-blue-50 border-l-2 border-l-ul-primary' : ''}
              `}
            >
              <div className="flex items-start justify-between gap-1">
                <span className="text-small font-medium text-ul-text truncate flex-1">
                  {conv.title}
                </span>
                <button
                  onClick={e => handleDelete(e, conv.id)}
                  className={`
                    p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0
                    ${confirmDelete === conv.id
                      ? 'opacity-100 text-red-500 hover:text-red-700'
                      : 'text-ul-text-muted hover:text-ul-text-secondary'
                    }
                  `}
                  title={confirmDelete === conv.id ? 'Click again to delete' : 'Delete conversation'}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <line x1="3" y1="3" x2="9" y2="9" />
                    <line x1="9" y1="3" x2="3" y2="9" />
                  </svg>
                </button>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-caption text-ul-text-muted">
                  {formatRelativeTime(conv.updated_at)}
                </span>
                <span className="text-caption text-ul-text-muted">
                  {conv.message_count} msg{conv.message_count !== 1 ? 's' : ''}
                </span>
              </div>
              {conv.last_message_preview && (
                <p className="text-caption text-ul-text-muted mt-0.5 truncate">
                  {conv.last_message_preview}
                </p>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
