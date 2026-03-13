// Root component — auth gate + view routing + sidebar.

import { useState, useEffect, useCallback } from 'react';
import { getToken, getApiBase } from './lib/storage';
import { useAppState } from './hooks/useAppState';
import { useAgentFleet } from './hooks/useAgentFleet';
import AuthGate from './components/AuthGate';
import ChatView from './components/ChatView';
import HomeView from './components/HomeView';
import AgentSidebar from './components/AgentSidebar';

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
        console.log('[App] OpenRouter key provisioned:', data.key_prefix);
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
  const {
    view,
    navigateHome,
    navigateToAgent,
    navigateToNewChat,
    selectedProjectDir,
    setSelectedProjectDir,
  } = useAppState();
  const {
    agents,
    deleteAgent,
    stopAgent,
    isAgentRunning,
    setActiveAgent,
  } = useAgentFleet();

  // Check for existing token on mount + provision key
  useEffect(() => {
    const token = getToken();
    if (token) {
      setAuthenticated(true);
      provisionKeyInBackground(token);
    }
    setChecking(false);
  }, []);

  // All hooks must be declared before any early returns
  const handleAuthenticated = useCallback(() => {
    setAuthenticated(true);
    const token = getToken();
    if (token) {
      provisionKeyInBackground(token);
    }
  }, []);

  const handleSelectAgent = useCallback((agentId: string) => {
    navigateToAgent(agentId);
  }, [navigateToAgent]);

  const handleNewAgent = useCallback(() => {
    setActiveAgent(null);
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

  const toggleSidebar = useCallback(() => {
    setSidebarOpen(prev => !prev);
  }, []);

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

  // Determine active agent ID for sidebar highlight
  const activeAgentId = view.kind === 'agent' ? view.agentId : null;

  // Route content based on view state
  let content: React.ReactNode;
  if (view.kind === 'home') {
    content = (
      <HomeView
        selectedProjectDir={selectedProjectDir}
        onSelectProjectDir={setSelectedProjectDir}
        onNavigateToAgent={navigateToAgent}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={toggleSidebar}
      />
    );
  } else if (view.kind === 'agent') {
    content = (
      <ChatView
        agentId={view.agentId}
        onNavigateHome={navigateHome}
        onNavigateToAgent={navigateToAgent}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={toggleSidebar}
      />
    );
  } else {
    // new-chat view — ChatView with no agentId
    content = (
      <ChatView
        onNavigateHome={navigateHome}
        onNavigateToAgent={navigateToAgent}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={toggleSidebar}
      />
    );
  }

  return (
    <div className="flex h-full">
      <AgentSidebar
        agents={agents}
        activeAgentId={activeAgentId}
        isOpen={sidebarOpen}
        onSelect={handleSelectAgent}
        onNewAgent={handleNewAgent}
        onGoHome={navigateHome}
        onDelete={handleDeleteAgent}
        onStop={handleStopAgent}
        onClose={() => setSidebarOpen(false)}
        isAgentRunning={isAgentRunning}
      />
      {content}
    </div>
  );
}
