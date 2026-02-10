/**
 * X Scrape - Research & Analysis Hub
 *
 * Storage: BYOS Supabase (russell-x-research) + pgvector embeddings
 * Features: Tweet storage, collections, AI analysis, theme extraction
 */

import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';

// ============================================
// TYPES
// ============================================

interface Tweet {
  id: string;
  tweet_id: string;
  author_handle: string;
  author_name?: string;
  content: string;
  url: string;
  posted_at?: string;
  metrics?: {
    likes?: number;
    retweets?: number;
    replies?: number;
  };
  tags: string[];
  created_at: string;
}

interface Collection {
  id: string;
  name: string;
  description?: string;
  tweet_ids: string[];
  tags: string[];
  created_at: string;
  analysis?: {
    summary: string;
    themes: string[];
    sentiment: string;
  };
}

interface Theme {
  name: string;
  description: string;
  tweet_count: number;
  keywords: string[];
}

// ============================================
// REACT UI COMPONENT
// ============================================

function App() {
  const [activeTab, setActiveTab] = useState<'tweets' | 'collections' | 'analyze'>('tweets');
  const [tweets, setTweets] = useState<Tweet[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Tweet[]>([]);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [stats, setStats] = useState<{ total_tweets: number; total_collections: number } | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [tweetsList, collectionsList, statsData] = await Promise.all([
        callFunction('searchTweets', { query: '', limit: 20 }).catch(() => ({ tweets: [] })),
        callFunction('getCollections', {}).catch(() => ({ collections: [] })),
        callFunction('getStats', {}).catch(() => ({ total_tweets: 0, total_collections: 0 })),
      ]);
      setTweets(tweetsList.tweets || []);
      setCollections(collectionsList.collections || []);
      setStats(statsData);
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
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    try {
      const results = await callFunction('findSimilarTweets', { query: searchQuery, limit: 10 });
      setSearchResults((results.results || []).map((r: any) => r.tweet));
    } catch (err) {
      console.error('Search failed:', err);
    }
  }

  async function extractThemes() {
    try {
      const result = await callFunction('extractThemes', { limit: 50 });
      setThemes(result.themes || []);
    } catch (err) {
      console.error('Theme extraction failed:', err);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <header className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
              X Scrape
            </h1>
            <p className="text-gray-400 mt-1">Research & Analysis Hub</p>
          </div>
          {stats && (
            <div className="flex gap-4 text-sm">
              <div className="text-center">
                <div className="text-2xl font-bold text-cyan-400">{stats.total_tweets}</div>
                <div className="text-gray-500">Tweets</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-400">{stats.total_collections}</div>
                <div className="text-gray-500">Collections</div>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Search Bar */}
      <div className="mb-6 flex gap-2">
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search tweets semantically..."
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white"
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
        />
        <button onClick={handleSearch} className="bg-cyan-600 hover:bg-cyan-700 px-6 py-2 rounded-lg">
          Search
        </button>
      </div>

      {/* Search Results */}
      {searchResults.length > 0 && (
        <div className="mb-6 bg-gray-900 rounded-xl p-4 border border-cyan-800">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-semibold text-cyan-400">Search Results</h3>
            <button onClick={() => setSearchResults([])} className="text-gray-400 hover:text-white">
              Clear
            </button>
          </div>
          <div className="space-y-3">
            {searchResults.map(tweet => (
              <TweetCard key={tweet.id} tweet={tweet} compact />
            ))}
          </div>
        </div>
      )}

      {/* Tab Navigation */}
      <nav className="flex gap-2 mb-6">
        {(['tweets', 'collections', 'analyze'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg font-medium transition-all ${
              activeTab === tab
                ? 'bg-cyan-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </nav>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500"></div>
        </div>
      ) : (
        <main>
          {activeTab === 'tweets' && <TweetsTab tweets={tweets} onRefresh={loadData} />}
          {activeTab === 'collections' && <CollectionsTab collections={collections} onRefresh={loadData} />}
          {activeTab === 'analyze' && <AnalyzeTab themes={themes} onExtract={extractThemes} />}
        </main>
      )}
    </div>
  );
}

// Tweet Card Component
function TweetCard({ tweet, compact = false }: { tweet: Tweet; compact?: boolean }) {
  return (
    <div className={`bg-gray-800 rounded-lg ${compact ? 'p-3' : 'p-4'} border border-gray-700`}>
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center text-sm font-bold">
          {tweet.author_handle.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{tweet.author_name || tweet.author_handle}</span>
            <span className="text-gray-500">@{tweet.author_handle}</span>
          </div>
          <p className={`mt-1 ${compact ? 'text-sm' : ''} text-gray-300`}>
            {tweet.content}
          </p>
          {tweet.tags.length > 0 && (
            <div className="flex gap-1 mt-2 flex-wrap">
              {tweet.tags.map(tag => (
                <span key={tag} className="text-xs px-2 py-0.5 bg-gray-700 rounded text-cyan-400">
                  #{tag}
                </span>
              ))}
            </div>
          )}
          {tweet.metrics && !compact && (
            <div className="flex gap-4 mt-2 text-sm text-gray-500">
              {tweet.metrics.likes && <span>❤️ {tweet.metrics.likes}</span>}
              {tweet.metrics.retweets && <span>🔄 {tweet.metrics.retweets}</span>}
              {tweet.metrics.replies && <span>💬 {tweet.metrics.replies}</span>}
            </div>
          )}
        </div>
        <a
          href={tweet.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-gray-500 hover:text-cyan-400"
        >
          ↗
        </a>
      </div>
    </div>
  );
}

// Tweets Tab
function TweetsTab({ tweets, onRefresh }: { tweets: Tweet[]; onRefresh: () => void }) {
  const [newTweetUrl, setNewTweetUrl] = useState('');
  const [newTweetContent, setNewTweetContent] = useState('');
  const [adding, setAdding] = useState(false);

  async function addTweet() {
    if (!newTweetUrl.trim() || !newTweetContent.trim()) return;
    setAdding(true);
    try {
      await fetch(`/mcp/${window.ultralight?.appId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'tools/call',
          params: {
            name: 'addTweet',
            arguments: { url: newTweetUrl, content: newTweetContent }
          }
        })
      });
      setNewTweetUrl('');
      setNewTweetContent('');
      onRefresh();
    } catch (err) {
      console.error('Failed to add tweet:', err);
    }
    setAdding(false);
  }

  return (
    <div className="space-y-6">
      {/* Add Tweet Form */}
      <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
        <h3 className="font-semibold mb-3">Save Tweet</h3>
        <div className="space-y-3">
          <input
            type="url"
            value={newTweetUrl}
            onChange={e => setNewTweetUrl(e.target.value)}
            placeholder="Tweet URL (x.com/user/status/123)"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white"
          />
          <textarea
            value={newTweetContent}
            onChange={e => setNewTweetContent(e.target.value)}
            placeholder="Tweet content..."
            rows={3}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white resize-none"
          />
          <button
            onClick={addTweet}
            disabled={adding}
            className="bg-cyan-600 hover:bg-cyan-700 px-6 py-2 rounded-lg disabled:opacity-50"
          >
            {adding ? 'Saving...' : 'Save Tweet'}
          </button>
        </div>
      </div>

      {/* Tweet List */}
      <div className="space-y-3">
        {tweets.length === 0 ? (
          <p className="text-gray-500 text-center py-8">No tweets saved yet. Add your first tweet above!</p>
        ) : (
          tweets.map(tweet => <TweetCard key={tweet.id} tweet={tweet} />)
        )}
      </div>
    </div>
  );
}

// Collections Tab
function CollectionsTab({ collections, onRefresh }: { collections: Collection[]; onRefresh: () => void }) {
  const [newCollectionName, setNewCollectionName] = useState('');

  async function createCollection() {
    if (!newCollectionName.trim()) return;
    try {
      await fetch(`/mcp/${window.ultralight?.appId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'tools/call',
          params: {
            name: 'createCollection',
            arguments: { name: newCollectionName }
          }
        })
      });
      setNewCollectionName('');
      onRefresh();
    } catch (err) {
      console.error('Failed to create collection:', err);
    }
  }

  return (
    <div className="space-y-6">
      {/* Create Collection */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newCollectionName}
          onChange={e => setNewCollectionName(e.target.value)}
          placeholder="New collection name..."
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white"
          onKeyDown={e => e.key === 'Enter' && createCollection()}
        />
        <button onClick={createCollection} className="bg-cyan-600 hover:bg-cyan-700 px-6 py-2 rounded-lg">
          Create
        </button>
      </div>

      {/* Collections Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {collections.length === 0 ? (
          <p className="text-gray-500 col-span-2 text-center py-8">No collections yet.</p>
        ) : (
          collections.map(collection => (
            <div key={collection.id} className="bg-gray-900 rounded-xl p-6 border border-gray-800">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-semibold text-lg">{collection.name}</h3>
                  {collection.description && (
                    <p className="text-gray-400 text-sm mt-1">{collection.description}</p>
                  )}
                </div>
                <span className="text-sm text-cyan-400">{collection.tweet_ids.length} tweets</span>
              </div>
              {collection.analysis && (
                <div className="mt-4 p-3 bg-gray-800 rounded-lg">
                  <p className="text-sm text-gray-400">{collection.analysis.summary}</p>
                  <div className="flex gap-1 mt-2 flex-wrap">
                    {collection.analysis.themes.map(theme => (
                      <span key={theme} className="text-xs px-2 py-0.5 bg-cyan-900 text-cyan-300 rounded">
                        {theme}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {collection.tags.length > 0 && (
                <div className="flex gap-1 mt-3 flex-wrap">
                  {collection.tags.map(tag => (
                    <span key={tag} className="text-xs px-2 py-0.5 bg-gray-800 rounded">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// Analyze Tab
function AnalyzeTab({ themes, onExtract }: { themes: Theme[]; onExtract: () => void }) {
  const [extracting, setExtracting] = useState(false);

  async function handleExtract() {
    setExtracting(true);
    await onExtract();
    setExtracting(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-semibold">Theme Analysis</h2>
          <p className="text-gray-400 text-sm">Extract recurring themes from your saved tweets</p>
        </div>
        <button
          onClick={handleExtract}
          disabled={extracting}
          className="bg-cyan-600 hover:bg-cyan-700 px-6 py-2 rounded-lg disabled:opacity-50"
        >
          {extracting ? 'Analyzing...' : 'Extract Themes'}
        </button>
      </div>

      {themes.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p>No themes extracted yet.</p>
          <p className="text-sm mt-1">Click "Extract Themes" to analyze your tweets.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {themes.map((theme, i) => (
            <div key={i} className="bg-gray-900 rounded-xl p-6 border border-gray-800">
              <div className="flex justify-between items-start">
                <h3 className="font-semibold text-lg text-cyan-400">{theme.name}</h3>
                <span className="text-sm text-gray-500">{theme.tweet_count} tweets</span>
              </div>
              <p className="text-gray-400 mt-2">{theme.description}</p>
              <div className="flex gap-1 mt-3 flex-wrap">
                {theme.keywords.map(kw => (
                  <span key={kw} className="text-xs px-2 py-0.5 bg-gray-800 text-cyan-300 rounded">
                    {kw}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
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

const supabase = (globalThis as any).supabase;
const uuid = (globalThis as any).uuid;
const _ = (globalThis as any)._;
const ultralight = (globalThis as any).ultralight;

export async function addTweet(
  url: string,
  content: string,
  options?: {
    authorHandle?: string;
    authorName?: string;
    postedAt?: string;
    metrics?: { likes?: number; retweets?: number; replies?: number };
    tags?: string[];
  }
): Promise<{ success: boolean; tweet: Tweet }> {
  const tweetId = extractTweetId(url);
  if (!tweetId) throw new Error('Invalid tweet URL');

  const { data: existing } = await supabase.from('tweets').select('id').eq('tweet_id', tweetId).single();
  if (existing) throw new Error(`Tweet ${tweetId} already saved`);

  const id = uuid.v4();
  let embedding: number[] | undefined;
  try {
    embedding = await generateEmbedding(content);
  } catch (e) {
    console.warn('Could not generate embedding:', e);
  }

  const tweet: Tweet = {
    id,
    tweet_id: tweetId,
    author_handle: options?.authorHandle || extractAuthorFromUrl(url),
    author_name: options?.authorName,
    content,
    url: normalizeTwitterUrl(url),
    posted_at: options?.postedAt,
    metrics: options?.metrics,
    tags: options?.tags || [],
    created_at: new Date().toISOString(),
  };

  const { error } = await supabase.from('tweets').insert({ ...tweet, embedding });
  if (error) throw new Error(`Failed to save tweet: ${error.message}`);

  return { success: true, tweet };
}

export async function getTweet(id: string): Promise<Tweet | null> {
  const { data, error } = await supabase.from('tweets').select('*').eq('id', id).single();
  return error ? null : data;
}

export async function searchTweets(query: string, limit: number = 20): Promise<{ tweets: Tweet[] }> {
  let q = supabase.from('tweets').select('*').order('created_at', { ascending: false }).limit(limit);
  if (query) {
    q = q.textSearch('content', query);
  }
  const { data, error } = await q;
  if (error) throw new Error(`Search failed: ${error.message}`);
  return { tweets: data || [] };
}

export async function findSimilarTweets(query: string, limit: number = 10): Promise<{ results: Array<{ tweet: Tweet; similarity: number }> }> {
  const queryEmbedding = await generateEmbedding(query);
  const { data: tweets } = await supabase.from('tweets').select('*').not('embedding', 'is', null);

  if (!tweets?.length) return { results: [] };

  const results = tweets
    .map((tweet: any) => ({
      tweet,
      similarity: cosineSimilarity(queryEmbedding, tweet.embedding || [])
    }))
    .filter((r: any) => r.similarity > 0.3)
    .sort((a: any, b: any) => b.similarity - a.similarity)
    .slice(0, limit);

  return { results };
}

export async function createCollection(name: string, description?: string, tags?: string[]): Promise<{ success: boolean; collection: Collection }> {
  const collection: Collection = {
    id: uuid.v4(),
    name,
    description,
    tweet_ids: [],
    tags: tags || [],
    created_at: new Date().toISOString(),
  };

  const { error } = await supabase.from('collections').insert(collection);
  if (error) throw new Error(`Failed to create collection: ${error.message}`);

  return { success: true, collection };
}

export async function addToCollection(collectionId: string, tweetIds: string[]): Promise<{ success: boolean; added: number }> {
  const { data: collection, error: fetchError } = await supabase.from('collections').select('*').eq('id', collectionId).single();
  if (fetchError || !collection) throw new Error('Collection not found');

  const existingIds = new Set(collection.tweet_ids || []);
  const newIds = tweetIds.filter(id => !existingIds.has(id));
  const updatedIds = [...(collection.tweet_ids || []), ...newIds];

  const { error } = await supabase.from('collections').update({ tweet_ids: updatedIds }).eq('id', collectionId);
  if (error) throw new Error(`Failed to update collection: ${error.message}`);

  return { success: true, added: newIds.length };
}

export async function getCollections(): Promise<{ collections: Collection[] }> {
  const { data, error } = await supabase.from('collections').select('*').order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to fetch collections: ${error.message}`);
  return { collections: data || [] };
}

export async function analyzeCollection(collectionId: string): Promise<{ success: boolean; analysis: any }> {
  const { data: collection } = await supabase.from('collections').select('*').eq('id', collectionId).single();
  if (!collection) throw new Error('Collection not found');

  const { data: tweets } = await supabase.from('tweets').select('*').in('id', collection.tweet_ids || []);
  if (!tweets?.length) throw new Error('Collection has no tweets');

  const tweetSummaries = tweets.map((t: Tweet, i: number) =>
    `${i + 1}. @${t.author_handle}: "${t.content.slice(0, 200)}"`
  ).join('\n');

  const response = await ultralight.ai({
    model: 'openai/gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Analyze these tweets and output JSON: { "summary": "2-3 sentences", "themes": ["theme1"], "sentiment": "positive|negative|mixed|neutral" }`
      },
      { role: 'user', content: `Collection: "${collection.name}"\n\nTweets:\n${tweetSummaries}` }
    ]
  });

  const analysis = JSON.parse(response.content);
  await supabase.from('collections').update({ analysis }).eq('id', collectionId);

  return { success: true, analysis };
}

export async function extractThemes(tags?: string[], limit: number = 100): Promise<{ themes: Theme[] }> {
  let query = supabase.from('tweets').select('*').order('created_at', { ascending: false }).limit(limit);
  const { data: tweets, error } = await query;
  if (error) throw new Error(`Failed to fetch tweets: ${error.message}`);
  if (!tweets?.length) return { themes: [] };

  const tweetSummaries = tweets.map((t: Tweet, i: number) =>
    `${i + 1}. @${t.author_handle}: "${t.content.slice(0, 150)}"`
  ).join('\n');

  const response = await ultralight.ai({
    model: 'openai/gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Identify 3-7 themes. Output JSON: { "themes": [{ "name": "", "description": "", "tweet_count": N, "keywords": [] }] }`
      },
      { role: 'user', content: `Analyze ${tweets.length} tweets:\n\n${tweetSummaries}` }
    ]
  });

  const parsed = JSON.parse(response.content);
  return { themes: parsed.themes || [] };
}

export async function getStats(): Promise<any> {
  const [tweetsCount, collectionsCount] = await Promise.all([
    supabase.from('tweets').select('*', { count: 'exact', head: true }),
    supabase.from('collections').select('*', { count: 'exact', head: true }),
  ]);

  return {
    total_tweets: tweetsCount.count || 0,
    total_collections: collectionsCount.count || 0,
  };
}

export async function healthCheck(): Promise<{ status: string }> {
  try {
    await supabase.from('tweets').select('id').limit(1);
    return { status: 'healthy' };
  } catch {
    return { status: 'unhealthy' };
  }
}

// Helper functions
function extractTweetId(url: string): string | null {
  const match = url.match(/(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/);
  return match ? match[1] : null;
}

function extractAuthorFromUrl(url: string): string {
  const match = url.match(/(?:twitter\.com|x\.com)\/(\w+)\/status/);
  return match ? match[1] : 'unknown';
}

function normalizeTwitterUrl(url: string): string {
  return url.replace('twitter.com', 'x.com');
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
