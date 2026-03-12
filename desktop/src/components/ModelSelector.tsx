// Model selector dropdown — fetches available models and persists selection.

import { useState, useEffect, useRef } from 'react';
import { fetchModels, type ModelInfo } from '../lib/api';
import { getModel, setModel } from '../lib/storage';

export default function ModelSelector() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selected, setSelected] = useState(getModel());
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  // Fetch models on mount
  useEffect(() => {
    fetchModels()
      .then(m => setModels(m))
      .catch(() => {
        // Fallback model list
        setModels([
          { id: 'anthropic/claude-sonnet-4-20250514', name: 'claude-sonnet-4-20250514', provider: 'anthropic' },
          { id: 'anthropic/claude-3.5-sonnet', name: 'claude-3.5-sonnet', provider: 'anthropic' },
          { id: 'openai/gpt-4o', name: 'gpt-4o', provider: 'openai' },
          { id: 'openai/gpt-4o-mini', name: 'gpt-4o-mini', provider: 'openai' },
          { id: 'deepseek/deepseek-chat', name: 'deepseek-chat', provider: 'deepseek' },
        ]);
      })
      .finally(() => setLoading(false));
  }, []);

  // Close on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleSelect = (id: string) => {
    setSelected(id);
    setModel(id);
    setOpen(false);
  };

  const displayName = (id: string) => {
    const parts = id.split('/');
    return parts.length > 1 ? parts[1] : id;
  };

  const providerLabel = (provider: string) => {
    const map: Record<string, string> = {
      anthropic: 'Anthropic',
      openai: 'OpenAI',
      google: 'Google',
      deepseek: 'DeepSeek',
    };
    return map[provider] || provider;
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="btn-ghost btn-sm flex items-center gap-1.5 font-mono text-caption"
        disabled={loading}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-ul-success inline-block" />
        {loading ? 'Loading...' : displayName(selected)}
        <svg
          className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-ul-border rounded-lg shadow-md z-50 py-1 max-h-80 overflow-y-auto">
          {models.map(model => (
            <button
              key={model.id}
              onClick={() => handleSelect(model.id)}
              className={`w-full text-left px-3 py-2 flex items-center justify-between transition-colors ${
                model.id === selected
                  ? 'bg-ul-bg-active'
                  : 'hover:bg-ul-bg-hover'
              }`}
            >
              <div>
                <span className="text-small text-ul-text font-mono">
                  {model.name}
                </span>
                <span className="text-caption text-ul-text-muted ml-2">
                  {providerLabel(model.provider)}
                </span>
              </div>
              {model.id === selected && (
                <svg className="w-4 h-4 text-ul-text" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
