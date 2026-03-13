import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import SubagentWindow from './components/SubagentWindow';
import './styles/globals.css';

// Detect if this is a subagent pop-out window
const params = new URLSearchParams(window.location.search);
const subagentId = params.get('subagent');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {subagentId ? <SubagentWindow agentId={subagentId} /> : <App />}
  </React.StrictMode>,
);
