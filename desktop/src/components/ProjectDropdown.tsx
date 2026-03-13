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
}

export default function ProjectDropdown({ selectedDir, onSelect }: ProjectDropdownProps) {
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
        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-ul-border bg-white hover:bg-gray-50 transition-colors min-w-[200px] max-w-[400px]"
      >
        {/* Folder icon */}
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-ul-text-secondary flex-shrink-0">
          <path d="M2 4.5V12.5C2 13.0523 2.44772 13.5 3 13.5H13C13.5523 13.5 14 13.0523 14 12.5V6.5C14 5.94772 13.5523 5.5 13 5.5H8L6.5 3.5H3C2.44772 3.5 2 3.94772 2 4.5Z" />
        </svg>

        {selectedDir ? (
          <div className="flex flex-col items-start min-w-0 flex-1">
            <span className="text-small font-medium text-ul-text truncate w-full text-left">
              {dirName(selectedDir)}
            </span>
            <span className="text-caption text-ul-text-muted truncate w-full text-left">
              {shortenPath(selectedDir)}
            </span>
          </div>
        ) : (
          <span className="text-small text-ul-text-secondary">Select a project...</span>
        )}

        {/* Chevron */}
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-ul-text-muted flex-shrink-0">
          <path d="M3 4.5L6 7.5L9 4.5" />
        </svg>
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-full min-w-[280px] bg-white border border-ul-border rounded-lg shadow-lg z-40 py-1">
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
