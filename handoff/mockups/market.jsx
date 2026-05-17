// Marketplace — landing page surfaces (2 variants).
// V1: Editorial — magazine-feel hero, Top 10 Billboard, curated rows
// V2: Dense — utilitarian search-first grid

const { C: M_C, Spark: M_Spark } = window.PUI_Primitives;
const { MD_TOOLS, MD_CATEGORIES, MD_NEW_THIS_WEEK, fmtN, fmtSpark } = window.PUI_MarketData;
const M_Icons = window.PUI_Icons;

// ── Trust avatar ──────────────────────────────────────────────
function MAvatar({ author, color, size = 24 }) {
  const ch = (author || '?').replace('@','').slice(0,1).toUpperCase();
  return (
    <span style={{ width: size, height: size, borderRadius: 9999, background: color, color:'#fff',
      display:'inline-flex', alignItems:'center', justifyContent:'center',
      fontSize: size * 0.42, fontWeight: 600, fontFamily:'var(--ul-font-sans)', flexShrink: 0 }}>{ch}</span>
  );
}

// ── Sparkline ─────────────────────────────────────────────────
function MSpark({ data, w = 56, h = 16, color = M_C.text, growth = 0 }) {
  const stroke = growth > 0.05 ? '#22c55e' : growth < -0.05 ? '#ef4444' : color;
  return (
    <svg width={w} height={h} style={{ display:'block', overflow:'visible' }}>
      <polyline points={fmtSpark(data, w, h)} fill="none" stroke={stroke} strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" opacity="0.85"/>
    </svg>
  );
}

// ── Tool row — used in Billboard top-10 (V1) ──────────────────
function MBillboardRow({ tool, rank, onClick }) {
  const moving = tool.growth7d;
  const arrow = moving > 0.05 ? '↑' : moving < -0.05 ? '↓' : '·';
  const arrowColor = moving > 0.05 ? '#22c55e' : moving < -0.05 ? '#ef4444' : M_C.mute;
  return (
    <div onClick={onClick} style={{
      display:'grid', gridTemplateColumns:'48px 1fr 100px 64px', alignItems:'center', gap: 16,
      padding:'14px 4px', borderTop:`1px solid ${M_C.border}`, cursor:'pointer',
      transition:'background 160ms ease',
    }}
    onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,0,0,0.02)'}
    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
      <div style={{ fontFamily:'var(--ul-font-mono)', fontSize: 28, fontWeight: 700,
        color: rank <= 3 ? M_C.text : M_C.mute, letterSpacing:'-0.04em', textAlign:'right',
        fontVariantNumeric:'tabular-nums', lineHeight: 1 }}>{rank}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display:'flex', alignItems:'center', gap: 8 }}>
          <MAvatar author={tool.author} color={tool.authorAvatar} size={20}/>
          <span style={{ fontSize: 15, fontWeight: 600, letterSpacing:'-0.01em' }}>{tool.name}</span>
          <span style={{ fontSize: 12, color: M_C.mute }}>·</span>
          <span style={{ fontSize: 12, color: M_C.sec }}>{tool.author}</span>
        </div>
        <div style={{ fontSize: 13, color: M_C.sec, marginTop: 3, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{tool.tagline}</div>
      </div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'flex-end', gap: 6 }}>
        <MSpark data={tool.sparkline} growth={tool.growth7d}/>
        <span style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', color: arrowColor, width: 28, textAlign:'right' }}>{arrow}{Math.abs(moving*100).toFixed(0)}%</span>
      </div>
      <div style={{ fontFamily:'var(--ul-font-mono)', fontSize: 12, color: M_C.sec, textAlign:'right', fontVariantNumeric:'tabular-nums' }}>{fmtN(tool.installs)}</div>
    </div>
  );
}

// ── Featured hero card — V1 editorial ─────────────────────────
function MFeaturedHero({ tool, onClick }) {
  return (
    <div onClick={onClick} style={{
      cursor:'pointer', borderRadius: 16, padding: 36,
      background: `linear-gradient(135deg, ${tool.authorAvatar}10 0%, transparent 60%), #fafafa`,
      border: `1px solid ${M_C.border}`,
      display:'flex', gap: 32, alignItems:'flex-end', minHeight: 200,
      position:'relative', overflow:'hidden',
    }}>
      <div style={{
        position:'absolute', right:-40, top:-40, width: 240, height: 240,
        borderRadius:'50%', background: `radial-gradient(circle, ${tool.authorAvatar}18 0%, transparent 70%)`,
        pointerEvents:'none',
      }}/>
      <div style={{ flex: 1, minWidth: 0, position:'relative' }}>
        <div style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', color: M_C.mute, letterSpacing:'0.08em', textTransform:'uppercase', marginBottom: 14 }}>Featured · 1 May</div>
        <div style={{ fontSize: 40, fontWeight: 700, letterSpacing:'-0.03em', lineHeight: 1.05, marginBottom: 10 }}>{tool.name}</div>
        <div style={{ fontSize: 17, color: M_C.sec, lineHeight: 1.45, marginBottom: 18, maxWidth: 480 }}>{tool.tagline}</div>
        <div style={{ display:'flex', alignItems:'center', gap: 16, fontSize: 12, color: M_C.sec }}>
          <span style={{ display:'inline-flex', alignItems:'center', gap: 6 }}>
            <MAvatar author={tool.author} color={tool.authorAvatar} size={18}/>
            {tool.author}
          </span>
          <span>·</span>
          <span style={{ fontFamily:'var(--ul-font-mono)' }}>{fmtN(tool.installs)} installs</span>
          <span>·</span>
          <span style={{ fontFamily:'var(--ul-font-mono)' }}>✦{tool.callPrice.toFixed(3)}/call</span>
        </div>
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap: 8 }}>
        <button style={{
          background: M_C.text, color:'#fff', border:'none', padding:'12px 20px',
          borderRadius: 10, fontSize: 14, fontWeight: 500, cursor:'pointer', display:'inline-flex', alignItems:'center', gap: 8,
        }}>Install <span style={{ fontFamily:'var(--ul-font-mono)', fontSize: 11, opacity: 0.6 }}>↵</span></button>
        <button style={{
          background:'transparent', color: M_C.text, border:`1px solid ${M_C.border}`, padding:'10px 20px',
          borderRadius: 10, fontSize: 13, fontWeight: 500, cursor:'pointer',
        }}>Acquire</button>
      </div>
    </div>
  );
}

// ── Category chip ─────────────────────────────────────────────
function MCategoryChip({ cat, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding:'8px 14px', borderRadius: 9999, fontSize: 13, fontWeight: 500,
      border: `1px solid ${active ? M_C.text : M_C.border}`,
      background: active ? M_C.text : '#fff',
      color: active ? '#fff' : M_C.text,
      cursor:'pointer', display:'inline-flex', alignItems:'center', gap: 8,
      transition:'all 160ms ease', fontFamily:'inherit',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 9999, background: active ? '#fff' : cat.color }}/>
      {cat.label}
      <span style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', color: active ? 'rgba(255,255,255,0.6)' : M_C.mute }}>{cat.count}</span>
    </button>
  );
}

// ── Trending card (smaller, used in row) ──────────────────────
function MTrendingCard({ tool, onClick }) {
  return (
    <div onClick={onClick} style={{
      cursor:'pointer', flex:'0 0 240px', border:`1px solid ${M_C.border}`, borderRadius: 12,
      padding: 16, background:'#fff', transition:'all 160ms ease',
    }}
    onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.06)'; e.currentTarget.style.borderColor = 'rgba(0,0,0,0.15)'; }}
    onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.borderColor = M_C.border; }}>
      <div style={{ display:'flex', alignItems:'center', gap: 8, marginBottom: 10 }}>
        <MAvatar author={tool.author} color={tool.authorAvatar} size={20}/>
        <span style={{ fontSize: 14, fontWeight: 600, letterSpacing:'-0.01em' }}>{tool.name}</span>
        <span style={{ marginLeft:'auto', fontSize: 11, fontFamily:'var(--ul-font-mono)', color:'#22c55e' }}>↑{(tool.growth7d*100).toFixed(0)}%</span>
      </div>
      <div style={{ fontSize: 12, color: M_C.sec, lineHeight: 1.4, marginBottom: 12, height: 34, overflow:'hidden' }}>{tool.tagline}</div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <MSpark data={tool.sparkline} growth={tool.growth7d} w={64}/>
        <span style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', color: M_C.text, fontVariantNumeric:'tabular-nums' }}>✦{tool.callPrice.toFixed(3)}</span>
      </div>
    </div>
  );
}

// ── New-this-week strip item ──────────────────────────────────
function MNewItem({ item }) {
  return (
    <div style={{ flex:'0 0 200px', padding:'10px 12px', border:`1px solid ${M_C.border}`, borderRadius: 10,
      display:'flex', alignItems:'center', gap: 10, background:'#fff', cursor:'pointer' }}>
      <div style={{ width: 32, height: 32, borderRadius: 8, background:'linear-gradient(135deg, #f3f4f6, #e5e7eb)',
        display:'flex', alignItems:'center', justifyContent:'center', flexShrink: 0 }}>
        <M_Icons.IconPackage size={14}/>
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.name}</div>
        <div style={{ fontSize: 11, color: M_C.mute, fontFamily:'var(--ul-font-mono)' }}>{item.days}d · ✦{item.callPrice.toFixed(3)}</div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// VARIANT 1: EDITORIAL — magazine-feel
// ════════════════════════════════════════════════════════════
function MMarketEditorial({ onOpenTool }) {
  const [cat, setCat] = React.useState(null);
  const [q, setQ] = React.useState('');
  const top10 = MD_TOOLS;
  const trending = MD_TOOLS.filter(t => t.growth7d > 0.1).sort((a,b) => b.growth7d - a.growth7d).slice(0, 5);
  const featured = MD_TOOLS[7]; // tweet.draft — highest 7d growth

  return (
    <div style={{ background:'#fff', height:'100%', overflow:'auto', fontFamily:'var(--ul-font-sans)' }}>
      <div style={{ maxWidth: 1080, margin:'0 auto', padding:'40px 40px 80px' }}>
        {/* Header */}
        <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between', marginBottom: 28 }}>
          <div>
            <div style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', color: M_C.mute, letterSpacing:'0.08em', textTransform:'uppercase', marginBottom: 8 }}>Marketplace</div>
            <div style={{ fontSize: 42, fontWeight: 700, letterSpacing:'-0.03em', lineHeight: 1 }}>Tools, today.</div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap: 8, border:`1px solid ${M_C.border}`, borderRadius: 10, padding:'8px 12px', width: 280 }}>
            <M_Icons.IconSearch size={14}/>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search 4,200 tools…"
              style={{ border:'none', outline:'none', fontSize: 13, fontFamily:'inherit', flex: 1, background:'transparent' }}/>
            <kbd style={{ fontSize: 10, color: M_C.mute, background:'rgba(0,0,0,0.04)', padding:'2px 5px', borderRadius: 3 }}>⌘K</kbd>
          </div>
        </div>

        {/* Featured */}
        <div style={{ marginBottom: 36 }}>
          <MFeaturedHero tool={featured} onClick={() => onOpenTool && onOpenTool(featured.id)}/>
        </div>

        {/* Categories */}
        <div style={{ display:'flex', gap: 8, flexWrap:'wrap', marginBottom: 32 }}>
          <MCategoryChip cat={{ id:'all', label:'All', count: 4204, color: M_C.text }} active={!cat} onClick={() => setCat(null)}/>
          {MD_CATEGORIES.map(c =>
            <MCategoryChip key={c.id} cat={c} active={cat === c.id} onClick={() => setCat(c.id)}/>)}
        </div>

        {/* Top 10 Billboard */}
        <div style={{ marginBottom: 40 }}>
          <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 24, fontWeight: 700, letterSpacing:'-0.02em' }}>Top 10 this week</div>
              <div style={{ fontSize: 12, color: M_C.mute, marginTop: 4 }}>By installs · refreshed Mondays</div>
            </div>
            <div style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', color: M_C.mute, display:'flex', gap: 24, letterSpacing:'0.02em' }}>
              <span>7d trend</span><span style={{ width: 60, textAlign:'right' }}>installs</span>
            </div>
          </div>
          <div>
            {top10.map((t, i) => <MBillboardRow key={t.id} tool={t} rank={i+1} onClick={() => onOpenTool && onOpenTool(t.id)}/>)}
          </div>
        </div>

        {/* Trending */}
        <div style={{ marginBottom: 40 }}>
          <div style={{ fontSize: 18, fontWeight: 600, letterSpacing:'-0.015em', marginBottom: 12 }}>Trending now</div>
          <div style={{ display:'flex', gap: 12, overflowX:'auto', paddingBottom: 4 }}>
            {trending.map(t => <MTrendingCard key={t.id} tool={t} onClick={() => onOpenTool && onOpenTool(t.id)}/>)}
          </div>
        </div>

        {/* New this week */}
        <div>
          <div style={{ fontSize: 18, fontWeight: 600, letterSpacing:'-0.015em', marginBottom: 12 }}>New this week</div>
          <div style={{ display:'flex', gap: 8, flexWrap:'wrap' }}>
            {MD_NEW_THIS_WEEK.map(n => <MNewItem key={n.id} item={n}/>)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// VARIANT 2: DENSE — utilitarian search-first grid
// ════════════════════════════════════════════════════════════
function MDenseGridCard({ tool, rank, onClick }) {
  return (
    <div onClick={onClick} style={{
      cursor:'pointer', border:`1px solid ${M_C.border}`, borderRadius: 8,
      padding: 12, background:'#fff', display:'flex', flexDirection:'column', gap: 8,
      position:'relative', transition:'all 140ms ease', minHeight: 124,
    }}
    onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(0,0,0,0.2)'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.04)'; }}
    onMouseLeave={e => { e.currentTarget.style.borderColor = M_C.border; e.currentTarget.style.boxShadow = 'none'; }}>
      {rank && <span style={{ position:'absolute', top: 8, right: 10, fontFamily:'var(--ul-font-mono)', fontSize: 10, color: M_C.mute, letterSpacing:'0.04em' }}>#{rank}</span>}
      <div style={{ display:'flex', alignItems:'center', gap: 8 }}>
        <MAvatar author={tool.author} color={tool.authorAvatar} size={20}/>
        <span style={{ fontSize: 13, fontWeight: 600, letterSpacing:'-0.01em', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{tool.name}</span>
      </div>
      <div style={{ fontSize: 12, color: M_C.sec, lineHeight: 1.4, flex: 1 }}>{tool.tagline}</div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:'auto' }}>
        <div style={{ display:'flex', alignItems:'center', gap: 8, fontSize: 11, fontFamily:'var(--ul-font-mono)', color: M_C.mute, fontVariantNumeric:'tabular-nums' }}>
          <span>{fmtN(tool.installs)}</span>
          <span style={{ color: tool.growth7d > 0 ? '#22c55e' : '#ef4444' }}>{tool.growth7d > 0 ? '↑' : '↓'}{Math.abs(tool.growth7d*100).toFixed(0)}%</span>
        </div>
        <span style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', color: M_C.text, fontVariantNumeric:'tabular-nums' }}>✦{tool.callPrice.toFixed(3)}</span>
      </div>
    </div>
  );
}

function MMarketDense({ onOpenTool }) {
  const [cat, setCat] = React.useState(null);
  const [q, setQ] = React.useState('');
  const [sort, setSort] = React.useState('top');
  const filtered = MD_TOOLS.filter(t => !cat || t.category === cat).filter(t => !q || t.name.includes(q));

  return (
    <div style={{ background:'#fff', height:'100%', overflow:'auto', fontFamily:'var(--ul-font-sans)' }}>
      {/* Sticky filter bar */}
      <div style={{ position:'sticky', top: 0, background:'rgba(255,255,255,0.95)', backdropFilter:'blur(8px)',
        borderBottom:`1px solid ${M_C.border}`, padding:'12px 32px', zIndex: 10 }}>
        <div style={{ maxWidth: 1200, margin:'0 auto', display:'flex', alignItems:'center', gap: 16 }}>
          <div style={{ display:'flex', alignItems:'center', gap: 8, border:`1px solid ${M_C.border}`, borderRadius: 8, padding:'6px 10px', flex: 1, maxWidth: 480 }}>
            <M_Icons.IconSearch size={14}/>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search 4,204 tools by name, capability, or author…"
              style={{ border:'none', outline:'none', fontSize: 13, fontFamily:'inherit', flex: 1, background:'transparent' }}/>
            <kbd style={{ fontSize: 10, color: M_C.mute, background:'rgba(0,0,0,0.04)', padding:'2px 5px', borderRadius: 3, fontFamily:'var(--ul-font-mono)' }}>/</kbd>
          </div>
          <div style={{ display:'flex', gap: 4, borderRadius: 8, padding: 2, background:'rgba(0,0,0,0.04)' }}>
            {[{id:'top', label:'Top'}, {id:'new', label:'New'}, {id:'rising', label:'Rising'}].map(s => (
              <button key={s.id} onClick={() => setSort(s.id)} style={{
                padding:'5px 12px', fontSize: 12, fontWeight: 500, fontFamily:'inherit',
                background: sort === s.id ? '#fff' : 'transparent',
                color: sort === s.id ? M_C.text : M_C.sec,
                border:'none', borderRadius: 6, cursor:'pointer',
                boxShadow: sort === s.id ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
              }}>{s.label}</button>
            ))}
          </div>
        </div>
        <div style={{ maxWidth: 1200, margin:'8px auto 0', display:'flex', gap: 6, flexWrap:'wrap' }}>
          <button onClick={() => setCat(null)} style={{ fontSize: 12, padding:'4px 10px', borderRadius: 9999,
            background: !cat ? M_C.text : 'transparent', color: !cat ? '#fff' : M_C.sec,
            border: `1px solid ${!cat ? M_C.text : M_C.border}`, cursor:'pointer', fontFamily:'inherit' }}>All</button>
          {MD_CATEGORIES.map(c => (
            <button key={c.id} onClick={() => setCat(cat === c.id ? null : c.id)} style={{
              fontSize: 12, padding:'4px 10px', borderRadius: 9999,
              background: cat === c.id ? M_C.text : 'transparent',
              color: cat === c.id ? '#fff' : M_C.sec,
              border: `1px solid ${cat === c.id ? M_C.text : M_C.border}`, cursor:'pointer', fontFamily:'inherit',
            }}>{c.label} <span style={{ opacity: 0.5, fontFamily:'var(--ul-font-mono)' }}>{c.count}</span></button>
          ))}
        </div>
      </div>

      {/* Featured strip — compact in dense variant */}
      <div style={{ padding:'20px 32px 8px', maxWidth: 1200, margin:'0 auto' }}>
        <div style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', color: M_C.mute, letterSpacing:'0.08em', textTransform:'uppercase', marginBottom: 10 }}>Featured</div>
        <div style={{ display:'flex', gap: 12, overflowX:'auto', paddingBottom: 6 }}>
          {[MD_TOOLS[7], MD_TOOLS[2], MD_TOOLS[0]].map(t => (
            <div key={t.id} onClick={() => onOpenTool && onOpenTool(t.id)} style={{
              flex:'0 0 320px', borderRadius: 10, padding: 16, cursor:'pointer',
              background: `linear-gradient(135deg, ${t.authorAvatar}12, transparent)`,
              border:`1px solid ${M_C.border}`,
            }}>
              <div style={{ display:'flex', alignItems:'center', gap: 10, marginBottom: 8 }}>
                <MAvatar author={t.author} color={t.authorAvatar} size={24}/>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{t.name}</div>
                  <div style={{ fontSize: 11, color: M_C.mute }}>{t.author}</div>
                </div>
                <span style={{ marginLeft:'auto', fontSize: 11, fontFamily:'var(--ul-font-mono)', color:'#22c55e' }}>↑{(t.growth7d*100).toFixed(0)}%</span>
              </div>
              <div style={{ fontSize: 13, color: M_C.sec, lineHeight: 1.4 }}>{t.tagline}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Top 10 + grid */}
      <div style={{ padding:'24px 32px 60px', maxWidth: 1200, margin:'0 auto' }}>
        <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 600, letterSpacing:'-0.01em' }}>Top 10 by install — {cat ? MD_CATEGORIES.find(c => c.id===cat)?.label : 'All'}</div>
          <div style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', color: M_C.mute }}>{filtered.length} tools</div>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
          {filtered.map((t, i) => <MDenseGridCard key={t.id} tool={t} rank={i+1} onClick={() => onOpenTool && onOpenTool(t.id)}/>)}
        </div>
      </div>
    </div>
  );
}

window.PUI_MMarketEditorial = MMarketEditorial;
window.PUI_MMarketDense = MMarketDense;
window.PUI_MAvatar = MAvatar;
window.PUI_MSpark = MSpark;
