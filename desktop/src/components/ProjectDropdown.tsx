// Project dropdown — selects the active project directory.
// Shows directory name + path, lists recent projects from localStorage,
// and allows picking a new folder via native dialog.

import { useState, useRef, useEffect, useCallback } from 'react';
import { open } from '@tauri-apps/plugin-dialog';

// ── Storage ──

const STORAGE_KEY = 'ul_recent_projects';
const MAX_RECENT = 8;

function getRecentProjects(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function addRecentProject(dir: string) {
  try {
    const recent = getRecentProjects().filter(p => p !== dir);
    recent.unshift(dir);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
  } catch {
    // ignore
  }
}

// ── Helpers ──

function dirName(path: string): string {
  return path.split('/').pop() || path;
}

function shortenPath(path: string): string {
  // Replace home dir with ~
  const home = '/Users/';
  if (path.startsWith(home)) {
    const rest = path.slice(home.length);
    const firstSlash = rest.indexOf('/');
    if (firstSlash >= 0) {
      return '~' + rest.slice(firstSlash);
    }
    return '~';
  }
  return path;
}

// ── Component ──

interface ProjectDropdownProps {
  selectedDir: string | null;
  onSelect: (dir: string | null) => void;
  /** Open the dropdown upward (for placement near bottom of screen) */
  dropUp?: boolean;
  /** Compact inline style — small text, no bordered button wrapper */
  compact?: boolean;
}

export default function ProjectDropdown({ selectedDir, onSelect, dropUp = false, compact = false }: ProjectDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const recentProjects = getRecentProjects();

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  const handlePickFolder = useCallback(async () => {
    setIsOpen(false);
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Project Directory',
      });
      if (selected && typeof selected === 'string') {
        addRecentProject(selected);
        onSelect(selected);
      }
    } catch (err) {
      console.error('[ProjectDropdown] Folder picker error:', err);
    }
  }, [onSelect]);

  const handleSelectProject = useCallback((dir: string) => {
    addRecentProject(dir);
    onSelect(dir);
    setIsOpen(false);
  }, [onSelect]);

  return (
    <div ref={dropdownRef} className="relative">
      {/* Trigger button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={compact
          ? 'flex items-center gap-1.5 px-1.5 py-0.5 rounded hover:bg-gray-100 transition-colors max-w-[260px]'
          : 'flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-gray-100 transition-colors max-w-[300px]'
        }
      >
        {compact && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-500 flex-shrink-0">
            <rect x="2" y="3" width="20" height="18" rx="2" ry="2"/><line x1="2" y1="9" x2="22" y2="9"/>
          </svg>
        )}
        <span className={compact
          ? `text-caption font-normal truncate text-gray-500`
          : 'text-small text-ul-text-muted truncate'
        }>
          {selectedDir ? shortenPath(selectedDir) : (compact ? 'No project selected' : 'Select a project...')}
        </span>

        {/* Chevron — only in non-compact mode */}
        {!compact && (
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-ul-text-muted flex-shrink-0">
            <path d="M3 4.5L6 7.5L9 4.5" />
          </svg>
        )}
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div className={`absolute ${dropUp ? 'bottom-full mb-1' : 'top-full mt-1'} left-0 min-w-[280px] bg-white border border-ul-border rounded-lg shadow-lg z-40 py-1`}>
          {/* Recent projects */}
          {recentProjects.length > 0 && (
            <>
              <div className="px-3 py-1.5">
                <span className="text-caption font-medium text-ul-text-muted uppercase tracking-wider">
                  Recent Projects
                </span>
              </div>
              {recentProjects.map(dir => (
                <button
                  key={dir}
                  onClick={() => handleSelectProject(dir)}
                  className={`w-full text-left px-3 py-2 hover:bg-gray-50 transition-colors ${
                    dir === selectedDir ? 'bg-blue-50' : ''
                  }`}
                >
                  <div className="text-small font-medium text-ul-text truncate">
                    {dirName(dir)}
                  </div>
                  <div className="text-caption text-ul-text-muted truncate">
                    {shortenPath(dir)}
                  </div>
                </button>
              ))}
              <div className="border-t border-ul-border my-1" />
            </>
          )}

          {/* New project */}
          <button
            onClick={handlePickFolder}
            className="w-full text-left px-3 py-2 hover:bg-gray-50 transition-colors flex items-center gap-2"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-ul-text-secondary">
              <line x1="7" y1="2" x2="7" y2="12" />
              <line x1="2" y1="7" x2="12" y2="7" />
            </svg>
            <span className="text-small text-ul-text-secondary">Open Folder...</span>
          </button>
        </div>
      )}
    </div>
  );
}
