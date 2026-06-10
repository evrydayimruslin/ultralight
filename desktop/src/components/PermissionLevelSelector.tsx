// Permission level selector — dropdown in the header for switching permission modes.
// Similar pattern to ModelSelector.

import { useState, useRef, useEffect } from 'react';
import { type PermissionLevel, PERMISSION_LEVELS } from '../lib/permissions';

interface PermissionLevelSelectorProps {
  level: PermissionLevel;
  onLevelChange: (level: PermissionLevel) => void;
}

export default function PermissionLevelSelector({
  level,
  onLevelChange,
}: PermissionLevelSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const current = PERMISSION_LEVELS.find(l => l.value === level);

  // Color coding for the level indicator
  const levelColors: Record<PermissionLevel, string> = {
    ask: 'bg-amber-400',
    auto_edit: 'bg-emerald-400',
    plan: 'bg-blue-400',
    bypass: 'bg-red-400',
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-ul-bg-hover transition-colors"
        title={`Permission level: ${current?.label}`}
      >
        {/* Status dot */}
        <div className={`w-2 h-2 rounded-full ${levelColors[level]}`} />
        <span className="text-caption text-ul-text-secondary">
          {current?.label || level}
        </span>
        <svg
          className={`w-3 h-3 text-ul-text-muted transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-white rounded-lg shadow-lg border border-ul-border z-40 py-1">
          {PERMISSION_LEVELS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                onLevelChange(opt.value);
                setOpen(false);
              }}
              className={`w-full flex items-start gap-2.5 px-3 py-2 text-left hover:bg-ul-bg-hover transition-colors ${
                opt.value === level ? 'bg-ul-bg-subtle' : ''
              }`}
            >
              <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${levelColors[opt.value]}`} />
              <div>
                <div className="text-small font-medium text-ul-text">
                  {opt.label}
                </div>
                <div className="text-caption text-ul-text-muted">
                  {opt.description}
                </div>
              </div>
              {opt.value === level && (
                <svg className="w-4 h-4 text-ul-text ml-auto mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
