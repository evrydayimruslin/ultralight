// Model selector — free-text input with suggestion dropdown.
// Users can paste any OpenRouter model ID (e.g. "qwen/qwen3-35b")
// or pick from fetched/fallback suggestions.

import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchModels, type ModelInfo } from '../lib/api';
import { getModel, setModel } from '../lib/storage';

export default function ModelSelector() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selected, setSelected] = useState(getModel());
  const [inputValue, setInputValue] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch models on mount
  useEffect(() => {
    fetchModels()
      .then(m => setModels(m))
      .catch(() => {
        setModels([
          { id: 'anthropic/claude-sonnet-4-20250514', name: 'claude-sonnet-4-20250514', provider: 'anthropic' },
          { id: 'anthropic/claude-3.5-sonnet', name: 'claude-3.5-sonnet', provider: 'anthropic' },
          { id: 'openai/gpt-4o', name: 'gpt-4o', provider: 'openai' },
          { id: 'deepseek/deepseek-chat', name: 'deepseek-chat', provider: 'deepseek' },
        ]);
      });
  }, []);

  // Close on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setEditing(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleSelect = useCallback((id: string) => {
    setSelected(id);
    setModel(id);
    setOpen(false);
    setEditing(false);
    setInputValue('');
  }, []);

  const handleStartEditing = useCallback(() => {
    setEditing(true);
    setInputValue(selected);
    setOpen(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }, [selected]);

  const handleInputChange = useCallback((value: string) => {
    setInputValue(value);
    setOpen(true);
  }, []);

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      const val = inputValue.trim();
      if (val) {
        handleSelect(val);
      }
    } else if (e.key === 'Escape') {
      setEditing(false);
      setOpen(false);
      setInputValue('');
    }
  }, [inputValue, handleSelect]);

  const displayName = (id: string) => {
    const parts = id.split('/');
    return parts.length > 1 ? parts[1] : id;
  };

  const providerFromId = (id: string) => {
    const slash = id.indexOf('/');
    return slash > 0 ? id.slice(0, slash) : '';
  };

  const providerLabel = (provider: string) => {
    const map: Record<string, string> = {
      anthropic: 'Anthropic',
      openai: 'OpenAI',
      google: 'Google',
      deepseek: 'DeepSeek',
      meta: 'Meta',
      qwen: 'Alibaba',
      nvidia: 'NVIDIA',
      mistralai: 'Mistral',
    };
    return map[provider] || provider;
  };

  // Filter models based on input
  const filteredModels = inputValue.trim()
    ? models.filter(m =>
        m.id.toLowerCase().includes(inputValue.toLowerCase()) ||
        m.name.toLowerCase().includes(inputValue.toLowerCase())
      )
    : models;

  // Check if current input exactly matches a known model
  const inputMatchesKnown = models.some(m => m.id === inputValue.trim());
  const showCustomOption = inputValue.trim() && !inputMatchesKnown && inputValue.trim() !== selected;

  return (
    <div className="relative" ref={ref}>
      {editing ? (
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={e => handleInputChange(e.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder="provider/model-name"
          autoFocus
          className="w-full text-caption font-mono rounded border border-ul-border-focus px-2 py-1 bg-white focus:outline-none"
        />
      ) : (
        <button
          onClick={handleStartEditing}
          className="btn-ghost btn-sm flex items-center gap-1.5 font-mono text-caption"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-ul-success inline-block" />
          {displayName(selected)}
          <svg
            className="w-3 h-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      )}

      {open && (
        <div className="absolute top-full left-0 mt-1 w-72 bg-white border border-ul-border rounded-lg shadow-md z-50 py-1 max-h-72 overflow-y-auto">
          {/* Custom model option */}
          {showCustomOption && (
            <button
              onClick={() => handleSelect(inputValue.trim())}
              className="w-full text-left px-3 py-2 hover:bg-ul-bg-hover border-b border-ul-border"
            >
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded shrink-0">
                  use
                </span>
                <span className="text-small text-ul-text font-mono truncate">
                  {inputValue.trim()}
                </span>
              </div>
              <p className="text-[10px] text-ul-text-muted mt-0.5">
                Press Enter or click to use this model
              </p>
            </button>
          )}

          {/* Known models */}
          {filteredModels.map(model => (
            <button
              key={model.id}
              onClick={() => handleSelect(model.id)}
              className={`w-full text-left px-3 py-2 flex items-center justify-between transition-colors ${
                model.id === selected
                  ? 'bg-ul-bg-active'
                  : 'hover:bg-ul-bg-hover'
              }`}
            >
              <div className="min-w-0">
                <span className="text-small text-ul-text font-mono">
                  {model.name}
                </span>
                <span className="text-caption text-ul-text-muted ml-2">
                  {providerLabel(model.provider || providerFromId(model.id))}
                </span>
              </div>
              {model.id === selected && (
                <svg className="w-4 h-4 text-ul-text shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          ))}

          {filteredModels.length === 0 && !showCustomOption && (
            <p className="text-caption text-ul-text-muted text-center py-3">
              No matching models
            </p>
          )}

          {/* Hint */}
          {!inputValue.trim() && (
            <div className="px-3 py-1.5 border-t border-ul-border">
              <p className="text-[10px] text-ul-text-muted">
                Paste any OpenRouter model ID, e.g. <code className="bg-gray-100 px-1 rounded">qwen/qwen3-35b</code>
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
