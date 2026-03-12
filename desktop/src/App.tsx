// Root component — auth gate + chat layout.

import { useState, useEffect } from 'react';
import { getToken } from './lib/storage';
import AuthGate from './components/AuthGate';
import ChatView from './components/ChatView';

export default function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);

  // Check for existing token on mount
  useEffect(() => {
    const token = getToken();
    if (token) {
      setAuthenticated(true);
    }
    setChecking(false);
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
    return <AuthGate onAuthenticated={() => setAuthenticated(true)} />;
  }

  // Chat
  return <ChatView />;
}
