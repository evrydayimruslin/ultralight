// Root component — auth gate + view routing + sidebar + top toolbar.

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getToken, getApiBase, isOnboardingComplete, setOnboardingComplete, resetOnboarding } from './lib/storage';
import { useAppState } from './hooks/useAppState';
import { useDeepLink } from './hooks/useDeepLink';
import { useAgentFleet, type Agent } from './hooks/useAgentFleet';
import { SYSTEM_AGENTS, deriveSystemAgentId } from './lib/systemAgents';
import { openViewWindow } from './lib/multiWindow';
import AuthGate from './components/AuthGate';
import OnboardingWizard, { type OnboardingHighlight } from './components/OnboardingWizard';
import ChatView from './components/ChatView';
import HomeView from './components/HomeView';
import NavSidebar from './components/NavSidebar';
import TopToolbar from './components/TopToolbar';
import WebPanel from './components/WebPanel';
import SpendingSettings from './components/SpendingSettings';

/**
 * Pre-provision the user's OpenRouter key in the background.
 * Called once after login — creates a per-user sub-key via the
 * OpenRouter Management API so the first chat doesn't timeout.
 */
function provisionKeyInBackground(token: string) {
  const base = getApiBase();
  fetch(`${base}/chat/provision-key`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  })
    .then(res => res.json())
    .then(data => {
      if (data.ok) {
        console.log('[App] OpenRouter key provisioned');
      } else {
        console.warn('[App] Key provisioning failed:', data.error);
      }
    })
    .catch(err => console.warn('[App] Key provisioning error:', err));
}

export default function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingHighlight, setOnboardingHighlight] = useState<OnboardingHighlight>('none');
  const {
    view,
    navigateHome,
    navigateToAgent,
    navigateToNewChat,
    navigateToCapabilities,
    navigateToAppStore,
    navigateToProfile,
    navigateToWallet,
    navigateToSettings,
  } = useAppState();
  const {
    agents,
    deleteAgent,
    stopAgent,
    isAgentRunning,
    setActiveAgent,
    refreshAgents,
    newSession,
  } = useAgentFleet();
  const systemAgentsProvisioned = useRef(false);

  // Provision system agents (idempotent — skips existing ones)
  const provisionSystemAgents = useCallback(async () => {
    if (systemAgentsProvisioned.current) return;
    systemAgentsProvisioned.current = true;
    try {
      const existing = await invoke<Agent[]>('db_list_system_agents');
      const existingTypes = new Set(existing.map(a => a.system_agent_type));
      // Use token as seed for deterministic IDs — DB is per-user (Tauri local)
      const userId = getToken() || 'default';

      // ── Migration: v1 (4 agents) → v2 (3 agents) ──
      // Convert tool_publisher → tool_marketer (preserves conversation history)
      const publisherAgent = existing.find(a => a.system_agent_type === 'tool_publisher');
      if (publisherAgent && !existingTypes.has('tool_marketer')) {
        await invoke('db_update_agent', {
          id: publisherAgent.id,
          name: 'Tool Dealer',
          systemAgentType: 'tool_marketer',
          // pass null for all other optional fields
          status: null, adminNotes: null, endGoal: null, context: null,
          permissionLevel: null, model: null, projectDir: null,
          connectedAppIds: null, connectedApps: null, initialTask: null,
          stateSummary: null,
        });
        existingTypes.add('tool_marketer');
        console.log('[App] Migrated tool_publisher → tool_marketer');
      }
      // Old tool_explorer agents are left orphaned — they won't match
      // any SYSTEM_AGENTS config so NavSidebar won't display them.

      // ── Sync display names for existing system agents ──
      for (const config of SYSTEM_AGENTS) {
        const match = existing.find(a => a.system_agent_type === config.type);
        if (match && match.name !== config.name) {
          await invoke('db_update_agent', {
            id: match.id,
            name: config.name,
            systemAgentType: null, status: null, adminNotes: null,
            endGoal: null, context: null, permissionLevel: null,
            model: null, projectDir: null, connectedAppIds: null,
            connectedApps: null, initialTask: null, stateSummary: null,
          });
          console.log(`[App] Renamed ${match.name} → ${config.name}`);
        }
      }

      // ── Create any missing system agents ──
      let created = 0;
      for (const config of SYSTEM_AGENTS) {
        if (existingTypes.has(config.type)) continue;

        const id = await deriveSystemAgentId(userId, config.type);
        const conversationId = await deriveSystemAgentId(userId, config.type + ':conv');

        await invoke('db_create_agent', {
          id,
          conversationId,
          name: config.name,
          role: config.role,
          systemPrompt: null,
          initialTask: null,
          projectDir: null,
          model: 'anthropic/claude-sonnet-4-20250514',
          parentAgentId: null,
          permissionLevel: 'auto_edit',
          adminNotes: null,
          endGoal: null,
          context: null,
          launchMode: 'discuss_first',
          connectedAppIds: null,
          connectedApps: null,
          isSystem: 1,
          systemAgentType: config.type,
        });
        created++;
      }

      if (created > 0) {
        console.log(`[App] Provisioned ${created} system agent(s)`);
      }
      await refreshAgents();
    } catch (err) {
      console.warn('[App] System agent provisioning error:', err);
      systemAgentsProvisioned.current = false; // retry next time
    }
  }, [refreshAgents]);

  // Check for existing token on mount + provision key
  useEffect(() => {
    const token = getToken();
    if (token) {
      setAuthenticated(true);
      provisionKeyInBackground(token);
      provisionSystemAgents();
    }
    setChecking(false);
  }, [provisionSystemAgents]);

  // ── postMessage bridge from embedded web iframes ──
  // The unified /app/:id store page (loaded in WebPanel) and the Market
  // tab (loaded via /capabilities) both post messages to us. We handle:
  //   - { type: 'navigate', to: 'app-store', appId, appName? }
  //       → flip the current view to the store page for that app
  //   - { type: 'library-changed', ... }
  //       → no-op for now (v2 may refresh cached library state)
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const data = e.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'navigate' && data.to === 'app-store' && typeof data.appId === 'string') {
        navigateToAppStore(data.appId, typeof data.appName === 'string' ? data.appName : undefined);
      }
      // Future: library-changed could invalidate cached state in other iframes
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [navigateToAppStore]);

  // ── Deep-link routing (Phase 3) ──
  // Listens for `ultralight://app/:id` URLs delivered by the Rust side,
  // routes them to the app-store view. URLs received before auth is ready
  // are queued and drained once `authenticated && !checking` flips true.
  useDeepLink({ navigateToAppStore }, authenticated && !checking);

  // All hooks must be declared before any early returns
  const handleAuthenticated = useCallback(() => {
    setAuthenticated(true);
    const token = getToken();
    if (token) {
      provisionKeyInBackground(token);
      provisionSystemAgents();
    }
    // Show onboarding for first-time users
    if (!isOnboardingComplete()) {
      setShowOnboarding(true);
    }
  }, []);

  const handleOnboardingComplete = useCallback((navigateTo?: 'chat' | 'tools') => {
    setOnboardingComplete();
    setShowOnboarding(false);
    setOnboardingHighlight('none');
    if (navigateTo === 'tools') navigateToCapabilities();
    else if (navigateTo === 'chat') navigateToNewChat();
  }, [navigateToCapabilities, navigateToNewChat]);

  const handleShowTutorial = useCallback(() => {
    resetOnboarding();
    setShowOnboarding(true);
  }, []);

  // Dismiss tutorial when user navigates via sidebar
  const dismissTutorial = useCallback(() => {
    if (showOnboarding) {
      setOnboardingComplete();
      setShowOnboarding(false);
      setOnboardingHighlight('none');
    }
  }, [showOnboarding]);

  const handleSelectAgent = useCallback((agentId: string) => {
    navigateToAgent(agentId);
  }, [navigateToAgent]);

  const [newChatKey, setNewChatKey] = useState(0);
  const handleNewAgent = useCallback(() => {
    setActiveAgent(null);
    setNewChatKey(k => k + 1);
    navigateToNewChat();
  }, [setActiveAgent, navigateToNewChat]);

  const handleDeleteAgent = useCallback(async (id: string) => {
    await deleteAgent(id);
    // If viewing the deleted agent, go home
    if (view.kind === 'agent' && view.agentId === id) {
      navigateHome();
    }
  }, [deleteAgent, view, navigateHome]);

  const handleStopAgent = useCallback((id: string) => {
    stopAgent(id);
  }, [stopAgent]);

  const handleNewSession = useCallback(async (id: string) => {
    await newSession(id);
  }, [newSession]);

  const handleRenameAgent = useCallback(async (id: string, newName: string) => {
    await invoke('db_update_agent', {
      id, name: newName, status: null, adminNotes: null,
      endGoal: null, context: null, permissionLevel: null, model: null,
      projectDir: null, connectedAppIds: null, connectedApps: null,
      initialTask: null, stateSummary: null, systemAgentType: null,
    });
    await refreshAgents();
  }, [refreshAgents]);

  // Create a new independent session of a system agent and open it in a window
  const handleNewSystemAgentSession = useCallback(async (agentType: string, agentName: string) => {
    try {
      const id = crypto.randomUUID();
      const conversationId = crypto.randomUUID();
      const config = SYSTEM_AGENTS.find(c => c.type === agentType);
      if (!config) return;

      // Copy model from the canonical agent if it exists
      const canonical = agents.find(a => a.is_system === 1 && a.system_agent_type === agentType);
      const model = canonical?.model || 'anthropic/claude-sonnet-4-20250514';

      // Auto-increment instance number
      const instanceCount = agents.filter(a => a.system_agent_type === agentType).length;
      const instanceName = `${agentName} (${instanceCount})`;

      await invoke('db_create_agent', {
        id,
        conversationId,
        name: instanceName,
        role: config.role,
        systemPrompt: null,
        initialTask: null,
        projectDir: canonical?.project_dir || null,
        model,
        parentAgentId: null,
        permissionLevel: 'auto_edit',
        adminNotes: null,
        endGoal: null,
        context: null,
        launchMode: 'discuss_first',
        connectedAppIds: null,
        connectedApps: null,
        isSystem: 1,
        systemAgentType: agentType,
      });

      await refreshAgents();
      openViewWindow({ kind: 'chat', agentId: id, agentName: instanceName });
    } catch (err) {
      console.warn('[App] Failed to create system agent session:', err);
    }
  }, [agents, refreshAgents]);

  // ── View caching: keep visited views mounted but hidden ──
  // Track which singleton views have been visited so we mount them once
  // and hide with CSS instead of unmounting. Agent views are cached by ID.
  // NOTE: These hooks must be before early returns to satisfy Rules of Hooks.
  const [mountedViews, setMountedViews] = useState<Set<string>>(() => new Set([view.kind]));
  const [mountedAgents, setMountedAgents] = useState<Set<string>>(() =>
    view.kind === 'agent' ? new Set([view.agentId]) : new Set()
  );

  // Update mounted sets when view changes
  useEffect(() => {
    if (view.kind === 'agent') {
      setMountedAgents(prev => {
        if (prev.has(view.agentId)) return prev;
        return new Set(prev).add(view.agentId);
      });
    }
    // 'app-store' is intentionally NOT cached — we unmount each visit so
    // switching between different apps always loads a fresh iframe. Visits
    // are short-lived (info pages) so there's no perf cost.
    if (view.kind === 'app-store') return;
    setMountedViews(prev => {
      if (prev.has(view.kind)) return prev;
      return new Set(prev).add(view.kind);
    });
  }, [view]);

  // Collect the set of agent IDs we should keep cached
  // (prune agents that were deleted from the fleet)
  const agentIds = useMemo(() => new Set(agents.map(a => a.id)), [agents]);
  const cachedAgentIds = useMemo(
    () => [...mountedAgents].filter(id => agentIds.has(id)),
    [mountedAgents, agentIds]
  );

  // Loading state
  if (checking) {
    return (
      <div className="flex items-center justify-center h-full bg-white">
        <p className="text-body text-ul-text-muted">Loading...</p>
      </div>
    );
  }

  // Auth gate
  if (!authenticated) {
    return <AuthGate onAuthenticated={handleAuthenticated} />;
  }

  // Helper: style to show/hide cached views
  const paneStyle = (visible: boolean): React.CSSProperties => ({
    display: visible ? 'flex' : 'none',
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    flexDirection: 'column' as const,
  });

  return (
    <div className="flex flex-col h-full">
      <TopToolbar />
      <div className="flex flex-1 min-h-0">
        <NavSidebar
          agents={agents}
          activeView={view}
          isOpen={sidebarOpen}
          onboardingHighlight={onboardingHighlight}
          onShowTutorial={handleShowTutorial}
          onNavigateHome={() => { dismissTutorial(); navigateHome(); }}
          onNavigateToCapabilities={() => { dismissTutorial(); navigateToCapabilities(); }}
          onNavigateToProfile={() => { dismissTutorial(); navigateToProfile(); }}
          onNavigateToWallet={() => { dismissTutorial(); navigateToWallet(); }}
          onNavigateToSettings={() => { dismissTutorial(); navigateToSettings(); }}
          onSelectAgent={(id) => { dismissTutorial(); handleSelectAgent(id); }}
          onNewAgent={() => { dismissTutorial(); handleNewAgent(); }}
          onDeleteAgent={handleDeleteAgent}
          onStopAgent={handleStopAgent}
          onNewSession={handleNewSession}
          onRenameAgent={handleRenameAgent}
          isAgentRunning={isAgentRunning}
          onOpenInNewWindow={openViewWindow}
          onNewSystemAgentSession={handleNewSystemAgentSession}
        />

        {/* Content area — relative container so onboarding overlay stays within */}
        <div className="relative flex-1 flex flex-col min-w-0 min-h-0">

        {/* Cached singleton views — mounted once, then shown/hidden */}
        {mountedViews.has('home') && (
          <div style={paneStyle(view.kind === 'home')}>
            <HomeView
              onNavigateToAgent={navigateToAgent}
            />
          </div>
        )}

        {mountedViews.has('capabilities') && (
          <div style={paneStyle(view.kind === 'capabilities')}>
            <WebPanel path="/capabilities" title="Tools" />
          </div>
        )}

        {/*
          App store detail view — NOT cached in mountedViews. Only rendered
          while the current view is 'app-store', so it unmounts on navigation
          away. Key on appId so switching between apps forces a fresh iframe.
        */}
        {view.kind === 'app-store' && (
          <div style={paneStyle(true)}>
            <WebPanel
              key={view.appId}
              path={`/app/${view.appId}`}
              title={view.appName ?? 'App'}
            />
          </div>
        )}

        {mountedViews.has('profile') && (
          <div style={paneStyle(view.kind === 'profile')}>
            <WebPanel path="/my-profile" title="Profile" />
          </div>
        )}

        {mountedViews.has('wallet') && (
          <div style={paneStyle(view.kind === 'wallet')}>
            <WebPanel path="/settings/billing" title="Wallet" />
          </div>
        )}

        {mountedViews.has('settings') && (
          <div style={paneStyle(view.kind === 'settings')}>
            <WebPanel path="/settings" title="Settings" headerExtra={<SpendingSettings />} />
          </div>
        )}

        {/* New-chat view — uses key to force fresh instance */}
        {view.kind === 'new-chat' && (
          <div style={paneStyle(true)}>
            <ChatView
              key={`new-chat-${newChatKey}`}
              onNavigateHome={navigateHome}
              onNavigateToAgent={navigateToAgent}
            />
          </div>
        )}

        {/* Cached agent ChatViews — one per visited agent */}
        {cachedAgentIds.map(agentId => (
          <div key={agentId} style={paneStyle(view.kind === 'agent' && view.agentId === agentId)}>
            <ChatView
              agentId={agentId}
              initialMessage={view.kind === 'agent' && view.agentId === agentId ? view.initialMessage : undefined}
              onNavigateHome={navigateHome}
              onNavigateToAgent={navigateToAgent}
              onShowTutorial={handleShowTutorial}
            />
          </div>
        ))}

        {/* Onboarding wizard overlay — inside content area, beside sidebar */}
        {showOnboarding && (
          <OnboardingWizard
            onComplete={handleOnboardingComplete}
            onHighlight={setOnboardingHighlight}
          />
        )}
        </div>
      </div>
    </div>
  );
}
