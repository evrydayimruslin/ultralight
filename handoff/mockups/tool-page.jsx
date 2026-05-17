// Public tool page — 2 variants. Both show the same get_weather data.
// V1: Install-primary (everyday user comes to use the tool)
// V2: Acquire-emphasized (the tool's listed with an active ask)
// Acquire is always SECONDARY — never primary — per spec.

const { C: P_C } = window.PUI_Primitives;
const { MD_TOOLS, MD_LISTINGS, MD_FUNCTIONS, MD_CAPABILITIES, fmtN } = window.PUI_MarketData;
const P_Icons = window.PUI_Icons;
const { PUI_MAvatar: P_Avatar, PUI_MSpark: P_Spark } = window;

// ── Try-it sandbox ─────────────────────────────────────────
function PSandbox({ fn = 'forecast' }) {
  const [city, setCity] = React.useState('Tokyo');
  const [days, setDays] = React.useState(5);
  const [out, setOut] = React.useState(null);
  const [running, setRunning] = React.useState(false);
  const run = () => {
    setRunning(true); setOut(null);
    setTimeout(() => {
      setRunning(false);
      setOut({ city, conditions:'partly cloudy', tempC: 17, days: Array.from({length: days}).map((_,i) => ({ d: i+1, hi: 18+i, lo: 11+i, p: i%2 ? 'rain':'clear' })), latencyMs: 142, costLight: 0.012 });
    }, 900);
  };
  return (
    <div style={{ border:`1px solid ${P_C.border}`, borderRadius: 0, overflow:'hidden', background:'#fff' }}>
      <div style={{ padding: 14, display:'grid', gridTemplateColumns:'1fr 1fr', gap: 16, alignItems:'stretch' }}>
        <div style={{ display:'flex', flexDirection:'column' }}>
          <div style={{ fontSize: 11, color: P_C.mute, marginBottom: 6, fontFamily:'var(--ul-font-mono)' }}>arguments</div>
          <div style={{ display:'flex', flexDirection:'column', gap: 8 }}>
            <label style={{ fontSize: 12, color: P_C.sec }}>city
              <input value={city} onChange={e => setCity(e.target.value)} style={{ display:'block', width:'100%', boxSizing:'border-box', marginTop: 4, padding:'8px 10px', border:`1px solid ${P_C.border}`, borderRadius: 0, fontSize: 13, fontFamily:'inherit', outline:'none' }}/>
            </label>
            <label style={{ fontSize: 12, color: P_C.sec }}>days
              <input type="number" value={days} onChange={e => setDays(+e.target.value)} min={1} max={10} style={{ display:'block', width:'100%', boxSizing:'border-box', marginTop: 4, padding:'8px 10px', border:`1px solid ${P_C.border}`, borderRadius: 0, fontSize: 13, fontFamily:'inherit', outline:'none' }}/>
            </label>
            <button onClick={run} disabled={running} style={{ marginTop: 4, width:'100%', boxSizing:'border-box', padding:'8px 14px', background:'#fff', color: P_C.text, border:`1px solid ${P_C.border}`, borderRadius: 0, fontSize: 12, fontWeight: 500, cursor: running ? 'wait':'pointer', fontFamily:'inherit', display:'inline-flex', alignItems:'center', justifyContent:'center', gap: 6 }}>
              {running ? <><span style={{ width: 8, height: 8, border:`1.5px solid ${P_C.border}`, borderTopColor: P_C.text, borderRadius: 9999, animation:'pui-spin 0.7s linear infinite' }}/>Running…</> : <>Run <span style={{ fontFamily:'var(--ul-font-mono)', opacity: 0.45 }}>↵</span></>}
            </button>
          </div>
        </div>
        <div style={{ display:'flex', flexDirection:'column' }}>
          <div style={{ fontSize: 11, color: P_C.mute, marginBottom: 6, fontFamily:'var(--ul-font-mono)' }}>output sandbox</div>
          <pre style={{ margin: 0, padding: 10, background:'#0a0a0a', color:'#a7f3d0', borderRadius: 0, fontSize: 11, fontFamily:'var(--ul-font-mono)', flex: 1, lineHeight: 1.5, overflow:'auto', whiteSpace:'pre-wrap' }}>
{out ? JSON.stringify(out, null, 2) : running ? '⏳ ' : '// Run the tool to see output here.'}
          </pre>
        </div>
      </div>
    </div>
  );
}

// ── Function row ───────────────────────────────────────────
function PFnRow({ fn, last, defaultOpen = false }) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div style={{ borderBottom: last ? 'none' : `1px solid ${P_C.border}` }}>
      <div onClick={() => setOpen(o => !o)} style={{ display:'grid', gridTemplateColumns:'1fr 110px 80px 24px', alignItems:'center', gap: 16, padding:'10px 4px', cursor:'pointer' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily:'var(--ul-font-mono)', fontSize: 13, fontWeight: 500, color: P_C.text }}>{fn.name}<span style={{ color: P_C.mute, fontWeight: 400 }}>{fn.args}</span></div>
          <div style={{ fontSize: 12, color: P_C.sec, marginTop: 2 }}>{fn.desc}</div>
        </div>
        <div style={{ fontFamily:'var(--ul-font-mono)', fontSize: 12, color: P_C.text, textAlign:'left', fontVariantNumeric:'tabular-nums' }}>✦{fn.pricePerCall.toFixed(3)}<span style={{ color: P_C.mute }}>/call</span></div>
        <div style={{ fontFamily:'var(--ul-font-mono)', fontSize: 11, color: P_C.mute, textAlign:'center', fontVariantNumeric:'tabular-nums' }}>{fn.p50ms}ms</div>
        <span style={{ display:'inline-flex', transform: open ? 'rotate(90deg)':'none', transition:'transform 160ms ease', color: P_C.mute }}><P_Icons.IconChevronRight size={14}/></span>
      </div>
      {open && (
        <div style={{ padding:'4px 4px 14px', animation:'pui-fade-up 220ms ease-out' }}>
          <PSandbox fn={fn.name}/>
        </div>
      )}
    </div>
  );
}

// ── Capability pill ────────────────────────────────────────
function PCapPill({ cap }) {
  const colors = { read:'#3b82f6', write:'#f59e0b', net:'#8b5cf6' };
  const icons = { read:'↘', write:'↗', net:'⇄' };
  return (
    <div style={{ display:'flex', alignItems:'center', gap: 8, padding:'6px 10px', background:'#fafafa', border:`1px solid ${P_C.border}`, borderRadius: 8 }}>
      <span style={{ fontFamily:'var(--ul-font-mono)', fontSize: 11, color: colors[cap.kind], fontWeight: 600 }}>{icons[cap.kind]} {cap.kind}</span>
      <span style={{ fontSize: 12, color: P_C.sec }}>{cap.what}</span>
    </div>
  );
}

// ── Combined Install button ──
function PInstallButton({ tool, onClick }) {
  const [installed, setInstalled] = React.useState(false);
  return (
    <button onClick={() => { setInstalled(i => !i); onClick && onClick(); }} style={{
      padding:'12px 22px', background: installed ? '#fff' : P_C.text, color: installed ? P_C.text : '#fff',
      border: installed ? `1px solid ${P_C.border}` : 'none', borderRadius: 10,
      fontSize: 14, fontWeight: 500, cursor:'pointer', fontFamily:'inherit',
      display:'inline-flex', alignItems:'center', justifyContent:'center', gap: 6,
      transition:'all 160ms ease',
    }}>
      <span>{installed ? 'Installed' : 'Install'}</span>
      <span style={{ fontFamily:'var(--ul-font-mono)', fontWeight: 400, fontSize: 13, opacity: 0.6 }}>({fmtN((tool.installs) + (installed ? 1 : 0))})</span>
    </button>
  );
}

// ── Acquire button (text + ask in parens, or "make offer" when unlisted) ──
function PAcquireButton({ listing, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding:'12px 22px', background:'#fff', color: P_C.text,
      border:`1px solid ${P_C.border}`, borderRadius: 10,
      fontSize: 14, fontWeight: 500, cursor:'pointer', fontFamily:'inherit',
      display:'inline-flex', alignItems:'center', justifyContent:'center', gap: 6,
    }}>
      <span>Acquire</span>
      <span style={{ color: P_C.mute, fontFamily:'var(--ul-font-mono)', fontWeight: 400, fontSize: 13 }}>
        {listing && listing.askLight ? `(✦${fmtN(listing.askLight)})` : '(make offer)'}
      </span>
    </button>
  );
}

// ── Tool page — canonical: title row separate, side rail begins at Functions ──
function PToolPage({ toolId = 'gw', onOpenAcquire, listed = true, revenuePublic }) {
  const tool = MD_TOOLS.find(t => t.id === toolId);
  const baseListing = MD_LISTINGS[toolId];
  const listing = listed ? baseListing : null;
  const showRevenue = listing ? (revenuePublic !== undefined ? revenuePublic : baseListing.revenuePublic) : false;
  return (
    <div style={{ background:'#fff', height:'100%', overflow:'auto', fontFamily:'var(--ul-font-sans)' }}>
      <div style={{ maxWidth: 1080, margin:'0 auto', padding:'32px 32px 60px' }}>
        {/* Breadcrumb */}
        <div style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', color: P_C.mute, marginBottom: 18, letterSpacing:'0.04em' }}>
          MARKETPLACE · WEATHER · {tool.name.toUpperCase()}
        </div>

        {/* Title + tagline + actions, all left-aligned and stacked */}
        <div style={{ marginBottom: 36, maxWidth: 720 }}>
          <div style={{ display:'flex', alignItems:'center', gap: 14, marginBottom: 12 }}>
            <P_Avatar author={tool.author} color={tool.authorAvatar} size={44}/>
            <div>
              <div style={{ fontSize: 32, fontWeight: 700, letterSpacing:'-0.025em', lineHeight: 1.05 }}>{tool.name}</div>
              <div style={{ fontSize: 13, color: P_C.sec, marginTop: 4 }}>by {tool.author} · weather</div>
            </div>
          </div>
          <div style={{ fontSize: 17, color: P_C.text, lineHeight: 1.5, marginBottom: 18 }}>{tool.tagline}</div>
          <div style={{ display:'flex', gap: 8 }}>
            <PInstallButton tool={tool}/>
            <PAcquireButton listing={listing} onClick={onOpenAcquire}/>
          </div>
        </div>

        {/* Two-column: Functions/Capabilities ←→ Acquire side rail */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 320px', gap: 32, alignItems:'flex-start' }}>
          <div style={{ minWidth: 0 }}>
            {/* Functions */}
            <div style={{ marginBottom: 32 }}>
              <div style={{ marginBottom: 8 }}>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 110px 80px 24px', gap: 16, padding:'0 4px 8px', borderBottom:`1px solid ${P_C.border}`, fontSize: 11, fontFamily:'var(--ul-font-mono)', color: P_C.mute, letterSpacing:'0.06em', textTransform:'uppercase' }}>
                  <span>Function ({MD_FUNCTIONS.length})</span>
                  <span style={{ textAlign:'left' }}>Price/call</span>
                  <span style={{ textAlign:'center' }}>Latency</span>
                  <span></span>
                </div>
              </div>
              <div>
                {MD_FUNCTIONS.map((f, i) => <PFnRow key={f.name} fn={f} last={i === MD_FUNCTIONS.length-1} defaultOpen={i === 0}/>)}
              </div>
            </div>

            {/* Capabilities */}
            <div>
              <div style={{ fontSize: 16, fontWeight: 600, letterSpacing:'-0.01em', marginBottom: 12 }}>Capabilities</div>
              <div style={{ display:'flex', flexDirection:'column', gap: 6 }}>
                {MD_CAPABILITIES.map((c, i) => <PCapPill key={i} cap={c}/>)}
              </div>
            </div>
          </div>

          {/* Side rail — always shown; varies by listed/revenue state */}
          <aside style={{ position:'sticky', top: 24, alignSelf:'flex-start' }}>
            <div style={{ border:`1px solid ${P_C.border}`, borderRadius: 12, overflow:'hidden', background:'#fff' }}>
              {listing ? (
                <div style={{ padding:'14px 16px', borderBottom:`1px solid ${P_C.border}`, background:'linear-gradient(135deg, #fafafa, #fff)' }}>
                  <div style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', color: P_C.mute, letterSpacing:'0.06em', textTransform:'uppercase', marginBottom: 6 }}>For sale · ask</div>
                  <div style={{ display:'flex', alignItems:'baseline', gap: 6 }}>
                    <span style={{ fontSize: 26, fontWeight: 700, letterSpacing:'-0.02em', fontFamily:'var(--ul-font-mono)' }}>✦{fmtN(listing.askLight)}</span>
                  </div>
                </div>
              ) : (
                <div style={{ padding:'14px 16px', borderBottom:`1px solid ${P_C.border}`, background:'#fafafa' }}>
                  <div style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', color: P_C.mute, letterSpacing:'0.06em', textTransform:'uppercase', marginBottom: 4 }}>Not for sale</div>
                  <div style={{ fontSize: 13, color: P_C.sec, lineHeight: 1.4 }}>Owner hasn't set an ask. You can still place a bid — if it's accepted, ownership transfers.</div>
                </div>
              )}
              <div style={{ padding:'12px 14px' }}>
                <div style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', color: P_C.mute, letterSpacing:'0.06em', textTransform:'uppercase', marginBottom: 8 }}>{listing ? `Place a bid · ${listing.bids.length} open` : `Open bids · ${baseListing.bids.length}`}</div>
                {baseListing.bids.slice(0, 3).map(b => (
                  <div key={b.id} style={{ display:'flex', alignItems:'center', gap: 8, padding:'6px 0', fontSize: 12 }}>
                    <P_Avatar author={b.bidder} color={b.bidderColor} size={16}/>
                    <span style={{ color: P_C.sec, flex: 1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{b.bidder}</span>
                    <span style={{ fontFamily:'var(--ul-font-mono)', color: P_C.text, fontVariantNumeric:'tabular-nums' }}>✦{fmtN(b.amount)}</span>
                  </div>
                ))}
                <button onClick={onOpenAcquire} style={{ marginTop: 8, padding:0, background:'transparent', color: P_C.text, border:'none', fontSize: 12, fontWeight: 500, cursor:'pointer', textDecoration:'underline', fontFamily:'inherit' }}>{listing ? 'See all bids →' : 'Place a bid →'}</button>
              </div>
              {showRevenue ? (
                <div style={{ padding:'12px 14px', borderTop:`1px solid ${P_C.border}`, background:'#fafafa' }}>
                  <div style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', color: P_C.mute, letterSpacing:'0.06em', textTransform:'uppercase', marginBottom: 6 }}>Revenue · last 30d</div>
                  <div style={{ display:'flex', alignItems:'baseline', gap: 8 }}>
                    <span style={{ fontSize: 18, fontWeight: 700, fontFamily:'var(--ul-font-mono)' }}>✦{baseListing.monthlyRevenue.toFixed(1)}</span>
                    <span style={{ fontSize: 11, color: P_C.mute }}>{fmtN(baseListing.callsPerWeek)} calls/wk</span>
                  </div>
                </div>
              ) : (
                <div style={{ padding:'10px 14px', borderTop:`1px solid ${P_C.border}`, background:'#fafafa', fontSize: 11, color: P_C.mute, fontStyle:'italic', lineHeight: 1.5 }}>
                  Revenue is private.
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

window.PUI_PToolPage = PToolPage;
