// Add Light — alternate payment-flow concepts
// Three directions for the checkout, optimized for conversion in different ways:
//   A) Order Summary Split  — Stripe Checkout pattern; explicit USD breakdown alongside
//   B) Express Wallet First — wallet buttons up top; one-tap path; alts collapsed
//   C) Bundle Picker        — pre-priced tiers w/ bonus Light at higher rungs;
//                             itemized order details; the SaaS-upgrade pattern

const AL_C = window.PUI_Primitives.C;

// ── Shared bits ────────────────────────────────────────────────────────
const fmtL = (n) => {
  if (n >= 1_000_000) return `${Math.round(n / 1_000_000)}m`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(Math.round(n));
};
const fmtUSD = (cents) => {
  const d = cents / 100;
  if (d >= 100) return `$${d.toFixed(2)}`;
  if (d >= 1) return `$${d.toFixed(2)}`;
  return `$${d.toFixed(2)}`;
};
const Sparkle = ({ size = 18 }) => (
  <span style={{ fontSize: size, color: AL_C.text, lineHeight: 1 }}>✦</span>
);
const Mono = ({ children, color = AL_C.text, size = 13, weight = 500 }) => (
  <span style={{ fontFamily:'var(--ul-font-mono)', fontSize: size, color, fontWeight: weight, fontVariantNumeric:'tabular-nums', letterSpacing:'0.01em' }}>{children}</span>
);
const Chip = ({ children, tone = 'mute' }) => (
  <span style={{ fontSize: 9, fontFamily:'var(--ul-font-mono)', color: tone === 'green' ? AL_C.green : AL_C.sec, border:`1px solid ${tone === 'green' ? 'rgba(34,197,94,0.4)' : AL_C.border}`, padding:'1px 6px', borderRadius: 4, letterSpacing:'0.06em', textTransform:'uppercase', background: tone === 'green' ? 'rgba(34,197,94,0.06)' : 'transparent' }}>{children}</span>
);
const SectionLabel = ({ children, mb = 10 }) => (
  <div style={{ fontSize: 10, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.08em', textTransform:'uppercase', color: AL_C.mute, marginBottom: mb }}>{children}</div>
);
const Divider = ({ my = 12 }) => <div style={{ height: 1, background: AL_C.border, margin: `${my}px 0` }}/>;

// Stripe-ish wallet glyphs (simplified, original-look)
const ApplePayGlyph = () => (
  <span style={{ fontFamily:'-apple-system, BlinkMacSystemFont, system-ui, sans-serif', fontWeight: 600, fontSize: 14, color:'#fff', display:'inline-flex', alignItems:'center', gap: 2 }}>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff" style={{ marginTop: -1 }}><path d="M17.05 11.97c-.03-2.6 2.13-3.86 2.23-3.92-1.21-1.77-3.1-2.01-3.78-2.04-1.6-.16-3.13.94-3.95.94-.84 0-2.08-.92-3.42-.89-1.76.03-3.39 1.02-4.29 2.6-1.84 3.18-.47 7.88 1.31 10.46.88 1.27 1.92 2.69 3.27 2.64 1.31-.05 1.81-.85 3.4-.85 1.58 0 2.03.85 3.41.83 1.41-.03 2.3-1.29 3.16-2.57.99-1.47 1.4-2.91 1.42-2.99-.03-.01-2.72-1.04-2.75-4.13zM14.45 4.39c.72-.87 1.21-2.08 1.07-3.29-1.04.04-2.3.69-3.05 1.56-.66.77-1.25 2.01-1.09 3.19 1.16.09 2.34-.59 3.07-1.46z"/></svg>
    Pay
  </span>
);
const GooglePayGlyph = () => (
  <span style={{ fontFamily:'-apple-system, BlinkMacSystemFont, system-ui, sans-serif', fontWeight: 600, fontSize: 14, color: AL_C.text, display:'inline-flex', alignItems:'center', gap: 4 }}>
    <span style={{ display:'inline-flex' }}>
      <span style={{ color:'#4285F4' }}>G</span>
    </span>
    Pay
  </span>
);

// Conversion model: user enters $ — pays EXACTLY that — receives Light at
// the method's rate (fees baked into the rate, no separate line items, no
// sales tax: Light is a stored-value balance, sales tax only applies to
// internal ledger transactions when Light is spent on tools).
//   Earnings → 100 ✦/$  (1:1, no haircut)
//   Wire     → 99 ✦/$
//   Wallet   → 95 ✦/$
const RATES = {
  transfer: 100,
  wire: 99,
  wallet: 95,
};
const RATE_LABEL = {
  transfer: '✦100 per $1',
  wire: '✦99 per $1',
  wallet: '✦95 per $1',
};
function buildOrder({ usdCents, method }) {
  const rate = RATES[method] || 100;
  const lightReceived = Math.round((usdCents / 100) * rate); // ✦ units
  return { usdCents, lightReceived, rate };
}

// ─────────────────────────────────────────────────────────────────────
// CONCEPT A — Order Summary Split
// Two-column. Left: amount + method. Right: itemized USD breakdown.
// Pattern: Stripe Checkout, modern SaaS upgrade. Highest perceived trust.
// ─────────────────────────────────────────────────────────────────────
// First-principles model:
//   • Earnings → Balance is an INTERNAL TRANSFER. The user already owns the
//     Light; nothing is purchased. Native unit is ✦. 1:1, no fees, no rate.
//   • Bank wire / Wallet are PURCHASES via Stripe. Native unit is $ (that's
//     what gets debited). Rate is baked in (99 / 95 ✦ per $1).
// So the input switches denomination based on intent. We store one canonical
// value (USD cents — also the ✦ count at the 1:1 reference rate) and reflow
// the input field, presets, and right-side summary around the active method.
const EARNINGS_AVAIL_CENTS = 25000; // ✦25,000 · = $250 reference

function AddLightSplit() {
  const [method, setMethod] = React.useState('wallet');
  const [cents, setCents] = React.useState(5000); // $50 / ✦5,000
  const [autoTransfer, setAutoTransfer] = React.useState(false);
  const isTransfer = method === 'transfer';

  const dollars = cents / 100;
  const receivedLight = isTransfer ? cents : Math.round(dollars * RATES[method]);
  const overEarnings = isTransfer && cents > EARNINGS_AVAIL_CENTS;

  const PRESETS_USD = [10, 25, 100, 500];
  const PRESETS_LIGHT = [1000, 5000, 10000, 25000];
  const presets = isTransfer ? PRESETS_LIGHT : PRESETS_USD;
  const activePreset = isTransfer ? cents : Math.round(dollars);

  const fmtExact = (n) => n.toLocaleString();

  return (
    <div style={{ background:'#fff', height:'100%', display:'grid', gridTemplateColumns:'1.15fr 1fr', overflow:'hidden' }}>
      {/* LEFT — amount + method */}
      <div style={{ padding:'24px 26px', display:'flex', flexDirection:'column', gap: 18, overflow:'auto' }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, letterSpacing:'-0.02em' }}>Add Light to Balance</div>
          <div style={{ fontSize: 12, color: AL_C.sec, marginTop: 2 }}>
            {isTransfer
              ? 'Move Light from your Earnings into Balance. 1:1, instant, no fees.'
              : "Enter what you'll pay; we'll show how much Light you receive at your method's rate."}
          </div>
        </div>

        <div>
          <SectionLabel>{isTransfer ? 'You transfer' : 'You pay'}</SectionLabel>
          <div style={{ display:'flex', alignItems:'baseline', gap: 8, padding:'12px 14px', border:`1px solid ${overEarnings ? '#c43d2f' : AL_C.borderStrong}`, borderRadius: 10 }}>
            {isTransfer
              ? <Sparkle size={22}/>
              : <span style={{ fontSize: 22, color: AL_C.text, fontWeight: 600 }}>$</span>}
            {isTransfer ? (
              <input value={cents} onChange={(e) => setCents(parseInt(e.target.value.replace(/[^0-9]/g,'')) || 0)}
                inputMode="numeric"
                style={{ flex: 1, border:'none', outline:'none', fontFamily:'var(--ul-font-mono)', fontSize: 22, fontWeight: 600, color: AL_C.text, background:'transparent', fontVariantNumeric:'tabular-nums' }}/>
            ) : (
              <input value={dollars} onChange={(e) => setCents(Math.round((parseFloat(e.target.value.replace(/[^0-9.]/g,'')) || 0) * 100))}
                inputMode="decimal"
                style={{ flex: 1, border:'none', outline:'none', fontFamily:'var(--ul-font-mono)', fontSize: 22, fontWeight: 600, color: AL_C.text, background:'transparent', fontVariantNumeric:'tabular-nums' }}/>
            )}
            <Mono color={AL_C.mute} size={12}>{isTransfer ? 'LIGHT' : 'USD'}</Mono>
          </div>
          {isTransfer && (
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop: 6, fontSize: 11 }}>
              <span style={{ color: overEarnings ? '#c43d2f' : AL_C.mute, fontFamily:'var(--ul-font-mono)' }}>
                {overEarnings ? 'EXCEEDS EARNINGS BALANCE' : `AVAILABLE ✦${fmtExact(EARNINGS_AVAIL_CENTS)}`}
              </span>
              <button onClick={() => setCents(EARNINGS_AVAIL_CENTS)}
                style={{ background:'transparent', border:'none', padding: 0, fontFamily:'var(--ul-font-mono)', fontSize: 11, color: AL_C.text, cursor:'pointer', borderBottom:`1px solid ${AL_C.border}` }}>
                Move max
              </button>
            </div>
          )}
          <div style={{ display:'flex', gap: 6, marginTop: 10, flexWrap:'wrap' }}>
            {presets.map(v => (
              <button key={v} onClick={() => setCents(isTransfer ? v : v * 100)}
                style={{ fontFamily:'var(--ul-font-mono)', fontSize: 11, padding:'5px 10px', border:`1px solid ${AL_C.border}`, borderRadius: 9999, background: activePreset === v ? AL_C.text : '#fff', color: activePreset === v ? '#fff' : AL_C.sec, cursor:'pointer' }}>
                {isTransfer ? `✦${fmtL(v)}` : `$${v}`}
              </button>
            ))}
          </div>
        </div>

        <div>
          <SectionLabel>Pay with</SectionLabel>
          <div style={{ display:'flex', flexDirection:'column', gap: 8 }}>
            {[
              { id:'transfer', name:'Transfer from Earnings', sub:`Available ✦${fmtL(EARNINGS_AVAIL_CENTS)} · Ultralight-only · 1:1, no fees`, meta:'instant' },
              { id:'wire',     name:'Bank wire (ACH)',        sub:`Clears in 1–3 business days · ${RATE_LABEL.wire}`, meta:'1–3d' },
              { id:'wallet',   name:'Apple Pay or Google Pay', sub:`Charged to your default wallet · ${RATE_LABEL.wallet}`, meta:'~2s' },
            ].map(m => (
              <button key={m.id} onClick={() => setMethod(m.id)}
                style={{ display:'grid', gridTemplateColumns:'18px 1fr', gap: 12, alignItems:'center', textAlign:'left', padding:'12px 14px', border:`1px solid ${method === m.id ? AL_C.text : AL_C.border}`, borderRadius: 10, background: method === m.id ? '#fafafa' : '#fff', cursor:'pointer', fontFamily:'inherit' }}>
                <span style={{ width: 16, height: 16, borderRadius: 9999, border:`1.5px solid ${method === m.id ? AL_C.text : AL_C.borderStrong}`, display:'inline-flex', alignItems:'center', justifyContent:'center' }}>
                  {method === m.id && <span style={{ width: 8, height: 8, borderRadius: 9999, background: AL_C.text }}/>}
                </span>
                <div>
                  <div style={{ display:'flex', alignItems:'center', gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{m.name}</span>
                    <Chip>{m.meta}</Chip>
                  </div>
                  <div style={{ fontSize: 11, color: AL_C.sec, marginTop: 2 }}>{m.sub}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* RIGHT — summary reflows by intent */}
      <div style={{ background:'#fafafa', borderLeft:`1px solid ${AL_C.border}`, padding:'24px 26px', display:'flex', flexDirection:'column' }}>
        <SectionLabel>{isTransfer ? 'Transfer summary' : 'Order summary'}</SectionLabel>

        {isTransfer ? (
          <>
            <div style={{ display:'flex', flexDirection:'column', gap: 12 }}>
              <Row label="From" sub={`Earnings · ✦${fmtL(EARNINGS_AVAIL_CENTS)} available`} value="EARNINGS" muted/>
              <Row label="To"   sub="Balance · spendable on Ultralight tools"             value="BALANCE"  muted/>
              <Row label="Rate" value="1:1 · no fees" muted/>
            </div>
            <Divider my={16}/>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline' }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>You move</div>
              <div style={{ display:'flex', alignItems:'baseline', gap: 8, fontFamily:'var(--ul-font-mono)', fontVariantNumeric:'tabular-nums' }}>
                <Sparkle size={26}/>
                <span style={{ fontSize: 26, fontWeight: 700, letterSpacing:'-0.02em' }}>{fmtExact(cents)}</span>
              </div>
            </div>
            <button disabled={overEarnings || cents <= 0}
              style={{ marginTop: 18, padding:'13px 16px', background: overEarnings ? AL_C.mute : AL_C.text, color:'#fff', border:'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: overEarnings ? 'not-allowed' : 'pointer', letterSpacing:'0.01em', opacity: cents <= 0 ? 0.5 : 1 }}>
              {overEarnings ? 'Insufficient earnings' : `Transfer ✦${fmtExact(cents)} to Balance`}
            </button>
            <div style={{ marginTop: 14, fontSize: 10, color: AL_C.mute, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.04em', display:'flex', alignItems:'center', gap: 6 }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
              INSTANT INTERNAL TRANSFER
            </div>
            <div style={{ marginTop: 8, fontSize: 11, color: AL_C.mute, lineHeight: 1.5 }}>
              Once moved, Light can be spent on Ultralight tools but cannot be withdrawn back to a bank account.
            </div>

            {/* Auto-transfer switch — only relevant when transfer is the active method */}
            <div style={{ marginTop: 18, padding:'14px 14px', border:`1px solid ${AL_C.border}`, borderRadius: 10, background:'#fff', display:'grid', gridTemplateColumns:'1fr 36px', gap: 12, alignItems:'flex-start' }}>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: AL_C.text }}>Auto-transfer earnings to Balance</div>
                <div style={{ fontSize: 11, color: AL_C.sec, marginTop: 4, lineHeight: 1.5 }}>
                  New earnings route into Balance as they arrive. Once moved, they can only be spent on Ultralight — not withdrawn to a bank account.
                </div>
              </div>
              <button onClick={() => setAutoTransfer(v => !v)} aria-pressed={autoTransfer}
                style={{ width: 36, height: 20, padding: 2, border:'none', borderRadius: 9999, background: autoTransfer ? AL_C.text : 'rgba(0,0,0,0.18)', cursor:'pointer', position:'relative', transition:'background 120ms', alignSelf:'center' }}>
                <span style={{ display:'block', width: 16, height: 16, borderRadius: 9999, background:'#fff', boxShadow:'0 1px 3px rgba(0,0,0,0.25)', transform: `translateX(${autoTransfer ? 16 : 0}px)`, transition:'transform 120ms' }}/>
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ display:'flex', flexDirection:'column', gap: 12 }}>
              <Row label="You pay" value={fmtUSD(cents)}/>
              <Row label={<span>Rate · {method === 'wallet' ? 'Apple/Google Pay' : 'Bank wire'}</span>}
                   value={RATE_LABEL[method]} muted/>
            </div>
            <Divider my={16}/>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline' }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>You receive</div>
              <div style={{ display:'flex', alignItems:'baseline', gap: 8, fontFamily:'var(--ul-font-mono)', fontVariantNumeric:'tabular-nums' }}>
                <Sparkle size={26}/>
                <span style={{ fontSize: 26, fontWeight: 700, letterSpacing:'-0.02em' }}>{fmtExact(receivedLight)}</span>
              </div>
            </div>
            <button disabled={cents <= 0}
              style={{ marginTop: 18, padding:'13px 16px', background: AL_C.text, color:'#fff', border:'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: cents > 0 ? 'pointer' : 'not-allowed', letterSpacing:'0.01em', opacity: cents <= 0 ? 0.5 : 1 }}>
              Pay {fmtUSD(cents)}
            </button>
            <div style={{ marginTop: 14, fontSize: 10, color: AL_C.mute, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.04em', display:'flex', alignItems:'center', gap: 6 }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              SECURE CHECKOUT · POWERED BY STRIPE
            </div>
            <div style={{ marginTop: 8, fontSize: 11, color: AL_C.mute, lineHeight: 1.5 }}>
              No sales tax. Tax is collected only when Light is spent on individual tools.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ label, sub, value, muted }) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap: 12 }}>
      <div>
        <div style={{ fontSize: 13, color: muted ? AL_C.sec : AL_C.text, fontWeight: muted ? 400 : 500 }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: AL_C.mute, marginTop: 2 }}>{sub}</div>}
      </div>
      <div style={{ fontSize: 13, fontFamily:'var(--ul-font-mono)', color: muted ? AL_C.sec : AL_C.text, fontVariantNumeric:'tabular-nums', whiteSpace:'nowrap' }}>{value}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// CONCEPT B — Express Wallet First
// Pattern: e-commerce express checkout. Wallet buttons huge up top, alts
// collapsed below "or pay another way". Optimized for one-tap conversion.
// ─────────────────────────────────────────────────────────────────────
function AddLightExpress() {
  const [usd, setUsd] = React.useState(25);
  const PRESETS = [
    { usd: 10,  badge: null },
    { usd: 25,  badge: 'Popular' },
    { usd: 100, badge: null },
    { usd: 500, badge: 'Best value' },
  ];
  const usdCents = Math.round(usd * 100);
  const yieldWallet = Math.round(usdCents / 100 * RATES.wallet);

  return (
    <div style={{ background:'#fff', height:'100%', overflow:'auto', padding:'26px 28px' }}>
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, letterSpacing:'-0.02em' }}>Add Light</div>
          <div style={{ fontSize: 12, color: AL_C.sec, marginTop: 2 }}>One-tap with Apple/Google Pay.</div>
        </div>
        <div style={{ textAlign:'right' }}>
          <SectionLabel mb={2}>Current balance</SectionLabel>
          <div style={{ fontSize: 16, fontWeight: 700, fontFamily:'var(--ul-font-mono)' }}>✦798k</div>
        </div>
      </div>

      {/* USD tiles */}
      <SectionLabel>You pay</SectionLabel>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap: 8, marginBottom: 14 }}>
        {PRESETS.map(p => {
          const lite = Math.round(p.usd * RATES.wallet);
          return (
            <button key={p.usd} onClick={() => setUsd(p.usd)}
              style={{ position:'relative', padding:'14px 14px', textAlign:'left', border:`1.5px solid ${usd === p.usd ? AL_C.text : AL_C.border}`, borderRadius: 12, background: usd === p.usd ? '#fafafa' : '#fff', cursor:'pointer', fontFamily:'inherit' }}>
              <div style={{ display:'flex', alignItems:'baseline', gap: 4 }}>
                <span style={{ fontSize: 22, fontWeight: 700, fontFamily:'var(--ul-font-mono)', letterSpacing:'-0.02em' }}>${p.usd}</span>
              </div>
              <div style={{ fontSize: 12, color: AL_C.sec, marginTop: 4, fontFamily:'var(--ul-font-mono)' }}>→ ✦{fmtL(lite)} Light</div>
              {p.badge && (
                <span style={{ position:'absolute', top: -8, right: 12, background: AL_C.text, color:'#fff', fontSize: 9, fontFamily:'var(--ul-font-mono)', padding:'3px 8px', borderRadius: 9999, letterSpacing:'0.06em', textTransform:'uppercase' }}>{p.badge}</span>
              )}
            </button>
          );
        })}
      </div>
      <div style={{ marginBottom: 18, fontSize: 11, color: AL_C.mute, fontFamily:'var(--ul-font-mono)' }}>
        or <button style={{ background:'transparent', border:'none', padding: 0, color: AL_C.text, fontFamily:'inherit', fontSize: 11, cursor:'pointer', borderBottom:`1px solid ${AL_C.border}` }}>enter custom amount</button>
      </div>

      {/* You receive (wallet rate) */}
      <div style={{ padding:'14px 16px', background:'#fafafa', borderRadius: 10, marginBottom: 14, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div>
          <Mono color={AL_C.sec} size={11}>YOU RECEIVE · {RATE_LABEL.wallet}</Mono>
          <div style={{ display:'flex', alignItems:'baseline', gap: 4, marginTop: 2 }}>
            <Sparkle size={18}/>
            <span style={{ fontSize: 22, fontWeight: 700, fontFamily:'var(--ul-font-mono)', letterSpacing:'-0.02em' }}>{fmtL(yieldWallet)}</span>
          </div>
        </div>
        <div style={{ textAlign:'right' }}>
          <Mono color={AL_C.sec} size={11}>YOU PAY</Mono>
          <div style={{ fontSize: 22, fontWeight: 700, fontFamily:'var(--ul-font-mono)', marginTop: 2 }}>{fmtUSD(usdCents)}</div>
        </div>
      </div>

      {/* Express pay buttons */}
      <div style={{ display:'flex', flexDirection:'column', gap: 8, marginBottom: 14 }}>
        <button style={{ height: 48, background:'#000', color:'#fff', border:'none', borderRadius: 8, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap: 8 }}>
          <ApplePayGlyph/>
        </button>
        <button style={{ height: 48, background:'#fff', color: AL_C.text, border:`1px solid ${AL_C.borderStrong}`, borderRadius: 8, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap: 8 }}>
          <GooglePayGlyph/>
        </button>
      </div>

      {/* Divider */}
      <div style={{ display:'flex', alignItems:'center', gap: 10, margin:'14px 0' }}>
        <div style={{ flex: 1, height: 1, background: AL_C.border }}/>
        <Mono color={AL_C.mute} size={10}>OR PAY ANOTHER WAY · BETTER RATE</Mono>
        <div style={{ flex: 1, height: 1, background: AL_C.border }}/>
      </div>

      {/* Alternative methods — collapsed, with their own rates surfaced */}
      <div style={{ display:'flex', flexDirection:'column', gap: 6 }}>
        <AltMethod icon={<TransferIcon/>} title="Transfer from Earnings"
          sub={`✦25k available · ${RATE_LABEL.transfer} · → ✦${fmtL(Math.round(usd * RATES.transfer))}`}/>
        <AltMethod icon={<BankIcon/>} title="Bank wire (ACH)"
          sub={`Clears 1–3 days · ${RATE_LABEL.wire} · → ✦${fmtL(Math.round(usd * RATES.wire))}`}/>
      </div>

      <div style={{ marginTop: 14, fontSize: 10, color: AL_C.mute, lineHeight: 1.5 }}>
        No sales tax — Light is a stored balance. Tax applies when Light is spent on tools.
      </div>
    </div>
  );
}

const AltMethod = ({ icon, title, sub }) => (
  <button style={{ display:'flex', alignItems:'center', gap: 12, padding:'12px 14px', border:`1px solid ${AL_C.border}`, borderRadius: 10, background:'#fff', cursor:'pointer', textAlign:'left', fontFamily:'inherit' }}>
    <span style={{ width: 28, height: 28, borderRadius: 8, background:'#fafafa', display:'inline-flex', alignItems:'center', justifyContent:'center', color: AL_C.sec }}>{icon}</span>
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 13, fontWeight: 500 }}>{title}</div>
      <div style={{ fontSize: 11, color: AL_C.sec, marginTop: 1 }}>{sub}</div>
    </div>
    <span style={{ color: AL_C.mute, fontSize: 16 }}>›</span>
  </button>
);

const BankIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3"/></svg>
);
const TransferIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3"/></svg>
);

// ─────────────────────────────────────────────────────────────────────
// CONCEPT C — Bundle Picker (SaaS upgrade pattern, Anthropic-style)
// Pre-priced bundles as cards with bonus Light at higher tiers,
// followed by payment + itemized order details.
// ─────────────────────────────────────────────────────────────────────
function AddLightBundle() {
  const BUNDLES = [
    { usd: 25,   popular: false },
    { usd: 100,  popular: true  },
    { usd: 500,  popular: false },
  ];
  const [picked, setPicked] = React.useState(1);
  const [method, setMethod] = React.useState('wallet');
  const b = BUNDLES[picked];
  const usdCents = Math.round(b.usd * 100);
  const order = buildOrder({ usdCents, method });

  return (
    <div style={{ background:'#fff', height:'100%', overflow:'auto', padding:'26px 28px' }}>
      <div style={{ fontSize: 18, fontWeight: 700, letterSpacing:'-0.02em' }}>Add Light to Balance</div>
      <div style={{ fontSize: 12, color: AL_C.sec, marginTop: 2, marginBottom: 22 }}>Pick what you'll pay. Light received depends on your payment method.</div>

      {/* Bundles — denominated in $ */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap: 8, marginBottom: 22 }}>
        {BUNDLES.map((p, i) => {
          const lite = Math.round(p.usd * RATES[method]);
          return (
            <button key={i} onClick={() => setPicked(i)}
              style={{ position:'relative', padding:'18px 14px', textAlign:'left', border:`1.5px solid ${picked === i ? AL_C.text : AL_C.border}`, borderRadius: 12, background: picked === i ? '#fafafa' : '#fff', cursor:'pointer', fontFamily:'inherit' }}>
              {p.popular && (
                <span style={{ position:'absolute', top: -9, left: '50%', transform:'translateX(-50%)', background: AL_C.text, color:'#fff', fontSize: 9, fontFamily:'var(--ul-font-mono)', padding:'3px 8px', borderRadius: 9999, letterSpacing:'0.06em', textTransform:'uppercase', whiteSpace:'nowrap' }}>Most popular</span>
              )}
              <div style={{ fontSize: 26, fontWeight: 700, fontFamily:'var(--ul-font-mono)', letterSpacing:'-0.02em' }}>${p.usd}</div>
              <div style={{ display:'flex', alignItems:'baseline', gap: 4, marginTop: 6, color: AL_C.sec }}>
                <Sparkle size={12}/>
                <span style={{ fontSize: 12, fontFamily:'var(--ul-font-mono)' }}>{fmtL(lite)} Light</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Order details */}
      <div style={{ background:'#fafafa', borderRadius: 12, padding:'18px 18px 20px', marginBottom: 16, border:`1px solid ${AL_C.border}` }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Order details</div>

        <Row label="Amount" sub="What you're paying" value={fmtUSD(order.usdCents)}/>
        <div style={{ height: 10 }}/>
        <Row label="Conversion rate" sub={`${method === 'wallet' ? 'Apple/Google Pay' : method === 'wire' ? 'Bank wire' : 'Earnings transfer'}`} value={RATE_LABEL[method]} muted/>

        <Divider my={14}/>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline' }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>You receive</div>
          <div style={{ display:'flex', alignItems:'baseline', gap: 4, fontFamily:'var(--ul-font-mono)', fontVariantNumeric:'tabular-nums' }}>
            <Sparkle size={16}/>
            <span style={{ fontSize: 22, fontWeight: 700, letterSpacing:'-0.02em' }}>{fmtL(order.lightReceived)}</span>
            <span style={{ fontSize: 12, color: AL_C.mute, marginLeft: 4 }}>Light</span>
          </div>
        </div>
        <Divider my={14}/>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline' }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Total due today</div>
          <div style={{ fontSize: 18, fontWeight: 700, fontFamily:'var(--ul-font-mono)', fontVariantNumeric:'tabular-nums' }}>{fmtUSD(order.usdCents)}</div>
        </div>
        <div style={{ fontSize: 11, color: AL_C.mute, marginTop: 8, lineHeight: 1.5 }}>
          No sales tax — Light is a stored balance. Tax applies when Light is spent on individual tools.
        </div>
      </div>

      {/* Payment method */}
      <SectionLabel>Payment method</SectionLabel>
      <div style={{ display:'flex', gap: 6, marginBottom: 14 }}>
        {[
          { id:'transfer', label:`Earnings · ${RATE_LABEL.transfer}` },
          { id:'wire',   label:`Wire · ${RATE_LABEL.wire}` },
          { id:'wallet', label:`Apple/Google · ${RATE_LABEL.wallet}` },
        ].map(m => (
          <button key={m.id} onClick={() => setMethod(m.id)}
            style={{ flex: 1, padding:'10px 8px', fontSize: 11, fontFamily:'var(--ul-font-mono)', fontWeight: 500, border:`1px solid ${method === m.id ? AL_C.text : AL_C.border}`, borderRadius: 8, background: method === m.id ? AL_C.text : '#fff', color: method === m.id ? '#fff' : AL_C.sec, cursor:'pointer', letterSpacing:'0.02em' }}>
            {m.label}
          </button>
        ))}
      </div>

      <button style={{ width:'100%', padding:'14px 16px', background: AL_C.text, color:'#fff', border:'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor:'pointer', letterSpacing:'0.01em' }}>
        Pay {fmtUSD(order.usdCents)} → receive ✦{fmtL(order.lightReceived)}
      </button>

      <div style={{ marginTop: 12, fontSize: 10, color: AL_C.mute, fontFamily:'var(--ul-font-mono)', textAlign:'center', letterSpacing:'0.04em' }}>
        SECURE CHECKOUT · POWERED BY STRIPE
      </div>
    </div>
  );
}

window.PUI_AddLightSplit = AddLightSplit;
window.PUI_AddLightExpress = AddLightExpress;
window.PUI_AddLightBundle = AddLightBundle;
