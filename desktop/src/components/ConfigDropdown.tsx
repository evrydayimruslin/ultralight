// Reusable dropdown for config panel — supports search, descriptions, and custom entries.

import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';

export interface DropdownOption {
  value: string;
  label: string;
  description?: string;
  icon?: ReactNode;
}

interface ConfigDropdownProps {
  /** The trigger content rendered as a clickable row */
  trigger: ReactNode;
  /** Available options */
  options: DropdownOption[];
  /** Currently selected value */
  selected?: string;
  /** Called when an option is selected */
  onSelect: (value: string) => void;
  /** Show search/filter input */
  searchable?: boolean;
  /** Placeholder for search input */
  searchPlaceholder?: string;
  /** Allow typing a custom value not in the list */
  allowCustom?: boolean;
  /** Custom label for the "use custom" row */
  customLabel?: string;
  /** Width of the dropdown (default: w-72) */
  width?: string;
  /** Additional class for the trigger wrapper */
  triggerClass?: string;
}

export default function ConfigDropdown({
  trigger,
  options,
  selected,
  onSelect,
  searchable = false,
  searchPlaceholder = 'Search...',
  allowCustom = false,
  customLabel = 'Use',
  width = 'w-72',
  triggerClass = '',
}: ConfigDropdownProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        ref.current && !ref.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Focus search input when opened
  useEffect(() => {
    if (open && searchable) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open, searchable]);

  const handleSelect = useCallback((value: string) => {
    onSelect(value);
    setOpen(false);
    setQuery('');
  }, [onSelect]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
    } else if (e.key === 'Enter' && query.trim()) {
      if (allowCustom) {
        handleSelect(query.trim());
      } else {
        const match = filtered[0];
        if (match) handleSelect(match.value);
      }
    }
  }, [query, allowCustom, handleSelect]);

  const filtered = query.trim()
    ? options.filter(o =>
        o.label.toLowerCase().includes(query.toLowerCase()) ||
        o.value.toLowerCase().includes(query.toLowerCase()) ||
        (o.description || '').toLowerCase().includes(query.toLowerCase())
      )
    : options;

  const showCustom = allowCustom && query.trim() && !options.some(o => o.value === query.trim());

  const handleOpen = useCallback(() => {
    if (open) {
      setOpen(false);
      setQuery('');
      return;
    }
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left });
    }
    setOpen(true);
  }, [open]);

  return (
    <div ref={ref}>
      {/* Trigger */}
      <div
        ref={triggerRef}
        onClick={handleOpen}
        className={`cursor-pointer ${triggerClass}`}
      >
        {trigger}
      </div>

      {/* Dropdown — fixed position to escape overflow clipping */}
      {open && pos && (
        <div
          ref={dropdownRef}
          className={`fixed ${width} bg-white border border-gray-200 shadow-lg z-[100] max-h-96 flex flex-col`}
          style={{ top: pos.top, left: pos.left }}
        >
          {/* Search */}
          {searchable && (
            <div className="p-2 border-b border-gray-100">
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={searchPlaceholder}
                className="w-full px-2 py-1 text-[12px] font-mono rounded border border-gray-200 bg-gray-50 focus:outline-none focus:border-gray-300 focus:bg-white placeholder:text-gray-300"
              />
            </div>
          )}

          {/* Options */}
          <div className="overflow-y-auto flex-1">
            {/* Custom entry */}
            {showCustom && (
              <button
                onClick={() => handleSelect(query.trim())}
                className="w-full text-left px-3 py-1.5 hover:bg-gray-50 transition-colors border-b border-gray-100"
              >
                <span className="text-[11px] text-gray-400 mr-1.5">{customLabel}</span>
                <span className="text-[12px] font-mono text-gray-600">{query.trim()}</span>
              </button>
            )}

            {filtered.map(option => (
              <button
                key={option.value}
                onClick={() => handleSelect(option.value)}
                className={`w-full text-left px-3 py-1.5 flex items-center gap-2 transition-colors ${
                  option.value === selected ? 'bg-gray-50' : 'hover:bg-gray-50'
                }`}
              >
                {option.icon && <span className="shrink-0">{option.icon}</span>}
                <div className="flex-1 min-w-0">
                  <span className="text-[12px] font-mono text-gray-600 truncate block">{option.label}</span>
                  {option.description && (
                    <span className="text-[11px] text-gray-400 truncate block">{option.description}</span>
                  )}
                </div>
                {option.value === selected && (
                  <svg className="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            ))}

            {filtered.length === 0 && !showCustom && (
              <p className="text-[11px] text-gray-300 text-center py-3">No matches</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
