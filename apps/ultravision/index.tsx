/**
 * Ultravision - Business Hub for Ultralight
 *
 * Storage: R2 + OpenRouter embeddings
 * Features: Roadmap, quarterly goals, decisions, risks, semantic search
 */

import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';

// ============================================
// TYPES
// ============================================

type ItemType = 'feature' | 'milestone' | 'goal' | 'decision' | 'risk';
type ItemStatus = 'planned' | 'in_progress' | 'completed' | 'blocked' | 'cancelled';
type Priority = 'low' | 'medium' | 'high' | 'critical';
type RiskStatus = 'identified' | 'mitigated' | 'occurred' | 'resolved';

interface RoadmapItem {
  id: string;
  type: ItemType;
  title: string;
  description: string;
  status: ItemStatus;
  priority: Priority;
  quarter?: string;
  due_date?: string;
  dependencies?: string[];
  tags: string[];
  created_at: string;
  updated_at: string;
}

interface Decision {
  id: string;
  title: string;
  context: string;
  options: string[];
  chosen_option?: string;
  rationale?: string;
  decided_at?: string;
  outcome?: string;
  outcome_recorded_at?: string;
  tags: string[];
  created_at: string;
}

interface Risk {
  id: string;
  title: string;
  description: string;
  probability: 'low' | 'medium' | 'high';
  impact: 'low' | 'medium' | 'high';
  status: RiskStatus;
  mitigation_plan?: string;
  tags: string[];
  created_at: string;
}

// ============================================
// REACT UI COMPONENT
// ============================================

function App() {
  const [activeTab, setActiveTab] = useState<'roadmap' | 'decisions' | 'risks'>('roadmap');
  const [roadmapItems, setRoadmapItems] = useState<RoadmapItem[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [risks, setRisks] = useState<Risk[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [roadmap, decisionsList, risksList] = await Promise.all([
        callFunction('getRoadmap', {}).catch(() => ({ items: [] })),
        callFunction('getDecisions', {}).catch(() => ({ decisions: [] })),
        callFunction('getRisks', {}).catch(() => ({ risks: [] })),
      ]);
      setRoadmapItems(roadmap.items || []);
      setDecisions(decisionsList.decisions || []);
      setRisks(risksList.risks || []);
    } catch (err) {
      console.error('Failed to load data:', err);
    }
    setLoading(false);
  }

  async function callFunction(name: string, args: Record<string, unknown>) {
    const res = await fetch(`/mcp/${window.ultralight?.appId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: { name, arguments: args }
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data.result?.structuredContent || {};
  }

  async function handleSearch() {
    if (!searchQuery.trim()) return;
    try {
      const results = await callFunction('searchVision', { query: searchQuery, limit: 10 });
      setSearchResults(results.results || []);
    } catch (err) {
      console.error('Search failed:', err);
    }
  }

  const currentQuarter = `Q${Math.ceil((new Date().getMonth() + 1) / 3)} ${new Date().getFullYear()}`;

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <header className="mb-8">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-400 to-fuchsia-500 bg-clip-text text-transparent">
          Ultravision
        </h1>
        <p className="text-gray-400 mt-1">Ultralight Business Hub • {currentQuarter}</p>
      </header>

      {/* Search Bar */}
      <div className="mb-6 flex gap-2">
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search roadmap, decisions, risks..."
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white"
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
        />
        <button onClick={handleSearch} className="bg-violet-600 hover:bg-violet-700 px-6 py-2 rounded-lg">
          Search
        </button>
      </div>

      {/* Search Results */}
      {searchResults.length > 0 && (
        <div className="mb-6 bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-semibold">Search Results</h3>
            <button onClick={() => setSearchResults([])} className="text-gray-400 hover:text-white">
              Clear
            </button>
          </div>
          <div className="space-y-2">
            {searchResults.map((result, i) => (
              <div key={i} className="p-3 bg-gray-800 rounded-lg">
                <div className="flex items-center gap-2">
                  <span className="text-xs px-2 py-0.5 bg-violet-900 text-violet-300 rounded">
                    {result.type}
                  </span>
                  <span className="font-medium">{result.title}</span>
                  <span className="text-gray-500 ml-auto">{(result.similarity * 100).toFixed(0)}% match</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab Navigation */}
      <nav className="flex gap-2 mb-6">
        {(['roadmap', 'decisions', 'risks'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg font-medium transition-all ${
              activeTab === tab
                ? 'bg-violet-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
            <span className="ml-2 text-xs opacity-70">
              ({tab === 'roadmap' ? roadmapItems.length : tab === 'decisions' ? decisions.length : risks.length})
            </span>
          </button>
        ))}
      </nav>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-500"></div>
        </div>
      ) : (
        <main>
          {activeTab === 'roadmap' && <RoadmapTab items={roadmapItems} onRefresh={loadData} />}
          {activeTab === 'decisions' && <DecisionsTab decisions={decisions} onRefresh={loadData} />}
          {activeTab === 'risks' && <RisksTab risks={risks} onRefresh={loadData} />}
        </main>
      )}
    </div>
  );
}

// Roadmap Tab
function RoadmapTab({ items, onRefresh }: { items: RoadmapItem[]; onRefresh: () => void }) {
  const statusColors: Record<ItemStatus, string> = {
    planned: 'bg-gray-700',
    in_progress: 'bg-blue-700',
    completed: 'bg-green-700',
    blocked: 'bg-red-700',
    cancelled: 'bg-gray-600',
  };

  const priorityColors: Record<Priority, string> = {
    low: 'text-gray-400',
    medium: 'text-yellow-400',
    high: 'text-orange-400',
    critical: 'text-red-400',
  };

  const groupedByQuarter = items.reduce((acc, item) => {
    const q = item.quarter || 'Unscheduled';
    if (!acc[q]) acc[q] = [];
    acc[q].push(item);
    return acc;
  }, {} as Record<string, RoadmapItem[]>);

  return (
    <div className="space-y-6">
      {Object.entries(groupedByQuarter).map(([quarter, quarterItems]) => (
        <div key={quarter} className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <div className="bg-gray-800 px-4 py-3 font-semibold">{quarter}</div>
          <div className="divide-y divide-gray-800">
            {quarterItems.map(item => (
              <div key={item.id} className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs px-2 py-0.5 rounded ${statusColors[item.status]}`}>
                        {item.status.replace('_', ' ')}
                      </span>
                      <span className={`text-xs ${priorityColors[item.priority]}`}>
                        {item.priority}
                      </span>
                      <span className="text-xs text-gray-500">{item.type}</span>
                    </div>
                    <h3 className="font-medium">{item.title}</h3>
                    <p className="text-sm text-gray-400 mt-1">{item.description}</p>
                    {item.tags.length > 0 && (
                      <div className="flex gap-1 mt-2">
                        {item.tags.map(tag => (
                          <span key={tag} className="text-xs px-2 py-0.5 bg-gray-800 rounded">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  {item.due_date && (
                    <span className="text-sm text-gray-500">
                      {new Date(item.due_date).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      {items.length === 0 && (
        <p className="text-gray-500 text-center py-8">No roadmap items yet. Create one via MCP tools!</p>
      )}
    </div>
  );
}

// Decisions Tab
function DecisionsTab({ decisions, onRefresh }: { decisions: Decision[]; onRefresh: () => void }) {
  return (
    <div className="space-y-4">
      {decisions.length === 0 ? (
        <p className="text-gray-500 text-center py-8">No decisions logged yet.</p>
      ) : (
        decisions.map(decision => (
          <div key={decision.id} className="bg-gray-900 rounded-xl p-6 border border-gray-800">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-lg">{decision.title}</h3>
                <p className="text-gray-400 mt-1">{decision.context}</p>
              </div>
              {decision.decided_at && (
                <span className="text-xs px-2 py-1 bg-green-900 text-green-400 rounded">
                  Decided
                </span>
              )}
            </div>
            {decision.options.length > 0 && (
              <div className="mt-4">
                <p className="text-sm text-gray-500 mb-2">Options considered:</p>
                <ul className="list-disc list-inside text-sm text-gray-400">
                  {decision.options.map((opt, i) => (
                    <li key={i} className={opt === decision.chosen_option ? 'text-green-400 font-medium' : ''}>
                      {opt} {opt === decision.chosen_option && '✓'}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {decision.rationale && (
              <div className="mt-4 p-3 bg-gray-800 rounded-lg">
                <p className="text-sm text-gray-500 mb-1">Rationale:</p>
                <p className="text-sm">{decision.rationale}</p>
              </div>
            )}
            {decision.outcome && (
              <div className="mt-4 p-3 bg-violet-900/30 rounded-lg border border-violet-800">
                <p className="text-sm text-violet-400 mb-1">Outcome:</p>
                <p className="text-sm">{decision.outcome}</p>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// Risks Tab
function RisksTab({ risks, onRefresh }: { risks: Risk[]; onRefresh: () => void }) {
  const riskLevel = (p: string, i: string) => {
    const scores: Record<string, number> = { low: 1, medium: 2, high: 3 };
    const score = scores[p] * scores[i];
    if (score >= 6) return { color: 'bg-red-900 border-red-700', label: 'High' };
    if (score >= 3) return { color: 'bg-yellow-900 border-yellow-700', label: 'Medium' };
    return { color: 'bg-green-900 border-green-700', label: 'Low' };
  };

  const statusColors: Record<RiskStatus, string> = {
    identified: 'bg-yellow-700',
    mitigated: 'bg-green-700',
    occurred: 'bg-red-700',
    resolved: 'bg-gray-600',
  };

  return (
    <div className="space-y-4">
      {risks.length === 0 ? (
        <p className="text-gray-500 text-center py-8">No risks identified yet.</p>
      ) : (
        risks.map(risk => {
          const level = riskLevel(risk.probability, risk.impact);
          return (
            <div key={risk.id} className={`rounded-xl p-6 border ${level.color}`}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-xs px-2 py-0.5 rounded ${statusColors[risk.status]}`}>
                      {risk.status}
                    </span>
                    <span className="text-xs text-gray-400">
                      P: {risk.probability} • I: {risk.impact}
                    </span>
                  </div>
                  <h3 className="font-semibold">{risk.title}</h3>
                  <p className="text-gray-400 mt-1">{risk.description}</p>
                </div>
                <span className="text-xs font-bold">{level.label} Risk</span>
              </div>
              {risk.mitigation_plan && (
                <div className="mt-4 p-3 bg-black/30 rounded-lg">
                  <p className="text-sm text-gray-500 mb-1">Mitigation Plan:</p>
                  <p className="text-sm">{risk.mitigation_plan}</p>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

// ============================================
// DEFAULT EXPORT - UI ENTRY POINT
// ============================================

export default function render(container: HTMLElement) {
  const root = ReactDOM.createRoot(container);
  root.render(<App />);
}

// ============================================
// MCP EXPORTS - Backend Functions
// ============================================

const ultralight = (globalThis as any).ultralight;

export async function createItem(
  type: ItemType,
  title: string,
  description: string,
  options?: {
    status?: ItemStatus;
    priority?: Priority;
    quarter?: string;
    dueDate?: string;
    dependencies?: string[];
    tags?: string[];
  }
): Promise<{ success: boolean; item: RoadmapItem }> {
  const item: RoadmapItem = {
    id: crypto.randomUUID(),
    type,
    title,
    description,
    status: options?.status || 'planned',
    priority: options?.priority || 'medium',
    quarter: options?.quarter,
    due_date: options?.dueDate,
    dependencies: options?.dependencies || [],
    tags: options?.tags || [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Generate embedding for semantic search
  try {
    const embedding = await generateEmbedding(`${title} ${description}`);
    await ultralight.store.set(`roadmap:${item.id}`, { ...item, embedding });
  } catch {
    await ultralight.store.set(`roadmap:${item.id}`, item);
  }

  return { success: true, item };
}

export async function getItem(id: string): Promise<RoadmapItem | null> {
  return await ultralight.store.get(`roadmap:${id}`);
}

export async function updateItem(id: string, updates: Partial<RoadmapItem>): Promise<{ success: boolean }> {
  const item = await ultralight.store.get(`roadmap:${id}`);
  if (!item) throw new Error('Item not found');

  const updated = { ...item, ...updates, updated_at: new Date().toISOString() };
  await ultralight.store.set(`roadmap:${id}`, updated);
  return { success: true };
}

export async function getRoadmap(filters?: { quarter?: string; status?: ItemStatus; type?: ItemType }): Promise<{ items: RoadmapItem[] }> {
  const keys = await ultralight.store.list('roadmap:');
  const items: RoadmapItem[] = [];

  for (const key of keys) {
    const item = await ultralight.store.get(key);
    if (item) {
      if (filters?.quarter && item.quarter !== filters.quarter) continue;
      if (filters?.status && item.status !== filters.status) continue;
      if (filters?.type && item.type !== filters.type) continue;
      items.push(item);
    }
  }

  return { items: items.sort((a, b) => (b.priority === 'critical' ? 1 : 0) - (a.priority === 'critical' ? 1 : 0)) };
}

export async function logDecision(
  title: string,
  context: string,
  options: string[],
  decision?: { chosenOption: string; rationale: string }
): Promise<{ success: boolean; decision: Decision }> {
  const dec: Decision = {
    id: crypto.randomUUID(),
    title,
    context,
    options,
    chosen_option: decision?.chosenOption,
    rationale: decision?.rationale,
    decided_at: decision ? new Date().toISOString() : undefined,
    tags: [],
    created_at: new Date().toISOString(),
  };

  try {
    const embedding = await generateEmbedding(`${title} ${context}`);
    await ultralight.store.set(`decision:${dec.id}`, { ...dec, embedding });
  } catch {
    await ultralight.store.set(`decision:${dec.id}`, dec);
  }

  return { success: true, decision: dec };
}

export async function getDecisions(): Promise<{ decisions: Decision[] }> {
  const keys = await ultralight.store.list('decision:');
  const decisions: Decision[] = [];
  for (const key of keys) {
    const dec = await ultralight.store.get(key);
    if (dec) decisions.push(dec);
  }
  return { decisions: decisions.sort((a, b) => b.created_at.localeCompare(a.created_at)) };
}

export async function identifyRisk(
  title: string,
  description: string,
  probability: 'low' | 'medium' | 'high',
  impact: 'low' | 'medium' | 'high',
  mitigationPlan?: string
): Promise<{ success: boolean; risk: Risk }> {
  const risk: Risk = {
    id: crypto.randomUUID(),
    title,
    description,
    probability,
    impact,
    status: 'identified',
    mitigation_plan: mitigationPlan,
    tags: [],
    created_at: new Date().toISOString(),
  };

  try {
    const embedding = await generateEmbedding(`${title} ${description}`);
    await ultralight.store.set(`risk:${risk.id}`, { ...risk, embedding });
  } catch {
    await ultralight.store.set(`risk:${risk.id}`, risk);
  }

  return { success: true, risk };
}

export async function getRisks(status?: RiskStatus): Promise<{ risks: Risk[] }> {
  const keys = await ultralight.store.list('risk:');
  const risks: Risk[] = [];
  for (const key of keys) {
    const risk = await ultralight.store.get(key);
    if (risk && (!status || risk.status === status)) risks.push(risk);
  }
  return { risks };
}

export async function searchVision(query: string, limit: number = 10): Promise<{ results: any[] }> {
  const queryEmbedding = await generateEmbedding(query);
  const allItems: Array<{ type: string; data: any; similarity: number }> = [];

  // Search roadmap items
  const roadmapKeys = await ultralight.store.list('roadmap:');
  for (const key of roadmapKeys) {
    const item = await ultralight.store.get(key);
    if (item?.embedding) {
      const similarity = cosineSimilarity(queryEmbedding, item.embedding);
      allItems.push({ type: 'roadmap', data: item, similarity });
    }
  }

  // Search decisions
  const decisionKeys = await ultralight.store.list('decision:');
  for (const key of decisionKeys) {
    const item = await ultralight.store.get(key);
    if (item?.embedding) {
      const similarity = cosineSimilarity(queryEmbedding, item.embedding);
      allItems.push({ type: 'decision', data: item, similarity });
    }
  }

  // Search risks
  const riskKeys = await ultralight.store.list('risk:');
  for (const key of riskKeys) {
    const item = await ultralight.store.get(key);
    if (item?.embedding) {
      const similarity = cosineSimilarity(queryEmbedding, item.embedding);
      allItems.push({ type: 'risk', data: item, similarity });
    }
  }

  return {
    results: allItems
      .filter(i => i.similarity > 0.3)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit)
      .map(i => ({ type: i.type, title: i.data.title, similarity: i.similarity, id: i.data.id }))
  };
}

async function generateEmbedding(text: string): Promise<number[]> {
  const response = await ultralight.ai({
    model: 'openai/text-embedding-3-small',
    input: text,
  });
  if (!response.embedding) throw new Error('No embedding');
  return response.embedding;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function healthCheck(): Promise<{ status: string }> {
  try {
    await ultralight.store.list('');
    return { status: 'healthy' };
  } catch {
    return { status: 'unhealthy' };
  }
}
