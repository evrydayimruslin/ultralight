// Acquisition flow — bid/ask order book + place-bid screen +
// owner-side accept-bid screen + ownership transfer ceremony.
// "Acquire" = ownership transfer, distinct from install.

const { C: A_C } = window.PUI_Primitives;
const { MD_TOOLS, MD_LISTINGS, MD_VISIBILITY_PRESETS, fmtN } = window.PUI_MarketData;
const A_Icons = window.PUI_Icons;
const { PUI_MAvatar: A_Avatar } = window;

// ── Order book — full bid list, buyer view ────────────────
function AOrderBook({ toolId = 'gw', onPlaceBid, onWithdraw }) {
  const tool = MD_TOOLS.find(t => t.id === toolId);
  const l = MD_LISTINGS[toolId];
  return (
    <div style={{ background:'#fff', height:'100%', overflow:'auto', fontFamily:'var(--ul-font-sans)' }}>
      <div style={{ maxWidth: 880, margin:'0 auto', padding:'32px 32px 60px' }}>
        <div style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', color: A_C.mute, marginBottom: 14, letterSpacing:'0.04em' }}>ACQUIRE · {tool.name.toUpperCase()}</div>
        <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between', marginBottom: 24 }}>
          <div>
            <div style={{ display:'flex', alignItems:'center', gap: 12, marginBottom: 6 }}>
              <A_Avatar author={tool.author} color={tool.authorAvatar} size={32}/>
              <div style={{ fontSize: 24, fontWeight: 700, letterSpacing:'-0.02em' }}>{tool.name}</div>
            </div>
            <div style={{ fontSize: 13, color: A_C.sec }}>Owned by {tool.author} · {fmtN(tool.installs)} installs come with the tool</div>
          </div>
          <div style={{ display:'flex', gap: 8 }}>
            <button style={{ padding:'10px 16px', background: A_C.text, color:'#fff', border:'none', borderRadius: 10, fontSize: 13, fontWeight: 500, cursor:'pointer', fontFamily:'inherit' }}>Acquire at ask · ✦{fmtN(l.askLight)}</button>
            <button onClick={onPlaceBid} style={{ padding:'10px 16px', background:'#fff', color: A_C.text, border:`1px solid ${A_C.border}`, borderRadius: 10, fontSize: 13, fontWeight: 500, cursor:'pointer', fontFamily:'inherit' }}>Place a bid</button>
          </div>
        </div>

        {/* Stats strip — gated on owner's visibility setting */}
        {l.revenuePublic ? (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap: 12, marginBottom: 28 }}>
            {[
              { l:'Asking price',     v:`✦${fmtN(l.askLight)}` },
              { l:'Top bid',          v:`✦${fmtN(l.bids[0].amount)}` },
              { l:'30d revenue',      v:`✦${l.monthlyRevenue.toFixed(1)}` },
              { l:'Calls/wk',         v: fmtN(l.callsPerWeek) },
            ].map((s, i) => (
              <div key={i} style={{ padding: 14, border:`1px solid ${A_C.border}`, borderRadius: 10, background:'#fafafa' }}>
                <div style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', color: A_C.mute, letterSpacing:'0.06em', textTransform:'uppercase', marginBottom: 6 }}>{s.l}</div>
                <div style={{ fontSize: 20, fontWeight: 700, fontFamily:'var(--ul-font-mono)', fontVariantNumeric:'tabular-nums' }}>{s.v}</div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap: 12, marginBottom: 28 }}>
            <div style={{ padding: 14, border:`1px solid ${A_C.border}`, borderRadius: 10, background:'#fafafa' }}>
              <div style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', color: A_C.mute, letterSpacing:'0.06em', textTransform:'uppercase', marginBottom: 6 }}>Asking price</div>
              <div style={{ fontSize: 20, fontWeight: 700, fontFamily:'var(--ul-font-mono)', fontVariantNumeric:'tabular-nums' }}>✦{fmtN(l.askLight)}</div>
            </div>
            <div style={{ padding: 14, border:`1px solid ${A_C.border}`, borderRadius: 10, background:'#fafafa' }}>
              <div style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', color: A_C.mute, letterSpacing:'0.06em', textTransform:'uppercase', marginBottom: 6 }}>Top bid</div>
              <div style={{ fontSize: 20, fontWeight: 700, fontFamily:'var(--ul-font-mono)', fontVariantNumeric:'tabular-nums' }}>✦{fmtN(l.bids[0].amount)}</div>
            </div>
            <div style={{ padding: 14, border:`1px dashed ${A_C.border}`, borderRadius: 10, background:'#fafafa', display:'flex', flexDirection:'column', justifyContent:'center' }}>
              <div style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', color: A_C.mute, letterSpacing:'0.06em', textTransform:'uppercase', marginBottom: 4 }}>Revenue & call volume</div>
              <div style={{ fontSize: 12, color: A_C.sec, fontStyle:'italic' }}>Private. Owner unlocks for serious bidders.</div>
            </div>
          </div>
        )}

        {/* Order book */}
        <div style={{ border:`1px solid ${A_C.border}`, borderRadius: 12, overflow:'hidden' }}>
          <div style={{ padding:'12px 16px', borderBottom:`1px solid ${A_C.border}`, background:'#fafafa', display:'grid', gridTemplateColumns:'40px 1fr 100px 110px', gap: 12, fontSize: 11, fontFamily:'var(--ul-font-mono)', color: A_C.mute, letterSpacing:'0.06em', textTransform:'uppercase' }}>
            <span></span><span>Bidder</span><span style={{ textAlign:'right' }}>Bid</span><span style={{ textAlign:'center' }}>Placed</span>
          </div>
          {/* Ask line — visually distinct */}
          <div style={{ padding:'12px 16px', display:'grid', gridTemplateColumns:'40px 1fr 100px 110px', gap: 12, alignItems:'center', background:'rgba(34,197,94,0.04)', borderBottom:`1px solid ${A_C.border}` }}>
            <span style={{ fontFamily:'var(--ul-font-mono)', fontSize: 10, color:'#22c55e', fontWeight: 600, letterSpacing:'0.06em' }}>ASK</span>
            <div style={{ display:'flex', alignItems:'center', gap: 8 }}>
              <A_Avatar author={tool.author} color={tool.authorAvatar} size={18}/>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{tool.author} <span style={{ color: A_C.mute, fontWeight: 400 }}>· owner</span></span>
            </div>
            <span style={{ fontSize: 14, fontWeight: 700, fontFamily:'var(--ul-font-mono)', textAlign:'right', fontVariantNumeric:'tabular-nums' }}>✦{fmtN(l.askLight)}</span>
            <div style={{ display:'flex', justifyContent:'center' }}>
              <button style={{ fontSize: 11, padding:'5px 14px', background: A_C.text, color:'#fff', border:'none', borderRadius: 6, cursor:'pointer', fontFamily:'inherit', fontWeight: 500 }}>Take</button>
            </div>
          </div>
          {/* Bids */}
          {l.bids.map((b, i) => (
            <div key={b.id} style={{ padding:'12px 16px', display:'grid', gridTemplateColumns:'40px 1fr 100px 110px', gap: 12, alignItems:'center', borderBottom: i === l.bids.length-1 ? 'none' : `1px solid ${A_C.border}`, background: b.isYou ? 'rgba(59,130,246,0.04)' : 'transparent' }}>
              <span style={{ fontFamily:'var(--ul-font-mono)', fontSize: 11, color: A_C.mute, fontVariantNumeric:'tabular-nums' }}>#{i+1}</span>
              <div>
                <div style={{ display:'flex', alignItems:'center', gap: 8 }}>
                  <A_Avatar author={b.bidder} color={b.bidderColor} size={18}/>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{b.bidder}</span>
                  {b.isYou && <span style={{ fontSize: 10, fontFamily:'var(--ul-font-mono)', color:'#3b82f6', background:'rgba(59,130,246,0.1)', padding:'2px 6px', borderRadius: 4, letterSpacing:'0.04em' }}>YOU</span>}
                </div>
                {b.message && <div style={{ fontSize: 11, color: A_C.mute, marginTop: 3, marginLeft: 26, fontStyle:'italic' }}>"{b.message}"</div>}
              </div>
              <span style={{ fontSize: 13, fontFamily:'var(--ul-font-mono)', textAlign:'right', fontVariantNumeric:'tabular-nums' }}>✦{fmtN(b.amount)}</span>
              <div style={{ display:'flex', justifyContent:'center' }}>
                {b.isYou ? (
                  <button onClick={onWithdraw} style={{ fontSize: 11, padding:'5px 14px', background:'#fff', color: A_C.text, border:`1px solid ${A_C.border}`, borderRadius: 6, cursor:'pointer', fontFamily:'inherit' }}>Manage</button>
                ) : <span style={{ fontSize: 11, color: A_C.mute, fontFamily:'var(--ul-font-mono)' }}>{b.placedHr}h ago</span>}
              </div>
            </div>
          ))}
        </div>

        {/* Recent comparable acquisitions */}
        <div style={{ marginTop: 32 }}>
          <div style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', color: A_C.mute, letterSpacing:'0.06em', textTransform:'uppercase', marginBottom: 10 }}>Comparable acquisitions</div>
          <div style={{ display:'flex', gap: 8 }}>
            {l.recentAcquisitions.map((c, i) => (
              <div key={i} style={{ flex: 1, padding: 12, border:`1px solid ${A_C.border}`, borderRadius: 10 }}>
                <div style={{ fontSize: 12, fontFamily:'var(--ul-font-mono)', color: A_C.text, marginBottom: 4 }}>{c.name}</div>
                <div style={{ fontSize: 16, fontWeight: 700, fontFamily:'var(--ul-font-mono)', fontVariantNumeric:'tabular-nums' }}>✦{fmtN(c.sold)}</div>
                <div style={{ fontSize: 11, color: A_C.mute, marginTop: 2 }}>sold {c.daysAgo}d ago</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Place a bid (modal-feel) ──────────────────────────────
function APlaceBid({ toolId = 'gw', onBack }) {
  const tool = MD_TOOLS.find(t => t.id === toolId);
  const l = MD_LISTINGS[toolId];
  const askLight = l.askLight;
  const [amt, setAmtRaw] = React.useState(3850);
  const [submitted, setSubmitted] = React.useState(false);
  const balance = 12.4;
  const insufficient = amt > balance * 1000;
  const topBid = l.bids[0].amount;
  // Cap at ask price — bid == ask auto-acquires
  const setAmt = (v) => setAmtRaw(Math.min(askLight, Math.max(0, v)));
  const willAcquire = amt === askLight;

  if (submitted) {
    return (
      <div style={{ height:'100%', background:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'var(--ul-font-sans)' }}>
        <div style={{ maxWidth: 440, textAlign:'center', padding: 32, animation:'pui-fade-up 360ms ease-out' }}>
          <div style={{ width: 56, height: 56, borderRadius: 9999, background:'rgba(34,197,94,0.1)', display:'inline-flex', alignItems:'center', justifyContent:'center', marginBottom: 16, animation:'pui-ring-resolve 800ms ease-out' }}>
            <A_Icons.IconCheck size={24}/>
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing:'-0.02em', marginBottom: 8 }}>Bid placed</div>
          <div style={{ fontSize: 14, color: A_C.sec, lineHeight: 1.5, marginBottom: 20 }}>Your bid of <strong style={{ fontFamily:'var(--ul-font-mono)', color: A_C.text }}>✦{fmtN(amt)}</strong> for <strong>{tool.name}</strong> is live. {tool.author} will be notified. You can withdraw anytime before acceptance.</div>
          <button onClick={onBack} style={{ padding:'10px 16px', background: A_C.text, color:'#fff', border:'none', borderRadius: 10, fontSize: 13, fontWeight: 500, cursor:'pointer', fontFamily:'inherit' }}>Back to order book</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background:'#fff', height:'100%', overflow:'auto', fontFamily:'var(--ul-font-sans)' }}>
      <div style={{ maxWidth: 560, margin:'0 auto', padding:'40px 32px' }}>
        <button onClick={onBack} style={{ background:'transparent', border:'none', color: A_C.sec, fontSize: 12, cursor:'pointer', marginBottom: 18, fontFamily:'inherit', display:'inline-flex', alignItems:'center', gap: 6 }}>← Back</button>
        <div style={{ fontSize: 24, fontWeight: 700, letterSpacing:'-0.02em', marginBottom: 6 }}>Place a bid on {tool.name}</div>
        <div style={{ fontSize: 13, color: A_C.sec, marginBottom: 28, lineHeight: 1.5 }}>If accepted, ownership of <strong>{tool.name}</strong> transfers to you. {fmtN(tool.installs)} existing users keep their installs running unchanged.</div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 12, fontFamily:'var(--ul-font-mono)', color: A_C.mute, letterSpacing:'0.06em', textTransform:'uppercase', display:'block', marginBottom: 8 }}>Bid amount</label>
          <div style={{ display:'flex', alignItems:'center', border:`1px solid ${A_C.border}`, borderRadius: 10, padding:'12px 14px', gap: 8 }}>
            <span style={{ fontSize: 18, fontFamily:'var(--ul-font-mono)' }}>✦</span>
            <input type="number" value={amt} onChange={e => setAmt(+e.target.value)}
              style={{ flex: 1, border:'none', outline:'none', fontSize: 18, fontFamily:'var(--ul-font-mono)', fontWeight: 600, fontVariantNumeric:'tabular-nums', background:'transparent' }}/>
            <span style={{ fontSize: 11, color: A_C.mute, fontFamily:'var(--ul-font-mono)' }}>Light</span>
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', fontSize: 11, color: A_C.mute, marginTop: 8, fontFamily:'var(--ul-font-mono)' }}>
            <span>Ask <strong style={{ color: A_C.text }}>✦{fmtN(l.askLight)}</strong> · top bid <strong style={{ color: A_C.text }}>✦{fmtN(topBid)}</strong></span>
            <span>Your bid is {amt > topBid ? <strong style={{ color:'#22c55e' }}>top of book</strong> : `${(((topBid - amt) / topBid) * 100).toFixed(0)}% below top`}</span>
          </div>
        </div>

        <div style={{ padding: 12, background: willAcquire ? 'rgba(34,197,94,0.06)' : '#fafafa', border: willAcquire ? '1px solid rgba(34,197,94,0.2)' : 'none', borderRadius: 8, fontSize: 12, color: willAcquire ? '#15803d' : A_C.sec, lineHeight: 1.5, marginBottom: 16 }}>
          {willAcquire
            ? <><strong>This bid matches the ask.</strong> Submitting will acquire {tool.name} immediately — ownership transfers atomically and ✦{fmtN(amt)} is debited from your wallet.</>
            : <>✦{fmtN(amt)} is escrowed from your wallet for the duration of the bid. Withdraw anytime to release. On accept, ownership transfers atomically.</>}
        </div>

        <div style={{ display:'flex', gap: 8 }}>
          <button onClick={onBack} style={{ flex: 1, padding:'12px', background:'#fff', color: A_C.text, border:`1px solid ${A_C.border}`, borderRadius: 10, fontSize: 13, fontWeight: 500, cursor:'pointer', fontFamily:'inherit' }}>Cancel</button>
          <button onClick={() => setSubmitted(true)} disabled={insufficient} style={{ flex: 2, padding:'12px', background: willAcquire ? '#15803d' : A_C.text, color:'#fff', border:'none', borderRadius: 10, fontSize: 14, fontWeight: 500, cursor: insufficient ? 'not-allowed':'pointer', opacity: insufficient ? 0.4 : 1, fontFamily:'inherit' }}>
            {insufficient ? 'Insufficient Light' : willAcquire ? `Buy now · ✦${fmtN(amt)}` : `Place bid · ✦${fmtN(amt)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Owner side — accept a bid + visibility settings ──────
function AOwnerPanel({ toolId = 'gw' }) {
  const tool = MD_TOOLS.find(t => t.id === toolId);
  const l = MD_LISTINGS[toolId];
  const [vis, setVis] = React.useState('private');
  const [threshold, setThreshold] = React.useState(1000);
  const [emails, setEmails] = React.useState(['arbiter@nimbus.io', 'cumulus@hex.dev']);
  const [emailInput, setEmailInput] = React.useState('');
  const [askEditing, setAskEditing] = React.useState(false);
  const [ask, setAsk] = React.useState(l.askLight);
  return (
    <div style={{ background:'#fff', height:'100%', overflow:'auto', fontFamily:'var(--ul-font-sans)' }}>
      <div style={{ maxWidth: 720, margin:'0 auto', padding:'32px' }}>
        <div style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', color: A_C.mute, marginBottom: 12, letterSpacing:'0.04em' }}>OWNER VIEW · {tool.name.toUpperCase()}</div>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing:'-0.02em', marginBottom: 4 }}>Listing controls</div>
        <div style={{ fontSize: 13, color: A_C.sec, marginBottom: 28, lineHeight: 1.5 }}>You decide if the tool is for sale, what price you'll accept, and what numbers prospective buyers can see.</div>

        {/* Ask price */}
        <div style={{ border:`1px solid ${A_C.border}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Asking price</div>
            <button onClick={() => setAskEditing(e => !e)} style={{ fontSize: 12, color: A_C.sec, background:'transparent', border:'none', cursor:'pointer', fontFamily:'inherit' }}>{askEditing ? 'Save' : 'Edit'}</button>
          </div>
          {askEditing ? (
            <div style={{ display:'flex', alignItems:'center', gap: 8, padding:'10px 12px', border:`1px solid ${A_C.border}`, borderRadius: 8 }}>
              <span style={{ fontFamily:'var(--ul-font-mono)' }}>✦</span>
              <input type="number" value={ask} onChange={e => setAsk(+e.target.value)} style={{ flex: 1, border:'none', outline:'none', fontSize: 18, fontFamily:'var(--ul-font-mono)', fontWeight: 600 }}/>
            </div>
          ) : (
            <div style={{ fontSize: 24, fontWeight: 700, fontFamily:'var(--ul-font-mono)', fontVariantNumeric:'tabular-nums' }}>✦{fmtN(ask)}</div>
          )}
          <div style={{ fontSize: 11, color: A_C.mute, marginTop: 8 }}>Anyone can take the tool at this price instantly. Set to 0 to delist (bids stay open).</div>
        </div>

        {/* Visibility */}
        <div style={{ border:`1px solid ${A_C.border}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Revenue & call-volume visibility</div>
          <div style={{ fontSize: 12, color: A_C.sec, marginBottom: 12 }}>Who sees your real numbers when they look at this tool's page?</div>
          <div style={{ display:'flex', flexDirection:'column', gap: 6 }}>
            {/* Public */}
            <label style={{ display:'flex', gap: 12, padding: 12, border:`1px solid ${vis === 'public' ? A_C.text : A_C.border}`, borderRadius: 8, cursor:'pointer', background: vis === 'public' ? 'rgba(0,0,0,0.02)':'transparent' }}>
              <input type="radio" checked={vis === 'public'} onChange={() => setVis('public')} style={{ marginTop: 2 }}/>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>Public</div>
                <div style={{ fontSize: 12, color: A_C.sec, marginTop: 2 }}>Anyone browsing the page can see revenue + call volume.</div>
              </div>
            </label>

            {/* Bid threshold */}
            <label style={{ display:'flex', gap: 12, padding: 12, border:`1px solid ${vis === 'threshold' ? A_C.text : A_C.border}`, borderRadius: 8, cursor:'pointer', background: vis === 'threshold' ? 'rgba(0,0,0,0.02)':'transparent' }}>
              <input type="radio" checked={vis === 'threshold'} onChange={() => setVis('threshold')} style={{ marginTop: 2 }}/>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>Bid threshold</div>
                <div style={{ fontSize: 12, color: A_C.sec, marginTop: 2, marginBottom: vis === 'threshold' ? 10 : 0 }}>Visible only after a bidder posts at least this much in escrowed Light.</div>
                {vis === 'threshold' && (
                  <div style={{ display:'flex', alignItems:'center', gap: 8, padding:'8px 12px', border:`1px solid ${A_C.border}`, borderRadius: 8, background:'#fff', maxWidth: 200 }}>
                    <span style={{ fontFamily:'var(--ul-font-mono)', color: A_C.mute }}>✦</span>
                    <input type="number" value={threshold} onChange={e => setThreshold(+e.target.value)}
                      style={{ flex: 1, minWidth: 0, border:'none', outline:'none', fontSize: 14, fontFamily:'var(--ul-font-mono)', fontWeight: 600, fontVariantNumeric:'tabular-nums', background:'transparent' }}/>
                    <span style={{ fontSize: 11, color: A_C.mute, fontFamily:'var(--ul-font-mono)' }}>min bid</span>
                  </div>
                )}
              </div>
            </label>

            {/* Hand-picked with email allowlist */}
            <label style={{ display:'flex', gap: 12, padding: 12, border:`1px solid ${vis === 'shortlist' ? A_C.text : A_C.border}`, borderRadius: 8, cursor:'pointer', background: vis === 'shortlist' ? 'rgba(0,0,0,0.02)':'transparent' }}>
              <input type="radio" checked={vis === 'shortlist'} onChange={() => setVis('shortlist')} style={{ marginTop: 2 }}/>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>Hand-picked</div>
                <div style={{ fontSize: 12, color: A_C.sec, marginTop: 2, marginBottom: vis === 'shortlist' ? 10 : 0 }}>Only specific people you allowlist can see the numbers.</div>
                {vis === 'shortlist' && (
                  <div onClick={e => e.preventDefault()}>
                    <div style={{ display:'flex', flexWrap:'wrap', gap: 6, marginBottom: 8 }}>
                      {emails.map((em, i) => (
                        <span key={em} style={{ display:'inline-flex', alignItems:'center', gap: 6, padding:'4px 4px 4px 10px', background:'#fff', border:`1px solid ${A_C.border}`, borderRadius: 9999, fontSize: 12, fontFamily:'var(--ul-font-mono)' }}>
                          {em}
                          <button onClick={() => setEmails(emails.filter((_, j) => j !== i))} style={{ width: 18, height: 18, border:'none', background:'transparent', cursor:'pointer', color: A_C.mute, fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
                        </span>
                      ))}
                    </div>
                    <form onSubmit={e => {
                      e.preventDefault();
                      const v = emailInput.trim();
                      if (v && !emails.includes(v)) { setEmails([...emails, v]); setEmailInput(''); }
                    }} style={{ display:'flex', gap: 6 }}>
                      <input type="email" value={emailInput} onChange={e => setEmailInput(e.target.value)} placeholder="add email…"
                        style={{ flex: 1, minWidth: 0, padding:'8px 12px', border:`1px solid ${A_C.border}`, borderRadius: 8, fontSize: 13, fontFamily:'inherit', outline:'none', background:'#fff' }}/>
                      <button type="submit" style={{ padding:'8px 14px', background: A_C.text, color:'#fff', border:'none', borderRadius: 8, fontSize: 12, fontFamily:'inherit', cursor:'pointer', fontWeight: 500 }}>Add</button>
                    </form>
                  </div>
                )}
              </div>
            </label>

            {/* Private */}
            <label style={{ display:'flex', gap: 12, padding: 12, border:`1px solid ${vis === 'private' ? A_C.text : A_C.border}`, borderRadius: 8, cursor:'pointer', background: vis === 'private' ? 'rgba(0,0,0,0.02)':'transparent' }}>
              <input type="radio" checked={vis === 'private'} onChange={() => setVis('private')} style={{ marginTop: 2 }}/>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>Private</div>
                <div style={{ fontSize: 12, color: A_C.sec, marginTop: 2 }}>No one but you sees the numbers. (Default.)</div>
              </div>
            </label>
          </div>
        </div>

        {/* Open bids */}
        <div style={{ border:`1px solid ${A_C.border}`, borderRadius: 12, overflow:'hidden' }}>
          <div style={{ padding:'12px 16px', borderBottom:`1px solid ${A_C.border}`, background:'#fafafa' }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Open bids ({l.bids.length})</div>
            <div style={{ fontSize: 11, color: A_C.mute, marginTop: 2 }}>Pick any bid to accept — ownership transfers atomically.</div>
          </div>
          {l.bids.map((b, i) => (
            <div key={b.id} style={{ padding:'14px 16px', display:'flex', alignItems:'center', gap: 12, borderBottom: i === l.bids.length-1 ? 'none' : `1px solid ${A_C.border}` }}>
              <A_Avatar author={b.bidder} color={b.bidderColor} size={28}/>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{b.bidder}</div>
                {b.message && <div style={{ fontSize: 11, color: A_C.mute, marginTop: 2, fontStyle:'italic' }}>"{b.message}"</div>}
                <div style={{ fontSize: 11, color: A_C.mute, fontFamily:'var(--ul-font-mono)', marginTop: 2 }}>{b.placedHr}h ago</div>
              </div>
              <div style={{ textAlign:'right' }}>
                <div style={{ fontSize: 16, fontWeight: 700, fontFamily:'var(--ul-font-mono)', fontVariantNumeric:'tabular-nums' }}>✦{fmtN(b.amount)}</div>
              </div>
              <button style={{ padding:'8px 14px', background: A_C.text, color:'#fff', border:'none', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor:'pointer', fontFamily:'inherit' }}>Accept</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Ownership transfer ceremony (post-accept) ─────────────
function ATransferCeremony({ toolId = 'gw', replayKey }) {
  const tool = MD_TOOLS.find(t => t.id === toolId);
  const [stage, setStage] = React.useState(0);
  React.useEffect(() => {
    setStage(0);
    const t1 = setTimeout(() => setStage(1), 400);
    const t2 = setTimeout(() => setStage(2), 1200);
    const t3 = setTimeout(() => setStage(3), 2000);
    const t4 = setTimeout(() => setStage(4), 2800);
    return () => [t1,t2,t3,t4].forEach(clearTimeout);
  }, [replayKey]);
  const stages = [
    { l:'Escrow released',          d:'✦3,800 → @kepler' },
    { l:'Manifest re-signed',       d:'admin keys → @arbiter' },
    { l:'Catalog updated',          d:`${fmtN(tool.installs)} installs migrated` },
    { l:'Revenue stream redirected',d:'next call → new owner' },
  ];
  return (
    <div style={{ height:'100%', background:'linear-gradient(180deg, #fafafa, #fff)', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'var(--ul-font-sans)', position:'relative', overflow:'hidden' }}>
      <div style={{ textAlign:'center', maxWidth: 480, padding: 32, position:'relative', zIndex: 1 }}>
        <div style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', color: A_C.mute, letterSpacing:'0.08em', textTransform:'uppercase', marginBottom: 12 }}>Ownership transfer</div>
        <div style={{ fontSize: 28, fontWeight: 700, letterSpacing:'-0.025em', marginBottom: 6 }}>{tool.name}</div>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap: 16, marginBottom: 28 }}>
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap: 6, opacity: stage >= 1 ? 0.4 : 1, transition:'opacity 600ms ease' }}>
            <A_Avatar author="@kepler" color="#7c3aed" size={36}/>
            <span style={{ fontSize: 11, color: A_C.mute }}>@kepler</span>
          </div>
          <div style={{ flex: 1, height: 2, maxWidth: 80, background: A_C.border, position:'relative', overflow:'hidden' }}>
            <div style={{ position:'absolute', top: 0, left:0, height:'100%', width: stage >= 1 ? '100%' : '0%', background: A_C.text, transition:'width 1200ms cubic-bezier(0.4, 0, 0.2, 1)' }}/>
          </div>
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap: 6, opacity: stage >= 4 ? 1 : 0.5, transform: stage >= 4 ? 'scale(1.05)':'scale(1)', transition:'all 600ms ease' }}>
            <A_Avatar author="@arbiter" color="#ef4444" size={36}/>
            <span style={{ fontSize: 11, color: stage >= 4 ? A_C.text : A_C.mute, fontWeight: stage >= 4 ? 600 : 400 }}>@arbiter</span>
          </div>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap: 6, textAlign:'left' }}>
          {stages.map((s, i) => (
            <div key={i} style={{ display:'flex', alignItems:'center', gap: 10, padding:'10px 14px', borderRadius: 8,
              background: stage > i ? 'rgba(34,197,94,0.06)' : '#fafafa',
              opacity: stage >= i ? 1 : 0.4, transition:'all 400ms ease' }}>
              <span style={{ width: 16, height: 16, borderRadius: 9999, background: stage > i ? '#22c55e' : stage === i ? A_C.text : A_C.border, display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize: 10, transition:'all 400ms ease' }}>
                {stage > i && '✓'}
              </span>
              <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>{s.l}</span>
              <span style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', color: A_C.mute }}>{s.d}</span>
            </div>
          ))}
        </div>
        {stage >= 4 && (
          <div style={{ marginTop: 24, fontSize: 13, color: A_C.text, animation:'pui-fade-up 400ms ease-out' }}>
            <strong>{tool.name}</strong> is yours. Existing installs continue uninterrupted.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Withdraw bid (modal-feel) ─────────────────────────────
function AWithdrawBid({ toolId = 'gw', onBack }) {
  const tool = MD_TOOLS.find(t => t.id === toolId);
  const l = MD_LISTINGS[toolId];
  const my = l.bids.find(b => b.isYou);
  const myRank = l.bids.findIndex(b => b.isYou) + 1;
  const original = my.amount;
  const wallet = 12480; // ✦ available
  // bid amount is the live value; diff vs original settles against wallet
  const [amt, setAmt] = React.useState(original);
  const [phase, setPhase] = React.useState('manage'); // manage · updated · withdrawn
  const diff = amt - original;
  const newWallet = wallet - diff; // raising = debit, lowering = credit
  const newRankProj = (() => {
    // rank if we replaced our bid with `amt`
    const others = l.bids.filter(b => !b.isYou).map(b => b.amount);
    const sorted = [...others, amt].sort((a,b) => b - a);
    return sorted.indexOf(amt) + 1;
  })();
  const askLight = l.askLight;
  const pctOfAsk = Math.round((amt / askLight) * 100);

  if (phase === 'updated' || phase === 'withdrawn') {
    const isW = phase === 'withdrawn';
    return (
      <div style={{ height:'100%', background:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'var(--ul-font-sans)' }}>
        <div style={{ maxWidth: 440, textAlign:'center', padding: 32, animation:'pui-fade-up 360ms ease-out' }}>
          <div style={{ width: 56, height: 56, borderRadius: 9999, background:'rgba(0,0,0,0.04)', display:'inline-flex', alignItems:'center', justifyContent:'center', marginBottom: 16 }}>
            <A_Icons.IconCheck size={24}/>
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing:'-0.02em', marginBottom: 8 }}>{isW ? 'Bid withdrawn' : 'Bid updated'}</div>
          <div style={{ fontSize: 14, color: A_C.sec, lineHeight: 1.5, marginBottom: 20 }}>
            {isW ? (
              <>Your <strong style={{ fontFamily:'var(--ul-font-mono)', color: A_C.text }}>✦{fmtN(original)}</strong> is back in your wallet.</>
            ) : (
              <>Bid moved from <strong style={{ fontFamily:'var(--ul-font-mono)', color: A_C.text }}>✦{fmtN(original)}</strong> → <strong style={{ fontFamily:'var(--ul-font-mono)', color: A_C.text }}>✦{fmtN(amt)}</strong>. {diff > 0 ? <>An additional <strong style={{ fontFamily:'var(--ul-font-mono)' }}>✦{fmtN(diff)}</strong> was escrowed from your wallet.</> : <><strong style={{ fontFamily:'var(--ul-font-mono)' }}>✦{fmtN(-diff)}</strong> was credited back to your wallet.</>}</>
            )}
          </div>
          <button onClick={onBack} style={{ padding:'10px 16px', background: A_C.text, color:'#fff', border:'none', borderRadius: 10, fontSize: 13, fontWeight: 500, cursor:'pointer', fontFamily:'inherit' }}>Back to {tool.name}</button>
        </div>
      </div>
    );
  }

  // numeric input handler — clamp to [50, min(wallet + original, askLight)]
  // Bid cannot exceed ask; if bid == ask, raising auto-acquires.
  const minBid = 50;
  const maxBid = Math.min(wallet + original, askLight);
  const setSafe = (v) => setAmt(Math.max(minBid, Math.min(maxBid, Math.round(v))));
  const willAcquire = amt === askLight;

  return (
    <div style={{ background:'#fff', height:'100%', overflow:'auto', fontFamily:'var(--ul-font-sans)' }}>
      <div style={{ maxWidth: 560, margin:'0 auto', padding:'32px 32px 40px' }}>
        <button onClick={onBack} style={{ background:'transparent', border:'none', color: A_C.sec, fontSize: 12, cursor:'pointer', marginBottom: 16, fontFamily:'inherit', display:'inline-flex', alignItems:'center', gap: 6 }}>← Back</button>
        <div style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', color: A_C.mute, letterSpacing:'0.06em', textTransform:'uppercase', marginBottom: 8 }}>Manage bid</div>
        <div style={{ fontSize: 24, fontWeight: 700, letterSpacing:'-0.02em', marginBottom: 6 }}>Your bid on {tool.name}</div>
        <div style={{ fontSize: 13, color: A_C.sec, marginBottom: 22, lineHeight: 1.5 }}>Adjust the amount or withdraw. The difference settles against your Light balance instantly.</div>

        {/* Original bid + placement */}
        <div style={{ border:`1px solid ${A_C.border}`, borderRadius: 12, padding: 14, marginBottom: 18, background:'#fafafa', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div>
            <div style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', color: A_C.mute, letterSpacing:'0.06em', textTransform:'uppercase', marginBottom: 4 }}>Original bid</div>
            <div style={{ display:'flex', alignItems:'baseline', gap: 10 }}>
              <span style={{ fontSize: 22, fontWeight: 700, fontFamily:'var(--ul-font-mono)', fontVariantNumeric:'tabular-nums' }}>✦{fmtN(original)}</span>
              <span style={{ fontSize: 11, color: A_C.mute, fontFamily:'var(--ul-font-mono)' }}>rank #{myRank} · {my.placedHr}h ago</span>
            </div>
          </div>
          {my.message && (
            <div style={{ fontSize: 11, color: A_C.sec, fontStyle:'italic', maxWidth: 200, textAlign:'right', lineHeight: 1.4 }}>"{my.message}"</div>
          )}
        </div>

        {/* Edit amount — large display + slider + numeric input */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', color: A_C.mute, letterSpacing:'0.06em', textTransform:'uppercase' }}>New amount</div>
            <div style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', color: A_C.mute }}>{pctOfAsk}% of ask · proj. rank #{newRankProj}</div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap: 12, marginBottom: 12 }}>
            <span style={{ fontSize: 32, fontWeight: 700, fontFamily:'var(--ul-font-mono)', fontVariantNumeric:'tabular-nums', letterSpacing:'-0.02em' }}>✦</span>
            <input type="number" value={amt} onChange={(e) => setSafe(Number(e.target.value || 0))}
              style={{ flex: 1, fontSize: 32, fontWeight: 700, fontFamily:'var(--ul-font-mono)', fontVariantNumeric:'tabular-nums', letterSpacing:'-0.02em', border:`1px solid ${A_C.border}`, borderRadius: 10, padding:'8px 14px', outline:'none', minWidth: 0 }}/>
            <div style={{ display:'flex', flexDirection:'column', gap: 4 }}>
              <button onClick={() => setSafe(amt + 100)} style={{ fontSize: 11, padding:'4px 10px', background:'#fff', border:`1px solid ${A_C.border}`, borderRadius: 6, cursor:'pointer', fontFamily:'inherit' }}>+100</button>
              <button onClick={() => setSafe(amt - 100)} style={{ fontSize: 11, padding:'4px 10px', background:'#fff', border:`1px solid ${A_C.border}`, borderRadius: 6, cursor:'pointer', fontFamily:'inherit' }}>−100</button>
            </div>
          </div>
          <input type="range" min={minBid} max={Math.max(maxBid, askLight)} step={50} value={amt} onChange={(e) => setSafe(Number(e.target.value))} style={{ width:'100%' }}/>
          <div style={{ display:'flex', justifyContent:'space-between', fontSize: 11, fontFamily:'var(--ul-font-mono)', color: A_C.mute, marginTop: 4 }}>
            <span>✦{minBid}</span>
            <span>ask ✦{fmtN(askLight)}</span>
          </div>
        </div>

        {/* Wallet settlement */}
        <div style={{ border:`1px solid ${A_C.border}`, borderRadius: 12, padding: 14, marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', color: A_C.mute, letterSpacing:'0.06em', textTransform:'uppercase', marginBottom: 10 }}>Wallet settlement</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr auto', gap:'6px 16px', fontSize: 13, fontFamily:'var(--ul-font-mono)', fontVariantNumeric:'tabular-nums' }}>
            <span style={{ color: A_C.sec }}>Wallet now</span>
            <span style={{ textAlign:'right' }}>✦{fmtN(wallet)}</span>
            <span style={{ color: A_C.sec }}>Bid change ({original} → {amt})</span>
            <span style={{ textAlign:'right', color: diff > 0 ? '#b91c1c' : diff < 0 ? '#15803d' : A_C.mute, fontWeight: 600 }}>
              {diff > 0 ? `−✦${fmtN(diff)}` : diff < 0 ? `+✦${fmtN(-diff)}` : '—'}
            </span>
            <span style={{ color: A_C.text, fontWeight: 600, paddingTop: 6, borderTop:`1px solid ${A_C.border}` }}>Wallet after</span>
            <span style={{ textAlign:'right', fontWeight: 700, paddingTop: 6, borderTop:`1px solid ${A_C.border}` }}>✦{fmtN(newWallet)}</span>
          </div>
        </div>

        {/* Auto-acquire notice when bid == ask */}
        {willAcquire && (
          <div style={{ padding: 12, background:'rgba(34,197,94,0.06)', border:'1px solid rgba(34,197,94,0.2)', borderRadius: 8, fontSize: 12, color:'#15803d', lineHeight: 1.5, marginBottom: 12 }}>
            <strong>This matches the ask.</strong> Submitting will acquire {tool.name} immediately — ownership transfers atomically.
          </div>
        )}

        {/* Action row */}
        <div style={{ display:'flex', gap: 8, marginBottom: 10 }}>
          <button onClick={() => setPhase('withdrawn')} style={{ padding:'12px 14px', background:'#fff', color:'#b91c1c', border:`1px solid rgba(185,28,28,0.25)`, borderRadius: 10, fontSize: 13, fontWeight: 500, cursor:'pointer', fontFamily:'inherit' }}>Withdraw entirely</button>
          <button onClick={onBack} style={{ flex: 1, padding:'12px', background:'#fff', color: A_C.text, border:`1px solid ${A_C.border}`, borderRadius: 10, fontSize: 13, fontWeight: 500, cursor:'pointer', fontFamily:'inherit' }}>Cancel</button>
          <button onClick={() => setPhase('updated')} disabled={diff === 0} style={{ flex: 1.4, padding:'12px', background: diff === 0 ? '#e5e5e5' : willAcquire ? '#15803d' : A_C.text, color: diff === 0 ? A_C.mute : '#fff', border:'none', borderRadius: 10, fontSize: 13, fontWeight: 500, cursor: diff === 0 ? 'default' : 'pointer', fontFamily:'inherit' }}>
            {diff === 0 ? 'No change' : willAcquire ? `Buy now · ✦${fmtN(amt)}` : (diff > 0 ? `Raise · escrow ✦${fmtN(diff)}` : `Lower · refund ✦${fmtN(-diff)}`)}
          </button>
        </div>
        <div style={{ fontSize: 11, color: A_C.mute, lineHeight: 1.5, fontFamily:'var(--ul-font-mono)' }}>
          Escrow released or topped up instantly. Owner sees the new amount on their next refresh; bid retains its placement timestamp.
        </div>
      </div>
    </div>
  );
}

window.PUI_AOrderBook = AOrderBook;
window.PUI_APlaceBid = APlaceBid;
window.PUI_AWithdrawBid = AWithdrawBid;
window.PUI_AOwnerPanel = AOwnerPanel;
window.PUI_ATransferCeremony = ATransferCeremony;
