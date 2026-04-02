// Two-model selector: Interpreter (Flash) → Heavy (Sonnet).
// Stacked rows with separate dropdowns for each slot.

import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchModels, type ModelInfo } from '../lib/api';
import {
  getInterpreterModel, setInterpreterModel,
  getHeavyModel, setHeavyModel,
} from '../lib/storage';

type Slot = 'interpreter' | 'heavy';

const displayName = (id: string) => {
  const parts = id.split('/');
  const name = parts.length > 1 ? parts[1] : id;
  return name.replace(/:nitro$/, '');
};

export default function ModelSelector() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [interpreter, setInterp] = useState(getInterpreterModel());
  const [heavy, setHeavy] = useState(getHeavyModel());
  const [editingSlot, setEditingSlot] = useState<Slot | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchModels()
      .then(m => setModels(m))
      .catch(() => {
        setModels([
          { id: 'google/gemini-3.1-flash-lite-preview:nitro', name: 'gemini-3.1-flash-lite-preview', provider: 'google' },
          { id: 'anthropic/claude-sonnet-4', name: 'claude-sonnet-4', provider: 'anthropic' },
          { id: 'anthropic/claude-3.5-sonnet', name: 'claude-3.5-sonnet', provider: 'anthropic' },
          { id: 'openai/gpt-4o', name: 'gpt-4o', provider: 'openai' },
          { id: 'deepseek/deepseek-chat', name: 'deepseek-chat', provider: 'deepseek' },
        ]);
      });
  }, []);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setEditingSlot(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleSelect = useCallback((id: string) => {
    if (editingSlot === 'interpreter') {
      setInterp(id);
      setInterpreterModel(id);
    } else {
      setHeavy(id);
      setHeavyModel(id);
    }
    setOpen(false);
    setEditingSlot(null);
    setInputValue('');
  }, [editingSlot]);

  const startEditing = useCallback((slot: Slot) => {
    setEditingSlot(slot);
    setInputValue(slot === 'interpreter' ? interpreter : heavy);
    setOpen(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }, [interpreter, heavy]);

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      const val = inputValue.trim();
      if (val) handleSelect(val);
    } else if (e.key === 'Escape') {
      setEditingSlot(null);
      setOpen(false);
      setInputValue('');
    }
  }, [inputValue, handleSelect]);

  const filteredModels = inputValue.trim()
    ? models.filter(m =>
        m.id.toLowerCase().includes(inputValue.toLowerCase()) ||
        m.name.toLowerCase().includes(inputValue.toLowerCase())
      )
    : models;

  const inputMatchesKnown = models.some(m => m.id === inputValue.trim());
  const showCustomOption = inputValue.trim() && !inputMatchesKnown;
  const currentSelected = editingSlot === 'interpreter' ? interpreter : heavy;

  return (
    <div className="relative" ref={ref}>
      <div className="flex flex-col gap-1">
        {/* Flash (Interpreter) row */}
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />
          <span className="text-caption text-ul-text-muted w-9 flex-shrink-0">Flash</span>
          {editingSlot === 'interpreter' ? (
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={e => { setInputValue(e.target.value); setOpen(true); }}
              onKeyDown={handleInputKeyDown}
              placeholder="interpreter model"
              autoFocus
              className="flex-1 text-caption font-mono rounded border border-ul-border-focus px-2 py-0.5 bg-white focus:outline-none"
            />
          ) : (
            <button
              onClick={() => startEditing('interpreter')}
              className="flex-1 text-left btn-ghost px-2 py-0.5 font-mono text-caption rounded hover:bg-ul-bg-hover truncate"
              title={interpreter}
            >
              {displayName(interpreter)}
            </button>
          )}
        </div>

        {/* Heavy (Sonnet) row */}
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-ul-success flex-shrink-0" />
          <span className="text-caption text-ul-text-muted w-9 flex-shrink-0">Heavy</span>
          {editingSlot === 'heavy' ? (
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={e => { setInputValue(e.target.value); setOpen(true); }}
              onKeyDown={handleInputKeyDown}
              placeholder="heavy model"
              autoFocus
              className="flex-1 text-caption font-mono rounded border border-ul-border-focus px-2 py-0.5 bg-white focus:outline-none"
            />
          ) : (
            <button
              onClick={() => startEditing('heavy')}
              className="flex-1 text-left btn-ghost px-2 py-0.5 font-mono text-caption rounded hover:bg-ul-bg-hover truncate"
              title={heavy}
            >
              {displayName(heavy)}
            </button>
          )}
        </div>
      </div>

      {/* Dropdown */}
      {open && editingSlot && (
        <div className="absolute top-full right-0 mt-1 w-72 bg-white border border-ul-border rounded-lg shadow-md z-50 py-1 max-h-72 overflow-y-auto">
          <div className="px-3 py-1.5 border-b border-ul-border">
            <p className="text-[10px] text-ul-text-muted font-semibold uppercase tracking-wide">
              {editingSlot === 'interpreter' ? '🔍 Flash (context resolution)' : '⚡ Heavy (code generation)'}
            </p>
          </div>

          {showCustomOption && (
            <button
              onClick={() => handleSelect(inputValue.trim())}
              className="w-full text-left px-3 py-2 hover:bg-ul-bg-hover border-b border-ul-border"
            >
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded shrink-0">use</span>
                <span className="text-small text-ul-text font-mono truncate">{inputValue.trim()}</span>
              </div>
            </button>
          )}

          {filteredModels.map(model => (
            <button
              key={model.id}
              onClick={() => handleSelect(model.id)}
              className={`w-full text-left px-3 py-2 flex items-center justify-between transition-colors ${
                model.id === currentSelected ? 'bg-ul-bg-active' : 'hover:bg-ul-bg-hover'
              }`}
            >
              <div className="min-w-0">
                <span className="text-small text-ul-text font-mono">{model.name}</span>
              </div>
              {model.id === currentSelected && (
                <svg className="w-4 h-4 text-ul-text shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          ))}

          {filteredModels.length === 0 && !showCustomOption && (
            <p className="text-caption text-ul-text-muted text-center py-3">No matching models</p>
          )}

          {!inputValue.trim() && (
            <div className="px-3 py-1.5 border-t border-ul-border">
              <p className="text-[10px] text-ul-text-muted">
                Paste any OpenRouter model ID
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
