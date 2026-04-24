// State summary generation for system agents.
// After each system agent interaction, generates a lightweight 1-2 sentence
// summary that gets stored locally and synced to server KV for Flash's Context Index.

import { invoke } from '@tauri-apps/api/core';
import { streamChat, embedConversation } from './api';
import { syncSystemAgentStates } from './api';
import { SYSTEM_AGENTS } from './systemAgents';
import { createDesktopLogger } from './logging';
import type { Agent } from '../hooks/useAgentFleet';

const STATE_SUMMARY_SYSTEM = `Summarize this system agent's current state in 1-2 sentences. Focus on: what the user is working on with this agent, any pending actions, and key context. Be extremely concise — max 100 words.`;
const agentStateLogger = createDesktopLogger('agentStateSummary');

/**
 * Generate a state summary from the agent's recent messages.
 * Uses a cheap Flash Lite call (~100 tokens output).
 */
export async function generateStateSummary(
  recentMessages: Array<{ role: string; content: string }>,
): Promise<string> {
  if (recentMessages.length === 0) return '';

  // Format recent messages for the summarizer
  const formatted = recentMessages
    .slice(-5)
    .map(m => `[${m.role}]: ${m.content.slice(0, 300)}`)
    .join('\n');

  let summary = '';
  try {
    for await (const event of streamChat({
      model: 'google/gemini-3.1-flash-lite-preview:nitro',
      messages: [
        { role: 'system', content: STATE_SUMMARY_SYSTEM },
        { role: 'user', content: formatted },
      ],
      max_tokens: 150,
      temperature: 0,
    })) {
      if (event.type === 'delta' && event.content) {
        summary += event.content;
      }
    }
  } catch (err) {
    agentStateLogger.warn('Generation failed', { error: err });
    // Fallback: simple extraction from last message
    const last = recentMessages[recentMessages.length - 1];
    summary = last ? last.content.slice(0, 150) : '';
  }

  return summary.trim();
}

/**
 * After a system agent completes a run, update its state summary
 * in the local DB and sync to server KV.
 */
export async function updateSystemAgentState(
  agentId: string,
  recentMessages: Array<{ role: string; content: string }>,
): Promise<void> {
  try {
    // Generate summary
    const summary = await generateStateSummary(recentMessages);
    if (!summary) return;

    // Persist locally
    await invoke('db_update_agent', {
      id: agentId,
      stateSummary: summary,
      // Pass null for all other optional fields
      status: null, name: null, adminNotes: null, endGoal: null,
      context: null, permissionLevel: null, model: null, projectDir: null,
      connectedAppIds: null, connectedApps: null, initialTask: null,
      systemAgentType: null,
    });

    // Sync all system agent states to server
    await syncAllSystemAgentStates();
  } catch (err) {
    agentStateLogger.warn('Update failed', { agent_id: agentId, error: err });
  }
}

/**
 * Read all system agents from local DB and sync their states to server KV.
 */
export async function syncAllSystemAgentStates(): Promise<void> {
  try {
    const systemAgents = await invoke<Agent[]>('db_list_system_agents');
    const states = systemAgents.map(a => ({
      type: a.system_agent_type || '',
      name: a.name,
      tools: [],  // tools are now handled server-side by Flash
      stateSummary: a.state_summary,
      status: a.status,
    }));
    await syncSystemAgentStates(states);
  } catch (err) {
    agentStateLogger.warn('Sync failed', { error: err });
  }
}

/**
 * Embed a conversation for cross-session semantic search.
 * Fire-and-forget — called after agent completion or orchestrate stream ends.
 */
export async function maybeEmbedConversation(
  conversationId: string,
  conversationName: string,
  recentMessages: Array<{ role: string; content: string }>,
): Promise<void> {
  if (recentMessages.length < 5) return; // not enough context to embed

  try {
    const summary = await generateStateSummary(recentMessages);
    if (!summary || summary.length < 20) return;

    // Extract entity hints from messages
    const entities: string[] = [];
    const entityPattern = /\b(?:app|tool|function|built|created|deployed|published|updated)\s+["']?(\w[\w-]+)/gi;
    for (const m of recentMessages.slice(-5)) {
      let match;
      while ((match = entityPattern.exec(m.content)) !== null) {
        if (match[1] && match[1].length > 2) entities.push(match[1]);
      }
    }

    await embedConversation({
      conversationId,
      conversationName,
      summary,
      metadata: { entities: [...new Set(entities)].slice(0, 10) },
    });
  } catch (err) {
    agentStateLogger.warn('Conversation embedding failed', {
      conversation_id: conversationId,
      error: err,
    });
  }
}
