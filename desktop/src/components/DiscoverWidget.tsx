// DiscoverWidget — inline marketplace search + scope injection widget.
// Rendered in chat when Flash delegates to Tool Dealer for capability gaps.
// Users select apps to add to their conversation's scope.

import { useState, useCallback, useEffect } from 'react';
import { getApiBase, getToken } from '../lib/storage';

interface DiscoverResult {
  id: string;
  name: string;
  slug: string;
  description: string;
  type: 'app' | 'skill';
  runtime?: string;
  source: 'library' | 'shared' | 'marketplace';
  connected: boolean;
}

interface DiscoverWidgetProps {
  /** Initial search query from Flash's delegation task */
  query?: string;
  /** Callback to inject selected apps into conversation scope */
  onInjectScope: (apps: Array<{ id: string; slug: string; name: string; access: string }>) => void;
}

export default function DiscoverWidget({ query: initialQuery, onInjectScope }: DiscoverWidgetProps) {
  const [query, setQuery] = useState(initialQuery || '');
  const [results, setResults] = useState<DiscoverResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState(false);
  const [searched, setSearched] = useState(false);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setLoading(true);
    setSearched(true);

    const base = getApiBase();
    const token = getToken();
    const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

    try {
      // Search across library + marketplace in parallel
      const [libraryRes, marketRes] = await Promise.all([
        fetch(`${base}/mcp/platform`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            jsonrpc: '2.0', id: '1', method: 'tools/call',
            params: { name: 'ul.discover', arguments: { scope: 'library', query: q } },
          }),
        }),
        fetch(`${base}/mcp/platform`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            jsonrpc: '2.0', id: '2', method: 'tools/call',
            params: { name: 'ul.discover', arguments: { scope: 'appstore', query: q, limit: 10 } },
          }),
        }),
      ]);

      const unified: DiscoverResult[] = [];
      const seen = new Set<string>();

      // Parse library results
      try {
        const libData = await libraryRes.json();
        const libText = libData.result?.content?.[0]?.text;
        if (libText) {
          const parsed = JSON.parse(libText);
          const libResults = parsed.results || parsed.library_results || [];
          for (const r of libResults) {
            if (r.id && !seen.has(r.id)) {
              seen.add(r.id);
              unified.push({
                id: r.id, name: r.name, slug: r.slug,
                description: r.description || '', type: r.app_type === 'skill' ? 'skill' : 'app',
                runtime: r.runtime, source: 'library', connected: true,
              });
            }
          }
        }
      } catch { /* library search failed, continue */ }

      // Parse marketplace results
      try {
        const mktData = await marketRes.json();
        const mktText = mktData.result?.content?.[0]?.text;
        if (mktText) {
          const parsed = JSON.parse(mktText);
          for (const r of (parsed.results || [])) {
            if (r.id && !seen.has(r.id)) {
              seen.add(r.id);
              unified.push({
                id: r.id, name: r.name, slug: r.slug,
                description: r.description || '', type: r.app_type === 'skill' ? 'skill' : 'app',
                runtime: r.runtime, source: r.connected ? 'library' : 'marketplace',
                connected: !!r.connected,
              });
            }
          }
        }
      } catch { /* marketplace search failed, continue */ }

      setResults(unified);
    } catch (err) {
      console.error('[DiscoverWidget] Search failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-search on mount if query provided
  useEffect(() => {
    if (initialQuery) search(initialQuery);
  }, [initialQuery, search]);

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleAdd = () => {
    const apps = results
      .filter(r => selected.has(r.id))
      .map(r => ({ id: r.id, slug: r.slug, name: r.name, access: 'all' }));
    if (apps.length > 0) {
      onInjectScope(apps);
      setAdded(true);
    }
  };

  if (added) {
    return (
      <div className="rounded-xl border border-ul-border bg-ul-bg-raised p-5 text-center">
        <div className="text-lg mb-2">&#10003;</div>
        <p className="text-small text-ul-text font-medium">
          {selected.size} tool{selected.size !== 1 ? 's' : ''} added to this conversation
        </p>
        <p className="text-caption text-ul-text-muted mt-1">
          They'll be available on your next message.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-ul-border bg-white overflow-hidden">
      {/* Search bar */}
      <div className="p-3 border-b border-ul-border">
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && search(query)}
            placeholder="Search tools and skills..."
            className="input flex-1"
          />
          <button
            onClick={() => search(query)}
            disabled={loading || !query.trim()}
            className="btn btn-primary btn-sm"
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="max-h-[300px] overflow-y-auto">
          {results.map(r => (
            <button
              key={r.id}
              onClick={() => toggleSelect(r.id)}
              className={`w-full text-left px-4 py-3 border-b border-ul-border last:border-b-0 flex items-start gap-3 transition-colors ${
                selected.has(r.id) ? 'bg-emerald-50' : 'hover:bg-ul-bg-raised'
              }`}
            >
              {/* Checkbox */}
              <div className={`w-4 h-4 rounded border flex-shrink-0 mt-0.5 flex items-center justify-center ${
                selected.has(r.id) ? 'bg-emerald-500 border-emerald-500' : 'border-gray-300'
              }`}>
                {selected.has(r.id) && (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M2 5L4 7L8 3" />
                  </svg>
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-small font-medium text-ul-text">{r.name}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                    r.source === 'library' ? 'bg-emerald-100 text-emerald-700'
                    : r.source === 'shared' ? 'bg-blue-100 text-blue-700'
                    : 'bg-gray-100 text-gray-600'
                  }`}>
                    {r.source === 'library' ? 'Installed' : r.source === 'shared' ? 'Shared' : 'Marketplace'}
                  </span>
                  {r.type === 'skill' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium">Skill</span>
                  )}
                  {r.runtime === 'gpu' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">GPU</span>
                  )}
                </div>
                <p className="text-caption text-ul-text-muted mt-0.5 truncate font-normal">{r.description}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Empty state */}
      {searched && !loading && results.length === 0 && (
        <div className="p-6 text-center text-small text-ul-text-muted">
          No tools found. Try a different search.
        </div>
      )}

      {/* Action bar */}
      {selected.size > 0 && (
        <div className="p-3 border-t border-ul-border bg-ul-bg-raised flex items-center justify-between">
          <span className="text-caption text-ul-text-secondary">
            {selected.size} selected
          </span>
          <button onClick={handleAdd} className="btn btn-primary btn-sm">
            Add to conversation
          </button>
        </div>
      )}
    </div>
  );
}
