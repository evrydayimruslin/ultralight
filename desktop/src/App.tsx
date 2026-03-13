// Root component — auth gate + view routing.

import { useState, useEffect } from 'react';
import { getToken, getApiBase } from './lib/storage';
import { useAppState } from './hooks/useAppState';
import AuthGate from './components/AuthGate';
import ChatView from './components/ChatView';
import HomeView from './components/HomeView';

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
  const {
    view,
    navigateHome,
    navigateToAgent,
    selectedProjectDir,
    setSelectedProjectDir,
  } = useAppState();

  // Check for existing token on mount + provision key
  useEffect(() => {
    const token = getToken();
    if (token) {
      setAuthenticated(true);
      // Pre-provision OpenRouter key in background
      provisionKeyInBackground(token);
    }
    setChecking(false);
  }, []);

  const handleAuthenticated = () => {
    setAuthenticated(true);
    // Provision key right after login
    const token = getToken();
    if (token) {
      provisionKeyInBackground(token);
    }
  };

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

  // Route based on view state
  if (view.kind === 'home') {
    return (
      <HomeView
        selectedProjectDir={selectedProjectDir}
        onSelectProjectDir={setSelectedProjectDir}
        onNavigateToAgent={navigateToAgent}
      />
    );
  }

  // Agent conversation view
  return (
    <ChatView
      agentId={view.agentId}
      onNavigateHome={navigateHome}
      onNavigateToAgent={navigateToAgent}
    />
  );
}
