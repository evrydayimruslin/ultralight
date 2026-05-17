// Light hero (✦), histogram, receipts, sidebar.

const LR_C = window.PUI_Primitives.C;
const { SYS_AGENTS } = window.PUI_Primitives;

function PUI_LightHero({ balance, recentCredit }) {
  const [hover, setHover] = React.useState(false);

  // Smoothly interpolate the displayed balance toward the target on real transactions.
  const [shown, setShown] = React.useState(balance);
  React.useEffect(() => {
    let raf;
    const start = performance.now();
    const from = shown;
    const to = balance;
    const dur = Math.min(1400, 600 + Math.abs(to - from) * 800);
    const step = (t) => {
      const k = Math.min(1, (t - start) / dur);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(from + (to - from) * eased);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [balance]);

  const bal = shown.toFixed(3);
  const [whole, frac] = bal.split('.');

  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ position:'relative', padding: '12px 16px', transition:'background 200ms' }}>
      <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', gap: 8 }}>
        <div style={{ display:'flex', flexDirection:'column' }}>
          <span style={{ fontSize: 10, fontWeight: 500, letterSpacing:'0.06em', textTransform:'uppercase', color: LR_C.mute, fontFamily:'var(--ul-font-mono)' }}>Light balance</span>
          <span style={{ fontSize: 22, fontWeight: 700, letterSpacing:'-0.02em', color: LR_C.text, fontFeatureSettings:'"tnum"', fontVariantNumeric:'tabular-nums', display:'inline-flex', alignItems:'baseline', gap: 2, marginTop: 2 }}>
            <span style={{ color: LR_C.text, fontWeight: 500, marginRight: 2 }}>✦</span>
            {whole}
            <span style={{ fontSize: 13, color: LR_C.mute, fontWeight: 500 }}>.{frac}</span>
          </span>
        </div>
      </div>

      {recentCredit !== 0 && (
        <div key={recentCredit} style={{ position:'absolute', right: 16, top: 30, fontSize: 12, fontWeight: 600, color: recentCredit > 0 ? LR_C.green : LR_C.red, fontFamily:'var(--ul-font-mono)', animation:'pui-credit-rise 1.6s ease-out forwards' }}>
          {recentCredit > 0 ? '+' : '−'}✦{Math.abs(recentCredit).toFixed(3)}
        </div>
      )}

      <div style={{ height: hover ? 32 : 0, marginTop: hover ? 10 : 0, overflow:'hidden', transition:'height 240ms cubic-bezier(0.4,0,0.2,1), margin-top 240ms cubic-bezier(0.4,0,0.2,1), opacity 200ms ease', opacity: hover ? 1 : 0 }}>
        <button
          onClick={(e) => { e.stopPropagation(); window.dispatchEvent(new CustomEvent('pui:add-light')); }}
          style={{ width:'100%', height: 28, fontSize: 11, fontFamily:'var(--ul-font-sans)', fontWeight: 500, color: LR_C.text, background:'#fff', border:`1px solid ${LR_C.border}`, padding:'0 8px', borderRadius: 6, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap: 4, transition:'background 160ms' }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(0,0,0,0.04)'}
          onMouseLeave={(e) => e.currentTarget.style.background = '#fff'}>
          <span style={{ fontSize: 12, lineHeight: 1, marginTop: -1 }}>+</span> Add Light
        </button>
      </div>
    </div>
  );
}

// ── Receipts ────────────────────────────────────────────────
function PUI_ReceiptHeader() {
  const cols = ['Agent', 'Action', '✦', 'Tokens', 'Latency', 'When'];
  return (
    <div style={{ display:'grid', gridTemplateColumns:'140px 1fr 70px 80px 80px 50px', gap: 12, padding:'8px 0', borderBottom:`1px solid ${LR_C.border}`, fontSize: 10, fontFamily:'var(--ul-font-mono)', color: LR_C.mute, letterSpacing:'0.06em', textTransform:'uppercase' }}>
      {cols.map((c, i) => <div key={i} style={{ textAlign: i >= 2 && i <= 4 ? 'right' : 'left' }}>{c}</div>)}
    </div>
  );
}

function PUI_Receipt({ agent, summary, time, light, tokens, latency, status }) {
  const [hover, setHover] = React.useState(false);
  const dot = status === 'running' ? LR_C.green : status === 'error' ? LR_C.red : '#60a5fa';
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ display:'grid', gridTemplateColumns:'140px 1fr 70px 80px 80px 50px', gap: 12, padding:'10px 0', borderBottom:`1px solid ${LR_C.border}`, fontSize: 13, alignItems:'center', background: hover ? 'rgba(0,0,0,0.02)' : 'transparent', transition:'background 120ms' }}>
      <div style={{ display:'flex', alignItems:'center', gap: 8, overflow:'hidden' }}>
        <span style={{ width: 6, height: 6, borderRadius: 9999, background: dot, flexShrink: 0, animation: status === 'running' ? 'pui-pulse 1.4s ease-in-out infinite' : 'none' }}/>
        <span style={{ fontWeight: 500, color: LR_C.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{agent}</span>
      </div>
      <div style={{ color: LR_C.sec, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{summary}</div>
      <div style={{ textAlign:'right', fontFamily:'var(--ul-font-mono)', fontSize: 12, color: light > 0 ? LR_C.text : LR_C.mute, fontVariantNumeric:'tabular-nums' }}>
        {light > 0 ? `✦${light.toFixed(3)}` : '—'}
      </div>
      <div style={{ textAlign:'right', fontFamily:'var(--ul-font-mono)', fontSize: 11, color: LR_C.sec, fontVariantNumeric:'tabular-nums' }}>{tokens.toLocaleString()}</div>
      <div style={{ textAlign:'right', fontFamily:'var(--ul-font-mono)', fontSize: 11, color: LR_C.sec, fontVariantNumeric:'tabular-nums' }}>{latency}ms</div>
      <div style={{ fontSize: 11, color: LR_C.mute, textAlign:'right' }}>{time}</div>
    </div>
  );
}

// ── Premium sidebar ─────────────────────────────────────────
function PUI_PremiumSidebar({ activeId, runningIds, balance, recentCredit, lightHeroOn, minimapOn, alive, onSelect }) {
  return (
    <div style={{ width: 256, flexShrink: 0, background: LR_C.sidebar, borderRight:`1px solid ${LR_C.border}`, display:'flex', flexDirection:'column' }}>
      <div style={{ padding:'16px 16px 8px', display:'flex', alignItems:'center', gap: 8 }}>
        <window.PUI_Primitives.Wordmark fontSize={15}/>
      </div>

      <div style={{ padding:'4px 8px 8px', flex: 1, overflow:'auto' }}>
        {[{id:'cmd', icon: window.PUI_Icons.IconCompass, label:'Command'}, {id:'tools', icon: window.PUI_Icons.IconPackage, label:'Tools'}, {id:'new', icon: window.PUI_Icons.IconCirclePlus, label:'New chat'}].map(i => (
          <div key={i.id} onClick={() => onSelect(i.id)} style={{ display:'flex', alignItems:'center', gap: 8, padding: 8, fontSize: 13, color: LR_C.sec, borderRadius: 8, cursor:'pointer' }}><i.icon/> {i.label}</div>
        ))}

        <div style={{ fontSize: 11, fontWeight: 500, letterSpacing:'0.05em', textTransform:'uppercase', color: LR_C.mute, padding:'16px 8px 8px' }}>System agents</div>
        {SYS_AGENTS.map(a => {
          const active = activeId === a.id;
          const running = runningIds.includes(a.id);
          return (
            <PUI_AgentRow key={a.id} agent={a} active={active} running={running} alive={alive} onClick={() => onSelect(a.id)}/>
          );
        })}
      </div>

      <div style={{ borderTop:`1px solid ${LR_C.border}` }}>
        {lightHeroOn ? <PUI_LightHero balance={balance} recentCredit={recentCredit}/> : <window.PUI_BasicLightFooter balance={balance}/>}
      </div>

      {minimapOn && runningIds.length > 0 && (
        <div style={{ padding:'8px 12px', borderTop:`1px solid ${LR_C.border}`, display:'flex', alignItems:'center', gap: 8, animation:'pui-fade-up 240ms ease-out' }}>
          <span style={{ fontSize: 9, fontFamily:'var(--ul-font-mono)', color: LR_C.mute, letterSpacing:'0.06em', textTransform:'uppercase' }}>Live</span>
          <div style={{ display:'flex', gap: 4, flex: 1 }}>
            {runningIds.map((id) => {
              const a = SYS_AGENTS.find(x => x.id === id);
              if (!a) return null;
              return (
                <div key={id} title={a.name} style={{ position:'relative', width: 8, height: 8 }}>
                  <span style={{ position:'absolute', inset: 0, borderRadius: 9999, background: a.color, animation:'pui-dot-arrive 260ms ease-out' }}/>
                  <span style={{ position:'absolute', inset: 0, borderRadius: 9999, background: a.color, opacity: 0.4, animation:'pui-halo 1.8s ease-out infinite' }}/>
                </div>
              );
            })}
          </div>
          <span style={{ fontSize: 10, fontFamily:'var(--ul-font-mono)', color: LR_C.sec, fontVariantNumeric:'tabular-nums' }}>{runningIds.length}</span>
        </div>
      )}
    </div>
  );
}

function PUI_AgentRow({ agent, active, running, alive, onClick }) {
  const [hover, setHover] = React.useState(false);
  const bg = active ? 'rgba(0,0,0,0.06)' : hover ? 'rgba(0,0,0,0.04)' : 'transparent';
  const rotate = alive && hover ? 8 : 0;
  return (
    <div onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ display:'flex', alignItems:'center', gap: 8, padding: 8, fontSize: 13, color: active ? LR_C.text : LR_C.sec, fontWeight: active ? 500 : 400, background: bg, borderRadius: 8, cursor:'pointer', transition:'background 120ms' }}>
      <span style={{ color: agent.color, display:'inline-flex', transform: `rotate(${rotate}deg)`, transition:'transform 240ms cubic-bezier(0.4,0,0.2,1)', animation: alive && running ? 'pui-breathe 2.4s ease-in-out infinite' : 'none' }}>
        <agent.Icon/>
      </span>
      <span style={{ flex: 1 }}>{agent.name}</span>
      {running && <span style={{ position:'relative', width: 8, height: 8 }}>
        <span style={{ position:'absolute', inset: 1, background: LR_C.green, borderRadius: 9999 }}/>
        <span style={{ position:'absolute', inset: 1, background: LR_C.green, borderRadius: 9999, animation:'pui-halo 1.8s ease-out infinite' }}/>
      </span>}
    </div>
  );
}

window.PUI_LightHero = PUI_LightHero;
window.PUI_ReceiptHeader = PUI_ReceiptHeader;
window.PUI_Receipt = PUI_Receipt;
window.PUI_PremiumSidebar = PUI_PremiumSidebar;
