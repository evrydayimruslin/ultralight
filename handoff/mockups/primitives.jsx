// Primitives — colors, system agents, Spark, Wordmark, basic before-state components.

const C = {
  text: '#0a0a0a',
  sec: '#555',
  mute: '#999',
  bg: '#fff',
  raised: '#fafafa',
  sidebar: '#f9fafb',
  border: 'rgba(0,0,0,0.08)',
  borderStrong: 'rgba(0,0,0,0.15)',
  blue: '#3b82f6',
  green: '#22c55e',
  red: '#ef4444',
  wine: '#722F37',
  deepGreen: '#004225',
};

const SYS_AGENTS = [
  { id: 'tool-builder', name: 'Tool Builder', Icon: window.PUI_Icons.IconWrench, color: C.blue },
  { id: 'tool-marketer', name: 'Tool Marketer', Icon: window.PUI_Icons.IconStore, color: C.deepGreen },
  { id: 'platform-manager', name: 'Platform Manager', Icon: window.PUI_Icons.IconSettings, color: C.wine },
];

function Spark({ size = 16, color = C.text }) {
  const r = 8;
  const k = 0.28;
  const cx = 12, cy = 12;
  const p = [
    [cx, cy - r], [cx + r*k, cy - r*k], [cx + r, cy], [cx + r*k, cy + r*k],
    [cx, cy + r], [cx - r*k, cy + r*k], [cx - r, cy], [cx - r*k, cy - r*k],
  ].map(p => p.join(',')).join(' ');
  return <svg width={size} height={size} viewBox="0 0 24 24"><polygon points={p} fill={color}/></svg>;
}

function Wordmark({ fontSize = 15, color = C.text }) {
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap: 8 }}>
      <Spark size={fontSize * 1.1} color={color}/>
      <span style={{ fontWeight: 700, fontSize, letterSpacing:'-0.03em', lineHeight: 1, color }}>Ultralight</span>
    </span>
  );
}

// ── Basic (before) composer ─────────────────────────────────
function PUI_BasicComposer({ onSend, isLoading, agentName = 'Tool Builder', agentColor = C.blue }) {
  const [v, setV] = React.useState('');
  const has = v.trim().length > 0;
  return (
    <div style={{ flexShrink: 0, padding:'8px 24px 24px', background: C.bg }}>
      <div style={{ maxWidth: 720, margin:'0 auto', border:`1px solid ${C.border}`, borderRadius: 16, background: C.bg, padding:'12px 16px' }}>
        <textarea value={v} onChange={e => setV(e.target.value)} placeholder="Message..." rows={1}
          style={{ width:'100%', border:'none', outline:'none', resize:'none', fontFamily:'inherit', fontSize: 14, lineHeight: 1.6, color: C.text, background:'transparent', padding: 0, minHeight: 24 }}/>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop: 8, gap: 8 }}>
          <div style={{ display:'flex', gap: 8, alignItems:'center', flex: 1 }}>
            <button style={{ width: 24, height: 24, border:'none', background:'transparent', color: C.mute, cursor:'pointer' }}><window.PUI_Icons.IconPaperclip size={14}/></button>
            <span style={{ fontSize: 11, fontWeight: 500, color: agentColor, background:'rgba(0,0,0,0.04)', padding:'4px 8px', borderRadius: 9999 }}>@{agentName}</span>
            <span style={{ fontSize: 11, fontWeight: 500, color: C.sec, background:'rgba(0,0,0,0.04)', padding:'4px 8px', borderRadius: 9999 }}>claude-sonnet-4</span>
          </div>
          <button onClick={() => { if (has) { onSend && onSend(v); setV(''); } }} disabled={!has}
            style={{ width: 28, height: 28, borderRadius: 9999, border:'none', background: has ? C.text : 'rgba(0,0,0,0.06)', color: has ? '#fff' : C.mute, display:'flex', alignItems:'center', justifyContent:'center', cursor: has ? 'pointer' : 'not-allowed' }}>
            <window.PUI_Icons.IconArrowUp size={14}/>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Basic (before) tool-call row ────────────────────────────
function PUI_BasicToolCall({ name, args, state, result }) {
  const isExec = state === 'executing';
  return (
    <div style={{ marginBottom: 10, padding:'8px 12px', background: C.raised, borderRadius: 8, fontFamily:'var(--ul-font-mono)', fontSize: 12, color: C.sec, display:'flex', alignItems:'center', gap: 8 }}>
      {isExec ?
        <span style={{ width: 10, height: 10, border:`2px solid ${C.border}`, borderTopColor: C.blue, borderRadius: 9999, animation:'pui-spin 0.8s linear infinite' }}/> :
        <window.PUI_Icons.IconCheck size={12}/>}
      <span style={{ color: C.text }}>{name}</span>
      <span style={{ color: C.mute, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex: 1 }}>{args || result || '...'}</span>
    </div>
  );
}

// ── Basic empty state ───────────────────────────────────────
function PUI_BasicEmptyState() {
  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding: 40 }}>
      <div style={{ fontSize: 22, fontWeight: 600, letterSpacing:'-0.015em', marginBottom: 12 }}>Command</div>
      <div style={{ fontSize: 14, color: C.sec, marginBottom: 24 }}>What do you want to ship today?</div>
      <div style={{ display:'flex', gap: 12 }}>
        {SYS_AGENTS.map(a => (
          <div key={a.id} style={{ width: 140, height: 100, border:`1px solid ${C.border}`, borderRadius: 12, padding: 14, display:'flex', flexDirection:'column', justifyContent:'space-between' }}>
            <span style={{ color: a.color }}><a.Icon/></span>
            <span style={{ fontSize: 13, fontWeight: 500 }}>{a.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Basic light footer ──────────────────────────────────────
function PUI_BasicLightFooter({ balance = 12.40 }) {
  return (
    <div style={{ borderTop:`1px solid ${C.border}`, padding: 16, fontSize: 12, color: C.mute, display:'flex', justifyContent:'space-between' }}>
      <span>Light balance</span>
      <span style={{ color: C.text, fontWeight: 600 }}>✦{balance.toFixed(2)}</span>
    </div>
  );
}

window.PUI_Primitives = { C, SYS_AGENTS, Spark, Wordmark };
window.PUI_BasicComposer = PUI_BasicComposer;
window.PUI_BasicToolCall = PUI_BasicToolCall;
window.PUI_BasicEmptyState = PUI_BasicEmptyState;
window.PUI_BasicLightFooter = PUI_BasicLightFooter;
