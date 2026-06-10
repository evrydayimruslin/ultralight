import { useEffect, useState } from 'react';
import { fetchFromApi, getToken } from '../lib/storage';
import type { ToolUsed } from '../types/executionPlan';

interface AppPreview {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  icon_url?: string | null;
  tags?: string[];
  likes?: number;
  dislikes?: number;
  category?: string | null;
}

interface ToolPreviewModalProps {
  tool: ToolUsed;
  onClose: () => void;
}

function formatArgs(args: Record<string, unknown>): string {
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

export default function ToolPreviewModal({ tool, onClose }: ToolPreviewModalProps) {
  const [app, setApp] = useState<AppPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const token = getToken();
        const res = await fetchFromApi(`/api/apps/${tool.appId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) {
          throw new Error(`Failed to load app preview (${res.status})`);
        }
        const data = await res.json() as AppPreview;
        if (!cancelled) {
          setApp(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load app preview');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [tool.appId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative max-h-[80vh] w-full max-w-lg overflow-auto rounded-2xl border border-ul-border bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-ul-border px-5 py-4">
          <div>
            <p className="text-small font-medium text-ul-text">Tool preview</p>
            <p className="text-caption text-ul-text-muted">
              {tool.origin === 'marketplace' ? 'Marketplace app' : 'From your library'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-ul-text-muted transition-colors hover:bg-gray-100 hover:text-ul-text"
            title="Close"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {loading ? (
            <p className="text-small text-ul-text-muted">Loading app details...</p>
          ) : error ? (
            <p className="text-small text-red-600">{error}</p>
          ) : app ? (
            <div className="space-y-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-body font-semibold text-ul-text">{app.name}</h3>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                    {app.slug}
                  </span>
                  {app.category && (
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                      {app.category}
                    </span>
                  )}
                </div>
                {app.description && (
                  <p className="mt-1 text-small text-ul-text-secondary">{app.description}</p>
                )}
                {!!app.tags?.length && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {app.tags.slice(0, 6).map((tag) => (
                      <span key={tag} className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-ul-border bg-ul-bg-raised px-3 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-caption font-medium uppercase tracking-wide text-ul-text-muted">Function</span>
                  <span className="font-mono text-small text-ul-text">{tool.fnName}</span>
                </div>
                <pre className="mt-2 overflow-auto rounded-lg bg-white p-3 text-[11px] text-ul-text-secondary whitespace-pre-wrap">
                  {formatArgs(tool.args)}
                </pre>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
