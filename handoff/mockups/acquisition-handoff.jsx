// Acquisition handoff moments — the post-accept arc.
//
// The original `ATransferCeremony` was a checklist that auto-played in a
// modal. That's not enough for what's actually happening: a user just took
// over a tool with thousands of installs and a real revenue stream.
//
// This file replaces 3E with a small family of moments, each at the right
// time + place:
//
//   3E1  Seller — bid accepted (compact, satisfied — they chose this)
//   3E2  Buyer's library — newly-owned tool, "open admin →" pulse
//   3E3  First admin-panel open — THE ceremony (welcome + handoff)
//   3E4  Admin panel after dismiss (the new normal — for context)
//
// Visual language stays Ultralight: monochrome, alpha-on-black, JetBrains
// Mono for numbers + slugs, Inter for everything else. The "premium" comes
// from pacing, scale, restraint — not color or decoration.

const { C: H_C } = window.PUI_Primitives;
const { MD_TOOLS, MD_LISTINGS, fmtN } = window.PUI_MarketData;
const H_Icons = window.PUI_Icons;
const { PUI_MAvatar: H_Avatar } = window;

// ────────────────────────────────────────────────────────────────────
// Shared bits
// ────────────────────────────────────────────────────────────────────

function Caps({ children, color = H_C.mute, style }) {
  return (
    <div style={{ fontSize: 10.5, fontFamily:'var(--ul-font-mono)', color, letterSpacing:'0.1em', textTransform:'uppercase', ...style }}>{children}</div>
  );
}

// Used for the slow-counter on revenue / installs in the ceremony.
function useCountUp(target, ms = 1400, start = 0, deps = []) {
  const [v, setV] = React.useState(start);
  React.useEffect(() => {
    let raf, t0;
    const step = (t) => {
      if (!t0) t0 = t;
      const p = Math.min(1, (t - t0) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setV(start + (target - start) * eased);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return v;
}

// ────────────────────────────────────────────────────────────────────
// 3E1 · Seller — bid accepted
// Compact card, lives where the owner panel was. They chose this, so the
// vibe is *satisfaction*, not surprise. One number, one outbound action.
// ────────────────────────────────────────────────────────────────────

function ASellerSold({ toolId = 'gw', path = 'accepted' }) {
  const tool = MD_TOOLS.find(t => t.id === toolId);
  const l = MD_LISTINGS[toolId];
  const accepted = l.bids.find(b => b.bidder === '@arbiter') || l.bids[0];
  const amount = path === 'instant' ? l.askLight : accepted.amount;
  const wallet = useCountUp(8420 + amount, 1500, 8420, [amount]);
  const headline = path === 'instant' ? 'Bought at ask' : 'Sold';

  return (
    <div style={{ height:'100%', background:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'var(--ul-font-sans)', position:'relative' }}>
      {/* tiny confetti — three subtle marks, monochrome */}
      <SellerSpecks/>
      <div style={{ width:'100%', maxWidth: 440, padding: 28, position:'relative', zIndex: 1 }}>
        <Caps style={{ marginBottom: 14 }}>{headline} · {tool.name}</Caps>

        <div style={{ fontSize: 56, fontWeight: 700, fontFamily:'var(--ul-font-mono)', fontVariantNumeric:'tabular-nums', letterSpacing:'-0.035em', lineHeight: 1, marginBottom: 10 }}>
          ✦{fmtN(amount)}
        </div>
        <div style={{ fontSize: 14, color: H_C.sec, lineHeight: 1.55, marginBottom: 20 }}>
          settled to your wallet. <strong>{accepted.bidder}</strong>{' '}
          {path === 'instant' ? 'just took your ask on ' : 'now owns '}
          <strong>{tool.name}</strong>.
        </div>

        <div style={{ border:`1px solid ${H_C.border}`, borderRadius: 12, padding:'14px 16px', display:'grid', gridTemplateColumns:'1fr auto', gap:'8px 18px', fontSize: 13, fontFamily:'var(--ul-font-mono)', fontVariantNumeric:'tabular-nums', marginBottom: 18 }}>
          <span style={{ color: H_C.sec }}>Wallet before</span>
          <span style={{ textAlign:'right' }}>✦8,420</span>
          <span style={{ color: H_C.sec }}>From acquisition</span>
          <span style={{ textAlign:'right', color:'#15803d', fontWeight: 600 }}>+✦{fmtN(amount)}</span>
          <span style={{ color: H_C.text, fontWeight: 600, paddingTop: 8, borderTop:`1px solid ${H_C.border}` }}>Wallet now</span>
          <span style={{ textAlign:'right', fontWeight: 700, paddingTop: 8, borderTop:`1px solid ${H_C.border}` }}>✦{fmtN(Math.round(wallet))}</span>
        </div>

        <div style={{ fontSize: 12, color: H_C.mute, lineHeight: 1.6, marginBottom: 18, fontFamily:'var(--ul-font-mono)' }}>
          {fmtN(tool.installs)} installs migrated · revenue stream redirected · admin keys re-signed to {accepted.bidder}
        </div>

        <div style={{ display:'flex', gap: 8 }}>
          <button style={{ flex: 1, padding:'12px', background: H_C.text, color:'#fff', border:'none', borderRadius: 10, fontSize: 13, fontWeight: 500, cursor:'pointer', fontFamily:'inherit' }}>List another tool</button>
          <button style={{ padding:'12px 14px', background:'#fff', color: H_C.text, border:`1px solid ${H_C.border}`, borderRadius: 10, fontSize: 13, fontWeight: 500, cursor:'pointer', fontFamily:'inherit' }}>View receipt</button>
        </div>
      </div>
    </div>
  );
}

function SellerSpecks() {
  // four tiny ✦ marks at fixed positions, fading in then drifting up
  return (
    <div aria-hidden style={{ position:'absolute', inset: 0, overflow:'hidden', pointerEvents:'none' }}>
      <style>{`
        @keyframes pui-speck-1 { 0% { opacity: 0; transform: translateY(8px) rotate(0deg); } 30% { opacity: 0.5; } 100% { opacity: 0; transform: translateY(-30px) rotate(180deg); } }
      `}</style>
      {[
        { l:'18%', t:'22%', d:'0.0s', s: 12 },
        { l:'82%', t:'18%', d:'0.4s', s: 10 },
        { l:'12%', t:'72%', d:'0.7s', s: 14 },
        { l:'88%', t:'68%', d:'1.0s', s:  9 },
      ].map((p, i) => (
        <span key={i} style={{ position:'absolute', left: p.l, top: p.t, fontSize: p.s, color: H_C.text, opacity: 0, animation:`pui-speck-1 2200ms ease-out ${p.d} infinite` }}>✦</span>
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// 3E1b · Seller's library — re-encounter
// The morning after. Seller opens Tools and the tool they sold is still
// here — installed, callable — but no longer theirs. The banner is the
// inverse of the buyer's: settled, not waiting. No CTA, just a close
// button. One-time pulse on first sight.
// ────────────────────────────────────────────────────────────────────

function ASellerLibrary({ toolId = 'gw', path = 'accepted' }) {
  const tool = MD_TOOLS.find(t => t.id === toolId);
  const l = MD_LISTINGS[toolId];
  const buyer = l.bids.find(b => b.bidder === '@arbiter') || l.bids[0];
  const amount = path === 'instant' ? l.askLight : buyer.amount;

  // Mock: the seller (@kepler) has 5 other installed tools.
  const installed = [
    { name:'tweet.draft',      author:'you',       calls:'420/wk', owner: true },
    { name:'spotify.queue',    author:'you',       calls:'180/wk', owner: true },
    { name:'currency_convert', author:'@anchor',   calls:'1.1k/wk' },
    { name:'pdf.parse',        author:'@vellum',   calls:'240/wk' },
    { name:'slack.post',       author:'@hex',      calls:'1.8k/wk' },
  ];

  return (
    <div style={{ height:'100%', background:'#fff', display:'flex', fontFamily:'var(--ul-font-sans)' }}>
      {/* mini sidebar */}
      <div style={{ width: 200, background:'#f9fafb', borderRight:`1px solid ${H_C.border}`, padding:'22px 16px', display:'flex', flexDirection:'column', gap: 4 }}>
        <div style={{ fontSize: 14, fontWeight: 600, letterSpacing:'-0.02em', marginBottom: 14, padding:'0 8px' }}>Ultralight</div>
        {[
          { l:'Command',  active: false },
          { l:'Tools',    active: true },
          { l:'App Store',active: false },
          { l:'Wallet',   active: false },
        ].map((it) => (
          <div key={it.l} style={{ padding:'7px 10px', borderRadius: 6, fontSize: 13, color: it.active ? H_C.text : H_C.sec, background: it.active ? 'rgba(0,0,0,0.04)' : 'transparent', fontWeight: it.active ? 500 : 400 }}>{it.l}</div>
        ))}
        <Caps style={{ marginTop: 18, padding:'0 10px', fontSize: 10 }}>Library</Caps>
      </div>

      {/* main column */}
      <div style={{ flex: 1, padding:'28px 36px', overflow:'auto' }}>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing:'-0.02em', marginBottom: 4 }}>Tools</div>
        <div style={{ fontSize: 13, color: H_C.sec, marginBottom: 22 }}>{installed.length + 1} installed · 2 owned by you</div>

        {/* sold banner */}
        <SoldBanner tool={tool} buyer={buyer} amount={amount} path={path}/>

        <Caps style={{ marginTop: 28, marginBottom: 12, fontSize: 10.5 }}>Installed</Caps>
        <div style={{ border:`1px solid ${H_C.border}`, borderRadius: 12, overflow:'hidden' }}>
          {installed.map((t, i) => (
            <div key={t.name} style={{ display:'grid', gridTemplateColumns:'1fr auto auto', gap: 16, alignItems:'center', padding:'12px 14px', borderBottom: i === installed.length-1 ? 'none' : `1px solid ${H_C.border}` }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, fontFamily:'var(--ul-font-mono)' }}>{t.name}</div>
                <div style={{ fontSize: 11, color: H_C.mute, marginTop: 2 }}>by {t.author}</div>
              </div>
              <div style={{ fontSize: 11, color: H_C.mute, fontFamily:'var(--ul-font-mono)' }}>{t.calls}</div>
              <div style={{ fontSize: 11, color: t.owner ? H_C.text : H_C.sec, fontWeight: t.owner ? 500 : 400 }}>{t.owner ? 'owned' : 'installed'}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SoldBanner({ tool, buyer, amount, path = 'accepted' }) {
  // Settled, not waiting. The verb tense is past — "sold", not "selling".
  // No primary CTA. A wallet sparkline strip on the right gives it weight.
  const wallet = useCountUp(8420 + amount, 1600, 8420, []);
  const headline = path === 'instant' ? 'Bought at ask · keeps running for you' : 'Sold · keeps running for you';
  const verb = path === 'instant' ? 'Bought at ask by' : 'Sold to';
  return (
    <div style={{ position:'relative' }}>
      <Caps style={{ marginBottom: 10, fontSize: 10.5 }}>{headline}</Caps>
      <div style={{ position:'relative', display:'grid', gridTemplateColumns:'auto 1fr auto', gap: 20, alignItems:'center', padding:'18px 20px', border:`1px solid ${H_C.border}`, borderRadius: 14, background:'#fafafa' }}>
        {/* glyph block: ✦ on a soft tile, with a faded key — handed over */}
        <div style={{ width: 56, height: 56, borderRadius: 12, background:'#fff', border:`1px solid ${H_C.border}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize: 26, lineHeight: 1, position:'relative', color: H_C.text }}>
          ✦
          {/* outbound arrow chip — the inverse of the buyer's key */}
          <div style={{ position:'absolute', right: -4, bottom: -4, width: 18, height: 18, borderRadius: 9999, background: H_C.text, color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontSize: 10, lineHeight: 1 }}>
            →
          </div>
        </div>

        <div>
          <div style={{ display:'flex', alignItems:'center', gap: 10, marginBottom: 4 }}>
            <span style={{ fontSize: 18, fontWeight: 700, letterSpacing:'-0.015em', fontFamily:'var(--ul-font-mono)', color: H_C.text }}>{tool.name}</span>
            <span style={{ fontSize: 10.5, fontFamily:'var(--ul-font-mono)', color: H_C.sec, background:'#fff', border:`1px solid ${H_C.border}`, padding:'3px 8px', borderRadius: 9999, letterSpacing:'0.06em', textTransform:'uppercase' }}>No longer yours</span>
          </div>
          <div style={{ fontSize: 12.5, color: H_C.sec, lineHeight: 1.5 }}>
            {verb} <strong style={{ color: H_C.text }}>{buyer.bidder}</strong> 4 minutes ago for <strong style={{ color: H_C.text, fontFamily:'var(--ul-font-mono)' }}>✦{fmtN(amount)}</strong> · still installed in your library, calls now route to the new owner
          </div>
        </div>

        {/* wallet delta — the only number that's "yours" anymore */}
        <div style={{ textAlign:'right', display:'flex', flexDirection:'column', alignItems:'flex-end', gap: 4, paddingLeft: 14, borderLeft:`1px solid ${H_C.border}` }}>
          <Caps style={{ fontSize: 10 }}>Wallet</Caps>
          <div style={{ fontSize: 22, fontWeight: 700, fontFamily:'var(--ul-font-mono)', fontVariantNumeric:'tabular-nums', letterSpacing:'-0.01em' }}>✦{fmtN(Math.round(wallet))}</div>
          <div style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', color:'#15803d', fontWeight: 500 }}>+✦{fmtN(amount)}</div>
          <a href="#" style={{ fontSize: 11, color: H_C.sec, textDecoration:'underline', marginTop: 2 }}>View receipt</a>
        </div>

        {/* dismiss */}
        <button aria-label="Dismiss" style={{ position:'absolute', top: 10, right: 10, width: 22, height: 22, border:'none', background:'transparent', color: H_C.mute, fontSize: 14, cursor:'pointer', lineHeight: 1 }}>×</button>
      </div>
      <div style={{ fontSize: 11, color: H_C.mute, fontFamily:'var(--ul-font-mono)', marginTop: 8, paddingLeft: 2 }}>shown once · the row stays in your library, this banner won't reappear</div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// 3E2 · Buyer's library — newly-owned tool entry point
// "Where do I find it?" — the buyer's library shows their installs;
// the newly-acquired tool joins the list with a tiny mark + a "open
// admin" affordance. This is the door to the ceremony.
// ────────────────────────────────────────────────────────────────────

function ABuyerLibrary({ toolId = 'gw' }) {
  const tool = MD_TOOLS.find(t => t.id === toolId);

  // Mock: the buyer (@arbiter) has 6 installed tools + 1 newly-owned.
  const installed = [
    { name:'currency_convert', author:'@anchor',   calls:'1.2k/wk' },
    { name:'github.diff',      author:'@octo',     calls:'820/wk' },
    { name:'pdf.parse',        author:'@vellum',   calls:'310/wk' },
    { name:'slack.post',       author:'@hex',      calls:'2.4k/wk' },
    { name:'maps.route',       author:'@cartography', calls:'180/wk' },
    { name:'calendar.book',    author:'@hex',      calls:'95/wk' },
  ];

  return (
    <div style={{ height:'100%', background:'#fff', display:'flex', fontFamily:'var(--ul-font-sans)' }}>
      {/* mini sidebar */}
      <div style={{ width: 200, background:'#f9fafb', borderRight:`1px solid ${H_C.border}`, padding:'22px 16px', display:'flex', flexDirection:'column', gap: 4 }}>
        <div style={{ fontSize: 14, fontWeight: 600, letterSpacing:'-0.02em', marginBottom: 14, padding:'0 8px' }}>Ultralight</div>
        {[
          { l:'Command',  active: false },
          { l:'Tools',    active: true },
          { l:'App Store',active: false },
          { l:'Wallet',   active: false },
        ].map((it) => (
          <div key={it.l} style={{ padding:'7px 10px', borderRadius: 6, fontSize: 13, color: it.active ? H_C.text : H_C.sec, background: it.active ? 'rgba(0,0,0,0.04)' : 'transparent', fontWeight: it.active ? 500 : 400 }}>{it.l}</div>
        ))}
        <Caps style={{ marginTop: 18, padding:'0 10px', fontSize: 10 }}>Library</Caps>
      </div>

      {/* main column */}
      <div style={{ flex: 1, padding:'28px 36px', overflow:'auto' }}>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing:'-0.02em', marginBottom: 4 }}>Tools</div>
        <div style={{ fontSize: 13, color: H_C.sec, marginBottom: 22 }}>{installed.length + 1} installed · 1 owned by you</div>

        {/* the newly-owned tool — given dedicated treatment */}
        <NewlyOwnedRow tool={tool}/>

        <Caps style={{ marginTop: 28, marginBottom: 12, fontSize: 10.5 }}>Installed</Caps>
        <div style={{ border:`1px solid ${H_C.border}`, borderRadius: 12, overflow:'hidden' }}>
          {installed.map((t, i) => (
            <div key={t.name} style={{ display:'grid', gridTemplateColumns:'1fr auto auto', gap: 16, alignItems:'center', padding:'12px 14px', borderBottom: i === installed.length-1 ? 'none' : `1px solid ${H_C.border}` }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, fontFamily:'var(--ul-font-mono)' }}>{t.name}</div>
                <div style={{ fontSize: 11, color: H_C.mute, marginTop: 2 }}>by {t.author}</div>
              </div>
              <div style={{ fontSize: 11, color: H_C.mute, fontFamily:'var(--ul-font-mono)' }}>{t.calls}</div>
              <div style={{ fontSize: 11, color: H_C.sec }}>installed</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function NewlyOwnedRow({ tool }) {
  return (
    <div style={{ position:'relative' }}>
      <Caps style={{ marginBottom: 10, fontSize: 10.5 }}>Newly acquired · waiting on you</Caps>
      <div style={{ position:'relative', display:'grid', gridTemplateColumns:'auto 1fr auto', gap: 18, alignItems:'center', padding:'18px 20px', border:`1px solid ${H_C.text}`, borderRadius: 14, background:'#fff', boxShadow:'0 1px 0 rgba(0,0,0,0.02), 0 8px 30px rgba(0,0,0,0.06)' }}>
        {/* glyph block: large ✦ on a dark tile */}
        <div style={{ width: 56, height: 56, borderRadius: 12, background: H_C.text, color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontSize: 26, lineHeight: 1, position:'relative' }}>
          ✦
          {/* corner key — owner mark */}
          <div style={{ position:'absolute', right: -4, bottom: -4, width: 18, height: 18, borderRadius: 9999, background:'#fff', border:`1px solid ${H_C.border}`, display:'flex', alignItems:'center', justifyContent:'center', color: H_C.text }}>
            <H_Icons.IconKey size={10}/>
          </div>
        </div>

        <div>
          <div style={{ display:'flex', alignItems:'center', gap: 10, marginBottom: 4 }}>
            <span style={{ fontSize: 18, fontWeight: 700, letterSpacing:'-0.015em', fontFamily:'var(--ul-font-mono)' }}>{tool.name}</span>
            <span style={{ fontSize: 10.5, fontFamily:'var(--ul-font-mono)', color: H_C.text, background:'rgba(0,0,0,0.06)', padding:'3px 8px', borderRadius: 9999, letterSpacing:'0.06em', textTransform:'uppercase' }}>You own this</span>
          </div>
          <div style={{ fontSize: 12.5, color: H_C.sec, lineHeight: 1.5 }}>
            Acquired 4 minutes ago from <strong>@kepler</strong> · {fmtN(tool.installs)} active installs · open the admin panel to claim it
          </div>
        </div>

        <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap: 6 }}>
          <button style={{ padding:'10px 18px', background: H_C.text, color:'#fff', border:'none', borderRadius: 10, fontSize: 13, fontWeight: 500, cursor:'pointer', fontFamily:'inherit', display:'inline-flex', alignItems:'center', gap: 8, position:'relative' }}>
            Open admin
            <span style={{ display:'inline-flex', alignItems:'center' }}>→</span>
            {/* pulse */}
            <span style={{ position:'absolute', inset: -3, borderRadius: 12, border:`1.5px solid ${H_C.text}`, opacity: 0, animation:'pui-pulse 2200ms ease-out infinite' }}/>
          </button>
          <span style={{ fontSize: 11, color: H_C.mute, fontFamily:'var(--ul-font-mono)' }}>first time only</span>
        </div>
        <style>{`
          @keyframes pui-pulse {
            0% { opacity: 0.5; transform: scale(1); }
            70% { opacity: 0; transform: scale(1.08); }
            100% { opacity: 0; transform: scale(1.08); }
          }
        `}</style>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// 3E3 · First admin-panel open — THE ceremony
// Beats:
//   0  Cold open — wordmark + small text "Welcome, owner"
//   1  Tool name + author handoff lockup (slow line draw between avatars)
//   2  Numbers reveal — what just changed hands (count-up)
//   3  The keys — a literal "admin keys re-signed to you" moment
//   4  Settles into a "what to do next" panel that morphs into the actual admin (3E4)
// ────────────────────────────────────────────────────────────────────

function AHandoffCeremony({ toolId = 'gw', replayKey = 0, path = 'accepted' }) {
  const tool = MD_TOOLS.find(t => t.id === toolId);
  const l = MD_LISTINGS[toolId];
  const accepted = l.bids.find(b => b.bidder === '@arbiter') || l.bids[0];
  const amount = path === 'instant' ? l.askLight : accepted.amount;

  // Two stages only:
  //  1 — handoff lockup + numbers strip (entry animation auto-plays)
  //  2 — keys panel (final)
  const [stage, setStage] = React.useState(0);
  React.useEffect(() => { setStage(0); }, [replayKey]);
  React.useEffect(() => {
    if (stage === 0) {
      const t = setTimeout(() => setStage(1), 350);
      return () => clearTimeout(t);
    }
  }, [stage, replayKey]);
  const next = () => setStage(s => Math.min(2, s + 1));

  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter') { e.preventDefault(); next(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div style={{ position:'relative', width:'100%', height:'100%', background:'#0a0a0a', color:'#fff', fontFamily:'var(--ul-font-sans)', overflow:'hidden' }}>
      <CeremonyBackdrop stage={stage}/>
      <CeremonyContent stage={stage} tool={tool} accepted={accepted} amount={amount} path={path} listing={l} replayKey={replayKey} onNext={next} onBack={() => setStage(s => Math.max(1, s - 1))}/>
      <CeremonyChrome stage={stage}/>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// 3E3' · Single-page variant — everything visible at once
// No paging. Lockup + numbers AND the keys panel + receipt + first
// moves all on one screen. Animation cascade still plays on entry.
// ────────────────────────────────────────────────────────────────────

function AHandoffCeremonyOnePage({ toolId = 'gw', replayKey = 0 }) {
  const tool = MD_TOOLS.find(t => t.id === toolId);
  const l = MD_LISTINGS[toolId];
  const accepted = l.bids.find(b => b.bidder === '@arbiter') || l.bids[0];

  const [stage, setStage] = React.useState(0);
  React.useEffect(() => { setStage(0); }, [replayKey]);
  React.useEffect(() => {
    if (stage === 0) {
      const t = setTimeout(() => setStage(1), 350);
      return () => clearTimeout(t);
    }
  }, [stage, replayKey]);

  return (
    <div style={{ position:'relative', width:'100%', height:'100%', background:'#0a0a0a', color:'#fff', fontFamily:'var(--ul-font-sans)', overflow:'auto' }}>
      <CeremonyBackdrop stage={stage}/>
      {/* top chrome */}
      <div style={{ position:'sticky', top: 0, zIndex: 2, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'18px 22px', opacity: stage >= 1 ? 1 : 0, transition:'opacity 600ms ease-out' }}>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing:'-0.025em', opacity: 0.85 }}>Ultralight</div>
        <div style={{ fontSize: 10.5, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.1em', textTransform:'uppercase', color:'rgba(255,255,255,0.45)' }}>
          ownership · transfer
        </div>
      </div>

      <div style={{ position:'relative', zIndex: 1, padding:'8px 32px 32px', display:'flex', flexDirection:'column', alignItems:'center', gap: 18 }}>
        {/* Top: lockup + numbers */}
        <div style={{ width:'100%', maxWidth: 560, textAlign:'center',
          opacity: stage >= 1 ? 1 : 0, transform: stage >= 1 ? 'translateY(0)':'translateY(8px)',
          transition:'opacity 700ms ease-out, transform 700ms ease-out' }}>
          <Caps color="rgba(255,255,255,0.45)" style={{ marginBottom: 16, fontSize: 11 }}>A new tool · in your hands</Caps>
          <div style={{ fontSize: 56, fontWeight: 700, fontFamily:'var(--ul-font-mono)', letterSpacing:'-0.035em', lineHeight: 1, marginBottom: 26 }}>{tool.name}</div>
          <HandoffLockup stage={stage} from={tool.author} fromColor={tool.authorAvatar} to={accepted.bidder} toColor={accepted.bidderColor} replayKey={replayKey}/>
          <NumbersStrip stage={stage} listing={l} replayKey={replayKey}/>
        </div>

        {/* Bottom: keys + receipt + first moves */}
        <div style={{ width:'100%', maxWidth: 560,
          opacity: stage >= 1 ? 1 : 0, transform: stage >= 1 ? 'translateY(0)':'translateY(20px)',
          transition:'opacity 900ms ease-out 1400ms, transform 900ms ease-out 1400ms' }}>
          <KeysPanel stage={stage} tool={tool} listing={l}/>
        </div>
      </div>
    </div>
  );
}

// faint dotted grid + a slow horizon glow — quiet, not flashy
function CeremonyBackdrop({ stage }) {
  return (
    <>
      <style>{`
        @keyframes pui-glow-rise { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pui-grid-fade { from { opacity: 0; } to { opacity: 0.5; } }
      `}</style>
      <div aria-hidden style={{
        position:'absolute', inset: 0,
        backgroundImage:'radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)',
        backgroundSize:'18px 18px', backgroundPosition:'center',
        opacity: 0, animation:'pui-grid-fade 1500ms ease-out 200ms forwards',
        maskImage:'radial-gradient(ellipse 80% 60% at center, black, transparent 75%)',
        WebkitMaskImage:'radial-gradient(ellipse 80% 60% at center, black, transparent 75%)',
      }}/>
      {/* horizon — the only "color" allowed: a hint of brand saffron, way down */}
      <div aria-hidden style={{
        position:'absolute', left: '50%', bottom: '-30%', transform:'translateX(-50%)',
        width: '120%', height: '60%',
        background:'radial-gradient(ellipse at center, rgba(245,184,42,0.08), transparent 60%)',
        opacity: stage >= 1 ? 1 : 0,
        transition:'opacity 1400ms ease-out 600ms',
      }}/>
    </>
  );
}

function CeremonyChrome({ stage, onNext, onBack }) {
  // Stage 1 has its own inline Continue + keyboard hint, so chrome only
  // surfaces on stage 2 (the keys panel) — and there it's just the
  // wordmark + slug. The keys panel itself is the final CTA.
  return (
    <>
      {/* top-left wordmark */}
      <div style={{ position:'absolute', top: 18, left: 22, fontSize: 13, fontWeight: 700, letterSpacing:'-0.025em', opacity: stage >= 1 ? 0.85 : 0, transition:'opacity 600ms ease-out' }}>Ultralight</div>
      {/* top-right slug */}
      <div style={{ position:'absolute', top: 20, right: 22, fontSize: 10.5, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.1em', textTransform:'uppercase', color:'rgba(255,255,255,0.45)', opacity: stage >= 1 ? 1 : 0, transition:'opacity 600ms ease-out' }}>
        ownership · transfer
      </div>

      {/* Back button — only shown on stage 2 */}
      <button onClick={onBack}
        style={{ position:'absolute', bottom: 22, left: 22, fontSize: 12, padding:'8px 14px', background:'transparent', color:'rgba(255,255,255,0.55)', border:'1px solid rgba(255,255,255,0.12)', borderRadius: 8, cursor:'pointer', fontFamily:'inherit', opacity: stage >= 2 ? 1 : 0, pointerEvents: stage >= 2 ? 'auto':'none', transition:'opacity 400ms ease-out' }}>
        ← Back
      </button>
    </>
  );
}

function CeremonyContent({ stage, tool, accepted, amount, path, listing, replayKey, onNext }) {
  return (
    <div style={{ position:'absolute', inset: 0, display:'grid', placeItems:'center', padding: 32 }}>
      <div style={{ width:'100%', maxWidth: 560, position:'relative', display:'grid', gridTemplateAreas:'"stack"', alignItems:'center', justifyItems:'center' }}>
        {/* Stage 1 — the lockup + numbers + Continue */}
        <div style={{
          gridArea:'stack',
          opacity: stage >= 1 && stage < 2 ? 1 : 0,
          transform: stage >= 1 && stage < 2 ? 'translateY(0)' : 'translateY(8px)',
          transition:'opacity 700ms ease-out, transform 700ms ease-out',
          width:'100%',
          pointerEvents: stage >= 2 ? 'none' : 'auto',
        }}>
          <div style={{ textAlign:'center', width:'100%' }}>
            <Caps color="rgba(255,255,255,0.45)" style={{ marginBottom: 18, fontSize: 11 }}>{path === 'instant' ? 'You just bought · the keys are warm' : 'A new tool · in your hands'}</Caps>

            <div style={{ fontSize: 56, fontWeight: 700, fontFamily:'var(--ul-font-mono)', letterSpacing:'-0.035em', lineHeight: 1, marginBottom: 26 }}>
              {tool.name}
            </div>

            <HandoffLockup stage={stage} from={tool.author} fromColor={tool.authorAvatar} to={accepted.bidder} toColor={accepted.bidderColor} replayKey={replayKey}/>

            <NumbersStrip stage={stage} listing={listing} replayKey={replayKey}/>

            <button onClick={onNext}
              style={{ marginTop: 28, padding:'12px 22px', background:'#fff', color:'#0a0a0a', border:'none', borderRadius: 10, fontSize: 13.5, fontWeight: 600, cursor:'pointer', fontFamily:'inherit', display:'inline-flex', alignItems:'center', gap: 8 }}>
              Continue <span>→</span>
            </button>
            <div style={{ marginTop: 10, fontSize: 10.5, fontFamily:'var(--ul-font-mono)', color:'rgba(255,255,255,0.3)', letterSpacing:'0.06em' }}>
              press → or space
            </div>
          </div>
        </div>

        {/* Stage 2 — the keys + welcome panel */}
        <div style={{
          gridArea:'stack',
          opacity: stage >= 2 ? 1 : 0,
          transform: stage >= 2 ? 'translateY(0)' : 'translateY(20px)',
          transition:'opacity 800ms ease-out 100ms, transform 800ms ease-out 100ms',
          pointerEvents: stage >= 2 ? 'auto' : 'none',
          width:'100%',
        }}>
          <KeysPanel stage={stage} tool={tool} listing={listing} amount={amount} path={path}/>
        </div>
      </div>
    </div>
  );
}

function HandoffLockup({ stage, from, fromColor, to, toColor, replayKey }) {
  // A bright filled circle starts at "from", moves along the line to "to",
  // pulls a darker trail behind it. By stage 3, the from avatar is dimmed
  // and the to avatar is highlighted with a thin ring.
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap: 26, marginBottom: 36 }}>
      {/* from */}
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap: 8, opacity: stage >= 1 ? 0.4 : 1, transition:'opacity 1200ms ease-out 1000ms' }}>
        <div style={{ width: 52, height: 52, borderRadius: 9999, background: fromColor, display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize: 18, fontWeight: 600 }}>
          {from.replace('@','').charAt(0).toUpperCase()}
        </div>
        <div style={{ fontSize: 12, color:'rgba(255,255,255,0.6)', fontFamily:'var(--ul-font-mono)' }}>{from}</div>
      </div>

      {/* path */}
      <div style={{ position:'relative', width: 160, height: 52, display:'flex', alignItems:'center' }}>
        <div style={{ position:'absolute', left: 0, right: 0, top:'50%', height: 1, background:'rgba(255,255,255,0.18)' }}/>
        <div style={{
          position:'absolute', left: 0, top:'50%', height: 1, background:'rgba(255,255,255,0.85)',
          width: stage >= 1 ? '100%' : '0%', transition:'width 1200ms cubic-bezier(0.65, 0, 0.35, 1) 200ms',
        }}/>
        {/* the courier — a small ✦ that travels */}
        <span key={`courier-${replayKey}`} aria-hidden style={{
          position:'absolute', top:'50%', left: 0, transform:'translate(-50%, -50%)',
          fontSize: 16, color:'#fff',
          opacity: stage >= 1 ? 1 : 0,
          transition:'opacity 200ms ease-out 200ms',
          animation: stage >= 1 ? 'pui-courier 1200ms cubic-bezier(0.65, 0, 0.35, 1) 200ms forwards' : 'none',
          textShadow:'0 0 8px rgba(255,255,255,0.4)',
        }}>✦</span>
        <style>{`
          @keyframes pui-courier {
            from { left: 0%; }
            to { left: 100%; }
          }
        `}</style>
      </div>

      {/* to */}
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap: 8, transform: stage >= 1 ? 'scale(1.06)':'scale(1)', transition:'transform 700ms ease-out 1200ms' }}>
        <div style={{ position:'relative', width: 52, height: 52 }}>
          <div style={{ width: 52, height: 52, borderRadius: 9999, background: toColor, display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize: 18, fontWeight: 600 }}>
            {to.replace('@','').charAt(0).toUpperCase()}
          </div>
          {/* ring */}
          <div style={{
            position:'absolute', inset: -6, borderRadius: 9999,
            border:'1px solid rgba(255,255,255,0.35)',
            opacity: stage >= 1 ? 1 : 0, transform: stage >= 1 ? 'scale(1)':'scale(0.9)',
            transition:'opacity 700ms ease-out 1200ms, transform 700ms ease-out 1200ms',
          }}/>
        </div>
        <div style={{ fontSize: 12, color: stage >= 1 ? '#fff' : 'rgba(255,255,255,0.6)', fontWeight: stage >= 1 ? 600 : 400, fontFamily:'var(--ul-font-mono)', transition:'color 700ms ease-out 1200ms' }}>
          {to} <span style={{ opacity: 0.6, fontWeight: 400 }}>· you</span>
        </div>
      </div>
    </div>
  );
}

function NumbersStrip({ stage, listing, replayKey }) {
  const visible  = stage >= 1;
  const installs = useCountUp(visible ? 24803 : 0, 1400, 0, [visible ? 1 : 0, replayKey]);
  const callsWk  = useCountUp(visible ? 5800 : 0, 1400, 0, [visible ? 1 : 0, replayKey]);
  const monthly  = useCountUp(visible ? 297.6 : 0, 1400, 0, [visible ? 1 : 0, replayKey]);
  return (
    <div style={{
      display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap: 1,
      background:'rgba(255,255,255,0.08)',
      border:'1px solid rgba(255,255,255,0.08)',
      borderRadius: 12, overflow:'hidden',
      opacity: visible ? 1 : 0,
      transform: visible ? 'translateY(0)':'translateY(8px)',
      transition:'opacity 700ms ease-out 200ms, transform 700ms ease-out 200ms',
    }}>
      {[
        { l:'Installs',   v: visible ? fmtN(Math.round(installs)) : '—' },
        { l:'Calls/wk',   v: visible ? fmtN(Math.round(callsWk))  : '—' },
        { l:'30d revenue',v: visible ? `✦${monthly.toFixed(1)}`  : '—' },
      ].map((s) => (
        <div key={s.l} style={{ background:'#0a0a0a', padding:'14px 12px', textAlign:'center' }}>
          <Caps color="rgba(255,255,255,0.45)" style={{ marginBottom: 6, fontSize: 10 }}>{s.l}</Caps>
          <div style={{ fontSize: 22, fontWeight: 700, fontFamily:'var(--ul-font-mono)', fontVariantNumeric:'tabular-nums', letterSpacing:'-0.02em' }}>
            {s.v}
          </div>
        </div>
      ))}
    </div>
  );
}

function KeysPanel({ stage, tool, listing, amount, path = 'accepted' }) {
  // The settled "what to do next" plate. Looks like the start of an admin
  // panel — three CTAs, a "what changed" log, and a Begin button that
  // dismisses the ceremony.
  const escrowAmt = amount != null ? amount : (listing.bids.find(b => b.bidder === '@arbiter') || listing.bids[0]).amount;
  const headline = path === 'instant' ? 'The keys are warm.' : 'The keys are yours.';
  const subhead = path === 'instant'
    ? `You took the ask. Manifest re-signed in seconds. ${fmtN(tool.installs)} active installs continue uninterrupted.`
    : `Manifest re-signed. ${fmtN(tool.installs)} active installs continue uninterrupted. The next call routes revenue to your wallet.`;
  return (
    <div style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.10)', borderRadius: 16, padding: 22, backdropFilter:'blur(2px)' }}>
      <div style={{ display:'flex', alignItems:'flex-start', gap: 14, marginBottom: 16 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background:'#fff', color:'#0a0a0a', display:'flex', alignItems:'center', justifyContent:'center', flexShrink: 0 }}>
          <H_Icons.IconKey size={20}/>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 600, letterSpacing:'-0.01em', marginBottom: 2 }}>{headline}</div>
          <div style={{ fontSize: 12.5, color:'rgba(255,255,255,0.6)', lineHeight: 1.5 }}>
            {subhead}
          </div>
        </div>
      </div>

      {/* receipt log — JetBrains Mono, very small */}
      <div style={{ borderTop:'1px solid rgba(255,255,255,0.08)', borderBottom:'1px solid rgba(255,255,255,0.08)', padding:'10px 0', marginBottom: 14, display:'flex', flexDirection:'column', gap: 5, fontSize: 11, fontFamily:'var(--ul-font-mono)', color:'rgba(255,255,255,0.55)' }}>
        {(path === 'instant' ? [
          `payment cleared  ✦${fmtN(escrowAmt)} → @kepler`,
          `manifest re-signed  admin keys → @arbiter`,
          `catalog updated  ${fmtN(tool.installs)} installs migrated`,
          `revenue redirected  next call → you`,
        ] : [
          `escrow released  ✦${fmtN(escrowAmt)} → @kepler`,
          `manifest re-signed  admin keys → @arbiter`,
          `catalog updated  ${fmtN(tool.installs)} installs migrated`,
          `revenue redirected  next call → you`,
        ]).map((msg) => (
          <div key={msg}>
            <span style={{ color:'#22c55e', marginRight: 8 }}>✓</span>{msg}
          </div>
        ))}
      </div>

      {/* three suggested first moves — soft CTAs */}
      <Caps color="rgba(255,255,255,0.45)" style={{ marginBottom: 10, fontSize: 10 }}>Suggested first moves</Caps>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap: 8, marginBottom: 16 }}>
        {[
          { l:'Set per-call price', s:`now ✦${tool.callPrice.toFixed(3)}` },
          { l:'Rotate API secrets',  s:'security' },
          { l:'Add a co-maintainer', s:'optional' },
        ].map(c => (
          <div key={c.l} style={{ padding:'10px 12px', background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', borderRadius: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 2 }}>{c.l}</div>
            <div style={{ fontSize: 10.5, color:'rgba(255,255,255,0.45)', fontFamily:'var(--ul-font-mono)' }}>{c.s}</div>
          </div>
        ))}
      </div>

      <button style={{ width:'100%', padding:'13px', background:'#fff', color:'#0a0a0a', border:'none', borderRadius: 10, fontSize: 13.5, fontWeight: 600, cursor:'pointer', fontFamily:'inherit', letterSpacing:'-0.005em' }}>
        Open admin panel →
      </button>
      <div style={{ textAlign:'center', marginTop: 10, fontSize: 11, color:'rgba(255,255,255,0.35)', fontFamily:'var(--ul-font-mono)' }}>shown once · receipt available in wallet</div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// 3E4 · Admin panel after dismiss — for context
// What the user lands on after closing the ceremony. Quiet, dense,
// Ultralight. A single subtle banner at the top reminds them the
// transfer is recent.
// ────────────────────────────────────────────────────────────────────

function AAdminPostHandoff({ toolId = 'gw' }) {
  const tool = MD_TOOLS.find(t => t.id === toolId);
  const l = MD_LISTINGS[toolId];
  const accepted = l.bids.find(b => b.bidder === '@arbiter') || l.bids[0];

  return (
    <div style={{ height:'100%', background:'#fff', overflow:'auto', fontFamily:'var(--ul-font-sans)' }}>
      {/* freshly-acquired banner — soft, monochrome, dismissable */}
      <div style={{ background:'rgba(0,0,0,0.03)', borderBottom:`1px solid ${H_C.border}`, padding:'10px 32px', display:'flex', alignItems:'center', gap: 12, fontSize: 12 }}>
        <span style={{ width: 8, height: 8, borderRadius: 9999, background: H_C.text }}/>
        <span style={{ flex: 1, color: H_C.sec }}>
          Acquired from <strong style={{ color: H_C.text }}>{tool.author}</strong> 4 minutes ago for <strong style={{ color: H_C.text, fontFamily:'var(--ul-font-mono)' }}>✦{fmtN(accepted.amount)}</strong>. <a href="#" style={{ color: H_C.text, textDecoration:'underline' }}>View receipt</a>
        </span>
        <button style={{ width: 22, height: 22, border:'none', background:'transparent', color: H_C.mute, fontSize: 14, cursor:'pointer', lineHeight: 1 }}>×</button>
      </div>

      <div style={{ maxWidth: 880, margin:'0 auto', padding:'28px 32px 60px' }}>
        {/* header */}
        <Caps style={{ marginBottom: 10 }}>Admin · {tool.name}</Caps>
        <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 24, fontWeight: 700, letterSpacing:'-0.02em', fontFamily:'var(--ul-font-mono)' }}>{tool.name}</div>
            <div style={{ fontSize: 13, color: H_C.sec, marginTop: 4 }}>You · since 4 minutes ago · {fmtN(tool.installs)} installs</div>
          </div>
          <div style={{ display:'flex', gap: 8 }}>
            <button style={{ padding:'8px 14px', background:'#fff', border:`1px solid ${H_C.border}`, borderRadius: 8, fontSize: 12, cursor:'pointer', fontFamily:'inherit' }}>View public page</button>
            <button style={{ padding:'8px 14px', background: H_C.text, color:'#fff', border:'none', borderRadius: 8, fontSize: 12, cursor:'pointer', fontFamily:'inherit', fontWeight: 500 }}>Deploy v1.4</button>
          </div>
        </div>

        {/* metric cards */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
          {[
            { l:'Calls/wk',     v: fmtN(5800) },
            { l:'30d revenue',  v:'✦297.6' },
            { l:'p50 latency',  v:'142ms' },
            { l:'Error rate',   v:'0.04%' },
          ].map((s, i) => (
            <div key={i} style={{ padding: 14, border:`1px solid ${H_C.border}`, borderRadius: 10, background:'#fafafa' }}>
              <Caps style={{ marginBottom: 6, fontSize: 10 }}>{s.l}</Caps>
              <div style={{ fontSize: 20, fontWeight: 700, fontFamily:'var(--ul-font-mono)', fontVariantNumeric:'tabular-nums', letterSpacing:'-0.01em' }}>{s.v}</div>
            </div>
          ))}
        </div>

        {/* tabs */}
        <div style={{ display:'flex', gap: 24, borderBottom:`1px solid ${H_C.border}`, marginBottom: 18 }}>
          {['Overview','Functions','Pricing','Secrets','Maintainers','Events'].map((t, i) => (
            <div key={t} style={{ padding:'10px 0', fontSize: 13, fontWeight: i === 0 ? 600 : 400, color: i === 0 ? H_C.text : H_C.sec, borderBottom: i === 0 ? `2px solid ${H_C.text}` : '2px solid transparent', marginBottom: -1, cursor:'pointer' }}>{t}</div>
          ))}
        </div>

        {/* function list */}
        <div style={{ border:`1px solid ${H_C.border}`, borderRadius: 12, overflow:'hidden' }}>
          <div style={{ padding:'10px 14px', background:'#fafafa', borderBottom:`1px solid ${H_C.border}`, display:'grid', gridTemplateColumns:'1fr 90px 80px 80px 70px', gap: 12 }}>
            <Caps style={{ fontSize: 10 }}>Function</Caps>
            <Caps style={{ fontSize: 10, textAlign:'right' }}>Price</Caps>
            <Caps style={{ fontSize: 10, textAlign:'right' }}>p50</Caps>
            <Caps style={{ fontSize: 10, textAlign:'right' }}>Calls/wk</Caps>
            <Caps style={{ fontSize: 10, textAlign:'right' }}>Errors</Caps>
          </div>
          {[
            { n:'forecast',   p: 0.012, p50: 142, c: 2840, err: 0.03 },
            { n:'now',        p: 0.004, p50:  68, c: 1820, err: 0.01 },
            { n:'historical', p: 0.018, p50: 280, c:  640, err: 0.08 },
            { n:'alerts',     p: 0.006, p50:  92, c:  380, err: 0.02 },
            { n:'radar.tile', p: 0.001, p50:  44, c:  120, err: 0.00 },
          ].map((f, i, arr) => (
            <div key={f.n} style={{ padding:'12px 14px', display:'grid', gridTemplateColumns:'1fr 90px 80px 80px 70px', gap: 12, alignItems:'center', borderBottom: i === arr.length-1 ? 'none' : `1px solid ${H_C.border}`, fontFamily:'var(--ul-font-mono)', fontSize: 12.5, fontVariantNumeric:'tabular-nums' }}>
              <span>{f.n}</span>
              <span style={{ textAlign:'right' }}>✦{f.p.toFixed(3)}</span>
              <span style={{ textAlign:'right', color: H_C.sec }}>{f.p50}ms</span>
              <span style={{ textAlign:'right' }}>{fmtN(f.c)}</span>
              <span style={{ textAlign:'right', color: f.err > 0.05 ? '#b45309' : H_C.sec }}>{f.err.toFixed(2)}%</span>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 18, fontSize: 11, color: H_C.mute, fontFamily:'var(--ul-font-mono)' }}>
          ownership log: <strong style={{ color: H_C.text }}>@kepler</strong> → <strong style={{ color: H_C.text }}>@arbiter</strong> · 4m ago · ✦{fmtN(accepted.amount)}
        </div>
      </div>
    </div>
  );
}

window.PUI_ASellerSold      = ASellerSold;
window.PUI_ASellerLibrary   = ASellerLibrary;
window.PUI_ABuyerLibrary    = ABuyerLibrary;
window.PUI_AHandoffCeremony = AHandoffCeremony;
window.PUI_AHandoffCeremonyOnePage = AHandoffCeremonyOnePage;
window.PUI_AAdminPostHandoff= AAdminPostHandoff;
