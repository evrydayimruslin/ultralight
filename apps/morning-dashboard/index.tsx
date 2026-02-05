/**
 * Morning Dashboard - Personal Life Hub
 *
 * Storage: BYOS Supabase (russell-personal-metrics)
 * Features: Health tracking, crypto prices, reminders, goals
 */

import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';

// ============================================
// TYPES
// ============================================

interface HealthMetric {
  date: string;
  weight?: number;
  sleep_hours?: number;
  energy_level?: number;
}

interface Reminder {
  id: string;
  text: string;
  due_at?: string;
  completed: boolean;
  created_at: string;
}

interface Goal {
  id: string;
  title: string;
  target: number;
  current: number;
  unit: string;
  deadline?: string;
}

interface CryptoPrice {
  symbol: string;
  price: number;
  change_24h: number;
}

// ============================================
// REACT UI COMPONENT
// ============================================

function App() {
  const [activeTab, setActiveTab] = useState<'health' | 'crypto' | 'reminders' | 'goals'>('health');
  const [healthData, setHealthData] = useState<HealthMetric[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [cryptoPrices, setCryptoPrices] = useState<CryptoPrice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      // Load data via MCP calls to this app's functions
      const [health, remindersList, goalsList, prices] = await Promise.all([
        callFunction('getHealthTrends', { days: 7 }).catch(() => ({ trends: [] })),
        callFunction('getReminders', {}).catch(() => ({ reminders: [] })),
        callFunction('getGoals', {}).catch(() => ({ goals: [] })),
        callFunction('getCryptoPrices', { symbols: ['BTC', 'ETH', 'SOL'] }).catch(() => ({ prices: [] })),
      ]);
      setHealthData(health.trends || []);
      setReminders(remindersList.reminders || []);
      setGoals(goalsList.goals || []);
      setCryptoPrices(prices.prices || []);
    } catch (err) {
      console.error('Failed to load data:', err);
    }
    setLoading(false);
  }

  async function callFunction(name: string, args: Record<string, unknown>) {
    // Use the ultralight runtime's call method which handles auth
    const ultralight = (window as any).ultralight;
    if (ultralight?.call) {
      return await ultralight.call(name, args);
    }
    // Fallback for older runtimes (shouldn't happen)
    throw new Error('Ultralight runtime not available');
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <header className="mb-8">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
          Morning Dashboard
        </h1>
        <p className="text-gray-400 mt-1">Your personal life hub</p>
      </header>

      {/* Tab Navigation */}
      <nav className="flex gap-2 mb-6">
        {(['health', 'crypto', 'reminders', 'goals'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg font-medium transition-all ${
              activeTab === tab
                ? 'bg-purple-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </nav>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500"></div>
        </div>
      ) : (
        <main>
          {activeTab === 'health' && <HealthTab data={healthData} onRefresh={loadData} />}
          {activeTab === 'crypto' && <CryptoTab prices={cryptoPrices} onRefresh={loadData} />}
          {activeTab === 'reminders' && <RemindersTab reminders={reminders} onRefresh={loadData} />}
          {activeTab === 'goals' && <GoalsTab goals={goals} onRefresh={loadData} />}
        </main>
      )}
    </div>
  );
}

// Health Tab Component
function HealthTab({ data, onRefresh }: { data: HealthMetric[]; onRefresh: () => void }) {
  const [weight, setWeight] = useState('');
  const [sleep, setSleep] = useState('');
  const [energy, setEnergy] = useState('5');

  async function logMetric(type: string, value: number) {
    try {
      const ultralight = (window as any).ultralight;
      if (ultralight?.call) {
        await ultralight.call(`log${type}`, { [type.toLowerCase()]: value });
      }
      onRefresh();
    } catch (err) {
      console.error('Failed to log metric:', err);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Weight Input */}
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <h3 className="text-sm text-gray-400 mb-2">Log Weight</h3>
          <div className="flex gap-2">
            <input
              type="number"
              value={weight}
              onChange={e => setWeight(e.target.value)}
              placeholder="lbs"
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
            />
            <button
              onClick={() => weight && logMetric('Weight', parseFloat(weight))}
              className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg"
            >
              Log
            </button>
          </div>
        </div>

        {/* Sleep Input */}
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <h3 className="text-sm text-gray-400 mb-2">Log Sleep</h3>
          <div className="flex gap-2">
            <input
              type="number"
              value={sleep}
              onChange={e => setSleep(e.target.value)}
              placeholder="hours"
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
            />
            <button
              onClick={() => sleep && logMetric('Sleep', parseFloat(sleep))}
              className="bg-indigo-600 hover:bg-indigo-700 px-4 py-2 rounded-lg"
            >
              Log
            </button>
          </div>
        </div>

        {/* Energy Input */}
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <h3 className="text-sm text-gray-400 mb-2">Energy Level (1-10)</h3>
          <div className="flex gap-2">
            <input
              type="range"
              min="1"
              max="10"
              value={energy}
              onChange={e => setEnergy(e.target.value)}
              className="flex-1"
            />
            <span className="text-lg font-bold w-8">{energy}</span>
            <button
              onClick={() => logMetric('Energy', parseInt(energy))}
              className="bg-green-600 hover:bg-green-700 px-4 py-2 rounded-lg"
            >
              Log
            </button>
          </div>
        </div>
      </div>

      {/* Recent Metrics */}
      <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
        <h3 className="text-lg font-semibold mb-4">Recent Metrics</h3>
        {data.length === 0 ? (
          <p className="text-gray-500">No health data yet. Start logging!</p>
        ) : (
          <div className="space-y-2">
            {data.slice(0, 7).map((metric, i) => (
              <div key={i} className="flex justify-between items-center py-2 border-b border-gray-800 last:border-0">
                <span className="text-gray-400">{metric.date}</span>
                <div className="flex gap-4">
                  {metric.weight && <span>⚖️ {metric.weight} lbs</span>}
                  {metric.sleep_hours && <span>😴 {metric.sleep_hours}h</span>}
                  {metric.energy_level && <span>⚡ {metric.energy_level}/10</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Crypto Tab Component
function CryptoTab({ prices, onRefresh }: { prices: CryptoPrice[]; onRefresh: () => void }) {
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">Crypto Prices</h2>
        <button onClick={onRefresh} className="text-purple-400 hover:text-purple-300">
          Refresh
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {prices.map(coin => (
          <div key={coin.symbol} className="bg-gray-900 rounded-xl p-6 border border-gray-800">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-lg font-bold">{coin.symbol}</h3>
                <p className="text-2xl font-bold mt-2">
                  ${coin.price?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
              <span className={`px-2 py-1 rounded text-sm ${
                coin.change_24h >= 0 ? 'bg-green-900 text-green-400' : 'bg-red-900 text-red-400'
              }`}>
                {coin.change_24h >= 0 ? '+' : ''}{coin.change_24h?.toFixed(2)}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Reminders Tab Component
function RemindersTab({ reminders, onRefresh }: { reminders: Reminder[]; onRefresh: () => void }) {
  const [newReminder, setNewReminder] = useState('');

  async function addReminder() {
    if (!newReminder.trim()) return;
    try {
      const ultralight = (window as any).ultralight;
      if (ultralight?.call) {
        await ultralight.call('addReminder', { text: newReminder });
      }
      setNewReminder('');
      onRefresh();
    } catch (err) {
      console.error('Failed to add reminder:', err);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          type="text"
          value={newReminder}
          onChange={e => setNewReminder(e.target.value)}
          placeholder="Add a reminder..."
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white"
          onKeyDown={e => e.key === 'Enter' && addReminder()}
        />
        <button onClick={addReminder} className="bg-purple-600 hover:bg-purple-700 px-6 py-2 rounded-lg">
          Add
        </button>
      </div>
      <div className="bg-gray-900 rounded-xl border border-gray-800 divide-y divide-gray-800">
        {reminders.length === 0 ? (
          <p className="p-4 text-gray-500">No reminders yet</p>
        ) : (
          reminders.map(reminder => (
            <div key={reminder.id} className="p-4 flex items-center gap-3">
              <input
                type="checkbox"
                checked={reminder.completed}
                className="w-5 h-5 rounded border-gray-600"
                readOnly
              />
              <span className={reminder.completed ? 'line-through text-gray-500' : ''}>
                {reminder.text}
              </span>
              {reminder.due_at && (
                <span className="text-sm text-gray-500 ml-auto">
                  {new Date(reminder.due_at).toLocaleDateString()}
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// Goals Tab Component
function GoalsTab({ goals, onRefresh }: { goals: Goal[]; onRefresh: () => void }) {
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">Goals</h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {goals.length === 0 ? (
          <p className="text-gray-500 col-span-2">No goals yet. Create one via the MCP tools!</p>
        ) : (
          goals.map(goal => {
            const progress = Math.min((goal.current / goal.target) * 100, 100);
            return (
              <div key={goal.id} className="bg-gray-900 rounded-xl p-6 border border-gray-800">
                <h3 className="font-semibold mb-2">{goal.title}</h3>
                <div className="flex justify-between text-sm text-gray-400 mb-2">
                  <span>{goal.current} / {goal.target} {goal.unit}</span>
                  <span>{progress.toFixed(0)}%</span>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-2">
                  <div
                    className="bg-gradient-to-r from-purple-500 to-blue-500 h-2 rounded-full transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                {goal.deadline && (
                  <p className="text-sm text-gray-500 mt-2">
                    Due: {new Date(goal.deadline).toLocaleDateString()}
                  </p>
                )}
              </div>
            );
          })
        )}
      </div>
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

// Helper to get today's date in YYYY-MM-DD format
function getToday(): string {
  return new Date().toISOString().split('T')[0];
}

export async function logWeight(args: { weight: number; date?: string }): Promise<{ success: boolean }> {
  console.log('logWeight called with:', JSON.stringify(args));
  const { weight, date } = args || {};
  console.log('Destructured weight:', weight, 'date:', date);

  if (weight === undefined || weight === null) {
    throw new Error(`Invalid weight value: ${weight}. Args received: ${JSON.stringify(args)}`);
  }

  const targetDate = date || getToday();

  // Check if entry exists for this date
  const { data: existing } = await supabase
    .from('weight_logs')
    .select('id')
    .eq('date', targetDate)
    .single();

  if (existing) {
    // Update existing
    const { error } = await supabase
      .from('weight_logs')
      .update({ weight, updated_at: new Date().toISOString() })
      .eq('date', targetDate);
    if (error) throw new Error(`Failed to update weight: ${error.message}`);
  } else {
    // Insert new
    const { error } = await supabase.from('weight_logs').insert({
      id: uuid.v4(),
      date: targetDate,
      weight,
      created_at: new Date().toISOString(),
    });
    if (error) throw new Error(`Failed to log weight: ${error.message}`);
  }

  return { success: true };
}

export async function logSleep({ hours, quality, date }: { hours: number; quality?: number; date?: string }): Promise<{ success: boolean }> {
  const targetDate = date || getToday();

  const { data: existing } = await supabase
    .from('sleep_logs')
    .select('id')
    .eq('date', targetDate)
    .single();

  if (existing) {
    const { error } = await supabase
      .from('sleep_logs')
      .update({ hours, quality: quality || null, updated_at: new Date().toISOString() })
      .eq('date', targetDate);
    if (error) throw new Error(`Failed to update sleep: ${error.message}`);
  } else {
    const { error } = await supabase.from('sleep_logs').insert({
      id: uuid.v4(),
      date: targetDate,
      hours,
      quality: quality || null,
      created_at: new Date().toISOString(),
    });
    if (error) throw new Error(`Failed to log sleep: ${error.message}`);
  }

  return { success: true };
}

export async function logEnergy({ level, notes, date }: { level: number; notes?: string; date?: string }): Promise<{ success: boolean }> {
  const targetDate = date || getToday();

  const { data: existing } = await supabase
    .from('energy_logs')
    .select('id')
    .eq('date', targetDate)
    .single();

  if (existing) {
    const { error } = await supabase
      .from('energy_logs')
      .update({ level, notes: notes || null, updated_at: new Date().toISOString() })
      .eq('date', targetDate);
    if (error) throw new Error(`Failed to update energy: ${error.message}`);
  } else {
    const { error } = await supabase.from('energy_logs').insert({
      id: uuid.v4(),
      date: targetDate,
      level,
      notes: notes || null,
      created_at: new Date().toISOString(),
    });
    if (error) throw new Error(`Failed to log energy: ${error.message}`);
  }

  return { success: true };
}

export async function getHealthTrends({ days = 30 }: { days?: number } = {}): Promise<{ trends: HealthMetric[] }> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString().split('T')[0];

  const [weights, sleeps, energies] = await Promise.all([
    supabase.from('weight_logs').select('*').gte('date', startDateStr).order('date', { ascending: false }),
    supabase.from('sleep_logs').select('*').gte('date', startDateStr).order('date', { ascending: false }),
    supabase.from('energy_logs').select('*').gte('date', startDateStr).order('date', { ascending: false }),
  ]);

  const dateMap = new Map<string, HealthMetric>();

  (weights.data || []).forEach((w: any) => {
    const existing = dateMap.get(w.date) || { date: w.date };
    existing.weight = w.weight;
    dateMap.set(w.date, existing);
  });

  (sleeps.data || []).forEach((s: any) => {
    const existing = dateMap.get(s.date) || { date: s.date };
    existing.sleep_hours = s.hours;
    dateMap.set(s.date, existing);
  });

  (energies.data || []).forEach((e: any) => {
    const existing = dateMap.get(e.date) || { date: e.date };
    existing.energy_level = e.level;
    dateMap.set(e.date, existing);
  });

  return { trends: Array.from(dateMap.values()).sort((a, b) => b.date.localeCompare(a.date)) };
}

export async function getCryptoPrices({ symbols = ['BTC', 'ETH'] }: { symbols?: string[] } = {}): Promise<{ prices: CryptoPrice[] }> {
  const ids = symbols.map(s => {
    const map: Record<string, string> = { BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana' };
    return map[s] || s.toLowerCase();
  }).join(',');

  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`);
    const data = await res.json();

    return {
      prices: symbols.map(symbol => {
        const id = { BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana' }[symbol] || symbol.toLowerCase();
        return {
          symbol,
          price: data[id]?.usd || 0,
          change_24h: data[id]?.usd_24h_change || 0,
        };
      })
    };
  } catch {
    return { prices: symbols.map(s => ({ symbol: s, price: 0, change_24h: 0 })) };
  }
}

export async function addReminder({ text, dueAt }: { text: string; dueAt?: string }): Promise<{ success: boolean; reminder: Reminder }> {
  const reminder: Reminder = {
    id: uuid.v4(),
    text,
    due_at: dueAt || null,
    completed: false,
    created_at: new Date().toISOString(),
  };

  const { error } = await supabase.from('reminders').insert(reminder);
  if (error) throw new Error(`Failed to add reminder: ${error.message}`);

  return { success: true, reminder };
}

export async function completeReminder({ id }: { id: string }): Promise<{ success: boolean }> {
  const { error } = await supabase.from('reminders').update({ completed: true }).eq('id', id);
  if (error) throw new Error(`Failed to complete reminder: ${error.message}`);
  return { success: true };
}

export async function getReminders({ includeCompleted = false }: { includeCompleted?: boolean } = {}): Promise<{ reminders: Reminder[] }> {
  let query = supabase.from('reminders').select('*').order('created_at', { ascending: false });
  if (!includeCompleted) {
    query = query.eq('completed', false);
  }
  const { data, error } = await query;
  if (error) throw new Error(`Failed to get reminders: ${error.message}`);
  return { reminders: data || [] };
}

export async function createGoal({ title, target, unit, deadline }: { title: string; target: number; unit: string; deadline?: string }): Promise<{ success: boolean; goal: Goal }> {
  const goal: Goal = {
    id: uuid.v4(),
    title,
    target,
    current: 0,
    unit,
    deadline: deadline || null,
  };

  const { error } = await supabase.from('goals').insert(goal);
  if (error) throw new Error(`Failed to create goal: ${error.message}`);

  return { success: true, goal };
}

export async function updateGoalProgress({ id, current }: { id: string; current: number }): Promise<{ success: boolean }> {
  const { error } = await supabase.from('goals').update({ current }).eq('id', id);
  if (error) throw new Error(`Failed to update goal: ${error.message}`);
  return { success: true };
}

export async function getGoals(_args?: Record<string, never>): Promise<{ goals: Goal[] }> {
  const { data, error } = await supabase.from('goals').select('*').order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to get goals: ${error.message}`);
  return { goals: data || [] };
}

export async function healthCheck(_args?: Record<string, never>): Promise<{ status: string; checks: Record<string, any> }> {
  const checks: Record<string, any> = {};

  try {
    await supabase.from('weight_logs').select('id').limit(1);
    checks.supabase = { ok: true };
  } catch (e) {
    checks.supabase = { ok: false, error: String(e) };
  }

  return {
    status: checks.supabase?.ok ? 'healthy' : 'unhealthy',
    checks,
  };
}
