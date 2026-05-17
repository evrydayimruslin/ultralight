// Library / Shared / Market — the Tools page redesigned to match the Premium UI grammar.

const LB_C = window.PUI_Primitives.C;
const LB_Icons = window.PUI_Icons;

// status: 'published' (you published; live in Market) | 'private' (you built; not listed) | 'installed' (someone else's)
const LB_TOOLS = [
  { name:'Private Tutor',   tag:'tutor',           v:'7.5.0',  fns: 19, glyph:'PT', tone:'#3b82f6', desc:'Personal AI tutor. Quizzes, lessons targeting weak spots.', kind:'mcp', last:'12m ago', calls:'18.4k', cost: 0.012, status:'private',   owner:'you' },
  { name:'email-ops',       tag:'email-agent',     v:'1.0.45', fns: 13, glyph:'EM', tone:'#22c55e', desc:'Connects to mailbox via IMAP, classifies and drafts replies.', kind:'agent', last:'1m ago', calls:'62.1k', cost: 0.024, status:'private',   owner:'you' },
  { name:'resort-manager',  tag:'multi-tool',      v:'1.5.1',  fns: 36, glyph:'RM', tone:'#722F37', desc:'Ski/golf resort: rooms, rentals, tee times, restaurant.', kind:'mcp', last:'4h ago', calls:'2.1k',  cost: 0.034, status:'installed', owner:'@reece' },
  { name:'gpu-phase2-test', tag:'experimental',    v:'1.0.0',  fns:  1, glyph:'GP', tone:'#ef4444', desc:'Internal: phase-2 GPU test runner.', kind:'mcp', last:'2d ago', calls:'14',    cost: 0.000, status:'private',   owner:'you' },
  { name:'Reading List',    tag:'reader',          v:'1.0.0',  fns:  5, glyph:'RL', tone:'#0a0a0a', desc:'Track books, articles, papers. Auto-extract, highlights, search.', kind:'mcp', last:'3h ago', calls:'940',  cost: 0.001, status:'published', owner:'you' },
  { name:'Story Builder',   tag:'creative',        v:'3.1.0',  fns:  7, glyph:'SB', tone:'#7c3aed', desc:'Persistent fiction worlds, characters, scene generator.', kind:'mcp', last:'1d ago', calls:'412',  cost: 0.018, status:'installed', owner:'@anya' },
  { name:'Recipe Box',      tag:'kitchen',         v:'1.0.0',  fns:  6, glyph:'RB', tone:'#004225', desc:'Save recipes, plan meals, generate grocery lists.', kind:'mcp', last:'6h ago', calls:'1.8k', cost: 0.002, status:'private',   owner:'you' },
  { name:'Fitness Tracker', tag:'health',          v:'1.0.0',  fns:  6, glyph:'FT', tone:'#3b82f6', desc:'Log meals, workouts, sleep. AI calorie estimation.', kind:'mcp', last:'30m ago', calls:'4.2k', cost: 0.003, status:'published', owner:'you' },
  { name:'Home Inventory',  tag:'household',       v:'1.0.0',  fns:  6, glyph:'HI', tone:'#7c3aed', desc:'Catalog belongings: location, category, value.', kind:'mcp', last:'2w ago', calls:'52',    cost: 0.001, status:'private',   owner:'you' },
  { name:'Goal Tracker',    tag:'productivity',    v:'1.0.0',  fns:  6, glyph:'GT', tone:'#22c55e', desc:'Goals, milestones, progress over time.', kind:'mcp', last:'1d ago', calls:'320',  cost: 0.001, status:'published', owner:'you' },
  { name:'Smart Budget',    tag:'money',           v:'1.0.0',  fns:  5, glyph:'SB', tone:'#004225', desc:'Track spending, manage budgets, financial insights.', kind:'mcp', last:'1h ago', calls:'1.2k', cost: 0.004, status:'published', owner:'you' },
];

const LB_SHARED = [
  { name:'Currency Convert', sharedBy:'@anya',    members: 4,  v:'2.0.1', last:'15m ago', desc:'Live FX with bank-rate fallback. Used by Tool Marketer.', tone:'#22c55e' },
  { name:'Slack Drafter',    sharedBy:'@workspace', members: 12, v:'0.9.0', last:'1h ago', desc:'Draft Slack replies in your voice; stage in #drafts before send.', tone:'#3b82f6' },
  { name:'PDF Reader',       sharedBy:'@reece',   members: 2,  v:'4.2.0', last:'4h ago', desc:'OCR + structured extraction. Forms, tables, signatures.', tone:'#722F37' },
];

// Glyph block — instead of emoji avatars, use a typographic monogram.
function LB_Glyph({ glyph, tone, size = 36 }) {
  return (
    <div style={{ width: size, height: size, borderRadius: 10, background: tone, color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'var(--ul-font-mono)', fontWeight: 700, fontSize: Math.round(size * 0.36), letterSpacing:'-0.02em', flexShrink: 0 }}>{glyph}</div>
  );
}

// ── BEFORE: the current Tools page layout ────────────────────────────────
function PUI_LibraryBefore() {
  const tabs = ['Library', 'Shared', 'Market'];
  const [tab, setTab] = React.useState('Library');
  return (
    <div style={{ background:'#fff', height:'100%', overflow:'auto', padding: 24 }}>
      <div style={{ fontSize: 22, fontWeight: 700, letterSpacing:'-0.02em', marginBottom: 18 }}>Tools</div>
      <div style={{ display:'flex', gap: 6, marginBottom: 16 }}>
        {tabs.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ fontSize: 13, fontWeight: 500, padding:'6px 14px', borderRadius: 6, border:'none', cursor:'pointer', background: tab === t ? LB_C.text : 'transparent', color: tab === t ? '#fff' : LB_C.text }}>{t}</button>
        ))}
      </div>
      <div style={{ display:'flex', gap: 8, marginBottom: 16 }}>
        <input placeholder="Search tools..." style={{ flex: 1, padding:'10px 14px', border:`1px solid ${LB_C.border}`, borderRadius: 8, fontSize: 13, fontFamily:'inherit', outline:'none' }}/>
        <button style={{ padding:'10px 14px', border:`1px solid ${LB_C.border}`, borderRadius: 8, background:'#fff', fontSize: 13, cursor:'pointer' }}>≡ Filters</button>
      </div>
      {LB_TOOLS.slice(0, 6).map((t, i) => (
        <div key={i} style={{ display:'flex', alignItems:'flex-start', gap: 14, padding:'14px 0', borderBottom:`1px solid ${LB_C.border}` }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background:'rgba(0,0,0,0.04)', display:'flex', alignItems:'center', justifyContent:'center', fontSize: 18 }}>🔧</div>
          <div style={{ flex: 1 }}>
            <div style={{ display:'flex', alignItems:'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{t.name}</span>
              <span style={{ fontSize: 10, color: LB_C.mute, padding:'1px 6px', border:`1px solid ${LB_C.border}`, borderRadius: 4 }}>{t.v}</span>
              <span style={{ fontSize: 10, color: LB_C.mute, padding:'1px 6px', border:`1px solid ${LB_C.border}`, borderRadius: 4 }}>{t.fns} fns</span>
            </div>
            <div style={{ fontSize: 12, color: LB_C.sec, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.desc}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── A: Receipt grammar — Library as a dense, sortable, signed-manifest list
function LibraryReceipts() {
  const tabs = ['Library', 'Shared', 'Market'];
  const [tab, setTab] = React.useState('Library');
  const [q, setQ] = React.useState('');
  const list = (tab === 'Shared' ? LB_SHARED.map(s => ({ ...s, glyph: s.name.split(' ').map(w=>w[0]).slice(0,2).join(''), tone: s.tone, calls:'shared', fns:'·', kind:'shared' })) : LB_TOOLS).filter(t => !q || t.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div style={{ background:'#fff', height:'100%', overflow:'auto' }}>
      <div style={{ padding:'20px 32px 0' }}>
        <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom: 10 }}>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing:'-0.02em' }}>Tools</div>
          <div style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', color: LB_C.mute }}>{LB_TOOLS.length} in library · ✦{LB_TOOLS.reduce((s,t)=>s+t.cost,0).toFixed(3)}/call avg</div>
        </div>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:`1px solid ${LB_C.border}`, marginBottom: 14 }}>
          <div style={{ display:'flex', gap: 0 }}>
            {tabs.map(t => (
              <button key={t} onClick={() => setTab(t)} style={{ fontSize: 13, fontWeight: 500, padding:'10px 0', marginRight: 22, border:'none', cursor:'pointer', background:'transparent', color: tab === t ? LB_C.text : LB_C.mute, borderBottom: tab === t ? `2px solid ${LB_C.text}` : '2px solid transparent', position:'relative', top: 1 }}>{t}</button>
            ))}
          </div>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="filter…" style={{ width: 180, padding:'6px 10px', border:`1px solid ${LB_C.border}`, borderRadius: 6, fontSize: 12, fontFamily:'var(--ul-font-mono)', outline:'none', color: LB_C.text }}/>
        </div>
      </div>

      <div style={{ padding:'0 32px 32px' }}>
        <div style={{ display:'grid', gridTemplateColumns:'minmax(220px, 1.6fr) 1fr 60px 70px 80px 70px', gap: 16, padding:'8px 0', borderBottom:`1px solid ${LB_C.border}`, fontSize: 10, fontFamily:'var(--ul-font-mono)', color: LB_C.mute, letterSpacing:'0.06em', textTransform:'uppercase' }}>
          <div>Tool</div>
          <div>Description</div>
          <div style={{ textAlign:'right' }}>Fns</div>
          <div style={{ textAlign:'right' }}>Calls</div>
          <div style={{ textAlign:'right' }}>✦/call</div>
          <div style={{ textAlign:'right' }}>Last</div>
        </div>
        {list.map((t, i) => (
          <div key={i}
            style={{ display:'grid', gridTemplateColumns:'minmax(220px, 1.6fr) 1fr 60px 70px 80px 70px', gap: 16, alignItems:'center', padding:'12px 0', borderBottom:`1px solid ${LB_C.border}`, fontSize: 13, cursor:'pointer' }}
            onMouseEnter={e => e.currentTarget.style.background='rgba(0,0,0,0.02)'}
            onMouseLeave={e => e.currentTarget.style.background='transparent'}>
            <div style={{ display:'flex', alignItems:'center', gap: 12, minWidth: 0 }}>
              <LB_Glyph glyph={t.glyph} tone={t.tone} size={32}/>
              <div style={{ minWidth: 0 }}>
                <div style={{ display:'flex', alignItems:'center', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: LB_C.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.name}</span>
                  <span style={{ fontSize: 10, color: LB_C.mute, fontFamily:'var(--ul-font-mono)' }}>{t.v}</span>
                </div>
                <div style={{ fontSize: 10, color: LB_C.mute, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.04em' }}>{t.tag || t.kind}</div>
              </div>
            </div>
            <div style={{ fontSize: 12, color: LB_C.sec, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.desc}</div>
            <div style={{ textAlign:'right', fontFamily:'var(--ul-font-mono)', fontSize: 11, color: LB_C.sec, fontVariantNumeric:'tabular-nums' }}>{t.fns}</div>
            <div style={{ textAlign:'right', fontFamily:'var(--ul-font-mono)', fontSize: 11, color: LB_C.sec, fontVariantNumeric:'tabular-nums' }}>{t.calls}</div>
            <div style={{ textAlign:'right', fontFamily:'var(--ul-font-mono)', fontSize: 11, color: t.cost > 0 ? LB_C.text : LB_C.mute, fontVariantNumeric:'tabular-nums', fontWeight: t.cost > 0 ? 500 : 400 }}>{t.cost > 0 ? `✦${t.cost.toFixed(3)}` : '—'}</div>
            <div style={{ textAlign:'right', fontFamily:'var(--ul-font-mono)', fontSize: 10, color: LB_C.mute }}>{t.last}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── B: Card grid — visual, with running indicators and pinned tools ──────
function LibraryGrid() {
  const tabs = ['Library', 'Shared', 'Market'];
  const [tab, setTab] = React.useState('Library');
  const tools = LB_TOOLS;
  return (
    <div style={{ background:'#fff', height:'100%', overflow:'auto' }}>
      <div style={{ padding:'24px 32px 0' }}>
        <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing:'-0.02em' }}>Tools</div>
            <div style={{ fontSize: 12, color: LB_C.sec, marginTop: 2 }}>11 in library · 3 shared · running 2</div>
          </div>
          <div style={{ display:'flex', gap: 6 }}>
            {tabs.map(t => (
              <button key={t} onClick={() => setTab(t)} style={{ fontSize: 12, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.04em', textTransform:'uppercase', padding:'6px 12px', borderRadius: 6, border: tab === t ? `1px solid ${LB_C.text}` : `1px solid ${LB_C.border}`, cursor:'pointer', background: tab === t ? LB_C.text : '#fff', color: tab === t ? '#fff' : LB_C.sec }}>{t}</button>
            ))}
          </div>
        </div>
        <div style={{ display:'flex', gap: 8, marginBottom: 18 }}>
          <input placeholder="Search tools, fns, or descriptions…" style={{ flex: 1, padding:'10px 14px', border:`1px solid ${LB_C.border}`, borderRadius: 10, fontSize: 13, fontFamily:'inherit', outline:'none', background: LB_C.raised }}/>
          <button style={{ padding:'10px 14px', border:`1px solid ${LB_C.border}`, borderRadius: 10, background:'#fff', fontSize: 12, fontFamily:'var(--ul-font-mono)', cursor:'pointer', color: LB_C.sec }}>kind ▾</button>
          <button style={{ padding:'10px 14px', border:`1px solid ${LB_C.border}`, borderRadius: 10, background:'#fff', fontSize: 12, fontFamily:'var(--ul-font-mono)', cursor:'pointer', color: LB_C.sec }}>sort: recent ▾</button>
        </div>
      </div>

      <div style={{ padding:'0 32px 32px', display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap: 12 }}>
        {tools.map((t, i) => {
          const running = i === 1; // email-ops "running"
          return (
            <div key={i} style={{ position:'relative', border:`1px solid ${LB_C.border}`, borderRadius: 14, padding: 16, background:'#fff', cursor:'pointer', transition:'box-shadow 160ms, transform 160ms' }}
              onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.06)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
              onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'translateY(0)'; }}>
              <div style={{ display:'flex', alignItems:'flex-start', gap: 12, marginBottom: 10 }}>
                <div style={{ position:'relative' }}>
                  <LB_Glyph glyph={t.glyph} tone={t.tone} size={40}/>
                  {running && <span style={{ position:'absolute', right: -2, bottom: -2, width: 12, height: 12, borderRadius: 9999, background: LB_C.green, border:'2px solid #fff', boxShadow:'0 0 0 0 rgba(34,197,94,0.6)', animation:'pui-pulse 1.4s ease-in-out infinite' }}/>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: LB_C.text, letterSpacing:'-0.01em' }}>{t.name}</div>
                  <div style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', color: LB_C.mute, marginTop: 1 }}>{t.tag} · {t.v}</div>
                </div>
                <button style={{ fontSize: 10, fontFamily:'var(--ul-font-mono)', color: LB_C.mute, background:'transparent', border:'none', cursor:'pointer' }}>···</button>
              </div>
              <div style={{ fontSize: 12, color: LB_C.sec, lineHeight: 1.5, marginBottom: 12, overflow:'hidden', display:'-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient:'vertical' }}>{t.desc}</div>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', paddingTop: 10, borderTop:`1px solid ${LB_C.border}`, fontSize: 10, fontFamily:'var(--ul-font-mono)', color: LB_C.mute, letterSpacing:'0.04em' }}>
                <div style={{ display:'flex', gap: 12 }}>
                  <span><span style={{ color: LB_C.sec, fontWeight: 500 }}>{t.fns}</span> fns</span>
                  <span><span style={{ color: LB_C.sec, fontWeight: 500 }}>{t.calls}</span> calls</span>
                </div>
                <span style={{ color: t.cost > 0 ? LB_C.text : LB_C.mute, fontWeight: t.cost > 0 ? 600 : 400 }}>{t.cost > 0 ? `✦${t.cost.toFixed(3)}` : 'free'}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── C: Sectioned — Pinned · Running · Library · Shared, all on one page ──
function LibrarySectioned() {
  const pinned = LB_TOOLS.slice(0, 3);
  const running = [LB_TOOLS[1]];
  const rest = LB_TOOLS.slice(3);

  const Row = ({ t, dense }) => (
    <div style={{ display:'flex', alignItems:'center', gap: 14, padding: dense ? '10px 14px' : '14px 14px', borderRadius: 10, cursor:'pointer', transition:'background 120ms' }}
      onMouseEnter={e => e.currentTarget.style.background='rgba(0,0,0,0.02)'}
      onMouseLeave={e => e.currentTarget.style.background='transparent'}>
      <LB_Glyph glyph={t.glyph} tone={t.tone} size={dense ? 28 : 36}/>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display:'flex', alignItems:'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{t.name}</span>
          <span style={{ fontSize: 10, fontFamily:'var(--ul-font-mono)', color: LB_C.mute }}>{t.v}</span>
        </div>
        {!dense && <div style={{ fontSize: 12, color: LB_C.sec, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.desc}</div>}
      </div>
      <span style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', color: LB_C.mute }}>{t.calls}</span>
      <span style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', color: t.cost > 0 ? LB_C.text : LB_C.mute, fontWeight: t.cost > 0 ? 500 : 400 }}>{t.cost > 0 ? `✦${t.cost.toFixed(3)}` : 'free'}</span>
    </div>
  );

  const SectionHeader = ({ title, count, action }) => (
    <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', padding:'18px 14px 6px' }}>
      <div style={{ display:'flex', alignItems:'baseline', gap: 8 }}>
        <span style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.06em', textTransform:'uppercase', color: LB_C.text, fontWeight: 600 }}>{title}</span>
        <span style={{ fontSize: 10, fontFamily:'var(--ul-font-mono)', color: LB_C.mute }}>{count}</span>
      </div>
      {action && <span style={{ fontSize: 11, color: LB_C.sec, cursor:'pointer' }}>{action}</span>}
    </div>
  );

  return (
    <div style={{ background:'#fff', height:'100%', overflow:'auto' }}>
      <div style={{ padding:'24px 32px 6px', display:'flex', alignItems:'baseline', justifyContent:'space-between' }}>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing:'-0.02em' }}>Tools</div>
        <input placeholder="Search…" style={{ width: 220, padding:'8px 12px', border:`1px solid ${LB_C.border}`, borderRadius: 8, fontSize: 12, fontFamily:'inherit', outline:'none', background: LB_C.raised }}/>
      </div>

      <div style={{ padding:'4px 18px 32px' }}>
        <SectionHeader title="◉ Running now" count={`${running.length} live`} action="View activity →"/>
        {running.map((t, i) => <Row key={'r'+i} t={t}/>)}

        <SectionHeader title="★ Pinned" count={`${pinned.length}`} action="Edit"/>
        {pinned.map((t, i) => <Row key={'p'+i} t={t}/>)}

        <SectionHeader title="Library" count={`${rest.length} more`} action="Sort: recent ▾"/>
        {rest.map((t, i) => <Row key={'l'+i} t={t} dense/>)}

        <SectionHeader title="Shared" count={`${LB_SHARED.length} workspaces`} action="Manage →"/>
        {LB_SHARED.map((s, i) => (
          <div key={'s'+i} style={{ display:'flex', alignItems:'center', gap: 14, padding:'12px 14px', borderRadius: 10, cursor:'pointer' }}
            onMouseEnter={e => e.currentTarget.style.background='rgba(0,0,0,0.02)'}
            onMouseLeave={e => e.currentTarget.style.background='transparent'}>
            <LB_Glyph glyph={s.name.split(' ').map(w=>w[0]).slice(0,2).join('')} tone={s.tone} size={32}/>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display:'flex', alignItems:'center', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</span>
                <span style={{ fontSize: 10, fontFamily:'var(--ul-font-mono)', color: LB_C.mute }}>{s.v}</span>
                <span style={{ fontSize: 10, fontFamily:'var(--ul-font-mono)', color: LB_C.sec, padding:'1px 6px', background:'rgba(0,0,0,0.04)', borderRadius: 4 }}>shared by {s.sharedBy}</span>
              </div>
              <div style={{ fontSize: 12, color: LB_C.sec, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.desc}</div>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap: 4 }}>
              {Array.from({length: Math.min(3, s.members)}).map((_, j) => (
                <span key={j} style={{ width: 22, height: 22, borderRadius: 9999, background:'#fff', border:'2px solid #fff', boxShadow:'0 0 0 1px rgba(0,0,0,0.08)', marginLeft: j ? -8 : 0, fontSize: 9, fontFamily:'var(--ul-font-mono)', color: LB_C.sec, display:'flex', alignItems:'center', justifyContent:'center' }}>{['A','R','M'][j]}</span>
              ))}
              {s.members > 3 && <span style={{ fontSize: 10, fontFamily:'var(--ul-font-mono)', color: LB_C.mute, marginLeft: 4 }}>+{s.members - 3}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── D: Hybrid — 2B header + 2C sectioned body + table metrics + ownership badges
//    Market is now a top-level sidebar destination (see SidebarWithMarket artboard) so this tab strip is just Library / Shared.
function LibraryHybrid() {
  const tabs = ['Library', 'Shared'];
  const [tab, setTab] = React.useState('Library');
  const PINNED_NAMES = ['Private Tutor', 'email-ops', 'resort-manager'];
  const pinned   = LB_TOOLS.filter(t => PINNED_NAMES.includes(t.name));
  const running  = LB_TOOLS.filter(t => t.name === 'email-ops');
  const yours    = LB_TOOLS.filter(t => t.owner === 'you' && !PINNED_NAMES.includes(t.name));
  const installed= LB_TOOLS.filter(t => t.owner !== 'you' && !PINNED_NAMES.includes(t.name));

  const OwnerBadge = ({ status, owner }) => {
    if (status === 'published') return (
      <span style={{ display:'inline-flex', alignItems:'center', gap: 4, fontSize: 9, fontFamily:'var(--ul-font-mono)', color: LB_C.green, background:'rgba(34,197,94,0.08)', padding:'2px 6px', borderRadius: 4, letterSpacing:'0.06em', textTransform:'uppercase', fontWeight: 600 }}>
        <span style={{ width: 4, height: 4, borderRadius: 9999, background: LB_C.green }}/>Published
      </span>
    );
    if (status === 'private') return (
      <span style={{ fontSize: 9, fontFamily:'var(--ul-font-mono)', color: LB_C.sec, background:'rgba(0,0,0,0.05)', padding:'2px 6px', borderRadius: 4, letterSpacing:'0.06em', textTransform:'uppercase', fontWeight: 600 }}>Private</span>
    );
    return (
      <span style={{ fontSize: 9, fontFamily:'var(--ul-font-mono)', color: LB_C.sec, padding:'2px 6px', border:`1px solid ${LB_C.border}`, borderRadius: 4, letterSpacing:'0.04em' }}>by {owner}</span>
    );
  };

  const Row = ({ t, running: isRunning, rank }) => (
    <div style={{ display:'grid', gridTemplateColumns:'40px minmax(0, 1fr) 70px 70px 70px', gap: 16, alignItems:'center', padding:'14px 14px', borderRadius: 10, cursor:'pointer', transition:'background 120ms' }}
      onMouseEnter={e => e.currentTarget.style.background='rgba(0,0,0,0.025)'}
      onMouseLeave={e => e.currentTarget.style.background='transparent'}>
      <div style={{ position:'relative' }}>
        <LB_Glyph glyph={t.glyph} tone={t.tone} size={36}/>
        {isRunning && <span style={{ position:'absolute', right: -2, bottom: -2, width: 11, height: 11, borderRadius: 9999, background: LB_C.green, border:'2px solid #fff', animation:'pui-pulse 1.4s ease-in-out infinite' }}/>}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display:'flex', alignItems:'center', gap: 8, marginBottom: 3, flexWrap:'wrap' }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: LB_C.text, letterSpacing:'-0.01em' }}>{t.name}</span>
          <span style={{ fontSize: 10, fontFamily:'var(--ul-font-mono)', color: LB_C.mute }}>{t.v}</span>
          <OwnerBadge status={t.status} owner={t.owner}/>
        </div>
        <div style={{ fontSize: 12, color: LB_C.sec, lineHeight: 1.45, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.desc}</div>
      </div>
      <div style={{ textAlign:'right', fontFamily:'var(--ul-font-mono)', fontSize: 11, color: LB_C.sec, fontVariantNumeric:'tabular-nums' }}>{t.fns}</div>
      <div style={{ textAlign:'right', fontFamily:'var(--ul-font-mono)', fontSize: 11, color: LB_C.sec, fontVariantNumeric:'tabular-nums' }}>{t.calls}</div>
      <div style={{ textAlign:'right', fontFamily:'var(--ul-font-mono)', fontSize: 10, color: LB_C.mute }}>{t.last}</div>
    </div>
  );

  const SectionHeader = ({ title, count, action }) => (
    <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', padding:'20px 14px 4px' }}>
      <div style={{ display:'flex', alignItems:'baseline', gap: 8 }}>
        <span style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.06em', textTransform:'uppercase', color: LB_C.text, fontWeight: 600 }}>{title}</span>
        <span style={{ fontSize: 10, fontFamily:'var(--ul-font-mono)', color: LB_C.mute }}>{count}</span>
      </div>
      {action && <span style={{ fontSize: 11, color: LB_C.sec, cursor:'pointer' }}>{action}</span>}
    </div>
  );

  const SharedRow = ({ s }) => (
    <div style={{ display:'grid', gridTemplateColumns:'40px minmax(0, 1fr) 100px 70px 70px', gap: 16, alignItems:'center', padding:'14px 14px', borderRadius: 10, cursor:'pointer' }}
      onMouseEnter={e => e.currentTarget.style.background='rgba(0,0,0,0.025)'}
      onMouseLeave={e => e.currentTarget.style.background='transparent'}>
      <LB_Glyph glyph={s.name.split(' ').map(w=>w[0]).slice(0,2).join('')} tone={s.tone} size={36}/>
      <div style={{ minWidth: 0 }}>
        <div style={{ display:'flex', alignItems:'center', gap: 8, marginBottom: 3 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{s.name}</span>
          <span style={{ fontSize: 10, fontFamily:'var(--ul-font-mono)', color: LB_C.mute }}>{s.v}</span>
          <span style={{ fontSize: 9, fontFamily:'var(--ul-font-mono)', color: LB_C.sec, padding:'2px 6px', border:`1px solid ${LB_C.border}`, borderRadius: 4, letterSpacing:'0.04em' }}>by {s.sharedBy}</span>
        </div>
        <div style={{ fontSize: 12, color: LB_C.sec, lineHeight: 1.45, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.desc}</div>
      </div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'flex-end', gap: 0 }}>
        {Array.from({length: Math.min(3, s.members)}).map((_, j) => (
          <span key={j} style={{ width: 22, height: 22, borderRadius: 9999, background:'#fff', border:'2px solid #fff', boxShadow:'0 0 0 1px rgba(0,0,0,0.08)', marginLeft: j ? -8 : 0, fontSize: 9, fontFamily:'var(--ul-font-mono)', color: LB_C.sec, display:'flex', alignItems:'center', justifyContent:'center' }}>{['A','R','M'][j]}</span>
        ))}
        {s.members > 3 && <span style={{ fontSize: 10, fontFamily:'var(--ul-font-mono)', color: LB_C.mute, marginLeft: 4 }}>+{s.members - 3}</span>}
      </div>
      <div style={{ textAlign:'right', fontFamily:'var(--ul-font-mono)', fontSize: 11, color: LB_C.sec, fontVariantNumeric:'tabular-nums' }}>—</div>
      <div style={{ textAlign:'right', fontFamily:'var(--ul-font-mono)', fontSize: 11, color: LB_C.sec, fontVariantNumeric:'tabular-nums' }}>shared</div>
      <div style={{ textAlign:'right', fontFamily:'var(--ul-font-mono)', fontSize: 10, color: LB_C.mute }}>{s.last}</div>
      <div></div>
    </div>
  );

  // MARKET tab → Marketplace landing UI
  if (tab === 'Market' && window.PUI_MMarketEditorial) {
    return (
      <div style={{ background:'#fff', height:'100%', display:'flex', flexDirection:'column', overflow:'hidden' }}>
        <div style={{ padding:'20px 32px 14px', borderBottom:`1px solid ${LB_C.border}`, display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing:'-0.02em' }}>Tools</div>
          <div style={{ display:'flex', gap: 6 }}>
            {tabs.map(t => (
              <button key={t} onClick={() => setTab(t)} style={{ fontSize: 12, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.04em', textTransform:'uppercase', padding:'6px 12px', borderRadius: 6, border: tab === t ? `1px solid ${LB_C.text}` : `1px solid ${LB_C.border}`, cursor:'pointer', background: tab === t ? LB_C.text : '#fff', color: tab === t ? '#fff' : LB_C.sec }}>{t}</button>
            ))}
          </div>
        </div>
        <div style={{ flex: 1, overflow:'auto' }}>
          <window.PUI_MMarketEditorial onOpenTool={() => {}}/>
        </div>
      </div>
    );
  }

  const isShared = tab === 'Shared';
  return (
    <div style={{ background:'#fff', height:'100%', overflow:'auto' }}>
      <div style={{ padding:'24px 32px 0' }}>
        <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing:'-0.02em' }}>Tools</div>
            <div style={{ fontSize: 12, color: LB_C.sec, marginTop: 2 }}>
              {isShared
                ? `${LB_SHARED.length} shared with you · ${LB_SHARED.reduce((s,x)=>s+x.members,0)} workspace members`
                : `${LB_TOOLS.length} in library · ${pinned.length} pinned · running 1`}
            </div>
          </div>
          <div style={{ display:'flex', gap: 6 }}>
            {tabs.map(t => (
              <button key={t} onClick={() => setTab(t)} style={{ fontSize: 12, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.04em', textTransform:'uppercase', padding:'6px 12px', borderRadius: 6, border: tab === t ? `1px solid ${LB_C.text}` : `1px solid ${LB_C.border}`, cursor:'pointer', background: tab === t ? LB_C.text : '#fff', color: tab === t ? '#fff' : LB_C.sec }}>{t}</button>
            ))}
          </div>
        </div>
        <div style={{ display:'flex', gap: 8, marginBottom: 8 }}>
          <input placeholder={isShared ? 'Search shared tools…' : 'Search tools, fns, or descriptions…'} style={{ flex: 1, padding:'10px 14px', border:`1px solid ${LB_C.border}`, borderRadius: 10, fontSize: 13, fontFamily:'inherit', outline:'none', background: LB_C.raised }}/>
          <button style={{ padding:'10px 14px', border:`1px solid ${LB_C.border}`, borderRadius: 10, background:'#fff', fontSize: 12, fontFamily:'var(--ul-font-mono)', cursor:'pointer', color: LB_C.sec }}>kind ▾</button>
          <button style={{ padding:'10px 14px', border:`1px solid ${LB_C.border}`, borderRadius: 10, background:'#fff', fontSize: 12, fontFamily:'var(--ul-font-mono)', cursor:'pointer', color: LB_C.sec }}>sort: recent ▾</button>
        </div>
      </div>

      <div style={{ padding:'0 32px' }}>
        <div style={{ display:'grid', gridTemplateColumns: isShared ? '40px minmax(0, 1fr) 100px 70px 70px' : '40px minmax(0, 1fr) 70px 70px 70px', gap: 16, padding:'14px 14px 8px', borderBottom:`1px solid ${LB_C.border}`, fontSize: 9, fontFamily:'var(--ul-font-mono)', color: LB_C.mute, letterSpacing:'0.08em', textTransform:'uppercase' }}>
          <div></div><div></div>
          <div style={{ textAlign:'right' }}>{isShared ? 'Members' : 'Fns'}</div>
          <div style={{ textAlign:'right' }}>Calls</div>
          <div style={{ textAlign:'right' }}>Last</div>
        </div>
      </div>

      {!isShared && (
        <div style={{ padding:'4px 18px 32px' }}>
          <SectionHeader title="◉ Running now" count={`${running.length} live`}/>
          {running.map((t, i) => <Row key={'r'+i} t={t} running/>)}

          <SectionHeader title="★ Pinned" count={`${pinned.length}`}/>
          {pinned.map((t, i) => <Row key={'p'+i} t={t} running={t.name === 'email-ops'}/>)}

          <SectionHeader title="Your tools" count={`${yours.length}`}/>
          {yours.map((t, i) => <Row key={'y'+i} t={t}/>)}

          <SectionHeader title="Installed" count={`${installed.length} from others`} action="Manage →"/>
          {installed.map((t, i) => <Row key={'i'+i} t={t}/>)}
        </div>
      )}

      {isShared && (
        <div style={{ padding:'4px 18px 32px' }}>
          <SectionHeader title="Shared with you" count={`${LB_SHARED.length}`}/>
          {LB_SHARED.map((s, i) => <SharedRow key={'sh'+i} s={s}/>)}
        </div>
      )}
    </div>
  );
}

window.PUI_LibraryBefore = PUI_LibraryBefore;
window.PUI_LibraryReceipts = LibraryReceipts;
window.PUI_LibraryGrid = LibraryGrid;
window.PUI_LibrarySectioned = LibrarySectioned;
window.PUI_LibraryHybrid = LibraryHybrid;

// ─────────────────────────────────────────────────────────────────────────
// Sidebar with Market promoted — proposed nav structure
// Before: Command / Tools / New Chat   (Market lives inside Tools as a tab)
// After:  Command / Tools (Library + Shared) / Market / New Chat
// ─────────────────────────────────────────────────────────────────────────
function PUI_SidebarMarketProposal({ variant = 'after' }) {
  const I = LB_Icons;
  const SYS_AGENTS = window.PUI_Primitives.SYS_AGENTS;

  const TopItem = ({ icon: Icon, label, active, badge, sub, indent }) => (
    <div style={{ display:'flex', alignItems:'center', gap: 10, padding:'7px 10px', paddingLeft: indent ? 26 : 10, fontSize: 13.5, color: active ? LB_C.text : LB_C.sec, fontWeight: active ? 500 : 400, background: active ? 'rgba(0,0,0,0.05)' : 'transparent', borderRadius: 7, cursor:'pointer' }}>
      {Icon && <span style={{ color: active ? LB_C.text : LB_C.sec, display:'inline-flex' }}><Icon size={15}/></span>}
      <span style={{ flex: 1 }}>{label}</span>
      {sub && <span style={{ fontSize: 10, fontFamily:'var(--ul-font-mono)', color: LB_C.mute }}>{sub}</span>}
      {badge && <span style={{ fontSize: 9, fontFamily:'var(--ul-font-mono)', color:'#fff', background: LB_C.green, padding:'2px 6px', borderRadius: 4, letterSpacing:'0.04em' }}>{badge}</span>}
    </div>
  );

  const SectionLabel = ({ children, action }) => (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 12px 6px' }}>
      <span style={{ fontSize: 10, fontFamily:'var(--ul-font-mono)', color: LB_C.mute, letterSpacing:'0.08em', textTransform:'uppercase' }}>{children}</span>
      {action && <span style={{ fontSize: 10, color: LB_C.mute, cursor:'pointer' }}>{action}</span>}
    </div>
  );

  const Wordmark = window.PUI_Primitives.Wordmark;

  if (variant === 'before') {
    return (
      <div style={{ width: 256, height:'100%', background: LB_C.sidebar, borderRight:`1px solid ${LB_C.border}`, display:'flex', flexDirection:'column' }}>
        <div style={{ padding:'16px 16px 8px' }}><Wordmark fontSize={15}/></div>
        <div style={{ padding:'4px 8px 8px', flex: 1, overflow:'auto' }}>
          <TopItem icon={I.IconCompass} label="Command"/>
          <TopItem icon={I.IconPackage} label="Tools" active sub="L · S · M"/>
          <TopItem icon={I.IconCirclePlus} label="New chat"/>

          <SectionLabel>System agents</SectionLabel>
          {SYS_AGENTS.map(a => (
            <div key={a.id} style={{ display:'flex', alignItems:'center', gap: 10, padding:'7px 10px', fontSize: 13.5, color: LB_C.sec, borderRadius: 7 }}>
              <span style={{ color: a.color, display:'inline-flex' }}><a.Icon size={15}/></span>
              <span style={{ flex: 1 }}>{a.name}</span>
            </div>
          ))}

          <SectionLabel action="🔍">Chats</SectionLabel>
          <div style={{ padding:'4px 12px', fontSize: 11, color: LB_C.mute, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.04em' }}>OLDER</div>
          {['View My Inbox Messages','Flash Lemon','Recent Email Inbox Overview','Reviewing My Email Inbox'].map((t,i) => (
            <div key={i} style={{ display:'flex', alignItems:'center', gap: 10, padding:'6px 10px', fontSize: 13, color: LB_C.sec }}>
              <span style={{ width: 6, height: 6, borderRadius: 9999, background: i === 1 ? SYS_AGENTS[0].color : LB_C.mute }}/>
              <span style={{ flex: 1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // AFTER — Market promoted to top-level
  return (
    <div style={{ width: 256, height:'100%', background: LB_C.sidebar, borderRight:`1px solid ${LB_C.border}`, display:'flex', flexDirection:'column' }}>
      <div style={{ padding:'16px 16px 8px' }}><Wordmark fontSize={15}/></div>
      <div style={{ padding:'4px 8px 8px', flex: 1, overflow:'auto' }}>
        <TopItem icon={I.IconCompass} label="Command" sub="3"/>

        <TopItem icon={I.IconPackage} label="Tools" active sub="11"/>

        <TopItem icon={I.IconStore} label="Market" badge="NEW"/>

        <TopItem icon={I.IconCirclePlus} label="New chat"/>

        <SectionLabel>System agents</SectionLabel>
        {SYS_AGENTS.map(a => (
          <div key={a.id} style={{ display:'flex', alignItems:'center', gap: 10, padding:'7px 10px', fontSize: 13.5, color: LB_C.sec, borderRadius: 7 }}>
            <span style={{ color: a.color, display:'inline-flex' }}><a.Icon size={15}/></span>
            <span style={{ flex: 1 }}>{a.name}</span>
          </div>
        ))}

        <SectionLabel action="🔍">Chats</SectionLabel>
        <div style={{ padding:'4px 12px', fontSize: 11, color: LB_C.mute, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.04em' }}>OLDER</div>
        {['View My Inbox Messages','Flash Lemon','Recent Email Inbox Overview','Reviewing My Email Inbox'].map((t,i) => (
          <div key={i} style={{ display:'flex', alignItems:'center', gap: 10, padding:'6px 10px', fontSize: 13, color: LB_C.sec }}>
            <span style={{ width: 6, height: 6, borderRadius: 9999, background: i === 1 ? SYS_AGENTS[0].color : LB_C.mute }}/>
            <span style={{ flex: 1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

window.PUI_SidebarMarketProposal = PUI_SidebarMarketProposal;
