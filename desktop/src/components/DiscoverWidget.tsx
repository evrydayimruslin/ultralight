import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchFromApi, getToken } from '../lib/storage';
import type { AmbientSuggestion } from '../types/ambientSuggestion';

type DiscoverResult = AmbientSuggestion;

export type DiscoverWidgetMode =
  | { kind: 'inline'; query?: string }
  | { kind: 'ambient'; suggestions: AmbientSuggestion[] };

interface DiscoverWidgetProps {
  mode: DiscoverWidgetMode;
  onInjectScope: (apps: Array<{ id: string; slug: string; name: string; access: string }>) => void;
}

async function searchDiscoverResults(query: string): Promise<DiscoverResult[]> {
  const token = getToken();
  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  const [libraryRes, marketRes] = await Promise.all([
    fetchFromApi('/mcp/platform', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0', id: '1', method: 'tools/call',
        params: { name: 'ul.discover', arguments: { scope: 'library', query } },
      }),
    }),
    fetchFromApi('/mcp/platform', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0', id: '2', method: 'tools/call',
        params: { name: 'ul.discover', arguments: { scope: 'appstore', query, limit: 10 } },
      }),
    }),
  ]);

  const unified: DiscoverResult[] = [];
  const seen = new Set<string>();

  try {
    const libData = await libraryRes.json();
    const libText = libData.result?.content?.[0]?.text;
    if (libText) {
      const parsed = JSON.parse(libText);
      const libResults = parsed.results || parsed.library_results || [];
      for (const result of libResults) {
        if (!result.id || seen.has(result.id)) continue;
        seen.add(result.id);
        unified.push({
          id: result.id,
          name: result.name,
          slug: result.slug,
          description: result.description || '',
          type: result.app_type === 'skill' ? 'skill' : 'app',
          runtime: result.runtime,
          source: 'library',
          connected: true,
          icon_url: result.icon_url || null,
        });
      }
    }
  } catch {
    // Continue with marketplace results.
  }

  try {
    const marketData = await marketRes.json();
    const marketText = marketData.result?.content?.[0]?.text;
    if (marketText) {
      const parsed = JSON.parse(marketText);
      for (const result of (parsed.results || [])) {
        if (!result.id || seen.has(result.id)) continue;
        seen.add(result.id);
        unified.push({
          id: result.id,
          name: result.name,
          slug: result.slug,
          description: result.description || '',
          type: result.app_type === 'skill' ? 'skill' : 'app',
          runtime: result.runtime,
          source: result.connected ? 'library' : 'marketplace',
          connected: !!result.connected,
          icon_url: result.icon_url || null,
        });
      }
    }
  } catch {
    // Surface what we have.
  }

  return unified;
}

export default function DiscoverWidget({ mode, onInjectScope }: DiscoverWidgetProps) {
  const inlineQuery = mode.kind === 'inline' ? mode.query || '' : '';
  const ambientSeed = mode.kind === 'ambient' ? mode.suggestions : [];
  const [query, setQuery] = useState(inlineQuery);
  const [results, setResults] = useState<DiscoverResult[]>(ambientSeed);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState(false);
  const [searched, setSearched] = useState(mode.kind === 'ambient' && ambientSeed.length > 0);

  const title = useMemo(
    () => mode.kind === 'ambient' ? 'Suggested tools for this conversation' : 'Find the right tools',
    [mode.kind],
  );

  const search = useCallback(async (nextQuery: string) => {
    if (!nextQuery.trim()) return;
    setLoading(true);
    setSearched(true);

    try {
      setResults(await searchDiscoverResults(nextQuery));
    } catch (err) {
      console.error('[DiscoverWidget] Search failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setAdded(false);
    setSelected(new Set());
    if (mode.kind === 'ambient') {
      setQuery('');
      setResults(ambientSeed);
      setSearched(ambientSeed.length > 0);
      return;
    }

    setQuery(inlineQuery);
    if (inlineQuery) {
      void search(inlineQuery);
    } else {
      setResults([]);
      setSearched(false);
    }
  }, [mode.kind, ambientSeed, inlineQuery, search]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAdd = () => {
    const apps = results
      .filter((result) => selected.has(result.id) && result.type === 'app')
      .map((result) => ({ id: result.id, slug: result.slug, name: result.name, access: 'all' }));
    if (apps.length === 0) return;

    onInjectScope(apps);
    setAdded(true);
  };

  if (added) {
    return (
      <div className="rounded-xl border border-ul-border bg-ul-bg-raised p-5 text-center">
        <div className="mb-2 text-lg">&#10003;</div>
        <p className="text-small font-medium text-ul-text">
          {selected.size} tool{selected.size !== 1 ? 's' : ''} added to this conversation
        </p>
        <p className="mt-1 text-caption text-ul-text-muted">
          They&apos;ll be available on your next message.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-ul-border bg-white overflow-hidden shadow-sm">
      <div className="border-b border-ul-border px-3 py-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <p className="text-small font-medium text-ul-text">{title}</p>
            <p className="text-caption text-ul-text-muted">
              {mode.kind === 'ambient'
                ? 'Fresh marketplace matches from the current conversation.'
                : 'Search your library and the marketplace together.'}
            </p>
          </div>
          {mode.kind === 'ambient' && results.length > 0 && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
              {results.length} suggestion{results.length === 1 ? '' : 's'}
            </span>
          )}
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void search(query)}
            placeholder={mode.kind === 'ambient' ? 'Search more tools...' : 'Search tools and skills...'}
            className="input flex-1"
          />
          <button
            onClick={() => void search(query)}
            disabled={loading || !query.trim()}
            className="btn btn-primary btn-sm"
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>
      </div>

      {results.length > 0 && (
        <div className="max-h-[320px] overflow-y-auto">
          {results.map((result) => (
            <button
              key={result.id}
              onClick={() => toggleSelect(result.id)}
              className={`w-full border-b border-ul-border px-4 py-3 text-left transition-colors last:border-b-0 ${
                selected.has(result.id) ? 'bg-emerald-50' : 'hover:bg-ul-bg-raised'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${
                  selected.has(result.id) ? 'border-emerald-500 bg-emerald-500' : 'border-gray-300'
                }`}>
                  {selected.has(result.id) && (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round">
                      <path d="M2 5L4 7L8 3" />
                    </svg>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-small font-medium text-ul-text">{result.name}</span>
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                      result.source === 'library'
                        ? 'bg-emerald-100 text-emerald-700'
                        : result.source === 'shared'
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-gray-100 text-gray-600'
                    }`}>
                      {result.source === 'library' ? 'Installed' : result.source === 'shared' ? 'Shared' : 'Marketplace'}
                    </span>
                    {result.type === 'skill' && (
                      <span className="rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700">
                        Skill
                      </span>
                    )}
                    {result.runtime === 'gpu' && (
                      <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                        GPU
                      </span>
                    )}
                  </div>

                  <p className="mt-0.5 truncate text-caption font-normal text-ul-text-muted">
                    {result.description}
                  </p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {searched && !loading && results.length === 0 && (
        <div className="p-6 text-center text-small text-ul-text-muted">
          {mode.kind === 'ambient'
            ? 'Suggestions will appear here when Flash finds marketplace matches.'
            : 'No tools found. Try a different search.'}
        </div>
      )}

      {selected.size > 0 && (
        <div className="flex items-center justify-between border-t border-ul-border bg-ul-bg-raised p-3">
          <span className="text-caption text-ul-text-secondary">{selected.size} selected</span>
          <button onClick={handleAdd} className="btn btn-primary btn-sm">
            Add to conversation
          </button>
        </div>
      )}
    </div>
  );
}
