// Discover / Tool Dealer widget — before vs after.
//
// BEFORE: faithful recreation of desktop/src/components/DiscoverWidget.tsx.
//
// AFTER: re-frames the widget as an in-chat moment delivered by Tool Dealer.
//   • Borderless, lives in the chat flow.
//   • Cards "dealt" in from the right with staggered entry; click to flip
//     to a richer trust+listing receipt with per-call price, version,
//     installs, signer, capabilities, recent activity.
//   • Selection lives on the FRONT face (checkmark badge) so users can
//     multi-select and add several at once — same flow as the form, but
//     the moment-feel of cards.
//   • Terminology: per-call price is shown as METADATA, not gating. "Add to
//     chat" is the action for both free and paid tools (uniform), since
//     adding is free; calls are metered later. "Acquire" is reserved for
//     true ownership-transfer listings (marketplace > Buy this app),
//     which is a separate flow we don't surface inline here.

const { C: PUI_DC_C, SYS_AGENTS: PUI_DC_AGENTS, Spark: PUI_DC_Spark } = window.PUI_Primitives;

// ── Demo data ───────────────────────────────────────────────────────────────
// Mirrors DiscoverWidget shape, plus the public-page detail bits (author,
// version, installs, recent calls, sample call price).
// Each tool is a *package* of functions. Light is priced per-function, not
// per-tool — that's the actual platform model. Card front shows the package
// name, author, and install count; the flip side lists every function with
// its description and per-call ✦ price.
const DISCOVER_RESULTS = [
  {
    id: 'weather',
    name: 'get_weather',
    description: 'Live weather + 7-day forecast from NOAA. Free tier 50 req/day.',
    type: 'app',
    source: 'library',
    runtime: 'edge',
    capabilities: ['Network'],
    receipts: true,
    latency: '120ms',
    author: 'noaa-bridge',
    version: '2.4.1',
    installs: '12.4k',
    likes: 982,
    rating: 4.8,
    recentCalls: '38k / 24h',
    signer: 'noaa-bridge.studio',
    functions: [
      { name: 'current',   desc: 'Conditions + temp at a coordinate.',    price: 0      },
      { name: 'forecast',  desc: '7-day daily forecast.',                 price: 0      },
      { name: 'alerts',    desc: 'NWS active alerts for an area.',        price: 0      },
      { name: 'historical',desc: 'Hourly observations, last 30 days.',    price: 0.0005 },
    ],
  },
  {
    id: 'currency',
    name: 'currency_convert',
    description: '180+ pairs · spot + historical · Stripe-backed billing.',
    type: 'app',
    source: 'marketplace',
    runtime: 'edge',
    capabilities: ['Network', 'AI'],
    receipts: true,
    latency: '180ms',
    author: 'fxpay',
    version: '1.12.0',
    installs: '4.1k',
    likes: 312,
    rating: 4.6,
    recentCalls: '9.2k / 24h',
    signer: 'fxpay.studio',
    functions: [
      { name: 'convert',    desc: 'Spot-rate conversion between any pair.', price: 0.002 },
      { name: 'historical', desc: 'EOD rate for a given date.',             price: 0.003 },
      { name: 'list_pairs', desc: 'All 180+ supported pairs.',              price: 0     },
    ],
  },
  {
    id: 'rss',
    name: 'rss_to_summary',
    description: 'Pulls a feed and returns one-paragraph summaries.',
    type: 'skill',
    source: 'marketplace',
    runtime: 'edge',
    capabilities: ['Network', 'AI'],
    receipts: true,
    latency: '~2s',
    author: 'feedrabbit',
    version: '0.4.2',
    installs: '820',
    likes: 47,
    rating: 4.1,
    recentCalls: '1.1k / 24h',
    signer: 'feedrabbit.studio',
    functions: [
      { name: 'fetch',       desc: 'Fetch the latest N items from a feed URL.',  price: 0     },
      { name: 'summarize',   desc: 'One-paragraph summary of an item.',          price: 0.001 },
      { name: 'digest',      desc: 'Combined digest across multiple feeds.',     price: 0.002 },
    ],
  },
];

// ── BEFORE: faithful recreation of the production DiscoverWidget ────────────
function PUI_DiscoverWidget_Before() {
  const [query, setQuery] = React.useState('weather');
  const [selected, setSelected] = React.useState(new Set(['weather']));

  const toggle = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  return (
    <div style={{
      borderRadius: 12,
      border: `1px solid ${PUI_DC_C.border}`,
      background: '#fff',
      overflow: 'hidden',
      boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
    }}>
      <div style={{ borderBottom: `1px solid ${PUI_DC_C.border}`, padding: 12 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom: 8, gap: 8 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: PUI_DC_C.text }}>Find the right tools</div>
            <div style={{ fontSize: 11, color: PUI_DC_C.mute }}>Search your library and the marketplace together.</div>
          </div>
        </div>
        <div style={{ display:'flex', gap: 8 }}>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search tool market..." style={{
            flex: 1, padding:'6px 10px', fontSize: 13, border: `1px solid ${PUI_DC_C.border}`, borderRadius: 6,
            outline:'none', fontFamily:'inherit', color: PUI_DC_C.text, background:'transparent',
          }}/>
          <button style={{
            padding:'6px 12px', fontSize: 12, fontWeight: 500, color:'#fff', background: PUI_DC_C.text,
            border:'none', borderRadius: 6, cursor:'pointer',
          }}>Search</button>
        </div>
      </div>
      <div>
        {DISCOVER_RESULTS.map(r => {
          const isSel = selected.has(r.id);
          return (
            <button key={r.id} onClick={() => toggle(r.id)} style={{
              width:'100%', textAlign:'left', display:'block', padding:'12px 16px',
              borderTop: `1px solid ${PUI_DC_C.border}`, borderLeft:'none', borderRight:'none', borderBottom:'none',
              background: isSel ? 'rgba(34,197,94,0.06)' : '#fff', cursor:'pointer',
            }}>
              <div style={{ display:'flex', alignItems:'flex-start', gap: 12 }}>
                <div style={{
                  marginTop: 2, width: 14, height: 14, flexShrink: 0, borderRadius: 3,
                  border: `1px solid ${isSel ? '#22c55e' : '#cbd5e1'}`,
                  background: isSel ? '#22c55e' : '#fff',
                  display:'flex', alignItems:'center', justifyContent:'center',
                }}>
                  {isSel && <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round"><path d="M2 5L4 7L8 3"/></svg>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display:'flex', flexWrap:'wrap', alignItems:'center', gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: PUI_DC_C.text }}>{r.name}</span>
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding:'2px 6px', borderRadius: 9999,
                      background: r.source === 'library' ? 'rgba(34,197,94,0.12)' : 'rgba(0,0,0,0.05)',
                      color: r.source === 'library' ? '#15803d' : PUI_DC_C.sec,
                    }}>{r.source === 'library' ? 'Installed' : 'Marketplace'}</span>
                    {r.type === 'skill' && <span style={{
                      fontSize: 10, fontWeight: 600, padding:'2px 6px', borderRadius: 9999,
                      background:'rgba(168,85,247,0.12)', color:'#7e22ce',
                    }}>Skill</span>}
                  </div>
                  <div style={{ fontSize: 11, color: PUI_DC_C.mute, marginTop: 2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.description}</div>
                  <div style={{ display:'flex', flexWrap:'wrap', alignItems:'center', gap: 6, marginTop: 6 }}>
                    <span style={{
                      fontSize: 9, fontWeight: 700, padding:'2px 6px', borderRadius: 9999,
                      background: r.signed ? 'rgba(34,197,94,0.14)' : 'rgba(245,158,11,0.18)',
                      color: r.signed ? '#15803d' : '#a16207',
                    }}>{r.signed ? 'Signed' : 'Legacy'}</span>
                    <span style={{
                      fontSize: 9, fontWeight: 600, padding:'2px 6px', borderRadius: 9999,
                      background:'rgba(0,0,0,0.04)', color: PUI_DC_C.sec,
                    }}>{r.capabilities.join(', ') || 'No broad access'}</span>
                    {r.receipts && <span style={{
                      fontSize: 9, fontWeight: 600, padding:'2px 6px', borderRadius: 9999,
                      background:'rgba(0,0,0,0.04)', color: PUI_DC_C.sec,
                    }}>Receipts</span>}
                    {r.pricePerCall > 0 && <span style={{
                      fontSize: 9, fontWeight: 600, padding:'2px 6px', borderRadius: 9999,
                      background:'rgba(34,197,94,0.12)', color:'#15803d',
                    }}>Acquire ✦{r.pricePerCall.toFixed(3)}</span>}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
      {selected.size > 0 && (
        <div style={{
          display:'flex', alignItems:'center', justifyContent:'space-between',
          borderTop: `1px solid ${PUI_DC_C.border}`, background: PUI_DC_C.raised, padding: 12,
        }}>
          <span style={{ fontSize: 12, color: PUI_DC_C.sec }}>{selected.size} selected</span>
          <button style={{
            padding:'6px 12px', fontSize: 12, fontWeight: 500, color:'#fff', background: PUI_DC_C.text,
            border:'none', borderRadius: 6, cursor:'pointer',
          }}>Add to conversation</button>
        </div>
      )}
    </div>
  );
}

// ── E3 Trust Stamp — three dots referencing the platform mark ───────────────
// All listings on Ultralight have signed manifests; the stamp is uniformly
// green. (Earlier iterations used a "legacy / unsigned" half-orange variant —
// dropped because "legacy" wasn't a meaningful axis to users; community signal
// is now expressed via likes / install count instead.)
function PUI_DC_TrustStamp({ size = 5 }) {
  return (
    <div style={{ display:'inline-flex', alignItems:'center', gap: 3 }} title="Signed manifest · receipts on">
      {[0,1,2].map(i => (
        <span key={i} style={{ width: size, height: size, borderRadius: 9999, background:'#16a34a', display:'block' }}/>
      ))}
    </div>
  );
}

// ── Price chip — shows per-call cost as metadata, not as a gate ─────────────
function PUI_DC_PriceChip({ price, dark = false }) {
  const isFree = !price || price === 0;
  return (
    <span style={{
      display:'inline-flex', alignItems:'baseline', gap: 4,
      fontFamily:'var(--ul-font-mono)', fontSize: 10,
      color: dark ? 'rgba(255,255,255,0.85)' : (isFree ? PUI_DC_C.sec : PUI_DC_C.text),
      fontVariantNumeric:'tabular-nums',
    }}>
      {isFree ? (
        <span>Free</span>
      ) : (
        <>
          <span style={{ color: dark ? 'rgba(255,255,255,0.5)' : PUI_DC_C.mute, fontSize: 9 }}>per call</span>
          <span>✦{price.toFixed(3)}</span>
        </>
      )}
    </span>
  );
}

// ── Tool Dealer card ────────────────────────────────────────────────────────
function PUI_DC_DealerCard({ result, index, dealt, flipped, selected, onFlip, onToggleSelect }) {
  // Hover animations and shadows removed: cards now read as quiet, equal-weight
  // packages — like a row of library shelves. Static border carries the affordance.
  const baseTransform = dealt ? 'translateY(0)' : 'translateY(8px)';
  const baseOpacity = dealt ? 1 : 0;

  return (
    <div
      style={{
        position:'relative',
        // Horizontal cards — wider than tall, equal height on both faces.
        // 184px gives the description and function list room without
        // losing the "card" silhouette in chat.
        width: 340,
        flex:'0 0 340px',
        height: 184,
        borderRadius: 12,
        background:'#fff',
        border:'1px solid rgba(0,0,0,0.08)',
        opacity: baseOpacity,
        transform: baseTransform,
        transition: `opacity 360ms cubic-bezier(.2,.9,.3,1) ${index * 80}ms, transform 360ms cubic-bezier(.2,.9,.3,1) ${index * 80}ms`,
        perspective: 800,
        overflow:'hidden',
      }}
    >
      <div style={{
        position:'absolute', inset: 0,
        transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
        transformStyle:'preserve-3d',
        transition:'transform 480ms cubic-bezier(.4,.0,.2,1)',
      }}>
        {/* Front face — quiet, library-shelf feel.
            • Top-left now reads only "N installs" in mono. No green ••• stamp;
              all listings on Ultralight are signed, so the stamp was dead weight.
            • Bottom-right has no per-call price. Price is per-function, not
              per-tool, and lives on the flip side.
            • Click anywhere on the body to flip; checkbox is the multi-select.
            • Header + footer don't shrink; description is the one scrollable
              region so cards never visually break when content overflows. */}
        <div
          onClick={() => onFlip(result.id)}
          style={{
            position:'absolute', inset: 0, padding:'12px 14px', cursor:'pointer',
            display:'flex', flexDirection:'column',
            backfaceVisibility:'hidden', WebkitBackfaceVisibility:'hidden',
          }}
        >
          {/* Multi-select checkbox — top-right, click stops propagation so flip doesn't fire */}
          <button
            onClick={(e) => { e.stopPropagation(); onToggleSelect(result.id); }}
            aria-label={selected ? 'Remove from selection' : 'Add to selection'}
            style={{
              position:'absolute', top: 10, right: 10, zIndex: 2,
              width: 18, height: 18, borderRadius: 5,
              background: selected ? '#16a34a' : '#fff',
              border: `1px solid ${selected ? '#16a34a' : 'rgba(0,0,0,0.18)'}`,
              display:'flex', alignItems:'center', justifyContent:'center',
              cursor:'pointer', padding: 0,
              transition:'background 160ms ease, border-color 160ms ease',
            }}
          >
            {selected && <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round"><path d="M2 5L4 7L8 3"/></svg>}
          </button>

          {/* Header row — name + author. Installs sits inline as a small mono badge. */}
          <div style={{ flexShrink: 0, paddingRight: 28, display:'flex', alignItems:'baseline', gap: 8 }}>
            <div style={{ fontFamily:'var(--ul-font-mono)', fontSize: 13, fontWeight: 600, color: PUI_DC_C.text, letterSpacing:'-0.01em', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {result.name}
            </div>
            <span style={{ fontSize: 10, color: PUI_DC_C.mute, fontFamily:'var(--ul-font-mono)', whiteSpace:'nowrap' }}>
              {result.installs} installs
            </span>
          </div>
          <div style={{ flexShrink: 0, fontSize: 10, color: PUI_DC_C.mute, fontFamily:'var(--ul-font-mono)', marginTop: 2 }}>
            by {result.author}
          </div>

          {/* Description — uses up to 3 lines so cards fill their height. */}
          <div style={{
            flex: 1, minHeight: 0, marginTop: 6,
            fontSize: 11, color: PUI_DC_C.sec, lineHeight: 1.4,
            display:'-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient:'vertical',
            overflow:'hidden', textOverflow:'ellipsis',
          }}>
            {result.description}
          </div>

          {/* Footer — fixed */}
          <div style={{ flexShrink: 0, marginTop: 8, display:'flex', alignItems:'center', justifyContent:'space-between', gap: 6 }}>
            <div style={{ display:'flex', gap: 4, flexWrap:'wrap' }}>
              {result.source === 'library' ? (
                <span style={{ fontSize: 9, fontWeight: 600, padding:'2px 6px', borderRadius: 9999, background:'rgba(34,197,94,0.12)', color:'#15803d', letterSpacing:'0.04em', textTransform:'uppercase' }}>Installed</span>
              ) : (
                <span style={{ fontSize: 9, fontWeight: 600, padding:'2px 6px', borderRadius: 9999, background:'rgba(0,0,0,0.05)', color: PUI_DC_C.sec, letterSpacing:'0.04em', textTransform:'uppercase' }}>Marketplace</span>
              )}
              {result.type === 'skill' && (
                <span style={{ fontSize: 9, fontWeight: 600, padding:'2px 6px', borderRadius: 9999, background:'rgba(168,85,247,0.12)', color:'#7e22ce', letterSpacing:'0.04em', textTransform:'uppercase' }}>Skill</span>
              )}
            </div>
            <span style={{ fontSize: 10, color: PUI_DC_C.mute, fontFamily:'var(--ul-font-mono)' }}>
              {result.functions.length} fn · details →
            </span>
          </div>
        </div>

        {/* Back face — horizontal: meta column on left, function list on right.
            Header and "Add to chat" footer don't shrink — only the function
            list scrolls. */}
        <div
          onClick={() => onFlip(result.id)}
          style={{
            position:'absolute', inset: 0, padding:'10px 12px',
            cursor:'pointer',
            background:'#fff', color: PUI_DC_C.text,
            display:'flex', gap: 12,
            transform:'rotateY(180deg)',
            backfaceVisibility:'hidden', WebkitBackfaceVisibility:'hidden',
          }}
        >
          {/* Left meta column — name, version, rating, Add button */}
          <div style={{ width: 112, flexShrink: 0, display:'flex', flexDirection:'column', gap: 10, paddingTop: 5 }}>
            <div>
              <div style={{ fontFamily:'var(--ul-font-mono)', fontSize: 11, fontWeight: 600, color: PUI_DC_C.text, letterSpacing:'-0.01em', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {result.name}
              </div>
              <div style={{ marginTop: 2, fontSize: 10, color: PUI_DC_C.mute, fontFamily:'var(--ul-font-mono)', display:'flex', gap: 6 }}>
                <span style={{ fontVariantNumeric:'tabular-nums' }}>v{result.version}</span>
                <span style={{ color: PUI_DC_C.text, fontVariantNumeric:'tabular-nums' }}>{result.rating.toFixed(1)}★</span>
              </div>
              <div style={{ marginTop: 4, fontSize: 9, fontFamily:'var(--ul-font-mono)', color: PUI_DC_C.mute, letterSpacing:'0.08em', textTransform:'uppercase' }}>
                {result.functions.length} functions
              </div>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); if (!selected) onToggleSelect(result.id); onFlip(result.id); }}
              style={{
                padding:'6px 10px', fontSize: 11, fontWeight: 600,
                background: PUI_DC_C.text, color:'#fff', border:'none', borderRadius: 6, cursor:'pointer',
                fontFamily:'inherit',
              }}
            >
              {selected ? 'Selected ✓' : 'Add to chat'}
            </button>
          </div>

          {/* Right column — function list, the only scrollable area */}
          <div
            onWheel={(e) => e.stopPropagation()}
            style={{
              flex: 1, minWidth: 0, overflowY:'auto', overflowX:'hidden',
              borderLeft:'1px solid rgba(0,0,0,0.06)', paddingLeft: 10,
            }}
          >
            {result.functions.map((fn, i) => (
              <div
                key={fn.name}
                style={{
                  display:'flex', alignItems:'flex-start', justifyContent:'space-between',
                  gap: 8, padding:'5px 0',
                  borderTop: i === 0 ? 'none' : '1px solid rgba(0,0,0,0.04)',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily:'var(--ul-font-mono)', fontSize: 10.5, fontWeight: 600, color: PUI_DC_C.text, lineHeight: 1.3, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {fn.name}
                  </div>
                  <div style={{ fontSize: 9.5, color: PUI_DC_C.mute, lineHeight: 1.35, marginTop: 1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {fn.desc}
                  </div>
                </div>
                <span style={{
                  fontFamily:'var(--ul-font-mono)', fontSize: 9.5, fontVariantNumeric:'tabular-nums', whiteSpace:'nowrap',
                  color: fn.price > 0 ? PUI_DC_C.text : PUI_DC_C.mute,
                  marginTop: 1,
                }}>
                  {fn.price > 0 ? `✦${fn.price.toFixed(3)}` : 'Free'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Tool Dealer widget — premium, ambient, in-chat ──────────────────────────
function PUI_DiscoverWidget_After({ replayKey = 0, headerVariant = 'ambient' /* 'ambient' | 'manual' */, onClose }) {
  const [dealt, setDealt] = React.useState(false);
  const [flipped, setFlipped] = React.useState(null);
  const [selected, setSelected] = React.useState(new Set());
  const [added, setAdded] = React.useState(0);
  const [query, setQuery] = React.useState('');
  // Ambient surfacing is the default \u2014 results reflect the totality of the
  // current session, not a typed query. Once the user types, the widget
  // flips into explicit-search mode and the header copy follows.
  const isExplicitSearch = query.trim().length > 0;

  React.useEffect(() => {
    setDealt(false);
    setFlipped(null);
    setSelected(new Set());
    setAdded(0);
    const t = setTimeout(() => setDealt(true), 60);
    return () => clearTimeout(t);
  }, [replayKey]);

  const onFlip = (id) => setFlipped(prev => prev === id ? null : id);

  const onToggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleAdd = () => {
    setAdded(selected.size);
  };

  const dealer = PUI_DC_AGENTS.find(a => a.id === 'tool-marketer');

  return (
    <div style={{ padding:'16px 20px 20px', position:'relative' }}>
      {/* Explicit close — sits in the upper-right of the widget. This is the
          primary dismiss affordance. The Tools pill toggle and click-outside
          on the popover both call onClose too. */}
      {onClose && (
        <button
          onClick={onClose}
          aria-label="Dismiss Tool Dealer"
          style={{
            position:'absolute', top: 10, right: 10, zIndex: 3,
            width: 24, height: 24, borderRadius: 9999,
            background:'rgba(0,0,0,0.04)', border:'none', cursor:'pointer',
            display:'flex', alignItems:'center', justifyContent:'center',
            color: PUI_DC_C.sec, padding: 0, fontFamily:'inherit',
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(0,0,0,0.08)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(0,0,0,0.04)'}>
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M3 3l6 6M9 3l-6 6"/></svg>
        </button>
      )}
      {/* Header — ambient: dealer-introduced (results from totality of the
          session). manual: triggered by the user typing in the search field
          below — header pivots to explicit-search copy. */}
      <div style={{ display:'flex', alignItems:'center', gap: 10, marginBottom: 12 }}>
        <div style={{ display:'flex', flexDirection:'column', gap: 3, lineHeight: 1.25 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: PUI_DC_C.text, letterSpacing:'-0.01em' }}>
            {isExplicitSearch
              ? <>Tool Dealer found {DISCOVER_RESULTS.length} matches</>
              : <>Found 3 new tools for this session</>}
          </span>
          <span style={{ fontSize: 11, color: PUI_DC_C.mute }}>
            Tap a card for details · use the checkbox to multi-select.
          </span>
        </div>
      </div>

      {/* Search bar — same affordance as the BEFORE version, but quieter
          chrome. Empty by default; typing flips the widget to explicit-
          search mode (header + subhead copy follow). */}
      <div style={{ display:'flex', gap: 8, marginBottom: 14 }}>
        <div style={{ flex: 1, display:'flex', alignItems:'center', gap: 8, padding:'7px 10px', background:'transparent', border:`1px solid ${PUI_DC_C.border}`, borderRadius: 8 }}>
          <span style={{ color: PUI_DC_C.mute, display:'inline-flex' }}><window.PUI_Icons.IconSearch size={13}/></span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tools"
            style={{
              flex: 1, border:'none', outline:'none', background:'transparent',
              fontFamily:'inherit', fontSize: 12, color: PUI_DC_C.text,
            }}
          />
          {isExplicitSearch && (
            <button onClick={() => setQuery('')} title="Clear search"
              style={{ border:'none', background:'transparent', color: PUI_DC_C.mute, cursor:'pointer', padding: 0, fontSize: 12, lineHeight: 1, fontFamily:'var(--ul-font-mono)' }}>×</button>
          )}
        </div>
      </div>

      {/* Card rail — horizontal layout, scrolls overflow on narrow containers.
          No flex-wrap: cards stay in a single row, like a hand of cards
          dealt across the chat. */}
      <div
        onWheel={(e) => {
          // Convert vertical scroll to horizontal so the rail scrolls naturally.
          if (e.deltaY !== 0 && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
            e.currentTarget.scrollLeft += e.deltaY;
          }
        }}
        style={{
          display:'flex', gap: 12, flexWrap:'nowrap',
          overflowX:'auto', overflowY:'hidden',
          paddingTop: 6, paddingBottom: 12, paddingLeft: 20, paddingRight: 20,
          marginTop: -6, marginLeft: -20, marginRight: -20,
          scrollbarWidth:'thin',
        }}>
        {DISCOVER_RESULTS.map((r, i) => (
          <PUI_DC_DealerCard
            key={r.id}
            result={r}
            index={i}
            dealt={dealt}
            flipped={flipped === r.id}
            selected={selected.has(r.id)}
            onFlip={onFlip}
            onToggleSelect={onToggleSelect}
          />
        ))}
      </div>

      {/* Footer — selection count + commit. Action label is the same for free
          and paid tools because adding is free; per-call ✦ is metadata. */}
      <div style={{
        marginTop: 8, display:'flex', alignItems:'center', justifyContent:'center', gap: 12, minHeight: 30,
      }}>
        {selected.size > 0 ? (
          <button onClick={handleAdd} style={{
            background: PUI_DC_C.text, color:'#fff', border:'none',
            padding:'7px 14px', fontSize: 11, fontWeight: 600, borderRadius: 8, cursor:'pointer',
            fontFamily:'inherit',
          }}>
            Add {selected.size} to chat
          </button>
        ) : (
          <span style={{
            fontSize: 11, fontFamily:'var(--ul-font-mono)',
            color: added > 0 ? '#15803d' : PUI_DC_C.mute,
            fontVariantNumeric:'tabular-nums', transition:'color 200ms',
          }}>
            {added > 0 ? `+${added} added to this chat` : 'Select cards to add'}
          </span>
        )}
      </div>
    </div>
  );
}

window.PUI_DiscoverWidget_Before = PUI_DiscoverWidget_Before;
window.PUI_DiscoverWidget_After = PUI_DiscoverWidget_After;
