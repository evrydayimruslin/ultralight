// Agent fleet management hook.
// Wraps Rust CRUD commands and subscribes to AgentRunner events
// for real-time status updates of background agents.

import { useState, useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { agentRunner, type AgentEvent, type AgentRunConfig } from '../lib/agentRunner';

// ── Types ──

export interface Agent {
  id: string;
  conversation_id: string;
  parent_agent_id: string | null;
  name: string;
  role: string;
  status: string;
  system_prompt: string | null;
  initial_task: string | null;
  project_dir: string | null;
  model: string | null;
  permission_level: string;
  admin_notes: string | null;
  end_goal: string | null;
  context: string | null;
  launch_mode: string;
  /** JSON array of app IDs this agent has pre-connected access to */
  connected_app_ids: string | null;
  /** JSON object with per-app function selections and conventions */
  connected_apps: string | null;
  created_at: number;
  updated_at: number;
  // Enriched fields (from JOINs, only present in list queries)
  last_message_preview?: string | null;
  message_count?: number | null;
}

export interface CreateAgentParams {
  name: string;
  role: string;
  initialTask: string;
  systemPrompt: string;
  projectDir: string | null;
  model: string;
  parentAgentId: string | null;
  permissionLevel?: string;
  adminNotes?: string;
  endGoal?: string;
  context?: string;
  launchMode?: string;
  /** JSON array of app IDs this agent should have pre-connected access to */
  connectedAppIds?: string;
  /** JSON object with per-app function selections and conventions */
  connectedApps?: string;
}

export interface UseAgentFleetReturn {
  /** All agents (ordered by created_at DESC) */
  agents: Agent[];
  /** Currently viewed agent (when in an agent's conversation) */
  activeAgent: Agent | null;
  /** Create a new agent + its backing conversation */
  createAgent: (params: CreateAgentParams) => Promise<Agent>;
  /** Start an agent running in the background */
  startAgent: (agentId: string, config: Omit<AgentRunConfig, 'agentId'>) => Promise<void>;
  /** Stop a running agent */
  stopAgent: (agentId: string) => void;
  /** Update agent fields (status, name, notes, etc.) */
  updateAgent: (id: string, updates: Partial<Pick<Agent, 'status' | 'name' | 'admin_notes' | 'end_goal' | 'context' | 'permission_level' | 'model' | 'project_dir' | 'connected_app_ids' | 'connected_apps' | 'initial_task'>>) => Promise<void>;
  /** Delete an agent and its conversation */
  deleteAgent: (id: string) => Promise<void>;
  /** Set which agent is currently being viewed */
  setActiveAgent: (agent: Agent | null) => void;
  /** Refresh the agent list from DB */
  refreshAgents: () => Promise<void>;
  /** Look up agent by its conversation ID */
  getAgentByConversation: (conversationId: string) => Promise<Agent | null>;
  /** Check if an agent is currently running in the background */
  isAgentRunning: (agentId: string) => boolean;
  /** Reset an agent's conversation — clears messages, keeps identity/config */
  newSession: (agentId: string) => Promise<void>;
}

// ── Hook ──

export function useAgentFleet(): UseAgentFleetReturn {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [activeAgent, setActiveAgent] = useState<Agent | null>(null);
  const mountedRef = useRef(true);

  // Refresh agent list from DB
  const refreshAgents = useCallback(async () => {
    try {
      const list = await invoke<Agent[]>('db_list_agents', {});
      if (mountedRef.current) {
        setAgents(list);
      }
    } catch (err) {
      console.error('[useAgentFleet] Failed to list agents:', err);
    }
  }, []);

  // Load agents on mount
  useEffect(() => {
    mountedRef.current = true;
    refreshAgents();
    return () => { mountedRef.current = false; };
  }, [refreshAgents]);

  // Subscribe to AgentRunner events for real-time status updates
  useEffect(() => {
    const unsubscribe = agentRunner.on((event: AgentEvent) => {
      if (!mountedRef.current) return;

      if (event.type === 'status_change') {
        // Update agent in local state
        setAgents(prev => prev.map(a =>
          a.id === event.agentId ? { ...a, status: event.status, updated_at: Date.now() } : a
        ));
        // Update activeAgent if it's the one that changed
        setActiveAgent(prev =>
          prev?.id === event.agentId ? { ...prev, status: event.status, updated_at: Date.now() } : prev
        );
      }
    });

    return unsubscribe;
  }, []);

  // Create agent + backing conversation
  const createAgent = useCallback(async (params: CreateAgentParams): Promise<Agent> => {
    const id = crypto.randomUUID();
    const conversationId = crypto.randomUUID();

    const agent = await invoke<Agent>('db_create_agent', {
      id,
      conversationId,
      name: params.name,
      role: params.role,
      systemPrompt: params.systemPrompt,
      initialTask: params.initialTask,
      projectDir: params.projectDir,
      model: params.model,
      parentAgentId: params.parentAgentId,
      permissionLevel: params.permissionLevel ?? 'auto_edit',
      adminNotes: params.adminNotes ?? null,
      endGoal: params.endGoal ?? null,
      context: params.context ?? null,
      launchMode: params.launchMode ?? null,
      connectedAppIds: params.connectedAppIds ?? null,
      connectedApps: params.connectedApps ?? null,
    });

    await refreshAgents();
    return agent;
  }, [refreshAgents]);

  // Start an agent running in the background
  const startAgent = useCallback(async (agentId: string, config: Omit<AgentRunConfig, 'agentId'>) => {
    await agentRunner.start({ agentId, ...config });
  }, []);

  // Stop a running agent
  const stopAgent = useCallback((agentId: string) => {
    agentRunner.stop(agentId);
  }, []);

  // Update agent fields
  const updateAgent = useCallback(async (
    id: string,
    updates: Partial<Pick<Agent, 'status' | 'name' | 'admin_notes' | 'end_goal' | 'context' | 'permission_level' | 'model' | 'project_dir' | 'connected_app_ids' | 'connected_apps' | 'initial_task'>>,
  ) => {
    await invoke('db_update_agent', {
      id,
      status: updates.status ?? null,
      name: updates.name ?? null,
      adminNotes: updates.admin_notes ?? null,
      endGoal: updates.end_goal ?? null,
      context: updates.context ?? null,
      permissionLevel: updates.permission_level ?? null,
      model: updates.model ?? null,
      projectDir: updates.project_dir ?? null,
      connectedAppIds: updates.connected_app_ids ?? null,
      connectedApps: updates.connected_apps ?? null,
      initialTask: updates.initial_task ?? null,
    });

    // Optimistic update
    setAgents(prev => prev.map(a => a.id === id ? { ...a, ...updates, updated_at: Date.now() } : a));
    setActiveAgent(prev => prev?.id === id ? { ...prev, ...updates, updated_at: Date.now() } : prev);
  }, []);

  // Delete agent + cascade conversation
  const deleteAgent = useCallback(async (id: string) => {
    // Stop if running
    if (agentRunner.isRunning(id)) {
      agentRunner.stop(id);
    }

    await invoke('db_delete_agent', { id });
    agentRunner.cleanup(id);
    await refreshAgents();

    // Clear active if deleted
    setActiveAgent(prev => prev?.id === id ? null : prev);
  }, [refreshAgents]);

  // Look up agent by conversation ID
  const getAgentByConversation = useCallback(async (conversationId: string): Promise<Agent | null> => {
    try {
      const agent = await invoke<Agent | null>('db_get_agent_by_conversation', { conversationId });
      return agent;
    } catch {
      return null;
    }
  }, []);

  // Check if agent is running
  const isAgentRunning = useCallback((agentId: string): boolean => {
    return agentRunner.isRunning(agentId);
  }, []);

  // Reset agent session — clear messages, reset status, keep identity
  const newSession = useCallback(async (agentId: string) => {
    // Stop if running
    if (agentRunner.isRunning(agentId)) {
      agentRunner.stop(agentId);
    }

    await invoke('db_new_agent_session', { id: agentId });
    agentRunner.cleanup(agentId);

    // Update local state
    setAgents(prev => prev.map(a =>
      a.id === agentId ? { ...a, status: 'pending', updated_at: Date.now(), last_message_preview: null, message_count: 0 } : a
    ));
    setActiveAgent(prev =>
      prev?.id === agentId ? { ...prev, status: 'pending', updated_at: Date.now(), last_message_preview: null, message_count: 0 } : prev
    );
  }, []);

  return {
    agents,
    activeAgent,
    createAgent,
    startAgent,
    stopAgent,
    updateAgent,
    deleteAgent,
    setActiveAgent,
    refreshAgents,
    getAgentByConversation,
    isAgentRunning,
    newSession,
  };
}
