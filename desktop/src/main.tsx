import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import SubagentWindow from './components/SubagentWindow';
import WidgetWindow from './components/WidgetWindow';
import ViewWindow from './components/ViewWindow';
import ChatWindow from './components/ChatWindow';
import './styles/globals.css';

// Detect if this is a pop-out window (subagent, widget, or view)
const params = new URLSearchParams(window.location.search);
const subagentId = params.get('subagent');
const isWidget = params.get('widget') === '1';
const viewKind = params.get('view');

function Root() {
  if (subagentId) return <SubagentWindow agentId={subagentId} />;
  if (isWidget) return <WidgetWindow />;
  if (viewKind === 'chat') return <ChatWindow />;
  if (viewKind) return <ViewWindow />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
