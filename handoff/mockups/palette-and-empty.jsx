// Cmd+K palette + constellation empty state.

const PE_C = window.PUI_Primitives.C;
const { SYS_AGENTS: PE_AGENTS, Spark: PE_Spark } = window.PUI_Primitives;

const PALETTE_ITEMS = [
  { group: 'Agents', icon: PE_AGENTS[0].Icon, color: PE_AGENTS[0].color, label: 'Tool Builder', shortcut: '⌘1' },
  { group: 'Agents', icon: PE_AGENTS[1].Icon, color: PE_AGENTS[1].color, label: 'Tool Marketer', shortcut: '⌘2' },
  { group: 'Agents', icon: PE_AGENTS[2].Icon, color: PE_AGENTS[2].color, label: 'Platform Manager', shortcut: '⌘3' },
  { group: 'Commands', icon: window.PUI_Icons.IconBolt, label: 'Deploy current tool', shortcut: '⇧⌘D' },
  { group: 'Commands', icon: window.PUI_Icons.IconShare, label: 'Share this run', shortcut: '⇧⌘S' },
  { group: 'Commands', icon: window.PUI_Icons.IconBeaker, label: 'Run validation', shortcut: '⌘T' },
  { group: 'Commands', icon: window.PUI_Icons.IconCirclePlus, label: 'New chat', shortcut: '⌘N' },
  { group: 'Wallet', icon: window.PUI_Icons.IconWallet, label: 'Top up Light (✦)', shortcut: '' },
  { group: 'Wallet', icon: window.PUI_Icons.IconWallet, label: 'View 7-day spend', shortcut: '' },
  { group: 'Settings', icon: window.PUI_Icons.IconSettings, label: 'Preferences', shortcut: '⌘,' },
  { group: 'Settings', icon: window.PUI_Icons.IconUser, label: 'Switch workspace', shortcut: '' },
];

function PUI_CmdKPalette({ open, onClose }) {
  const [q, setQ] = React.useState('');
  const [idx, setIdx] = React.useState(0);
  const inputRef = React.useRef(null);

  React.useEffect(() => {
    if (open) {
      setQ(''); setIdx(0);
      setTimeout(() => inputRef.current && inputRef.current.focus(), 50);
    }
  }, [open]);

  const filtered = React.useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return PALETTE_ITEMS;
    return PALETTE_ITEMS.filter(i => i.label.toLowerCase().includes(t) || i.group.toLowerCase().includes(t));
  }, [q]);

  // group filtered by group
  const grouped = React.useMemo(() => {
    const g = {};
    filtered.forEach((it, i) => { (g[it.group] = g[it.group] || []).push({ ...it, _i: i }); });
    return g;
  }, [filtered]);

  React.useEffect(() => { if (idx >= filtered.length) setIdx(0); }, [filtered, idx]);

  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => (i + 1) % filtered.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => (i - 1 + filtered.length) % filtered.length); }
    else if (e.key === 'Enter') { e.preventDefault(); onClose(); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  if (!open) return null;
  return (
    <div onClick={onClose} style={{ position:'absolute', inset: 0, background:'rgba(10,10,10,0.4)', display:'flex', alignItems:'flex-start', justifyContent:'center', paddingTop: 60, zIndex: 100, animation:'pui-fade-in 140ms ease-out' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: 560, maxWidth:'90%', background:'#fff', borderRadius: 14, boxShadow:'0 24px 60px rgba(0,0,0,0.25)', overflow:'hidden', animation:'pui-pop 200ms cubic-bezier(0.2, 0.9, 0.3, 1)' }}>
        <div style={{ display:'flex', alignItems:'center', gap: 10, padding:'12px 16px', borderBottom:`1px solid ${PE_C.border}` }}>
          <window.PUI_Icons.IconSearch size={14}/>
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey}
            placeholder="Type a command or search..."
            style={{ flex: 1, border:'none', outline:'none', fontSize: 14, fontFamily:'inherit', color: PE_C.text, background:'transparent' }}/>
          <span style={{ fontSize: 10, fontFamily:'var(--ul-font-mono)', color: PE_C.mute, padding:'2px 6px', border:`1px solid ${PE_C.border}`, borderRadius: 4 }}>esc</span>
        </div>
        <div style={{ maxHeight: 360, overflow:'auto', padding:'4px 0' }}>
          {Object.keys(grouped).length === 0 && (
            <div style={{ padding: 20, textAlign:'center', fontSize: 13, color: PE_C.mute }}>No matches.</div>
          )}
          {Object.entries(grouped).map(([group, items]) => (
            <div key={group}>
              <div style={{ padding:'8px 16px 4px', fontSize: 10, fontWeight: 500, letterSpacing:'0.06em', textTransform:'uppercase', color: PE_C.mute, fontFamily:'var(--ul-font-mono)' }}>{group}</div>
              {items.map(it => {
                const sel = idx === it._i;
                return (
                  <div key={it._i} onMouseEnter={() => setIdx(it._i)} onClick={onClose}
                    style={{ display:'flex', alignItems:'center', gap: 10, padding:'8px 16px', cursor:'pointer', background: sel ? 'rgba(0,0,0,0.04)' : 'transparent', borderLeft: sel ? `2px solid ${PE_C.text}` : '2px solid transparent' }}>
                    <span style={{ color: it.color || PE_C.sec, width: 16, display:'inline-flex' }}><it.icon size={14}/></span>
                    <span style={{ fontSize: 13, color: PE_C.text, flex: 1 }}>{it.label}</span>
                    {it.shortcut && <span style={{ fontSize: 10, fontFamily:'var(--ul-font-mono)', color: PE_C.mute }}>{it.shortcut}</span>}
                    {sel && <span style={{ fontSize: 10, fontFamily:'var(--ul-font-mono)', color: PE_C.mute }}>↵</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div style={{ padding:'8px 16px', borderTop:`1px solid ${PE_C.border}`, fontSize: 10, fontFamily:'var(--ul-font-mono)', color: PE_C.mute, display:'flex', gap: 14 }}>
          <span>↑↓ navigate</span><span>↵ select</span><span>esc close</span>
        </div>
      </div>
    </div>
  );
}

// ── Constellation hero ─────────────────────────────────────
function PUI_ConstellationHero({ replayKey, onPick }) {
  const [phase, setPhase] = React.useState(0);
  const wordmark = 'Ultralight';
  const [typed, setTyped] = React.useState(0);

  React.useEffect(() => {
    setPhase(0); setTyped(0);
    let i = 0;
    const typer = setInterval(() => {
      i++;
      setTyped(i);
      if (i >= wordmark.length) clearInterval(typer);
    }, 80);
    const t1 = setTimeout(() => setPhase(1), 900);   // subtitle
    const t2 = setTimeout(() => setPhase(2), 1400);  // orbit
    const t3 = setTimeout(() => setPhase(3), 1800);  // first dot
    const t4 = setTimeout(() => setPhase(4), 2050);
    const t5 = setTimeout(() => setPhase(5), 2300);
    return () => { clearInterval(typer); [t1,t2,t3,t4,t5].forEach(clearTimeout); };
  }, [replayKey]);

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding: 40, background:'#fff', position:'relative' }}>
      <div style={{ display:'flex', alignItems:'center', gap: 14, marginBottom: 12 }}>
        <PE_Spark size={36} color={PE_C.text}/>
        <span style={{ fontSize: 36, fontWeight: 700, letterSpacing:'-0.03em', lineHeight: 1, color: PE_C.text, fontFamily:'inherit' }}>
          {wordmark.slice(0, typed)}
          {typed < wordmark.length && <span style={{ display:'inline-block', width: 2, height: 28, background: PE_C.text, marginLeft: 2, verticalAlign:'middle', animation:'pui-caret 1s steps(1) infinite' }}/>}
        </span>
      </div>
      {phase >= 1 && (
        <div style={{ fontSize: 14, color: PE_C.sec, marginBottom: 36, animation:'pui-fade-up 320ms ease-out' }}>
          Three agents are ready. Pick one.
        </div>
      )}

      <div style={{ position:'relative', width: 320, height: 240 }}>
        {phase >= 2 && (
          <svg width="320" height="240" viewBox="0 0 320 240" style={{ position:'absolute', inset: 0, animation:'pui-fade-in 600ms ease-out' }}>
            <g style={{ transformOrigin:'160px 120px', animation:'pui-orbit 60s linear infinite' }}>
              <ellipse cx="160" cy="120" rx="130" ry="80" fill="none" stroke={PE_C.text} strokeOpacity="0.25" strokeWidth="1" strokeDasharray="2 6"/>
            </g>
            <g style={{ transformOrigin:'160px 120px', animation:'pui-spark-pulse 3.6s ease-in-out infinite' }}>
              <circle cx="160" cy="120" r="6" fill={PE_C.text}/>
            </g>
          </svg>
        )}
        {[
          { i: 0, x: 30, y: 95, agent: PE_AGENTS[2] },
          { i: 1, x: 142, y: 12, agent: PE_AGENTS[0] },
          { i: 2, x: 254, y: 95, agent: PE_AGENTS[1] },
        ].map(({ i, x, y, agent }) => phase >= 3 + i && (
          <button key={i} onClick={() => onPick && onPick(agent)}
            style={{ position:'absolute', left: x, top: y, width: 56, height: 56, borderRadius: 9999, background:'#fff', border:`1px solid ${PE_C.border}`, display:'flex', alignItems:'center', justifyContent:'center', color: agent.color, cursor:'pointer', boxShadow:'0 4px 12px rgba(0,0,0,0.06)', animation:'pui-dot-arrive 360ms cubic-bezier(0.2, 0.9, 0.3, 1)', transition:'transform 200ms cubic-bezier(0.4,0,0.2,1), box-shadow 200ms' }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.08)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.12)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.06)'; }}>
            <agent.Icon size={20}/>
          </button>
        ))}
        {[
          { i: 0, x: 30+56, y: 95+28, label: PE_AGENTS[2].name },
          { i: 1, x: 142+28, y: 12+62, label: PE_AGENTS[0].name },
          { i: 2, x: 254-12, y: 95+28, label: PE_AGENTS[1].name },
        ].map(({ i, x, y, label }) => phase >= 3 + i && (
          <div key={'l'+i} style={{ position:'absolute', left: x, top: y, fontSize: 11, fontFamily:'var(--ul-font-mono)', color: PE_C.mute, animation:'pui-fade-in 600ms ease-out 200ms both', whiteSpace:'nowrap' }}>{label}</div>
        ))}
      </div>
    </div>
  );
}

window.PUI_CmdKPalette = PUI_CmdKPalette;
window.PUI_ConstellationHero = PUI_ConstellationHero;
