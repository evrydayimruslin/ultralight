// Command — composable widget HOMESCREEN.
//
// Mental model: iOS homescreen, but every tile is a widget exposed by an
// installed tool/MCP. Each tool ships its own widget(s) with custom code
// (these are samples). The user composes their dashboard by adding widgets
// from the picker — exactly like adding a widget on iOS.
//
// Consolidated around two surviving directions:
//   1B · Cozy iOS tiles (lead) — 1B + edit mode
//   1A · Bento (alternate)     — denser, dashboard-y
//
// Plus a dedicated Widget Picker close-up, since picking widgets *from your
// installed tools* is the central interaction.

const CS_C = window.PUI_Primitives.C;
const { SYS_AGENTS: CS_AGENTS, Spark: CS_Spark } = window.PUI_Primitives;
const CS_Icons = window.PUI_Icons;

// ── BEFORE: the current Command screen ───────────────────────────────────
function PUI_CommandBefore() {
  const tiles = [
    { emoji: '🎯', label: 'Quiz',           sub: 'Private Tutor', count: 36 },
    { emoji: '📊', label: 'Study Progress', sub: 'Private Tutor', count: 2 },
    { emoji: '📖', label: 'Lessons',        sub: 'Private Tutor', count: 1 },
    { emoji: '✉️', label: 'Email Approvals', sub: 'email-ops',    count: 22 },
    { emoji: '📋', label: 'Email FAQs',     sub: 'email-ops',     count: 15 },
  ];
  return (
    <div style={{ background:'#fff', padding: 24, height:'100%' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: 24 }}>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing:'-0.02em' }}>Command</div>
        <span style={{ fontSize: 14, color: CS_C.mute, cursor:'pointer' }}>↻</span>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap: 14 }}>
        {tiles.map((t, i) => (
          <div key={i} style={{ position:'relative', border:`1px solid ${CS_C.border}`, borderRadius: 14, padding: 18, height: 130, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', textAlign:'center' }}>
            <div style={{ position:'absolute', top: 8, right: 8, background:'#ef4444', color:'#fff', minWidth: 18, height: 18, padding:'0 6px', borderRadius: 9999, fontSize: 10, fontWeight: 600, display:'flex', alignItems:'center', justifyContent:'center' }}>{t.count}</div>
            <div style={{ fontSize: 26, marginBottom: 6 }}>{t.emoji}</div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{t.label}</div>
            <div style={{ fontSize: 11, color: CS_C.mute, marginTop: 2 }}>{t.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Tool registry: each tool can expose 1+ widgets ───────────────────────
const CS_TOOLS = [
  { id:'email',  name:'email-ops',      glyph:'EO', tone:'#22c55e', author:'@ada' },
  { id:'tutor',  name:'Private Tutor',  glyph:'PT', tone:'#3b82f6', author:'@kemi' },
  { id:'github', name:'github-mcp',     glyph:'GH', tone:'#0a0a0a', author:'github inc.' },
  { id:'fx',     name:'fx-rates',       glyph:'FX', tone:'#004225', author:'@finn' },
  { id:'resort', name:'resort-manager', glyph:'RM', tone:'#722F37', author:'@hugo' },
  { id:'fitness',name:'Fitness Tracker',glyph:'FT', tone:'#e8590c', author:'@jules' },
  { id:'cal',    name:'calendar-mcp',   glyph:'CL', tone:'#7c3aed', author:'@nora' },
  { id:'expense',name:'expense-pal',    glyph:'EX', tone:'#0891b2', author:'@theo' },
];
const CS_TOOL = id => CS_TOOLS.find(t => t.id === id);

// Each installed tool publishes a catalog of widgets with size variants.
// In production the tool ships the render function; here we render samples.
// Each widget ships at one fixed, developer-chosen size. No S/M/L variants —
// the tool author picks the size that fits its content.
const CS_WIDGETS = [
  { tool:'email',   id:'drafts',   name:'Drafts queue',         size:'L', desc:'numbers + sender list', perms:[{ scope:'Mail', detail:'Read drafts and sender metadata' }] },
  { tool:'email',   id:'volume',   name:'Inbox volume',         size:'M', desc:'24h sparkline',         perms:[{ scope:'Mail', detail:'Read message counts (no contents)' }] },
  { tool:'tutor',   id:'surfaces', name:'Surfaces ready',       size:'M', desc:'count + chips' },
  { tool:'tutor',   id:'mastery',  name:'Mastery by topic',     size:'L', desc:'horizontal bars' },
  { tool:'github',  id:'prs',      name:'PRs · CI',             size:'M', desc:'status pills',          perms:[{ scope:'GitHub', detail:'Read pull requests & CI status on selected repos' }] },
  { tool:'github',  id:'deploys',  name:'Deploys today',        size:'M', desc:'timeline',              perms:[{ scope:'GitHub', detail:'Read deployment events' }] },
  { tool:'fx',      id:'watch',    name:'Watchlist',            size:'S', desc:'pair ticker' },
  { tool:'resort',  id:'occ',      name:'Occupancy',            size:'S', desc:'percent + bar' },
  { tool:'fitness', id:'rings',    name:'Today',                size:'S', desc:'rings + steps',         perms:[{ scope:'Health', detail:'Read activity rings, steps, and workouts' }] },
  { tool:'cal',     id:'next',     name:'Next on calendar',     size:'L', desc:'meeting list',          perms:[{ scope:'Calendar', detail:'Read upcoming events' }, { scope:'GitHub', detail:'Cross-link PRs mentioned in invites' }] },
  { tool:'expense', id:'pending',  name:'Pending receipts',     size:'S', desc:'count + amount',        perms:[{ scope:'Mail', detail:'Scan for receipt attachments' }] },
];

// ── Visual primitives ────────────────────────────────────────────────────
function CS_Spark1({ data, w = 100, h = 24, color = CS_C.text, fill = false }) {
  const max = Math.max(...data), min = Math.min(...data);
  const norm = v => h - ((v - min) / (max - min || 1)) * (h - 2) - 1;
  const step = w / (data.length - 1);
  const d = data.map((v, i) => `${i ? 'L' : 'M'}${(i*step).toFixed(1)},${norm(v).toFixed(1)}`).join(' ');
  return (
    <svg width={w} height={h} style={{ display:'block' }}>
      {fill && <path d={`${d} L${w},${h} L0,${h} Z`} fill={color} opacity="0.10"/>}
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
function CS_Mono({ glyph, tone, size = 28, radius = 7 }) {
  return <div style={{ width:size, height:size, borderRadius:radius, background:tone, color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'var(--ul-font-mono)', fontWeight:700, fontSize: Math.round(size*0.36), letterSpacing:'-0.02em', flexShrink:0 }}>{glyph}</div>;
}
function CS_Ring({ pct, size = 36, stroke = 4, color = '#22c55e', track = 'rgba(0,0,0,0.06)' }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - pct);
  return (
    <svg width={size} height={size} style={{ display:'block', transform:'rotate(-90deg)' }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={track} strokeWidth={stroke}/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off}/>
    </svg>
  );
}

// ╔══════════════════════════════════════════════════════════════════════╗
// ║  SAMPLE WIDGET CONTENTS                                              ║
// ║  These are the per-tool render functions a developer would ship.     ║
// ║  Each accepts a "size" ('S' | 'M' | 'L') and renders accordingly.    ║
// ╚══════════════════════════════════════════════════════════════════════╝

// email-ops · Drafts queue
function CW_EmailDrafts({ size = 'L' }) {
  const senders = [
    { n: 'Aiko Tanaka',     sub: 're: Q3 wholesale terms',      t: '2m' },
    { n: 'support@stripe',  sub: 'webhook 4xx — needs ack',     t: '6m' },
    { n: 'Pavel Nowak',     sub: 'introduction, mutual @sara',  t: '11m' },
    { n: 'David Choe',      sub: 're: studio visit thu',        t: '24m' },
  ];
  return (
    <div style={{ display:'flex', flexDirection:'column', gap: size==='L'?12:8, height:'100%' }}>
      <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between' }}>
        <div style={{ fontSize: size==='L'?64:36, fontWeight:700, letterSpacing:'-0.035em', lineHeight:0.9, fontVariantNumeric:'tabular-nums' }}>22</div>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <span style={{ width:6, height:6, borderRadius:9999, background:'#22c55e', animation:'pui-pulse 1.6s infinite' }}/>
          <span style={{ fontSize:9, fontFamily:'var(--ul-font-mono)', color:'#22c55e', letterSpacing:'0.08em' }}>LIVE</span>
        </div>
      </div>
      <div style={{ fontSize: size==='L'?14:12, color: CS_C.text, fontWeight: 500 }}>drafts awaiting your review</div>
      {size === 'L' && (
        <div style={{ flex:1, display:'flex', flexDirection:'column', gap:6, marginTop: 4 }}>
          {senders.map((s, i) => (
            <div key={i} style={{ display:'flex', alignItems:'baseline', gap:8, paddingBottom:6, borderBottom: i<3 ? `1px solid ${CS_C.border}` : 'none' }}>
              <div style={{ fontSize:11, fontWeight:600, color: CS_C.text, minWidth:96, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.n}</div>
              <div style={{ flex:1, fontSize:11, color: CS_C.sec, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.sub}</div>
              <div style={{ fontSize:10, fontFamily:'var(--ul-font-mono)', color: CS_C.mute, fontVariantNumeric:'tabular-nums' }}>{s.t}</div>
            </div>
          ))}
        </div>
      )}
      <div style={{ marginTop:'auto', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div style={{ fontSize:10, fontFamily:'var(--ul-font-mono)', color: CS_C.mute }}>148 auto-tagged · 3 bounced</div>
      </div>
    </div>
  );
}

// Private Tutor · Surfaces ready
function CW_TutorSurfaces({ size = 'M' }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:8, height:'100%' }}>
      <div style={{ display:'flex', alignItems:'baseline', gap: 12 }}>
        <div style={{ fontSize: 44, fontWeight:700, letterSpacing:'-0.025em', fontVariantNumeric:'tabular-nums', lineHeight:1 }}>39</div>
        <div style={{ fontSize: 13, color: CS_C.sec }}>surfaces ready</div>
      </div>
      <div style={{ display:'flex', flexWrap:'wrap', gap: 5, fontSize: 10, fontFamily:'var(--ul-font-mono)', color: CS_C.mute }}>
        <span style={{ background:'rgba(59,130,246,0.10)', color:'#3b82f6', padding:'3px 7px', borderRadius:5, fontWeight:600 }}>36 quiz</span>
        <span style={{ background:'rgba(0,0,0,0.04)', padding:'3px 7px', borderRadius:5 }}>2 reports</span>
        <span style={{ background:'rgba(0,0,0,0.04)', padding:'3px 7px', borderRadius:5 }}>1 lesson</span>
      </div>
      <div style={{ marginTop:'auto', fontSize:10, fontFamily:'var(--ul-font-mono)', color: CS_C.mute }}>last: <span style={{ color: CS_C.text }}>algebra 7 · 8m ago</span></div>
    </div>
  );
}

// github-mcp · PRs + CI
function CW_GitHubPRs({ size = 'S' }) {
  if (size === 'S') {
    return (
      <div style={{ display:'flex', flexDirection:'column', gap:6, height:'100%' }}>
        <div style={{ fontSize: 32, fontWeight:700, letterSpacing:'-0.025em', fontVariantNumeric:'tabular-nums', lineHeight:1 }}>4</div>
        <div style={{ fontSize: 11, color: CS_C.sec }}>PRs open</div>
        <div style={{ marginTop:'auto', display:'flex', alignItems:'center', gap:6 }}>
          <span style={{ width:6, height:6, borderRadius:9999, background:'#22c55e' }}/>
          <span style={{ fontSize:10, fontFamily:'var(--ul-font-mono)', color: CS_C.text, fontVariantNumeric:'tabular-nums' }}>CI 97%</span>
        </div>
      </div>
    );
  }
  const prs = [
    { repo:'shop/api', t:'fix idempotency on refund', s:'green' },
    { repo:'shop/web', t:'a11y · keyboard cart',      s:'green' },
    { repo:'infra',    t:'bump terraform → 1.7',      s:'red'   },
    { repo:'shop/api', t:'spike: queue partitioning', s:'gray'  },
  ];
  const dot = c => ({ green:'#22c55e', red:'#ef4444', gray:'#a1a1a1' }[c]);
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:8, height:'100%' }}>
      <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between' }}>
        <div style={{ fontSize: 32, fontWeight:700, letterSpacing:'-0.025em', fontVariantNumeric:'tabular-nums', lineHeight:1 }}>4 PRs</div>
        <div style={{ fontSize:10, fontFamily:'var(--ul-font-mono)', color:'#22c55e' }}>CI 97%</div>
      </div>
      <div style={{ flex:1, display:'flex', flexDirection:'column', gap:5, overflow:'hidden' }}>
        {prs.map((p, i) => (
          <div key={i} style={{ display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ width:6, height:6, borderRadius:9999, background: dot(p.s), flexShrink:0 }}/>
            <span style={{ fontSize:10, fontFamily:'var(--ul-font-mono)', color: CS_C.mute, minWidth: 72 }}>{p.repo}</span>
            <span style={{ fontSize:11, color: CS_C.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.t}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// fx-rates · Watchlist
function CW_FXWatch({ size = 'S' }) {
  const pairs = [
    { p:'EUR/USD', v:'1.0834', d:'+0.18%', up:true },
    { p:'GBP/USD', v:'1.2641', d:'-0.04%', up:false },
    { p:'USD/JPY', v:'149.18', d:'+0.22%', up:true },
    { p:'AUD/USD', v:'0.6587', d:'-0.11%', up:false },
  ];
  const visible = size === 'L' ? 4 : size === 'M' ? 3 : 2;
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:6, height:'100%', fontFamily:'var(--ul-font-mono)', fontSize:11, fontVariantNumeric:'tabular-nums' }}>
      {pairs.slice(0, visible).map(p => (
        <div key={p.p} style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between' }}>
          <span style={{ color: CS_C.sec }}>{p.p}</span>
          <span style={{ display:'flex', alignItems:'baseline', gap:6 }}>
            <span style={{ color: CS_C.text, fontWeight:600 }}>{p.v}</span>
            <span style={{ color: p.up ? '#22c55e' : '#ef4444', fontSize:10 }}>{p.d}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

// resort-manager · Occupancy
function CW_ResortOcc({ size = 'S' }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:6, height:'100%' }}>
      <div style={{ fontSize: 32, fontWeight:700, letterSpacing:'-0.025em', fontVariantNumeric:'tabular-nums', lineHeight:1 }}>87%</div>
      <div style={{ fontSize: 11, color: CS_C.sec }}>occupancy · 42/48</div>
      <div style={{ marginTop:'auto', height: 4, background:'rgba(0,0,0,0.05)', borderRadius:9999, overflow:'hidden' }}>
        <div style={{ width:'87%', height:'100%', background:'#722F37' }}/>
      </div>
      <div style={{ fontSize:9, fontFamily:'var(--ul-font-mono)', color: CS_C.mute }}>6 turning over today</div>
    </div>
  );
}

// fitness · Rings
function CW_FitnessRings({ size = 'S' }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', gap: 6 }}>
      <div style={{ display:'flex', alignItems:'center', gap: 10 }}>
        <CS_Ring pct={0.78} size={42} color="#e8590c"/>
        <div>
          <div style={{ fontSize: 22, fontWeight:700, letterSpacing:'-0.02em', fontVariantNumeric:'tabular-nums', lineHeight:1 }}>8,420</div>
          <div style={{ fontSize:10, fontFamily:'var(--ul-font-mono)', color: CS_C.mute }}>steps</div>
        </div>
      </div>
      <div style={{ marginTop:'auto', fontSize:10, fontFamily:'var(--ul-font-mono)', color: CS_C.mute }}>move <span style={{color:'#e8590c', fontWeight:600}}>78%</span> · stand 11/12</div>
    </div>
  );
}

// calendar · Next on calendar
function CW_CalendarNext({ size = 'M' }) {
  const items = [
    { t:'Now',   title:'Design crit · Premium UI',  who:'4 attendees', tone:'#22c55e' },
    { t:'2:30',  title:'1:1 with Maya',             who:'@maya',       tone:'#3b82f6' },
    { t:'4:00',  title:'Vendor review',             who:'8 attendees', tone:'#7c3aed' },
  ];
  const visible = size === 'L' ? 3 : 2;
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:8, height:'100%' }}>
      <div style={{ fontSize:10, fontFamily:'var(--ul-font-mono)', color: CS_C.mute, letterSpacing:'0.06em', textTransform:'uppercase' }}>up next · sun mar 9</div>
      <div style={{ flex:1, display:'flex', flexDirection:'column', gap:8 }}>
        {items.slice(0, visible).map((it, i) => (
          <div key={i} style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', fontWeight:600, color: it.tone, minWidth: 36, fontVariantNumeric:'tabular-nums' }}>{it.t}</div>
            <div style={{ width: 2, height: 26, background: it.tone, borderRadius: 1 }}/>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize: 12, fontWeight:600, color: CS_C.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{it.title}</div>
              <div style={{ fontSize: 10, color: CS_C.mute }}>{it.who}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// expense · Pending receipts
function CW_ExpensePending({ size = 'S' }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:6, height:'100%' }}>
      <div style={{ fontSize: 32, fontWeight:700, letterSpacing:'-0.025em', fontVariantNumeric:'tabular-nums', lineHeight:1 }}>7</div>
      <div style={{ fontSize:11, color: CS_C.sec }}>receipts to file</div>
      <div style={{ marginTop:'auto', fontSize:11, fontFamily:'var(--ul-font-mono)', color: CS_C.text, fontVariantNumeric:'tabular-nums' }}>$1,284.30</div>
      <div style={{ fontSize:9, fontFamily:'var(--ul-font-mono)', color: CS_C.mute }}>oldest: 4 days</div>
    </div>
  );
}

// Burn rate widget — special, aggregates per-widget burn
function CW_Burn({ size = 'M' }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:8, height:'100%' }}>
      <div style={{ fontSize:10, fontFamily:'var(--ul-font-mono)', color: CS_C.mute, letterSpacing:'0.06em', textTransform:'uppercase' }}>Burn · all widgets</div>
      <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between' }}>
        <div style={{ fontSize: 30, fontWeight:700, letterSpacing:'-0.025em', fontVariantNumeric:'tabular-nums', lineHeight:1 }}>✦0.024<span style={{fontSize:11, color: CS_C.mute, fontWeight:500}}>/min</span></div>
        <div style={{ fontSize:10, fontFamily:'var(--ul-font-mono)', color:'#22c55e' }}>+8% · 1h</div>
      </div>
      <div style={{ marginTop:'auto' }}>
        <CS_Spark1 data={[0.018,0.022,0.020,0.027,0.024,0.030,0.024,0.022,0.026]} w={size==='L'?460:240} h={size==='L'?44:28} color={CS_C.text} fill/>
      </div>
    </div>
  );
}

// ── Cozy tile chrome ─────────────────────────────────────────────────────
function CozyTile({ tool, burn, span, rowSpan, onOpen, edit, onRemove, children, style = {} }) {
  const t = tool ? CS_TOOL(tool) : null;
  const wig = edit ? { animation: `cs-wiggle 0.45s ease-in-out ${(rowSpan||1)*0.05}s infinite` } : {};
  return (
    <div
      onClick={edit ? null : onOpen}
      style={{
        gridColumn: `span ${span}`,
        gridRow: rowSpan ? `span ${rowSpan}` : undefined,
        background:'#fff',
        border:`1px solid ${CS_C.border}`,
        borderRadius: 22,
        padding: 18,
        position:'relative',
        cursor: edit ? 'grab' : 'pointer',
        overflow: edit ? 'visible' : 'hidden',
        transition:'transform 160ms ease, box-shadow 160ms ease',
        display:'flex', flexDirection:'column', gap: 10,
        boxShadow: edit ? '0 4px 18px rgba(0,0,0,0.08)' : 'none',
        ...wig,
        ...style,
      }}
      onMouseEnter={e => { if (!edit) { e.currentTarget.style.boxShadow = '0 6px 22px rgba(0,0,0,0.07)'; e.currentTarget.style.transform = 'translateY(-1px)'; } }}
      onMouseLeave={e => { if (!edit) { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'translateY(0)'; } }}
    >
      {edit && (
        <div onClick={e => { e.stopPropagation(); onRemove && onRemove(); }} style={{ position:'absolute', top: -8, left: -8, width: 22, height: 22, borderRadius: 9999, background:'#0a0a0a', color:'#fff', fontSize: 14, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', boxShadow:'0 2px 6px rgba(0,0,0,0.2)', lineHeight:1, zIndex:5 }}>×</div>
      )}
      {t && (
        <div style={{ display:'flex', alignItems:'center', gap: 10 }}>
          <CS_Mono glyph={t.glyph} tone={t.tone} size={22} radius={6}/>
          <div style={{ fontSize:10, fontFamily:'var(--ul-font-mono)', color: t.tone, letterSpacing:'0.08em', textTransform:'uppercase', fontWeight:600 }}>{t.name}</div>
          {burn != null && (
            <div style={{ marginLeft:'auto', fontSize:10, fontFamily:'var(--ul-font-mono)', color: CS_C.mute, fontVariantNumeric:'tabular-nums' }}>✦{burn.toFixed(3)}/min</div>
          )}
        </div>
      )}
      <div style={{ flex:1, minHeight:0 }}>{children}</div>
    </div>
  );
}

// ── 1B · COZY HOMESCREEN — lead direction ────────────────────────────────
// Ships in two states: view (default) and edit (wiggle + drop slots + ×).
function CozyHomescreen({ initialEdit = false, fixedDate = 'Sunday, March 9' }) {
  const [edit, setEdit] = React.useState(initialEdit);
  const [picker, setPicker] = React.useState(false);
  const [expanded, setExpanded] = React.useState(null);

  // wiggle keyframes injected once
  React.useEffect(() => {
    if (typeof document === 'undefined' || document.getElementById('cs-wiggle-anim')) return;
    const s = document.createElement('style');
    s.id = 'cs-wiggle-anim';
    s.textContent = `@keyframes cs-wiggle { 0%,100% { transform: rotate(-0.4deg) } 50% { transform: rotate(0.4deg) } }`;
    document.head.appendChild(s);
  }, []);

  const open = which => !edit && setExpanded(which);

  return (
    <div style={{ background:'#f6f6f4', height:'100%', overflow:'auto', position:'relative' }}>
      {/* Header */}
      <div style={{ padding:'24px 26px 14px', display:'flex', alignItems:'flex-end', justifyContent:'space-between' }}>
        <div>
          <div style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.08em', textTransform:'uppercase', color: edit ? '#3b82f6' : CS_C.mute, marginBottom: 4 }}>
            {edit ? 'Command · edit mode' : 'Command'}
          </div>
          <div style={{ fontSize: 26, fontWeight: 700, letterSpacing:'-0.025em' }}>
            {edit ? <>Drag or remove</> : <>{fixedDate}</>}
          </div>
        </div>
        <div style={{ display:'flex', gap: 8 }}>
          {!edit && (
            <button onClick={() => setEdit(true)} style={{ fontSize:12, fontFamily:'var(--ul-font-mono)', color: CS_C.sec, background:'#fff', border:`1px solid ${CS_C.border}`, padding:'8px 12px', borderRadius:8, cursor:'pointer' }}>Edit layout</button>
          )}
          {edit && (
            <button onClick={() => setEdit(false)} style={{ fontSize:12, fontFamily:'var(--ul-font-mono)', color: CS_C.sec, background:'#fff', border:`1px solid ${CS_C.border}`, padding:'8px 14px', borderRadius:8, cursor:'pointer' }}>Done</button>
          )}
          <button onClick={() => setPicker(true)} style={{ fontSize:12, fontFamily:'var(--ul-font-mono)', color: '#fff', background: CS_C.text, border:`1px solid ${CS_C.text}`, padding:'8px 14px', borderRadius:8, cursor:'pointer' }}>＋ Widget</button>
        </div>
      </div>

      {/* 4-column grid, 150px rows. Infinite capacity — vertical scroll. */}
      <div style={{ padding:'8px 22px 22px', display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gridAutoRows:'150px', gap: 14 }}>
        {/* PAGE 1 ─────────────────────────────────────── */}
        <CozyTile tool="email"  burn={0.014} span={2} rowSpan={2} onOpen={() => open('email')}  edit={edit}><CW_EmailDrafts size="L"/></CozyTile>
        <CozyTile tool="tutor"  burn={0.006} span={2}              onOpen={() => open('tutor')}  edit={edit}><CW_TutorSurfaces size="M"/></CozyTile>
        <CozyTile tool="cal"    burn={0.001} span={2}              onOpen={() => open('cal')}    edit={edit}><CW_CalendarNext size="M"/></CozyTile>

        <CozyTile tool="github" burn={0.002} span={1}              onOpen={() => open('github')} edit={edit}><CW_GitHubPRs size="S"/></CozyTile>
        <CozyTile tool="fx"     burn={0.001} span={1}              onOpen={() => open('fx')}     edit={edit}><CW_FXWatch size="S"/></CozyTile>
        <CozyTile tool="resort" burn={0.001} span={1}              onOpen={() => open('resort')} edit={edit}><CW_ResortOcc size="S"/></CozyTile>
        <CozyTile tool="fitness"burn={0.001} span={1}              onOpen={() => open('fitness')}edit={edit}><CW_FitnessRings size="S"/></CozyTile>

        <CozyTile               burn={null}  span={2}              onOpen={() => open('burn')}   edit={edit}><CW_Burn size="M"/></CozyTile>
        <CozyTile tool="expense"burn={0.000} span={1}              onOpen={() => open('expense')}edit={edit}><CW_ExpensePending size="S"/></CozyTile>
        <CozyTile tool="github" burn={0.001} span={1}              onOpen={() => open('github')} edit={edit}><CW_GitHubPRs size="S"/></CozyTile>

        {/* page break */}
        <div style={{ gridColumn:'1 / -1', display:'flex', alignItems:'center', gap: 10, padding:'10px 0 4px' }}>
          <span style={{ flex:1, height:1, background:'rgba(0,0,0,0.06)' }}/>
          <span style={{ fontSize:9, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.12em', textTransform:'uppercase', color: CS_C.mute }}>page 2</span>
          <span style={{ flex:1, height:1, background:'rgba(0,0,0,0.06)' }}/>
        </div>

        {/* PAGE 2 ─────────────────────────────────────── */}
        <CozyTile tool="tutor"  burn={0.003} span={2} rowSpan={2} onOpen={() => open('tutor')}  edit={edit}><CW_EmailDrafts size="L"/></CozyTile>
        <CozyTile tool="cal"    burn={0.001} span={2}              onOpen={() => open('cal')}    edit={edit}><CW_CalendarNext size="M"/></CozyTile>
        <CozyTile tool="fx"     burn={0.001} span={1}              onOpen={() => open('fx')}     edit={edit}><CW_FXWatch size="S"/></CozyTile>
        <CozyTile tool="resort" burn={0.001} span={1}              onOpen={() => open('resort')} edit={edit}><CW_ResortOcc size="S"/></CozyTile>
        <CozyTile tool="email"  burn={0.002} span={2}              onOpen={() => open('email')}  edit={edit}><CW_TutorSurfaces size="M"/></CozyTile>
        <CozyTile tool="fitness"burn={0.001} span={1}              onOpen={() => open('fitness')}edit={edit}><CW_FitnessRings size="S"/></CozyTile>
        <CozyTile tool="expense"burn={0.000} span={1}              onOpen={() => open('expense')}edit={edit}><CW_ExpensePending size="S"/></CozyTile>

        {edit ? (
          <div style={{ gridColumn:'span 2', borderRadius: 22, border:`2px dashed rgba(59,130,246,0.45)`, background:'rgba(59,130,246,0.04)', display:'flex', alignItems:'center', justifyContent:'center', color:'#3b82f6', fontSize:10, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.08em', textTransform:'uppercase', textAlign:'center', padding: 8 }}>
            Drop here
          </div>
        ) : (
          <div onClick={() => setPicker(true)} style={{ gridColumn:'span 2', borderRadius: 22, border:`1px dashed ${CS_C.borderStrong}`, background:'transparent', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', cursor:'pointer', color: CS_C.mute, gap: 4 }}>
            <span style={{ fontSize: 22 }}>＋</span>
            <span style={{ fontSize:10, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.08em', textTransform:'uppercase' }}>Add widget</span>
          </div>
        )}

        {/* page indicator dots */}
        <div style={{ gridColumn:'1 / -1', display:'flex', justifyContent:'center', gap: 6, padding:'18px 0 4px' }}>
          <span style={{ width: 6, height: 6, borderRadius: 9999, background: 'rgba(0,0,0,0.18)' }}/>
          <span style={{ width: 6, height: 6, borderRadius: 9999, background: CS_C.text }}/>
          <span style={{ width: 18, height: 6, borderRadius: 9999, background: 'rgba(0,0,0,0.10)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:8, color: CS_C.mute, fontFamily:'var(--ul-font-mono)' }}>+</span>
        </div>
      </div>

      {/* Edit-mode bottom toolbar removed per feedback — controls live in the page header. */}

      {picker && <WidgetPicker onClose={() => setPicker(false)}/>}
      {expanded && <WidgetExpanded which={expanded} onClose={() => setExpanded(null)}/>}
    </div>
  );
}

// ── 1A · BENTO — denser dashboard alternate ──────────────────────────────
function CommandBento() {
  const [picker, setPicker] = React.useState(false);
  const [expanded, setExpanded] = React.useState(null);

  const Tile = ({ tool, burn, span, rowSpan, onOpen, children }) => {
    const t = tool ? CS_TOOL(tool) : null;
    return (
      <div onClick={onOpen} style={{ gridColumn:`span ${span}`, gridRow: rowSpan?`span ${rowSpan}`:undefined, background:'#fff', border:`1px solid ${CS_C.border}`, borderRadius: 14, padding: 14, position:'relative', overflow:'hidden', cursor: onOpen ? 'pointer' : 'default', transition:'transform 140ms ease, box-shadow 140ms ease', display:'flex', flexDirection:'column', minHeight: 0 }}
        onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 14px rgba(0,0,0,0.06)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
        onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'translateY(0)'; }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom: 8 }}>
          {t && <CS_Mono glyph={t.glyph} tone={t.tone} size={18} radius={4}/>}
          <div style={{ flex:1, minWidth:0, fontSize:10, fontFamily:'var(--ul-font-mono)', color: t ? t.tone : CS_C.mute, letterSpacing:'0.08em', textTransform:'uppercase', fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t ? t.name : 'system'}</div>
          {burn != null && <div style={{ fontSize:9, fontFamily:'var(--ul-font-mono)', color: CS_C.mute, fontVariantNumeric:'tabular-nums' }}>✦{burn.toFixed(3)}/m</div>}
        </div>
        <div style={{ flex:1, minHeight: 0 }}>{children}</div>
      </div>
    );
  };

  return (
    <div style={{ background:'#fafafa', height:'100%', overflow:'auto', position:'relative' }}>
      <div style={{ padding:'20px 22px 12px', display:'flex', alignItems:'flex-end', justifyContent:'space-between' }}>
        <div>
          <div style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.08em', textTransform:'uppercase', color: CS_C.mute, marginBottom: 4 }}>Command · bento</div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing:'-0.02em' }}>Your widgets.</div>
        </div>
        <div style={{ display:'flex', gap: 6 }}>
          <button style={{ fontSize:11, fontFamily:'var(--ul-font-mono)', color: CS_C.sec, background:'#fff', border:`1px solid ${CS_C.border}`, padding:'7px 11px', borderRadius:7, cursor:'pointer' }}>Edit layout</button>
          <button onClick={() => setPicker(true)} style={{ fontSize:11, fontFamily:'var(--ul-font-mono)', color:'#fff', background: CS_C.text, border:`1px solid ${CS_C.text}`, padding:'7px 11px', borderRadius:7, cursor:'pointer' }}>＋ Widget</button>
        </div>
      </div>

      <div style={{ padding:'0 16px 16px', display:'grid', gridTemplateColumns:'repeat(6, 1fr)', gridAutoRows:'108px', gap: 10 }}>
        <Tile tool="email"  burn={0.014} span={3} rowSpan={2} onOpen={() => setExpanded('email')}><CW_EmailDrafts size="L"/></Tile>
        <Tile tool="tutor"  burn={0.006} span={3}              onOpen={() => setExpanded('tutor')}><CW_TutorSurfaces size="M"/></Tile>
        <Tile tool="github" burn={0.002} span={2}              onOpen={() => setExpanded('github')}><CW_GitHubPRs size="M"/></Tile>
        <Tile tool="fx"     burn={0.001} span={1}              onOpen={() => setExpanded('fx')}><CW_FXWatch size="S"/></Tile>
        <Tile               burn={null}  span={2}              onOpen={() => setExpanded('burn')}><CW_Burn size="M"/></Tile>
        <Tile tool="cal"    burn={0.001} span={3}              onOpen={() => setExpanded('cal')}><CW_CalendarNext size="M"/></Tile>
        <Tile tool="resort" burn={0.001} span={1}              onOpen={() => setExpanded('resort')}><CW_ResortOcc size="S"/></Tile>
        <Tile tool="fitness"burn={0.001} span={1}              onOpen={() => setExpanded('fitness')}><CW_FitnessRings size="S"/></Tile>
        <Tile tool="expense"burn={0.000} span={1}              onOpen={() => setExpanded('expense')}><CW_ExpensePending size="S"/></Tile>
        <div onClick={() => setPicker(true)} style={{ gridColumn:'span 2', borderRadius: 14, border:`1px dashed ${CS_C.borderStrong}`, background:'transparent', display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:4, cursor:'pointer', color:CS_C.mute }}>
          <span style={{ fontSize: 18 }}>＋</span>
          <span style={{ fontSize:10, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.08em', textTransform:'uppercase' }}>Add widget</span>
        </div>
      </div>

      {picker && <WidgetPicker onClose={() => setPicker(false)}/>}
      {expanded && <WidgetExpanded which={expanded} onClose={() => setExpanded(null)}/>}
    </div>
  );
}

// ╔══════════════════════════════════════════════════════════════════════╗
// ║  WIDGET PICKER — iOS homescreen pattern                              ║
// ║  Two-pane: left = installed tools, right = widgets that tool exposes  ║
// ║  with size-variant previews (S / M / L cards).                       ║
// ╚══════════════════════════════════════════════════════════════════════╝

function PickerSizePreview({ size, tool, widgetId }) {
  const t = CS_TOOL(tool);
  const { w, h } = size === 'S' ? { w: 110, h: 110 } : size === 'M' ? { w: 232, h: 110 } : { w: 232, h: 232 };
  const renderSample = () => {
    if (tool === 'email')   return <CW_EmailDrafts size={size}/>;
    if (tool === 'tutor')   return <CW_TutorSurfaces size={size}/>;
    if (tool === 'github')  return <CW_GitHubPRs size={size}/>;
    if (tool === 'fx')      return <CW_FXWatch size={size}/>;
    if (tool === 'resort')  return <CW_ResortOcc size={size}/>;
    if (tool === 'fitness') return <CW_FitnessRings size={size}/>;
    if (tool === 'cal')     return <CW_CalendarNext size={size}/>;
    if (tool === 'expense') return <CW_ExpensePending size={size}/>;
    return null;
  };
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap: 8 }}>
      <div style={{ width: w, height: h, background:'#fff', border:`1px solid ${CS_C.border}`, borderRadius: 18, padding: 14, display:'flex', flexDirection:'column', gap: 8, boxShadow:'0 6px 18px rgba(0,0,0,0.06)' }}>
        <div style={{ display:'flex', alignItems:'center', gap: 8 }}>
          <CS_Mono glyph={t.glyph} tone={t.tone} size={18} radius={5}/>
          <div style={{ fontSize:9, fontFamily:'var(--ul-font-mono)', color: t.tone, letterSpacing:'0.08em', textTransform:'uppercase', fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.name}</div>
        </div>
        <div style={{ flex:1, minHeight:0, overflow:'hidden' }}>
          {renderSample()}
        </div>
      </div>
      <div style={{ fontSize:10, fontFamily:'var(--ul-font-mono)', color: CS_C.mute, letterSpacing:'0.06em', textTransform:'uppercase' }}>
        {size === 'S' ? 'small · 1×1' : size === 'M' ? 'medium · 2×1' : 'large · 2×2'}
      </div>
    </div>
  );
}

// The modal picker now wraps the live gallery (locked-in direction).
function WidgetPicker({ onClose, embedded = false }) {
  const body = (
    <div style={{ width:'100%', height:'100%', background:'#fff', borderRadius: embedded ? 0 : 18, boxShadow: embedded ? 'none' : '0 24px 80px rgba(0,0,0,0.22)', overflow:'hidden', position:'relative' }}>
      {!embedded && (
        <button onClick={onClose} style={{ position:'absolute', top: 14, right: 14, width: 28, height: 28, fontSize:18, color: CS_C.mute, background:'#fff', border:`1px solid ${CS_C.border}`, borderRadius: 9999, cursor:'pointer', zIndex: 5, display:'flex', alignItems:'center', justifyContent:'center', lineHeight: 1 }}>×</button>
      )}
      <CommandWidgetPickerGallery/>
    </div>
  );
  if (embedded) return body;
  return (
    <div onClick={onClose} style={{ position:'absolute', inset:0, background:'rgba(10,10,10,0.36)', display:'flex', alignItems:'center', justifyContent:'center', zIndex: 50, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ width:'min(96%, 980px)', height:'min(90%, 640px)' }}>
        {body}
      </div>
    </div>
  );
}

// (legacy two-pane retained for reference but not exported)
function WidgetPickerLegacy_unused({ onClose, embedded = false }) {
  const [toolId, setToolId] = React.useState('email');
  const widgetsForTool = CS_WIDGETS.filter(w => w.tool === toolId);
  const [widgetId, setWidgetId] = React.useState(widgetsForTool[0]?.id || null);
  React.useEffect(() => { setWidgetId(CS_WIDGETS.find(w => w.tool === toolId)?.id); }, [toolId]);
  const widget = widgetsForTool.find(w => w.id === widgetId) || widgetsForTool[0];
  const t = CS_TOOL(toolId);

  const body = (
    <div style={{ width:'100%', height:'100%', background:'#fff', borderRadius: embedded ? 0 : 18, boxShadow: embedded ? 'none' : '0 24px 80px rgba(0,0,0,0.22)', overflow:'hidden', display:'flex', flexDirection:'column' }}>
      {/* Header */}
      <div style={{ padding:'18px 22px 14px', borderBottom:`1px solid ${CS_C.border}`, display:'flex', alignItems:'center', gap: 12 }}>
        <div>
          <div style={{ fontSize:10, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.08em', textTransform:'uppercase', color: CS_C.mute, marginBottom: 2 }}>Add widget</div>
          <div style={{ fontSize: 18, fontWeight:700, letterSpacing:'-0.02em' }}>From your installed tools</div>
        </div>
        <span style={{ flex:1 }}/>
        <div style={{ position:'relative' }}>
          <input placeholder="Search widgets…" style={{ fontSize:12, fontFamily:'var(--ul-font-mono)', color: CS_C.text, background:'#fafafa', border:`1px solid ${CS_C.border}`, padding:'7px 11px 7px 28px', borderRadius:8, outline:'none', width: 200 }}/>
          <span style={{ position:'absolute', left: 10, top:'50%', transform:'translateY(-50%)', fontSize:12, color: CS_C.mute }}>⌕</span>
        </div>
        {!embedded && <button onClick={onClose} style={{ fontSize:18, color: CS_C.mute, background:'transparent', border:'none', cursor:'pointer', padding: 4, marginLeft: 6 }}>×</button>}
      </div>

      {/* Body: two panes */}
      <div style={{ flex:1, display:'flex', minHeight: 0 }}>
        {/* Left: installed tools */}
        <div style={{ width: 220, borderRight:`1px solid ${CS_C.border}`, background:'#fafafa', overflow:'auto', display:'flex', flexDirection:'column' }}>
          <div style={{ padding:'10px 14px 4px', fontSize:9, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.08em', textTransform:'uppercase', color: CS_C.mute }}>Installed tools</div>
          {CS_TOOLS.map(tt => {
            const count = CS_WIDGETS.filter(w => w.tool === tt.id).length;
            const active = tt.id === toolId;
            return (
              <div key={tt.id} onClick={() => setToolId(tt.id)} style={{ padding:'9px 12px', display:'flex', alignItems:'center', gap:10, cursor:'pointer', background: active ? '#fff' : 'transparent', borderLeft: active ? `2px solid ${tt.tone}` : '2px solid transparent' }}>
                <CS_Mono glyph={tt.glyph} tone={tt.tone} size={22} radius={5}/>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:12, fontWeight:600, color: CS_C.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{tt.name}</div>
                  <div style={{ fontSize:9, fontFamily:'var(--ul-font-mono)', color: CS_C.mute, letterSpacing:'0.04em' }}>{count} widget{count!==1?'s':''}</div>
                </div>
              </div>
            );
          })}
          <div style={{ marginTop:'auto', padding:'14px 12px', borderTop:`1px solid ${CS_C.border}` }}>
            <div style={{ fontSize:9, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.08em', textTransform:'uppercase', color: CS_C.mute, marginBottom:6 }}>more</div>
            <div style={{ fontSize:11, color: CS_C.text, padding:'6px 4px', cursor:'pointer' }}>＋ Browse Market →</div>
            <div style={{ fontSize:11, color: CS_C.text, padding:'6px 4px', cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
              <span style={{ width:5, height:5, borderRadius:9999, background:'#3b82f6' }}/>
              Build with Tool Maker
            </div>
          </div>
        </div>

        {/* Right: widgets exposed by this tool, with size variants */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0, overflow:'hidden' }}>
          {/* Tool head */}
          <div style={{ padding:'16px 22px 12px', display:'flex', alignItems:'center', gap: 14, borderBottom:`1px solid ${CS_C.border}` }}>
            <CS_Mono glyph={t.glyph} tone={t.tone} size={36} radius={9}/>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize: 16, fontWeight:700, letterSpacing:'-0.02em' }}>{t.name}</div>
              <div style={{ fontSize: 10, fontFamily:'var(--ul-font-mono)', color: CS_C.mute, letterSpacing:'0.04em' }}>by {t.author} · {widgetsForTool.length} widget{widgetsForTool.length!==1?'s':''} exposed</div>
            </div>
            <button style={{ fontSize:11, fontFamily:'var(--ul-font-mono)', color: CS_C.text, background:'transparent', border:`1px solid ${CS_C.border}`, padding:'6px 10px', borderRadius:7, cursor:'pointer' }}>Open tool ↗</button>
          </div>

          {/* Widget list */}
          <div style={{ padding:'10px 22px 6px', display:'flex', gap: 6, flexWrap:'wrap' }}>
            {widgetsForTool.map(w => {
              const active = w.id === widgetId;
              return (
                <div key={w.id} onClick={() => setWidgetId(w.id)} style={{ padding:'6px 11px', borderRadius: 8, fontSize: 11, fontWeight:600, cursor:'pointer', background: active ? CS_C.text : '#fafafa', color: active ? '#fff' : CS_C.text, border: `1px solid ${active ? CS_C.text : CS_C.border}` }}>
                  {w.name}
                </div>
              );
            })}
          </div>

          {/* Size previews */}
          {widget && (
            <div style={{ flex:1, padding:'14px 22px 22px', overflow:'auto' }}>
              <div style={{ fontSize:11, color: CS_C.sec, marginBottom:14 }}>{widget.desc} · pick a size</div>
              <div style={{ display:'flex', alignItems:'flex-start', gap: 28, flexWrap:'wrap' }}>
                {widget.sizes.map(sz => (
                  <PickerSizePreview key={sz} size={sz} tool={toolId} widgetId={widget.id}/>
                ))}
              </div>
            </div>
          )}

          {/* Footer */}
          <div style={{ borderTop:`1px solid ${CS_C.border}`, padding:'12px 22px', display:'flex', alignItems:'center', justifyContent:'space-between', background:'#fafafa' }}>
            <div style={{ fontSize:11, color: CS_C.sec }}>Drag a size onto the homescreen, or:</div>
            <button style={{ fontSize:12, fontFamily:'var(--ul-font-mono)', color:'#fff', background: CS_C.text, border:'none', padding:'8px 14px', borderRadius:8, cursor:'pointer' }}>＋ Add to homescreen</button>
          </div>
        </div>
      </div>
    </div>
  );

  if (embedded) return body;

  return (
    <div onClick={onClose} style={{ position:'absolute', inset:0, background:'rgba(10,10,10,0.36)', display:'flex', alignItems:'center', justifyContent:'center', zIndex: 50, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(94%, 760px)', height: 'min(86%, 540px)' }}>
        {body}
      </div>
    </div>
  );
}

// ── Widget expanded modal ────────────────────────────────────────────────
function WidgetExpanded({ which, onClose }) {
  const map = {
    email:   { tool:'email',   title:'Drafts awaiting review',   burn:0.014 },
    tutor:   { tool:'tutor',   title:'Tutor surfaces ready',     burn:0.006 },
    github:  { tool:'github',  title:'PRs · CI · github-mcp',    burn:0.002 },
    fx:      { tool:'fx',      title:'FX watchlist',             burn:0.001 },
    resort:  { tool:'resort',  title:'Rooms occupancy',          burn:0.001 },
    fitness: { tool:'fitness', title:'Fitness · today',          burn:0.001 },
    cal:     { tool:'cal',     title:'Up next on calendar',      burn:0.001 },
    expense: { tool:'expense', title:'Pending receipts',         burn:0.000 },
    burn:    { tool:null,      title:'Burn rate · all widgets',  burn:null  },
  };
  const cfg = map[which] || map.email;
  const t = cfg.tool ? CS_TOOL(cfg.tool) : null;

  const burnRows = [
    { tool:'email',  burn: 0.014 },
    { tool:'tutor',  burn: 0.006 },
    { tool:'github', burn: 0.002 },
    { tool:'fx',     burn: 0.001 },
    { tool:'resort', burn: 0.001 },
    { tool:'fitness',burn: 0.001 },
    { tool:'cal',    burn: 0.001 },
  ];

  return (
    <div onClick={onClose} style={{ position:'absolute', inset:0, background:'rgba(10,10,10,0.42)', display:'flex', alignItems:'center', justifyContent:'center', zIndex: 50, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ width:'min(94%, 640px)', maxHeight:'92%', background:'#fff', borderRadius: 18, boxShadow:'0 24px 80px rgba(0,0,0,0.22)', overflow:'hidden', display:'flex', flexDirection:'column' }}>
        <div style={{ padding:'18px 22px 14px', borderBottom:`1px solid ${CS_C.border}`, display:'flex', alignItems:'center', gap:12 }}>
          {t ? <CS_Mono glyph={t.glyph} tone={t.tone} size={32} radius={8}/>
             : <div style={{ width:32, height:32, borderRadius:8, background:'#fafafa', border:`1px solid ${CS_C.border}`, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'var(--ul-font-mono)', fontSize:14, fontWeight:700, color:CS_C.text }}>✦</div>}
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:10, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.08em', textTransform:'uppercase', color: CS_C.mute }}>Widget</div>
            <div style={{ fontSize: 18, fontWeight: 700, letterSpacing:'-0.02em' }}>{cfg.title}</div>
          </div>
          {cfg.burn != null && (
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:9, fontFamily:'var(--ul-font-mono)', color: CS_C.mute, letterSpacing:'0.06em' }}>BURN</div>
              <div style={{ fontSize:14, fontFamily:'var(--ul-font-mono)', fontWeight:600, fontVariantNumeric:'tabular-nums' }}>✦{cfg.burn.toFixed(3)}/min</div>
            </div>
          )}
          <button onClick={onClose} style={{ fontSize:18, color: CS_C.mute, background:'transparent', border:'none', cursor:'pointer', padding: 4, marginLeft: 8 }}>×</button>
        </div>

        <div style={{ flex:1, overflow:'auto', padding: 22 }}>
          {which === 'burn' ? (
            <>
              <div style={{ fontSize: 38, fontWeight:700, letterSpacing:'-0.025em', fontVariantNumeric:'tabular-nums' }}>✦0.024<span style={{fontSize:13, color: CS_C.mute, fontWeight:500}}>/min</span></div>
              <div style={{ fontSize:11, fontFamily:'var(--ul-font-mono)', color: CS_C.sec, marginTop: 4, marginBottom: 16 }}>aggregate of all widgets currently mounted on Command</div>
              <CS_Spark1 data={[0.018,0.022,0.020,0.027,0.024,0.030,0.024,0.022,0.024]} w={560} h={64} color={CS_C.text} fill/>
              <div style={{ marginTop: 22, fontSize:10, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.08em', textTransform:'uppercase', color: CS_C.mute, marginBottom: 8 }}>Per-widget contribution</div>
              {burnRows.map(r => {
                const tt = CS_TOOL(r.tool);
                return (
                  <div key={r.tool} style={{ display:'flex', alignItems:'center', gap: 12, padding:'10px 0', borderBottom:`1px solid ${CS_C.border}` }}>
                    <CS_Mono glyph={tt.glyph} tone={tt.tone} size={22} radius={5}/>
                    <div style={{ flex:1, fontSize:13, fontWeight:500 }}>{tt.name}</div>
                    <div style={{ flex:1, height: 5, background:'rgba(0,0,0,0.04)', borderRadius:9999, overflow:'hidden' }}>
                      <div style={{ width:`${(r.burn / 0.014) * 100}%`, height:'100%', background: tt.tone, borderRadius:9999 }}/>
                    </div>
                    <div style={{ fontSize: 12, fontFamily:'var(--ul-font-mono)', fontWeight:600, fontVariantNumeric:'tabular-nums' }}>✦{r.burn.toFixed(3)}/min</div>
                  </div>
                );
              })}
            </>
          ) : (
            <>
              <div style={{ fontSize:10, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.08em', textTransform:'uppercase', color: CS_C.mute, marginBottom:6 }}>Recent activity</div>
              <div style={{ borderRadius: 10, border:`1px solid ${CS_C.border}`, overflow:'hidden' }}>
                {[1,2,3,4,5].map(i => (
                  <div key={i} style={{ padding:'12px 14px', display:'flex', alignItems:'center', gap:12, borderTop: i > 1 ? `1px solid ${CS_C.border}` : 'none' }}>
                    <div style={{ width:24, height:24, borderRadius:9999, background:'rgba(0,0,0,0.04)', flexShrink:0, fontSize:10, color: CS_C.mute, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'var(--ul-font-mono)' }}>{i}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ height: 9, width: `${72 - i*8}%`, background:'rgba(0,0,0,0.08)', borderRadius: 4, marginBottom: 5 }}/>
                      <div style={{ height: 7, width: `${52 - i*4}%`, background:'rgba(0,0,0,0.05)', borderRadius: 4 }}/>
                    </div>
                    <button style={{ fontSize:11, fontFamily:'var(--ul-font-mono)', color: CS_C.text, background:'transparent', border:`1px solid ${CS_C.border}`, padding:'6px 10px', borderRadius:6, cursor:'pointer' }}>Open ↵</button>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 16, display:'flex', gap:8 }}>
                <button style={{ fontSize:12, fontWeight:500, color:'#fff', background: CS_C.text, border:'none', padding:'8px 14px', borderRadius: 8, cursor:'pointer' }}>Open in chat</button>
                <button style={{ fontSize:12, color: CS_C.text, background:'transparent', border:`1px solid ${CS_C.border}`, padding:'8px 14px', borderRadius: 8, cursor:'pointer' }}>Configure widget</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── A · Two-pane catalog (the original WidgetPicker, in a frame) ─────────
function CommandWidgetPickerTwoPane() {
  return (
    <div style={{ background:'#f6f6f4', height:'100%', overflow:'auto', padding: 18 }}>
      <div style={{ height:'100%', minHeight: 480 }}>
        <WidgetPicker embedded/>
      </div>
    </div>
  );
}

// ╔══════════════════════════════════════════════════════════════════════╗
// ║  B · LIVE GALLERY                                                     ║
// ║  Every widget from every installed tool rendered as a live preview    ║
// ║  tile, grouped by tool. Tool-filter rail across top. Hover a tile to  ║
// ║  reveal size chips; tap a tile to add at its default size.            ║
// ╚══════════════════════════════════════════════════════════════════════╝

function GalleryTile({ tool, widget, selected, granted, onSelect }) {
  const t = CS_TOOL(tool);
  const sample = (sz='M') => {
    if (tool === 'email')   return <CW_EmailDrafts size={sz}/>;
    if (tool === 'tutor')   return <CW_TutorSurfaces size={sz}/>;
    if (tool === 'github')  return <CW_GitHubPRs size={sz}/>;
    if (tool === 'fx')      return <CW_FXWatch size={sz}/>;
    if (tool === 'resort')  return <CW_ResortOcc size={sz}/>;
    if (tool === 'fitness') return <CW_FitnessRings size={sz}/>;
    if (tool === 'cal')     return <CW_CalendarNext size={sz}/>;
    if (tool === 'expense') return <CW_ExpensePending size={sz}/>;
    return null;
  };
  const span = widget.size === 'M' ? 2 : 1;
  const rowSpan = widget.size === 'L' ? 2 : 1;
  return (
    <div
      onClick={onSelect}
      style={{ gridColumn: `span ${span}`, gridRow: `span ${rowSpan}`, position:'relative', background:'#fff', border: selected ? `2px solid ${CS_C.text}` : `1px solid ${CS_C.border}`, borderRadius: 14, padding: selected ? 13 : 14, cursor:'pointer', transition:'transform 140ms ease, box-shadow 140ms ease', display:'flex', flexDirection:'column', gap: 10, boxShadow: selected ? '0 12px 30px rgba(0,0,0,0.10)' : 'none' }}
      onMouseEnter={e => { if (!selected) { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 6px 18px rgba(0,0,0,0.05)'; } }}
      onMouseLeave={e => { if (!selected) { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; } }}
    >
      <div style={{ display:'flex', alignItems:'center', gap: 8 }}>
        <CS_Mono glyph={t.glyph} tone={t.tone} size={20} radius={5}/>
        <div style={{ fontSize:10, fontFamily:'var(--ul-font-mono)', color: t.tone, letterSpacing:'0.08em', textTransform:'uppercase', fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{widget.name}</div>
      </div>
      <div style={{ flex:1, minHeight: 0, overflow:'hidden' }}>{sample(widget.size)}</div>
      {widget.perms && widget.perms.length > 0 && !selected && (
        <div title={`Requests access: ${widget.perms.map(p=>p.scope).join(', ')}`} style={{ position:'absolute', top: 9, right: 9, display:'flex', alignItems:'center', gap: 4, padding:'3px 6px', borderRadius: 999, background: granted ? 'rgba(34,197,94,0.12)' : 'rgba(0,0,0,0.05)', color: granted ? '#15803d' : CS_C.mute, fontSize: 9, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.04em', fontWeight: 600 }}>
          <svg width="9" height="10" viewBox="0 0 9 10" fill="none"><path d="M2 4.5V3a2.5 2.5 0 0 1 5 0v1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><rect x="1.3" y="4.3" width="6.4" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none"/></svg>
          {granted ? 'GRANTED' : widget.perms.map(p=>p.scope).join('·').toUpperCase()}
        </div>
      )}
      {selected && (
        <div style={{ position:'absolute', top: 9, right: 9, width: 20, height: 20, borderRadius: 9999, background: CS_C.text, color:'#fff', fontSize: 12, display:'flex', alignItems:'center', justifyContent:'center', fontWeight: 700 }}>✓</div>
      )}
    </div>
  );
}

function CommandWidgetPickerGallery() {
  const [filter, setFilter] = React.useState('all');
  const [selected, setSelected] = React.useState([]); // array of `${toolId}-${widgetId}`
  const [granted, setGranted] = React.useState([]); // keys whose perms have been granted this session
  const [pending, setPending] = React.useState(null); // { key, tool, widget } awaiting confirmation
  const grouped = CS_TOOLS.map(t => ({ tool: t, widgets: CS_WIDGETS.filter(w => w.tool === t.id) })).filter(g => g.widgets.length > 0);
  const visible = filter === 'all' ? grouped : grouped.filter(g => g.tool.id === filter);
  const totalWidgets = CS_WIDGETS.length;

  // Resolve selected widgets for footer copy
  const selectedItems = selected.map(key => {
    const [tid, wid] = key.split('-');
    return { key, tool: CS_TOOL(tid), widget: CS_WIDGETS.find(w => w.tool === tid && w.id === wid) };
  }).filter(x => x.widget);
  const handleTileClick = key => {
    // Already selected → deselect, no modal.
    if (selected.includes(key)) { setSelected(s => s.filter(k => k !== key)); return; }
    const [tid, wid] = key.split('-');
    const widget = CS_WIDGETS.find(w => w.tool === tid && w.id === wid);
    const tool = CS_TOOL(tid);
    // Needs permission and not yet granted this session → confirm.
    if (widget.perms && widget.perms.length && !granted.includes(key)) {
      setPending({ key, tool, widget });
      return;
    }
    setSelected(s => [...s, key]);
  };
  const confirmPending = () => {
    if (!pending) return;
    setGranted(g => g.includes(pending.key) ? g : [...g, pending.key]);
    setSelected(s => s.includes(pending.key) ? s : [...s, pending.key]);
    setPending(null);
  };
  const sizeFootprint = sz => sz === 'S' ? '1×1' : sz === 'M' ? '2×1' : '2×2';

  return (
    <div style={{ background:'#f6f6f4', height:'100%', display:'flex', flexDirection:'column', overflow:'hidden', position:'relative' }}>
      {/* Header */}
      <div style={{ padding:'18px 22px 14px', display:'flex', alignItems:'center', gap: 16, background:'#fff', borderBottom:`1px solid ${CS_C.border}` }}>
        <div style={{ flexShrink: 0 }}>
          <div style={{ fontSize:10, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.08em', textTransform:'uppercase', color: CS_C.mute, marginBottom: 2 }}>Add widget</div>
          <div style={{ fontSize: 17, fontWeight:700, letterSpacing:'-0.02em' }}>{totalWidgets} widgets across {grouped.length} tools</div>
        </div>
        <div style={{ flex: 1, display:'flex', justifyContent:'center' }}>
          <div style={{ position:'relative', width: 320, maxWidth: '100%' }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ position:'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents:'none' }}>
              <circle cx="6" cy="6" r="4.5" stroke={CS_C.mute} strokeWidth="1.4"/>
              <line x1="9.5" y1="9.5" x2="12.5" y2="12.5" stroke={CS_C.mute} strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
            <input placeholder="Search widgets" style={{ width: '100%', boxSizing:'border-box', fontSize:13, fontFamily:'var(--ul-font-mono)', color: CS_C.text, background:'#fafafa', border:`1px solid ${CS_C.border}`, padding:'9px 14px 9px 34px', borderRadius:9, outline:'none' }}/>
          </div>
        </div>
        <div style={{ flexShrink: 0, width: 100 }}/> {/* spacer balances modal close button */}
      </div>

      {/* Tool filter rail */}
      <div style={{ padding:'12px 22px', display:'flex', gap: 8, alignItems:'center', overflow:'auto', background:'#fff', borderBottom:`1px solid ${CS_C.border}` }}>
        <div onClick={() => setFilter('all')} style={{ flexShrink:0, padding:'6px 12px', borderRadius: 8, fontSize:11, fontWeight:600, cursor:'pointer', background: filter==='all' ? CS_C.text : '#fafafa', color: filter==='all' ? '#fff' : CS_C.text, border:`1px solid ${filter==='all' ? CS_C.text : CS_C.border}` }}>All</div>
        {grouped.map(g => {
          const active = filter === g.tool.id;
          return (
            <div key={g.tool.id} onClick={() => setFilter(g.tool.id)} style={{ flexShrink:0, display:'flex', alignItems:'center', gap:7, padding:'5px 10px 5px 6px', borderRadius: 8, fontSize:11, fontWeight:600, cursor:'pointer', background: active ? CS_C.text : '#fafafa', color: active ? '#fff' : CS_C.text, border:`1px solid ${active ? CS_C.text : CS_C.border}` }}>
              <CS_Mono glyph={g.tool.glyph} tone={g.tool.tone} size={18} radius={4}/>
              {g.tool.name}
              <span style={{ fontSize:9, fontFamily:'var(--ul-font-mono)', opacity:0.6 }}>{g.widgets.length}</span>
            </div>
          );
        })}
      </div>

      {/* Gallery */}
      <div style={{ flex:1, overflow:'auto', padding:'18px 22px' }}>
        {visible.map(g => (
          <div key={g.tool.id} style={{ marginBottom: 22 }}>
            <div style={{ display:'flex', alignItems:'center', gap: 10, marginBottom: 10 }}>
              <CS_Mono glyph={g.tool.glyph} tone={g.tool.tone} size={20} radius={5}/>
              <div style={{ fontSize: 13, fontWeight:700, letterSpacing:'-0.01em' }}>{g.tool.name}</div>
              <div style={{ fontSize: 10, fontFamily:'var(--ul-font-mono)', color: CS_C.mute, letterSpacing:'0.04em' }}>by {g.tool.author}</div>
              <span style={{ flex:1, height: 1, background: CS_C.border }}/>
              <div style={{ fontSize:10, fontFamily:'var(--ul-font-mono)', color: CS_C.mute, letterSpacing:'0.04em' }}>{g.widgets.length} widget{g.widgets.length!==1?'s':''}</div>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gridAutoRows: '140px', gap: 12 }}>
              {g.widgets.map(w => {
                const key = `${g.tool.id}-${w.id}`;
                return (
                  <GalleryTile key={key} tool={g.tool.id} widget={w} selected={selected.includes(key)} granted={granted.includes(key)} onSelect={() => handleTileClick(key)}/>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Confirmation banner — only when one or more widgets are selected */}
      {selectedItems.length > 0 && (
        <div style={{ borderTop:`1px solid ${CS_C.border}`, padding:'14px 22px', display:'flex', alignItems:'center', gap: 14, background:'#0a0a0a', color:'#fff' }}>
          {/* Stacked monogram avatars */}
          <div style={{ display:'flex', flexShrink: 0 }}>
            {selectedItems.slice(0, 4).map((it, i) => (
              <div key={it.key} style={{ marginLeft: i === 0 ? 0 : -8, border:'2px solid #0a0a0a', borderRadius: 9, lineHeight: 0 }}>
                <CS_Mono glyph={it.tool.glyph} tone={it.tool.tone} size={28} radius={7}/>
              </div>
            ))}
            {selectedItems.length > 4 && (
              <div style={{ marginLeft: -8, width: 32, height: 32, borderRadius: 9, border:'2px solid #0a0a0a', background:'#1f1f1f', color:'#fff', fontSize: 11, fontFamily:'var(--ul-font-mono)', display:'flex', alignItems:'center', justifyContent:'center', fontWeight: 600 }}>+{selectedItems.length - 4}</div>
            )}
          </div>
          <div style={{ flex:1, minWidth: 0 }}>
            {selectedItems.length === 1 ? (
              <>
                <div style={{ fontSize: 13, fontWeight: 600, color:'#fff' }}>{selectedItems[0].widget.name}</div>
                <div style={{ fontSize: 10, fontFamily:'var(--ul-font-mono)', color:'rgba(255,255,255,0.55)', letterSpacing:'0.04em' }}>{selectedItems[0].tool.name} · {sizeFootprint(selectedItems[0].widget.size)} · {selectedItems[0].widget.desc}</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 13, fontWeight: 600, color:'#fff' }}>{selectedItems.length} widgets selected</div>
                <div style={{ fontSize: 10, fontFamily:'var(--ul-font-mono)', color:'rgba(255,255,255,0.55)', letterSpacing:'0.04em', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {selectedItems.map(it => it.widget.name).join(' · ')}
                </div>
              </>
            )}
          </div>
          <button onClick={() => setSelected([])} style={{ fontSize:11, fontFamily:'var(--ul-font-mono)', color:'rgba(255,255,255,0.7)', background:'transparent', border:'1px solid rgba(255,255,255,0.18)', padding:'8px 12px', borderRadius: 8, cursor:'pointer' }}>Clear</button>
          <button style={{ fontSize:13, fontWeight: 600, color: '#0a0a0a', background:'#fff', border:'none', padding:'9px 18px', borderRadius: 8, cursor:'pointer' }}>＋ Add {selectedItems.length === 1 ? 'to homescreen' : `${selectedItems.length} to homescreen`}</button>
        </div>
      )}

      {/* Permission confirmation modal */}
      {pending && (
        <div onClick={() => setPending(null)} style={{ position:'absolute', inset: 0, background:'rgba(10,10,10,0.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex: 20, padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: 380, maxWidth: '100%', background:'#fff', borderRadius: 16, boxShadow:'0 24px 60px rgba(0,0,0,0.30)', overflow:'hidden' }}>
            <div style={{ padding:'22px 22px 16px', borderBottom:`1px solid ${CS_C.border}` }}>
              <div style={{ display:'flex', alignItems:'center', gap: 12, marginBottom: 14 }}>
                <CS_Mono glyph={pending.tool.glyph} tone={pending.tool.tone} size={36} radius={9}/>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, letterSpacing:'-0.01em' }}>{pending.widget.name}</div>
                  <div style={{ fontSize: 10, fontFamily:'var(--ul-font-mono)', color: CS_C.mute, letterSpacing:'0.04em' }}>{pending.tool.name} · by {pending.tool.author}</div>
                </div>
              </div>
              <div style={{ fontSize: 13, color: CS_C.text, lineHeight: 1.45 }}>
                Installing this widget grants <span style={{ fontWeight: 700 }}>{pending.tool.name}</span> read access to:
              </div>
            </div>
            <div style={{ padding:'14px 22px 6px' }}>
              {pending.widget.perms.map((p, i) => (
                <div key={i} style={{ display:'flex', gap: 12, padding:'10px 0', borderBottom: i < pending.widget.perms.length - 1 ? `1px solid ${CS_C.border}` : 'none' }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background:'#f6f6f4', display:'flex', alignItems:'center', justifyContent:'center', flexShrink: 0, color: CS_C.text }}>
                    <svg width="13" height="14" viewBox="0 0 9 10" fill="none"><path d="M2 4.5V3a2.5 2.5 0 0 1 5 0v1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><rect x="1.3" y="4.3" width="6.4" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none"/></svg>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{p.scope}</div>
                    <div style={{ fontSize: 11, color: CS_C.mute, lineHeight: 1.4 }}>{p.detail}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ padding:'10px 22px 14px', fontSize: 10, fontFamily:'var(--ul-font-mono)', color: CS_C.mute, letterSpacing:'0.04em', lineHeight: 1.5 }}>
              Revocable any time from Settings · Permissions.
            </div>
            <div style={{ display:'flex', gap: 10, padding:'12px 22px 18px', borderTop:`1px solid ${CS_C.border}`, background:'#fafafa' }}>
              <button onClick={() => setPending(null)} style={{ flex:1, fontSize:13, fontWeight: 500, color: CS_C.text, background:'#fff', border:`1px solid ${CS_C.border}`, padding:'10px 14px', borderRadius: 9, cursor:'pointer' }}>Cancel</button>
              <button onClick={confirmPending} style={{ flex:1, fontSize:13, fontWeight: 600, color:'#fff', background: CS_C.text, border:'none', padding:'10px 14px', borderRadius: 9, cursor:'pointer' }}>Allow & add</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ╔══════════════════════════════════════════════════════════════════════╗
// ║  C · iOS SWIPE SHEET                                                  ║
// ║  Two-screen flow: tool list → tool detail with horizontally swipeable ║
// ║  size variants at true scale and a single big Add Widget CTA.         ║
// ╚══════════════════════════════════════════════════════════════════════╝

function IOSWidgetCard({ size, tool }) {
  const { w, h } = size === 'S' ? { w: 158, h: 158 } : size === 'M' ? { w: 332, h: 158 } : { w: 332, h: 332 };
  const t = CS_TOOL(tool);
  const sample = () => {
    if (tool === 'email')   return <CW_EmailDrafts size={size}/>;
    if (tool === 'tutor')   return <CW_TutorSurfaces size={size}/>;
    if (tool === 'github')  return <CW_GitHubPRs size={size}/>;
    if (tool === 'fx')      return <CW_FXWatch size={size}/>;
    if (tool === 'resort')  return <CW_ResortOcc size={size}/>;
    if (tool === 'fitness') return <CW_FitnessRings size={size}/>;
    if (tool === 'cal')     return <CW_CalendarNext size={size}/>;
    if (tool === 'expense') return <CW_ExpensePending size={size}/>;
    return null;
  };
  return (
    <div style={{ width: w, height: h, flexShrink: 0, background:'#fff', border:`1px solid ${CS_C.border}`, borderRadius: 22, padding: 16, display:'flex', flexDirection:'column', gap: 10, boxShadow:'0 10px 28px rgba(0,0,0,0.08)' }}>
      <div style={{ display:'flex', alignItems:'center', gap: 8 }}>
        <CS_Mono glyph={t.glyph} tone={t.tone} size={20} radius={5}/>
        <div style={{ fontSize:10, fontFamily:'var(--ul-font-mono)', color: t.tone, letterSpacing:'0.08em', textTransform:'uppercase', fontWeight:600 }}>{t.name}</div>
      </div>
      <div style={{ flex:1, minHeight: 0, overflow:'hidden' }}>{sample()}</div>
    </div>
  );
}

function CommandWidgetPickerIOS() {
  const [toolId, setToolId] = React.useState(null);
  const [widgetId, setWidgetId] = React.useState(null);
  const [sizeIdx, setSizeIdx] = React.useState(0);

  const goToTool = id => {
    setToolId(id);
    const first = CS_WIDGETS.find(w => w.tool === id);
    setWidgetId(first?.id || null);
    setSizeIdx(0);
  };
  const goBack = () => { setToolId(null); setWidgetId(null); setSizeIdx(0); };

  const t = toolId ? CS_TOOL(toolId) : null;
  const widgetsForTool = toolId ? CS_WIDGETS.filter(w => w.tool === toolId) : [];
  const widget = widgetsForTool.find(w => w.id === widgetId) || widgetsForTool[0];
  const sizes = widget?.sizes || [];
  const currentSize = sizes[sizeIdx] || sizes[0];

  return (
    <div style={{ background:'#f1f1ee', height:'100%', display:'flex', flexDirection:'column', overflow:'hidden' }}>
      {/* Top bar */}
      <div style={{ padding:'14px 18px 10px', display:'flex', alignItems:'center', gap: 10, background:'rgba(255,255,255,0.7)', backdropFilter:'blur(10px)', borderBottom:`1px solid ${CS_C.border}`, position:'relative' }}>
        {toolId ? (
          <button onClick={goBack} style={{ fontSize:14, color: CS_C.text, background:'transparent', border:'none', cursor:'pointer', padding: 0, fontFamily:'var(--ul-font-mono)' }}>‹ Tools</button>
        ) : (
          <div style={{ fontSize:11, fontFamily:'var(--ul-font-mono)', color: CS_C.mute, letterSpacing:'0.08em', textTransform:'uppercase' }}>Cancel</div>
        )}
        <div style={{ position:'absolute', left:'50%', transform:'translateX(-50%)', fontSize: 14, fontWeight:700, letterSpacing:'-0.01em' }}>{toolId ? t.name : 'Widgets'}</div>
        <span style={{ flex:1 }}/>
        {!toolId && <div style={{ fontSize:11, fontFamily:'var(--ul-font-mono)', color: CS_C.text, letterSpacing:'0.06em' }}>Done</div>}
      </div>

      {/* Body */}
      {!toolId ? (
        // ── Screen 1: tool list ─────────────────────────────────────────
        <div style={{ flex:1, overflow:'auto' }}>
          <div style={{ padding:'16px 18px 8px' }}>
            <div style={{ position:'relative', background:'#fff', border:`1px solid ${CS_C.border}`, borderRadius: 12, padding:'10px 14px 10px 38px' }}>
              <span style={{ position:'absolute', left: 14, top:'50%', transform:'translateY(-50%)', fontSize:13, color: CS_C.mute }}>⌕</span>
              <input placeholder="Search" style={{ fontSize:13, color: CS_C.text, background:'transparent', border:'none', outline:'none', width:'100%' }}/>
            </div>
          </div>
          <div style={{ padding:'4px 18px 8px', fontSize:10, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.08em', textTransform:'uppercase', color: CS_C.mute }}>Suggestions</div>
          <div style={{ padding:'0 18px', display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap: 10 }}>
            {['email','tutor'].map(id => {
              const tt = CS_TOOL(id);
              const w = CS_WIDGETS.find(w => w.tool === id);
              return (
                <div key={id} onClick={() => goToTool(id)} style={{ background:'#fff', border:`1px solid ${CS_C.border}`, borderRadius: 14, padding: 12, cursor:'pointer', display:'flex', flexDirection:'column', gap: 6 }}>
                  <CS_Mono glyph={tt.glyph} tone={tt.tone} size={28} radius={7}/>
                  <div style={{ fontSize: 13, fontWeight:600 }}>{tt.name}</div>
                  <div style={{ fontSize:10, fontFamily:'var(--ul-font-mono)', color: CS_C.mute }}>{w?.name}</div>
                </div>
              );
            })}
          </div>
          <div style={{ padding:'18px 18px 8px', fontSize:10, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.08em', textTransform:'uppercase', color: CS_C.mute }}>From your installed tools</div>
          <div style={{ background:'#fff', borderTop:`1px solid ${CS_C.border}`, borderBottom:`1px solid ${CS_C.border}` }}>
            {CS_TOOLS.map((tt, i) => {
              const count = CS_WIDGETS.filter(w => w.tool === tt.id).length;
              return (
                <div key={tt.id} onClick={() => goToTool(tt.id)} style={{ padding:'12px 18px', display:'flex', alignItems:'center', gap: 12, cursor:'pointer', borderTop: i > 0 ? `1px solid ${CS_C.border}` : 'none' }}>
                  <CS_Mono glyph={tt.glyph} tone={tt.tone} size={30} radius={7}/>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize: 14, fontWeight:600, color: CS_C.text }}>{tt.name}</div>
                    <div style={{ fontSize:11, color: CS_C.mute }}>{count} widget{count!==1?'s':''}</div>
                  </div>
                  <span style={{ fontSize: 16, color: CS_C.mute }}>›</span>
                </div>
              );
            })}
          </div>
          <div style={{ padding:'14px 18px 22px', display:'flex', flexDirection:'column', gap: 6 }}>
            <div style={{ fontSize:12, color:'#3b82f6', padding:'6px 0' }}>＋ Browse Market</div>
            <div style={{ fontSize:12, color:'#3b82f6', padding:'6px 0' }}>＋ Build with Tool Maker</div>
          </div>
        </div>
      ) : (
        // ── Screen 2: tool detail with swipe sizes ──────────────────────
        <div style={{ flex:1, overflow:'auto', display:'flex', flexDirection:'column' }}>
          <div style={{ padding:'18px 18px 6px', display:'flex', alignItems:'center', gap: 12 }}>
            <CS_Mono glyph={t.glyph} tone={t.tone} size={44} radius={10}/>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize: 16, fontWeight:700, letterSpacing:'-0.02em' }}>{t.name}</div>
              <div style={{ fontSize:10, fontFamily:'var(--ul-font-mono)', color: CS_C.mute, letterSpacing:'0.04em' }}>by {t.author} · {widgetsForTool.length} widget{widgetsForTool.length!==1?'s':''}</div>
            </div>
          </div>

          {/* widget tabs (only if >1) */}
          {widgetsForTool.length > 1 && (
            <div style={{ padding:'10px 18px 4px', display:'flex', gap: 6, flexWrap:'wrap' }}>
              {widgetsForTool.map(w => {
                const active = w.id === widgetId;
                return (
                  <div key={w.id} onClick={() => { setWidgetId(w.id); setSizeIdx(0); }} style={{ padding:'5px 11px', borderRadius: 999, fontSize: 11, fontWeight:600, cursor:'pointer', background: active ? CS_C.text : 'transparent', color: active ? '#fff' : CS_C.sec, border: `1px solid ${active ? CS_C.text : CS_C.border}` }}>
                    {w.name}
                  </div>
                );
              })}
            </div>
          )}

          {/* swipe stage */}
          <div style={{ flex:1, minHeight: 0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'18px 0', position:'relative' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap: 22, width:'100%' }}>
              {sizes.length > 1 && (
                <button onClick={() => setSizeIdx((sizeIdx - 1 + sizes.length) % sizes.length)} style={{ width: 32, height: 32, borderRadius: 9999, border:`1px solid ${CS_C.border}`, background:'#fff', cursor:'pointer', fontSize: 16, color: CS_C.sec, lineHeight: 1, flexShrink: 0 }}>‹</button>
              )}
              {currentSize && <IOSWidgetCard size={currentSize} tool={toolId}/>}
              {sizes.length > 1 && (
                <button onClick={() => setSizeIdx((sizeIdx + 1) % sizes.length)} style={{ width: 32, height: 32, borderRadius: 9999, border:`1px solid ${CS_C.border}`, background:'#fff', cursor:'pointer', fontSize: 16, color: CS_C.sec, lineHeight: 1, flexShrink: 0 }}>›</button>
              )}
            </div>
            {/* paging dots */}
            <div style={{ marginTop: 18, display:'flex', gap: 6 }}>
              {sizes.map((sz, i) => (
                <span key={sz} style={{ width: 6, height: 6, borderRadius: 9999, background: i === sizeIdx ? CS_C.text : 'rgba(0,0,0,0.15)' }}/>
              ))}
            </div>
            {currentSize && (
              <div style={{ marginTop: 12, fontSize: 11, fontFamily:'var(--ul-font-mono)', color: CS_C.sec, letterSpacing:'0.06em', textTransform:'uppercase' }}>
                {currentSize === 'S' ? 'Small · 1×1' : currentSize === 'M' ? 'Medium · 2×1' : 'Large · 2×2'}
              </div>
            )}
            {widget && (
              <div style={{ marginTop: 6, fontSize: 12, color: CS_C.sec, padding:'0 18px', textAlign:'center' }}>{widget.desc}</div>
            )}
          </div>

          {/* Big add button */}
          <div style={{ padding:'12px 18px 20px' }}>
            <button style={{ width:'100%', fontSize: 14, fontWeight: 600, color:'#fff', background: CS_C.text, border:'none', padding:'14px', borderRadius: 12, cursor:'pointer' }}>＋ Add Widget</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Exports ──────────────────────────────────────────────────────────────
window.PUI_CommandBefore                = PUI_CommandBefore;
window.PUI_CommandCozy                  = () => <CozyHomescreen/>;             // lead
window.PUI_CommandCozyEdit              = () => <CozyHomescreen initialEdit/>; // edit state
window.PUI_CommandWidgetPickerTwoPane   = CommandWidgetPickerTwoPane;          // A
window.PUI_CommandWidgetPickerGallery   = CommandWidgetPickerGallery;          // B
window.PUI_CommandWidgetPickerIOS       = CommandWidgetPickerIOS;              // C
// (kept for compatibility)
window.PUI_CommandWidgetPicker          = CommandWidgetPickerTwoPane;
