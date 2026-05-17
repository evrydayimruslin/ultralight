// Profile / Wallet / Settings — three before screens collapsed into one Premium UI surface.
// All three are facets of "you, your money, your keys" and should share visual real estate.

const PR_C = window.PUI_Primitives.C;
const PR_Icons = window.PUI_Icons;

// One-time inject hover styles for profile rows
if (typeof document !== 'undefined' && !document.getElementById('pr-hover-styles')) {
  const s = document.createElement('style');
  s.id = 'pr-hover-styles';
  s.textContent = `.pr-row { transition: background 120ms ease; border-radius: 6px; } .pr-row:hover { background: rgba(0,0,0,0.035); }`;
  document.head.appendChild(s);
}

// 7 days of spend, fake but plausible
const PR_SPEND = [0.022, 0.041, 0.018, 0.037, 0.054, 0.029, 0.012];

const PR_TXNS = [
  { day:'today',    items:[
    { t:'12:14', who:'email-ops',     act:'sent reply to 3 threads',     d:-0.024 },
    { t:'09:02', who:'Tool Builder',  act:'deploy get_weather → staging', d:-0.012 },
    { t:'08:41', who:'wallet',        act:'top-up',                       d:+50.000 },
    { t:'00:00', who:'tool earnings', act:'4 published tools · 318 calls', d:+0.482, earn:true },
  ]},
  { day:'yesterday', items:[
    { t:'23:59', who:'tool earnings', act:'4 published tools · 271 calls', d:+0.391, earn:true },
    { t:'18:30', who:'Tool Marketer', act:'drafted listing · Currency Convert', d:-0.018 },
    { t:'14:10', who:'resort-manager', act:'62 calls (rooms.update)',     d:-0.034 },
    { t:'09:55', who:'Private Tutor', act:'12 quizzes generated',          d:-0.008 },
  ]},
  { day:'mar 5',    items:[
    { t:'23:59', who:'tool earnings', act:'4 published tools · 198 calls', d:+0.214, earn:true },
    { t:'22:01', who:'wallet',        act:'auto-top-up (threshold ✦5)',   d:+25.000 },
  ]},
];

const PR_PUBLISHED = [
  { name:'Fitness Tracker', v:'1.0.0', when:'Mar 2026', desc:'Log meals, workouts, sleep. AI calorie estimation.', glyph:'FT', tone:'#3b82f6' },
  { name:'Smart Budget',    v:'1.0.0', when:'Mar 2026', desc:'Track spending, manage budgets, financial insights.', glyph:'SB', tone:'#004225' },
  { name:'Reading List',    v:'1.0.0', when:'Mar 2026', desc:'Track books, articles, papers. Auto-extract.', glyph:'RL', tone:'#0a0a0a' },
  { name:'Goal Tracker',    v:'1.0.0', when:'Mar 2026', desc:'Goals, milestones, progress over time.', glyph:'GT', tone:'#22c55e' },
];

function PR_Glyph({ glyph, tone, size = 32 }) {
  return <div style={{ width: size, height: size, borderRadius: 8, background: tone, color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'var(--ul-font-mono)', fontWeight: 700, fontSize: Math.round(size * 0.36), letterSpacing:'-0.02em', flexShrink: 0 }}>{glyph}</div>;
}

// ── BEFORE: stitched-together version of the current Wallet/Profile/Settings ──
function PUI_ProfileBefore() {
  return (
    <div style={{ background:'#fff', height:'100%', overflow:'auto', padding: 24 }}>
      <div style={{ fontSize: 22, fontWeight: 700, letterSpacing:'-0.02em', marginBottom: 18 }}>Wallet</div>
      <div style={{ display:'flex', gap: 6, marginBottom: 18 }}>
        {['Balance','Transactions','Earnings','Offers'].map((t,i) => (
          <button key={t} style={{ padding:'6px 14px', fontSize: 13, border:'none', borderRadius: 6, cursor:'pointer', background: i === 0 ? PR_C.text : 'transparent', color: i === 0 ? '#fff' : PR_C.text }}>{t}</button>
        ))}
      </div>
      <div style={{ background: PR_C.raised, borderRadius: 12, padding: 22, marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: PR_C.sec, marginBottom: 4 }}>Available Balance</div>
        <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between' }}>
          <div style={{ fontSize: 36, fontWeight: 700, letterSpacing:'-0.02em' }}>✦798.0K</div>
          <button style={{ background: PR_C.text, color:'#fff', border:'none', padding:'10px 18px', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor:'pointer' }}>Add Funds</button>
        </div>
      </div>
      <div style={{ background: PR_C.raised, borderRadius: 12, padding: 22 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>Auto Top-up</div>
        <label style={{ fontSize: 13, color: PR_C.sec, display:'flex', gap: 8, alignItems:'center' }}>
          <input type="checkbox"/> Enable automatic top-up when balance is low
        </label>
      </div>
    </div>
  );
}

// ── A: Statement — the wallet as a clean financial statement ─────────────
function ProfileStatement() {
  const tabs = ['Balance', 'Activity', 'Earnings', 'Settings'];
  const [tab, setTab] = React.useState('Balance');
  const max = Math.max(...PR_SPEND);

  return (
    <div style={{ background:'#fff', height:'100%', overflow:'auto' }}>
      {/* Identity strip */}
      <div style={{ padding:'24px 32px 0', display:'flex', alignItems:'center', gap: 16 }}>
        <div style={{ width: 56, height: 56, borderRadius: 9999, background:'#0a0a0a', color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'var(--ul-font-mono)', fontWeight: 700, fontSize: 18, letterSpacing:'-0.02em' }}>R</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 700, letterSpacing:'-0.02em' }}>russellin49</div>
          <div style={{ fontSize: 12, color: PR_C.sec, fontFamily:'var(--ul-font-mono)' }}>active since feb 2026 · 4 published · 0 acquired</div>
        </div>
        <button style={{ fontSize: 12, color: PR_C.sec, background:'transparent', border:`1px solid ${PR_C.border}`, padding:'6px 12px', borderRadius: 6, cursor:'pointer' }}>Edit profile</button>
      </div>

      <div style={{ padding:'18px 32px 0' }}>
        <div style={{ display:'flex', gap: 0, borderBottom:`1px solid ${PR_C.border}` }}>
          {tabs.map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ padding:'10px 0', marginRight: 22, fontSize: 13, fontWeight: 500, border:'none', cursor:'pointer', background:'transparent', color: tab === t ? PR_C.text : PR_C.mute, borderBottom: tab === t ? `2px solid ${PR_C.text}` : '2px solid transparent', position:'relative', top: 1 }}>{t}</button>
          ))}
        </div>
      </div>

      {tab === 'Balance' && (
      <div style={{ padding:'24px 32px 32px' }}>
        {/* Hero balance */}
        <div style={{ display:'grid', gridTemplateColumns:'1.4fr 1fr', gap: 14, marginBottom: 14 }}>
          <div style={{ background: PR_C.raised, border:`1px solid ${PR_C.border}`, borderRadius: 14, padding: 22 }}>
            <div style={{ fontSize: 10, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.06em', textTransform:'uppercase', color: PR_C.mute }}>Available</div>
            <div style={{ fontSize: 44, fontWeight: 700, letterSpacing:'-0.025em', display:'flex', alignItems:'baseline', gap: 4, lineHeight: 1.05, marginTop: 4 }}>
              <span style={{ fontWeight: 500 }}>✦</span>798<span style={{ fontSize: 22, color: PR_C.mute, fontWeight: 500 }}>,032</span>
            </div>
            <div style={{ fontSize: 12, color: PR_C.sec, marginTop: 6 }}>spendable. Earnings withdraw separately.</div>
            <div style={{ display:'flex', gap: 8, marginTop: 16 }}>
              <button style={{ background: PR_C.text, color:'#fff', border:'none', padding:'8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor:'pointer' }}>+ Add Light</button>
              <button style={{ background:'transparent', color: PR_C.text, border:`1px solid ${PR_C.border}`, padding:'8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor:'pointer' }}>Auto top-up · ✦5</button>
            </div>
          </div>
          <div style={{ background:'#fff', border:`1px solid ${PR_C.border}`, borderRadius: 14, padding: 22, display:'flex', flexDirection:'column', justifyContent:'space-between' }}>
            <div>
              <div style={{ fontSize: 10, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.06em', textTransform:'uppercase', color: PR_C.mute }}>Last 7 days</div>
              <div style={{ fontSize: 22, fontWeight: 700, letterSpacing:'-0.02em', marginTop: 2, fontVariantNumeric:'tabular-nums' }}>✦{PR_SPEND.reduce((s,x)=>s+x,0).toFixed(3)}</div>
            </div>
            <div style={{ display:'flex', alignItems:'flex-end', gap: 4, height: 50, marginTop: 12 }}>
              {PR_SPEND.map((v, i) => (
                <div key={i} style={{ flex: 1, height: `${(v/max)*100}%`, background: i === PR_SPEND.length-1 ? PR_C.text : 'rgba(0,0,0,0.18)', borderRadius: 2, transition:'height 200ms' }}/>
              ))}
            </div>
            <div style={{ display:'flex', justifyContent:'space-between', fontSize: 9, fontFamily:'var(--ul-font-mono)', color: PR_C.mute, marginTop: 4 }}>
              {['M','T','W','T','F','S','S'].map((d,i) => <span key={i}>{d}</span>)}
            </div>
          </div>
        </div>

        {/* Activity feed */}
        <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', marginTop: 12, marginBottom: 6 }}>
          <div style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.06em', textTransform:'uppercase', color: PR_C.mute }}>Recent activity</div>
          <span style={{ fontSize: 11, color: PR_C.sec, cursor:'pointer' }}>Full statement →</span>
        </div>
        {PR_TXNS.map((day, di) => (
          <div key={di} style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, fontFamily:'var(--ul-font-mono)', color: PR_C.mute, padding:'10px 0 4px', letterSpacing:'0.06em', textTransform:'uppercase' }}>{day.day}</div>
            {day.items.map((tx, i) => (
              <div key={i} style={{ display:'grid', gridTemplateColumns:'46px 140px 1fr 90px', gap: 12, alignItems:'center', padding:'10px 0', borderTop:`1px solid ${PR_C.border}`, fontSize: 13 }}>
                <span style={{ fontSize: 10, fontFamily:'var(--ul-font-mono)', color: PR_C.mute }}>{tx.t}</span>
                <span style={{ color: PR_C.sec, fontSize: 12, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{tx.who}</span>
                <span style={{ color: PR_C.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{tx.act}</span>
                <span style={{ textAlign:'right', fontFamily:'var(--ul-font-mono)', fontSize: 13, color: tx.d > 0 ? PR_C.green : PR_C.text, fontWeight: 500, fontVariantNumeric:'tabular-nums' }}>
                  {tx.d > 0 ? '+' : '−'}✦{Math.abs(tx.d).toFixed(3)}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
      )}

      {tab === 'Earnings' && (
      <div style={{ padding:'24px 32px 32px' }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap: 12, marginBottom: 18 }}>
          {[
            { l:'Lifetime', v:'0', tone: PR_C.text },
            { l:'Last 30d', v:'0', tone: PR_C.text },
            { l:'Withdrawn', v:'0', tone: PR_C.sec },
            { l:'Withdrawable', v:'0', tone: PR_C.green },
          ].map(s => (
            <div key={s.l} style={{ background: PR_C.raised, border:`1px solid ${PR_C.border}`, borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 10, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.06em', textTransform:'uppercase', color: PR_C.mute }}>{s.l}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: s.tone, fontVariantNumeric:'tabular-nums', letterSpacing:'-0.02em', marginTop: 4 }}>✦{s.v}</div>
            </div>
          ))}
        </div>
        <div style={{ background: PR_C.raised, border:`1px solid ${PR_C.border}`, borderRadius: 12, padding: 18, display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: 18 }}>
          <div>
            <div style={{ display:'flex', alignItems:'center', gap: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Bank payouts</div>
              <span style={{ fontSize: 10, fontFamily:'var(--ul-font-mono)', color:'#dc2626', background:'rgba(239,68,68,0.08)', padding:'2px 6px', borderRadius: 4, letterSpacing:'0.06em', textTransform:'uppercase' }}>Not connected</span>
            </div>
            <div style={{ fontSize: 12, color: PR_C.sec, marginTop: 4 }}>Connect a bank to withdraw earnings. Deposits stay in-app.</div>
          </div>
          <button style={{ background: PR_C.text, color:'#fff', border:'none', padding:'8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor:'pointer' }}>Connect bank</button>
        </div>
        <div style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.06em', textTransform:'uppercase', color: PR_C.mute, marginBottom: 6 }}>Published tools</div>
        {PR_PUBLISHED.map((p, i) => (
          <div key={i} style={{ display:'grid', gridTemplateColumns:'40px 1fr 90px 60px', gap: 14, alignItems:'center', padding:'12px 0', borderTop:`1px solid ${PR_C.border}`, fontSize: 13 }}>
            <PR_Glyph glyph={p.glyph} tone={p.tone} size={32}/>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</div>
              <div style={{ fontSize: 11, color: PR_C.sec, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.desc}</div>
            </div>
            <div style={{ textAlign:'right', fontSize: 11, fontFamily:'var(--ul-font-mono)', color: PR_C.sec }}>{p.when} · {p.v}</div>
            <div style={{ textAlign:'right', fontFamily:'var(--ul-font-mono)', fontSize: 13, color: PR_C.mute, fontVariantNumeric:'tabular-nums' }}>✦0</div>
          </div>
        ))}
      </div>
      )}

      {tab === 'Activity' && (
      <div style={{ padding:'24px 32px 32px' }}>
        <div style={{ fontSize: 13, color: PR_C.sec, marginBottom: 14 }}>Every transaction. Spend, top-ups, earnings, refunds.</div>
        {PR_TXNS.flatMap(d => d.items.map((it, i) => ({ ...it, day: d.day }))).map((tx, i) => (
          <div key={i} style={{ display:'grid', gridTemplateColumns:'80px 50px 140px 1fr 90px', gap: 12, alignItems:'center', padding:'12px 0', borderTop:`1px solid ${PR_C.border}`, fontSize: 13 }}>
            <span style={{ fontSize: 10, fontFamily:'var(--ul-font-mono)', color: PR_C.mute, letterSpacing:'0.04em', textTransform:'uppercase' }}>{tx.day}</span>
            <span style={{ fontSize: 10, fontFamily:'var(--ul-font-mono)', color: PR_C.mute }}>{tx.t}</span>
            <span style={{ color: PR_C.sec, fontSize: 12, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{tx.who}</span>
            <span style={{ color: PR_C.text }}>{tx.act}</span>
            <span style={{ textAlign:'right', fontFamily:'var(--ul-font-mono)', fontSize: 13, color: tx.d > 0 ? PR_C.green : PR_C.text, fontWeight: 500, fontVariantNumeric:'tabular-nums' }}>
              {tx.d > 0 ? '+' : '−'}✦{Math.abs(tx.d).toFixed(3)}
            </span>
          </div>
        ))}
      </div>
      )}

      {tab === 'Settings' && (
      <div style={{ padding:'24px 32px 32px' }}>
        <ProfileSettingsBody/>
      </div>
      )}
    </div>
  );
}

// Inner settings body — used by both Statement (Settings tab) and Console.
function ProfileSettingsBody() {
  return (
    <>
      <div style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.06em', textTransform:'uppercase', color: PR_C.mute, marginBottom: 6 }}>API key</div>
      <div style={{ background: PR_C.raised, border:`1px solid ${PR_C.border}`, borderRadius: 12, padding: 16, marginBottom: 18 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap: 12 }}>
          <code style={{ fontFamily:'var(--ul-font-mono)', fontSize: 13, color: PR_C.text, padding:'8px 12px', background:'#fff', border:`1px solid ${PR_C.border}`, borderRadius: 6, flex: 1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>ul_13cb77c45ba9e73d62b8dea5297a8e90</code>
          <button style={{ background: PR_C.text, color:'#fff', border:'none', padding:'8px 14px', borderRadius: 6, fontSize: 12, fontWeight: 500, cursor:'pointer' }}>Copy</button>
          <button style={{ background:'transparent', color: PR_C.sec, border:`1px solid ${PR_C.border}`, padding:'8px 12px', borderRadius: 6, fontSize: 12, cursor:'pointer' }}>Regenerate</button>
        </div>
        <div style={{ fontSize: 11, color: PR_C.mute, fontFamily:'var(--ul-font-mono)', marginTop: 8 }}>created 3/11/26 · last used just now</div>
      </div>

      <div style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.06em', textTransform:'uppercase', color: PR_C.mute, marginBottom: 6 }}>Auto-approve threshold</div>
      <div style={{ background: PR_C.raised, border:`1px solid ${PR_C.border}`, borderRadius: 12, padding: 16, marginBottom: 18, display:'flex', alignItems:'center', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>Tools cheaper than this run without asking</div>
          <div style={{ fontSize: 12, color: PR_C.sec, marginTop: 2 }}>Anything above prompts you. Set to 0 to confirm every call.</div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap: 6, padding:'6px 12px', background:'#fff', border:`1px solid ${PR_C.border}`, borderRadius: 8 }}>
          <span style={{ fontFamily:'var(--ul-font-mono)', fontSize: 14 }}>✦</span>
          <input defaultValue="25" style={{ width: 38, border:'none', outline:'none', fontFamily:'var(--ul-font-mono)', fontSize: 14, fontWeight: 600, textAlign:'right', color: PR_C.text, background:'transparent' }}/>
        </div>
      </div>

      <div style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.06em', textTransform:'uppercase', color: PR_C.mute, marginBottom: 6 }}>Bring your own AI keys</div>
      <div style={{ border:`1px solid ${PR_C.border}`, borderRadius: 12, overflow:'hidden' }}>
        {[
          { name:'OpenRouter', sub:'sk-or-•••••••••••••', state:'primary' },
          { name:'Anthropic',  sub:'Claude models direct', state:'add' },
          { name:'OpenAI',     sub:'GPT models direct',    state:'add' },
        ].map((k, i) => (
          <div key={i} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 16px', borderTop: i ? `1px solid ${PR_C.border}` : 'none', background: i % 2 === 0 ? PR_C.raised : '#fff' }}>
            <div>
              <div style={{ display:'flex', alignItems:'center', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{k.name}</span>
                {k.state === 'primary' && <span style={{ fontSize: 9, fontFamily:'var(--ul-font-mono)', color:'#fff', background: PR_C.text, padding:'2px 6px', borderRadius: 4, letterSpacing:'0.06em', textTransform:'uppercase' }}>Primary</span>}
              </div>
              <div style={{ fontSize: 12, color: PR_C.sec, fontFamily: k.state === 'primary' ? 'var(--ul-font-mono)' : 'inherit', marginTop: 2 }}>{k.sub}</div>
            </div>
            {k.state === 'primary'
              ? <button style={{ background:'transparent', color:'#dc2626', border:`1px solid rgba(220,38,38,0.3)`, padding:'6px 12px', borderRadius: 6, fontSize: 12, cursor:'pointer' }}>Remove</button>
              : <button style={{ background:'transparent', color: PR_C.text, border:`1px solid ${PR_C.border}`, padding:'6px 12px', borderRadius: 6, fontSize: 12, cursor:'pointer' }}>+ Add key</button>}
          </div>
        ))}
      </div>
    </>
  );
}

// ── B: Console — single-page profile with both wallet AND settings visible
function ProfileConsole() {
  return (
    <div style={{ background:'#fff', height:'100%', overflow:'auto' }}>
      <div style={{ padding:'24px 32px 16px', borderBottom:`1px solid ${PR_C.border}`, display:'flex', alignItems:'center', gap: 18 }}>
        <div style={{ width: 64, height: 64, borderRadius: 9999, background:'#0a0a0a', color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'var(--ul-font-mono)', fontWeight: 700, fontSize: 22 }}>R</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing:'-0.02em' }}>russellin49</div>
          <div style={{ fontSize: 12, color: PR_C.sec, fontFamily:'var(--ul-font-mono)', display:'flex', gap: 14, marginTop: 4 }}>
            <span><span style={{ color: PR_C.text, fontWeight: 600 }}>4</span> published</span>
            <span><span style={{ color: PR_C.text, fontWeight: 600 }}>0</span> acquired</span>
            <span><span style={{ color: PR_C.text, fontWeight: 600 }}>—</span> featured</span>
            <span style={{ color: PR_C.mute }}>· active feb 2026</span>
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'baseline', gap: 4 }}>
          <span style={{ fontSize: 10, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.06em', textTransform:'uppercase', color: PR_C.mute, marginRight: 8 }}>Balance</span>
          <span style={{ fontSize: 28, fontWeight: 700, letterSpacing:'-0.02em', fontVariantNumeric:'tabular-nums' }}>✦798,032</span>
        </div>
      </div>

      <div style={{ padding:'24px 32px', display:'grid', gridTemplateColumns:'2fr 1fr', gap: 18 }}>
        {/* LEFT — wallet + activity */}
        <div>
          <div style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.06em', textTransform:'uppercase', color: PR_C.mute, marginBottom: 10 }}>Last 7 days</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(7, 1fr)', gap: 6, alignItems:'flex-end', marginBottom: 16, height: 80 }}>
            {PR_SPEND.map((v, i) => {
              const max = Math.max(...PR_SPEND);
              return (
                <div key={i} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap: 4 }}>
                  <div style={{ width:'100%', height: `${(v/max)*70}px`, background: i === PR_SPEND.length-1 ? PR_C.text : 'rgba(0,0,0,0.18)', borderRadius: 3 }}/>
                  <span style={{ fontSize: 9, fontFamily:'var(--ul-font-mono)', color: PR_C.mute, fontVariantNumeric:'tabular-nums' }}>{v.toFixed(3)}</span>
                </div>
              );
            })}
          </div>

          <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom: 6 }}>
            <div style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.06em', textTransform:'uppercase', color: PR_C.mute }}>Activity</div>
            <span style={{ fontSize: 11, color: PR_C.sec, cursor:'pointer' }}>Filter ▾</span>
          </div>
          {PR_TXNS.flatMap(d => d.items.map(it => ({ ...it, day: d.day }))).map((tx, i) => (
            <div key={i} style={{ display:'grid', gridTemplateColumns:'70px 1fr 80px', gap: 10, alignItems:'center', padding:'10px 0', borderTop:`1px solid ${PR_C.border}`, fontSize: 13 }}>
              <span style={{ fontSize: 10, fontFamily:'var(--ul-font-mono)', color: PR_C.mute }}>{tx.day} · {tx.t}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: PR_C.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{tx.act}</div>
                <div style={{ fontSize: 11, color: PR_C.sec, fontFamily:'var(--ul-font-mono)' }}>{tx.who}</div>
              </div>
              <span style={{ textAlign:'right', fontFamily:'var(--ul-font-mono)', fontSize: 13, color: tx.d > 0 ? PR_C.green : PR_C.text, fontWeight: 500, fontVariantNumeric:'tabular-nums' }}>{tx.d > 0 ? '+' : '−'}✦{Math.abs(tx.d).toFixed(3)}</span>
            </div>
          ))}
        </div>

        {/* RIGHT — settings/keys/published */}
        <div>
          <div style={{ background: PR_C.raised, border:`1px solid ${PR_C.border}`, borderRadius: 12, padding: 14, marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.06em', textTransform:'uppercase', color: PR_C.mute, marginBottom: 4 }}>Withdrawable earnings</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: PR_C.green, letterSpacing:'-0.02em', fontVariantNumeric:'tabular-nums' }}>✦0</div>
            <button style={{ marginTop: 10, width:'100%', background:'transparent', color: PR_C.text, border:`1px solid ${PR_C.border}`, padding:'8px', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor:'pointer' }}>Connect bank →</button>
          </div>
          <div style={{ background: PR_C.raised, border:`1px solid ${PR_C.border}`, borderRadius: 12, padding: 14, marginBottom: 12 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <div style={{ fontSize: 12, fontWeight: 600 }}>Auto top-up</div>
              <span style={{ width: 28, height: 16, borderRadius: 9999, background: PR_C.text, position:'relative', flexShrink: 0 }}>
                <span style={{ position:'absolute', right: 2, top: 2, width: 12, height: 12, borderRadius: 9999, background:'#fff' }}/>
              </span>
            </div>
            <div style={{ fontSize: 11, color: PR_C.sec, marginTop: 4 }}>Refill ✦100 when balance dips under ✦5.</div>
          </div>
          <div style={{ background: PR_C.raised, border:`1px solid ${PR_C.border}`, borderRadius: 12, padding: 14, marginBottom: 12 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600 }}>API key</div>
              <span style={{ fontSize: 9, fontFamily:'var(--ul-font-mono)', color: PR_C.mute, letterSpacing:'0.06em', textTransform:'uppercase' }}>Last used now</span>
            </div>
            <code style={{ display:'block', fontFamily:'var(--ul-font-mono)', fontSize: 11, color: PR_C.sec, padding:'6px 10px', background:'#fff', border:`1px solid ${PR_C.border}`, borderRadius: 6, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>ul_13cb77c45ba9e73d62b8dea5297a8e90</code>
          </div>
          <div style={{ background: PR_C.raised, border:`1px solid ${PR_C.border}`, borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>AI keys</div>
            {[{n:'OpenRouter',p:true},{n:'Anthropic'},{n:'OpenAI'}].map((k,i) => (
              <div key={i} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'6px 0', borderTop: i ? `1px solid ${PR_C.border}` : 'none' }}>
                <div style={{ display:'flex', alignItems:'center', gap: 8 }}>
                  <span style={{ width: 6, height: 6, borderRadius: 9999, background: k.p ? PR_C.green : PR_C.mute }}/>
                  <span style={{ fontSize: 12 }}>{k.n}</span>
                </div>
                <span style={{ fontSize: 10, fontFamily:'var(--ul-font-mono)', color: PR_C.sec, cursor:'pointer' }}>{k.p ? 'Primary' : '+ add'}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── C: Receipt — feels like a printed bank statement, dense and quiet ────
function ProfileReceipt() {
  const max = Math.max(...PR_SPEND);
  return (
    <div style={{ background:'#fff', height:'100%', overflow:'auto', fontFamily:'var(--ul-font-sans)' }}>
      <div style={{ padding:'28px 36px', borderBottom:`1px dashed ${PR_C.border}` }}>
        <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between' }}>
          <div style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.1em', textTransform:'uppercase', color: PR_C.mute }}>Statement · russellin49</div>
          <div style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', color: PR_C.mute }}>Mar 1 – Mar 7, 2026</div>
        </div>
        <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between', marginTop: 14 }}>
          <div>
            <div style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.06em', textTransform:'uppercase', color: PR_C.mute }}>Closing balance</div>
            <div style={{ fontSize: 48, fontWeight: 700, letterSpacing:'-0.025em', fontVariantNumeric:'tabular-nums', lineHeight: 1, marginTop: 6 }}>✦798,032<span style={{ fontSize: 18, color: PR_C.mute, fontWeight: 500 }}>.412</span></div>
          </div>
          <div style={{ display:'flex', gap: 28 }}>
            {[
              { l:'Spend (7d)', v:'-✦0.213' },
              { l:'Top-up (7d)', v:'+✦75.000' },
              { l:'Earned (7d)', v:'✦0' },
            ].map((s,i) => (
              <div key={i} style={{ textAlign:'right' }}>
                <div style={{ fontSize: 9, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.06em', textTransform:'uppercase', color: PR_C.mute }}>{s.l}</div>
                <div style={{ fontSize: 16, fontWeight: 600, fontFamily:'var(--ul-font-mono)', fontVariantNumeric:'tabular-nums', marginTop: 2 }}>{s.v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ padding:'18px 36px', borderBottom:`1px dashed ${PR_C.border}` }}>
        <div style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.06em', textTransform:'uppercase', color: PR_C.mute, marginBottom: 14 }}>Daily spend</div>
        <div style={{ display:'flex', alignItems:'flex-end', gap: 10, height: 70 }}>
          {PR_SPEND.map((v, i) => (
            <div key={i} style={{ flex: 1, display:'flex', flexDirection:'column', alignItems:'center', gap: 6 }}>
              <span style={{ fontSize: 9, fontFamily:'var(--ul-font-mono)', color: PR_C.mute, fontVariantNumeric:'tabular-nums' }}>{v.toFixed(3)}</span>
              <div style={{ width:'100%', height:`${(v/max)*50}px`, background: PR_C.text, borderRadius: 1 }}/>
              <span style={{ fontSize: 9, fontFamily:'var(--ul-font-mono)', color: PR_C.mute }}>{['MON','TUE','WED','THU','FRI','SAT','SUN'][i]}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding:'18px 36px', borderBottom:`1px dashed ${PR_C.border}` }}>
        <div style={{ display:'grid', gridTemplateColumns:'90px 50px 150px 1fr 100px', gap: 12, padding:'4px 0 8px', borderBottom:`1px solid ${PR_C.border}`, fontSize: 9, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.08em', textTransform:'uppercase', color: PR_C.mute }}>
          <div>Date</div><div>Time</div><div>Source</div><div>Memo</div><div style={{ textAlign:'right' }}>Amount</div>
        </div>
        {PR_TXNS.flatMap(d => d.items.map(it => ({ ...it, day: d.day }))).map((tx, i) => (
          <div key={i} style={{ display:'grid', gridTemplateColumns:'90px 50px 150px 1fr 100px', gap: 12, padding:'10px 0', borderBottom: i < 5 ? `1px solid rgba(0,0,0,0.04)` : 'none', fontSize: 12, alignItems:'center' }}>
            <span style={{ fontFamily:'var(--ul-font-mono)', color: PR_C.sec, letterSpacing:'0.04em', textTransform:'uppercase', fontSize: 10 }}>{tx.day}</span>
            <span style={{ fontFamily:'var(--ul-font-mono)', color: PR_C.mute, fontSize: 10 }}>{tx.t}</span>
            <span style={{ fontFamily:'var(--ul-font-mono)', color: PR_C.text, fontSize: 11 }}>{tx.who}</span>
            <span style={{ color: PR_C.sec, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{tx.act}</span>
            <span style={{ textAlign:'right', fontFamily:'var(--ul-font-mono)', fontWeight: 600, fontVariantNumeric:'tabular-nums', color: tx.d > 0 ? PR_C.green : PR_C.text }}>{tx.d > 0 ? '+' : '−'}✦{Math.abs(tx.d).toFixed(3)}</span>
          </div>
        ))}
      </div>

      <div style={{ padding:'14px 36px 28px', display:'flex', justifyContent:'space-between', alignItems:'center', fontSize: 10, fontFamily:'var(--ul-font-mono)', color: PR_C.mute, letterSpacing:'0.06em', textTransform:'uppercase' }}>
        <span>End of statement</span>
        <span>·  ·  ·</span>
        <span>Auto-approve threshold ✦25 · API key ul_13cb…a8e90</span>
      </div>
    </div>
  );
}

// ── D: Internal config — 3A structure refined per feedback ──────────────
// - No "Activity" tab (redundant with Recent activity feed in Balance)
// - No "Edit profile" button (this is internal; external profile lives elsewhere)
// - 3B-style identity strip: balance pinned top-right
// - 3B-style "Last 7 days" full-width with values under bars
// - 3A-style recent activity rows with 3C-style column headers
function ProfileStatementD() {
  const tabs = ['Balance', 'Earnings', 'Settings'];
  const [tab, setTab] = React.useState('Balance');
  const [addOpen, setAddOpen] = React.useState(false);
  const max = Math.max(...PR_SPEND);
  const flat = PR_TXNS.flatMap(d => d.items.map(it => ({ ...it, day: d.day })));

  return (
    <div style={{ background:'#fff', height:'100%', position:'relative', overflow:'hidden' }}>
      <div style={{ height:'100%', overflow:'auto' }}>
      {/* Identity strip + segmented tabs (Tools-page pattern) */}
      <div style={{ padding:'24px 32px 8px', display:'flex', alignItems:'center', gap: 16 }}>
        <div style={{ width: 56, height: 56, borderRadius: 9999, background:'#0a0a0a', color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'var(--ul-font-mono)', fontWeight: 700, fontSize: 18, letterSpacing:'-0.02em' }}>R</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 700, letterSpacing:'-0.02em' }}>russellin49</div>
          <div style={{ fontSize: 12, color: PR_C.sec, fontFamily:'var(--ul-font-mono)' }}>active since feb 2026 · 4 published · 0 acquired</div>
        </div>
        <div style={{ display:'flex', gap: 6 }}>
          {tabs.map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ fontSize: 12, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.04em', textTransform:'uppercase', padding:'6px 12px', borderRadius: 6, border: tab === t ? `1px solid ${PR_C.text}` : `1px solid ${PR_C.border}`, cursor:'pointer', background: tab === t ? PR_C.text : '#fff', color: tab === t ? '#fff' : PR_C.sec }}>{t}</button>
          ))}
        </div>
      </div>

      {tab === 'Balance' && (
      <div style={{ padding:'0 32px 32px' }}>
        {/* Balance + stacked buttons on left, Last 7 days on right */}
        <div style={{ display:'grid', gridTemplateColumns:'1.4fr 1fr', gap: 20, alignItems:'center', paddingBottom: 16, marginBottom: 14 }}>
          {/* LEFT — balance number with single Add Light button to its right (vertically centered) */}
          <div style={{ display:'flex', alignItems:'center', gap: 22, paddingLeft: 72 }}>
            <div>
              <div style={{ fontSize: 48, fontWeight: 700, letterSpacing:'-0.025em', lineHeight: 1.05, display:'inline-block' }}>
                <span style={{ marginRight: 12, fontWeight: 500 }}>✦</span>798<span style={{ color: PR_C.mute, fontWeight: 500 }}>,032</span>
              </div>
              <div style={{ fontSize: 12, color: PR_C.mute, marginTop: 8, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.02em', paddingLeft: 44 }}>available to spend</div>
            </div>
            <button onClick={() => setAddOpen(true)} style={{ background:'#fff', color: PR_C.text, border:`1px solid ${PR_C.text}`, padding:'10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor:'pointer', whiteSpace:'nowrap' }}>+ Add Light</button>
          </div>

          {/* RIGHT — Last 7 days, plain */}
          <div style={{ display:'flex', flexDirection:'column', marginTop: 18, marginLeft: -80 }}>
            <div style={{ fontSize: 10, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.06em', textTransform:'uppercase', color: PR_C.mute, marginBottom: 12 }}>Last 7 days</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(7, 1fr)', gap: 8, alignItems:'flex-end', flex: 1, minHeight: 80 }}>
              {PR_SPEND.map((v, i) => (
                <div key={i} style={{ display:'flex', flexDirection:'column', alignItems:'stretch', justifyContent:'flex-end', height:'100%' }}>
                  <div style={{ width:'100%', height: `${(v/max)*100}%`, background: i === PR_SPEND.length-1 ? PR_C.text : 'rgba(0,0,0,0.18)', borderRadius: 3 }}/>
                </div>
              ))}
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(7, 1fr)', gap: 8, marginTop: 6 }}>
              {PR_SPEND.map((v, i) => (
                <div key={i} style={{ fontSize: 10, fontFamily:'var(--ul-font-mono)', color: PR_C.mute, fontVariantNumeric:'tabular-nums', textAlign:'center' }}>{v.toFixed(3)}</div>
              ))}
            </div>
          </div>
        </div>

        {/* Recent activity — column headers only, no "RECENT ACTIVITY" label */}

        <div style={{ paddingLeft: 72 }}>
        {/* Column headers — 3C style */}
        <div style={{ display:'grid', gridTemplateColumns:'80px 50px 150px 1fr 100px', gap: 12, padding:'8px 0', borderBottom:`1px solid ${PR_C.border}`, fontSize: 9, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.08em', textTransform:'uppercase', color: PR_C.mute }}>
          <div>Date</div><div>Time</div><div>Source</div><div>Memo</div><div style={{ textAlign:'right' }}>Amount</div>
        </div>

        {/* Rows — separator only above day markers (between days) */}
        {PR_TXNS.map((day, di) => (
          day.items.map((tx, i) => (
            <div key={`${di}-${i}`} className="pr-row" style={{ display:'grid', gridTemplateColumns:'80px 50px 150px 1fr 100px', gap: 12, alignItems:'center', padding:'12px 8px', margin:'0 -8px', borderTop: (i === 0 && di > 0) ? `1px solid ${PR_C.border}` : 'none', fontSize: 13 }}>
              <span style={{ fontSize: 10, fontFamily:'var(--ul-font-mono)', color: i === 0 ? PR_C.sec : 'transparent', letterSpacing:'0.04em', textTransform:'uppercase' }}>{day.day}</span>
              <span style={{ fontSize: 10, fontFamily:'var(--ul-font-mono)', color: PR_C.mute }}>{tx.t}</span>
              <span style={{ color: PR_C.sec, fontSize: 12, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{tx.who}</span>
              <span style={{ color: PR_C.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{tx.act}</span>
              <span style={{ textAlign:'right', fontFamily:'var(--ul-font-mono)', fontSize: 13, color: tx.d > 0 ? PR_C.green : PR_C.text, fontWeight: 500, fontVariantNumeric:'tabular-nums' }}>
                ✦{Math.abs(tx.d).toFixed(3)}
              </span>
            </div>
          ))
        ))}
        </div>
      </div>
      )}

      {tab === 'Earnings' && (
      <div style={{ padding:'24px 32px 32px 104px' }}>
        {/* Earnings stats — bordered cells (full perimeter), no fill, withdrawable in black */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap: 0, marginBottom: 22, border:`1px solid ${PR_C.border}`, borderRadius: 10, overflow:'hidden' }}>
          {[
            { l:'Lifetime', v:'0' },
            { l:'Last 30d', v:'0' },
            { l:'Withdrawn', v:'0' },
            { l:'Withdrawable', v:'0' },
          ].map((s, i) => (
            <div key={s.l} style={{ padding:'18px 20px', borderLeft: i ? `1px solid ${PR_C.border}` : 'none' }}>
              <div style={{ fontSize: 10, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.06em', textTransform:'uppercase', color: PR_C.mute }}>{s.l}</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: PR_C.text, fontVariantNumeric:'tabular-nums', letterSpacing:'-0.02em', marginTop: 6 }}>✦{s.v}</div>
            </div>
          ))}
        </div>

        {/* Tools — single table; no Tool header; no + on acquisition price */}
        <div style={{ display:'grid', gridTemplateColumns:'40px 1fr 130px 130px', gap: 14, padding:'8px 0', borderBottom:`1px solid ${PR_C.border}`, fontSize: 9, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.08em', textTransform:'uppercase', color: PR_C.mute }}>
          <div></div>
          <div></div>
          <div style={{ textAlign:'right' }}>Lifetime earnings</div>
          <div style={{ textAlign:'right' }}>Acquisition price</div>
        </div>
        {[
          { name:'Fitness Tracker', desc:'Log meals, workouts, sleep. AI calorie estimation.', glyph:'FT', tone:'#3b82f6', acquired:false, earned:'1.240',  price: null },
          { name:'Smart Budget',    desc:'Acquired Apr 2026 · Track spending, manage budgets, financial insights.', glyph:'SB', tone:'#004225', acquired:true,  earned:'12.480', price:'250.000' },
          { name:'Reading List',    desc:'Acquired Mar 2026 · Track books, articles, papers. Auto-extract.',         glyph:'RL', tone:'#0a0a0a', acquired:true,  earned:'4.220',  price:'120.000' },
          { name:'Goal Tracker',    desc:'Goals, milestones, progress over time.', glyph:'GT', tone:'#22c55e', acquired:false, earned:'0.560',  price: null },
        ].map((p, i) => (
          <div key={i} className="pr-row" style={{ display:'grid', gridTemplateColumns:'40px 1fr 130px 130px', gap: 14, alignItems:'center', padding:'12px 8px', margin:'0 -8px', fontSize: 13 }}>
            <PR_Glyph glyph={p.glyph} tone={p.tone} size={32}/>
            <div style={{ minWidth: 0 }}>
              <div style={{ display:'flex', alignItems:'center', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</span>
                {p.acquired && <span style={{ fontSize: 9, fontFamily:'var(--ul-font-mono)', color: PR_C.sec, border:`1px solid ${PR_C.border}`, padding:'1px 6px', borderRadius: 4, letterSpacing:'0.06em', textTransform:'uppercase' }}>Acquired</span>}
              </div>
              <div style={{ fontSize: 11, color: PR_C.sec, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginTop: 2 }}>{p.desc}</div>
            </div>
            <div style={{ textAlign:'right', fontFamily:'var(--ul-font-mono)', fontSize: 13, color: PR_C.text, fontVariantNumeric:'tabular-nums', fontWeight: 500 }}>✦{p.earned}</div>
            <div style={{ textAlign:'right', fontFamily:'var(--ul-font-mono)', fontSize: 13, color: p.price ? PR_C.text : PR_C.mute, fontVariantNumeric:'tabular-nums', fontWeight: 500 }}>{p.price ? `✦${p.price}` : '—'}</div>
          </div>
        ))}
      </div>
      )}

      {tab === 'Settings' && (
      <div style={{ padding:'24px 32px 32px 104px' }}>
        <ProfileSettingsBodyD/>
      </div>
      )}
      </div>
      {addOpen && <AddLightModal onClose={() => setAddOpen(false)}/>}
    </div>
  );
}

// Settings body for D — no card backgrounds; auto-approve is a switch + value
function ProfileSettingsBodyD() {
  const [autoApprove, setAutoApprove] = React.useState(true);
  const [threshold, setThreshold] = React.useState('25');
  return (
    <>
      {/* API key */}
      <div style={{ marginBottom: 40 }}>
        <div style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.06em', textTransform:'uppercase', color: PR_C.mute, marginBottom: 10 }}>API key</div>
        <div style={{ display:'flex', alignItems:'center', gap: 10 }}>
          <code style={{ fontFamily:'var(--ul-font-mono)', fontSize: 13, color: PR_C.text, padding:'8px 12px', border:`1px solid ${PR_C.border}`, borderRadius: 6, flex: 1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>ul_13cb77c45ba9e73d62b8dea5297a8e90</code>
          <button style={{ background: PR_C.text, color:'#fff', border:'none', padding:'8px 14px', borderRadius: 6, fontSize: 12, fontWeight: 500, cursor:'pointer' }}>Copy</button>
          <button style={{ background:'transparent', color: PR_C.sec, border:`1px solid ${PR_C.border}`, padding:'8px 12px', borderRadius: 6, fontSize: 12, cursor:'pointer' }}>Regenerate</button>
        </div>
        <div style={{ fontSize: 11, color: PR_C.mute, fontFamily:'var(--ul-font-mono)', marginTop: 8 }}>created 3/11/26 · last used just now</div>
      </div>

      {/* Bank payouts — connect + request withdraw */}
      <div style={{ marginBottom: 40 }}>
        <div style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.06em', textTransform:'uppercase', color: PR_C.mute, marginBottom: 10 }}>Bank payouts</div>
        <div style={{ display:'flex', alignItems:'center', gap: 14 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display:'flex', alignItems:'center', gap: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>No bank connected</div>
              <span style={{ fontSize: 9, fontFamily:'var(--ul-font-mono)', color: PR_C.sec, background:'rgba(0,0,0,0.05)', padding:'2px 6px', borderRadius: 4, letterSpacing:'0.06em', textTransform:'uppercase' }}>Required for withdraw</span>
            </div>
            <div style={{ fontSize: 12, color: PR_C.sec, marginTop: 2 }}>Connect a bank to withdraw earnings. Withdrawable: <span style={{ fontFamily:'var(--ul-font-mono)' }}>✦0</span>.</div>
          </div>
          <div style={{ display:'flex', gap: 8 }}>
            <button style={{ background: PR_C.text, color:'#fff', border:'none', padding:'8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor:'pointer' }}>Connect bank</button>
            <button disabled style={{ background:'transparent', color: PR_C.mute, border:`1px solid ${PR_C.border}`, padding:'8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor:'not-allowed' }}>Request withdraw</button>
          </div>
        </div>
      </div>

      {/* Auto-approve threshold — switch + value */}
      <div style={{ marginBottom: 40 }}>
        <div style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.06em', textTransform:'uppercase', color: PR_C.mute, marginBottom: 10 }}>Auto-approve threshold</div>
        <div style={{ display:'flex', alignItems:'center', gap: 14 }}>
          {/* Switch */}
          <button onClick={() => setAutoApprove(v => !v)} aria-pressed={autoApprove} style={{ width: 36, height: 20, borderRadius: 9999, background: autoApprove ? PR_C.text : 'rgba(0,0,0,0.18)', position:'relative', flexShrink: 0, border:'none', padding: 0, cursor:'pointer', transition:'background 150ms' }}>
            <span style={{ position:'absolute', left: autoApprove ? 18 : 2, top: 2, width: 16, height: 16, borderRadius: 9999, background:'#fff', transition:'left 150ms', boxShadow:'0 1px 2px rgba(0,0,0,0.2)' }}/>
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>Auto-approve tools under a cost threshold</div>
            <div style={{ fontSize: 12, color: PR_C.sec, marginTop: 2 }}>{autoApprove ? 'Tools cheaper than the threshold run without asking. Anything above prompts you.' : 'Every tool call requires your approval.'}</div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap: 6, padding:'6px 12px', border:`1px solid ${PR_C.border}`, borderRadius: 8, opacity: autoApprove ? 1 : 0.4 }}>
            <span style={{ fontFamily:'var(--ul-font-mono)', fontSize: 14 }}>✦</span>
            <input value={threshold} onChange={e => setThreshold(e.target.value.replace(/[^0-9.]/g,''))} disabled={!autoApprove} style={{ width: 38, border:'none', outline:'none', fontFamily:'var(--ul-font-mono)', fontSize: 14, fontWeight: 600, textAlign:'right', color: PR_C.text, background:'transparent' }}/>
          </div>
        </div>
      </div>

      {/* AI keys */}
      <div>
        <div style={{ fontSize: 11, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.06em', textTransform:'uppercase', color: PR_C.mute, marginBottom: 4 }}>Bring your own AI keys</div>
        {[
          { name:'OpenRouter', sub:'sk-or-•••••••••••••', state:'primary' },
          { name:'Anthropic',  sub:'Claude models direct', state:'add' },
          { name:'OpenAI',     sub:'GPT models direct',    state:'add' },
        ].map((k, i) => (
          <div key={i} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 0', borderTop:`1px solid ${PR_C.border}` }}>
            <div>
              <div style={{ display:'flex', alignItems:'center', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{k.name}</span>
                {k.state === 'primary' && <span style={{ fontSize: 9, fontFamily:'var(--ul-font-mono)', color:'#fff', background: PR_C.text, padding:'2px 6px', borderRadius: 4, letterSpacing:'0.06em', textTransform:'uppercase' }}>Primary</span>}
              </div>
              <div style={{ fontSize: 12, color: PR_C.sec, fontFamily: k.state === 'primary' ? 'var(--ul-font-mono)' : 'inherit', marginTop: 2 }}>{k.sub}</div>
            </div>
            {k.state === 'primary'
              ? <button title="Remove" aria-label="Remove" style={{ background:'transparent', color: PR_C.sec, border:'none', padding: 6, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                </button>
              : <button style={{ background:'transparent', color: PR_C.text, border:`1px solid ${PR_C.border}`, padding:'6px 12px', borderRadius: 6, fontSize: 12, cursor:'pointer' }}>+ Add key</button>}
          </div>
        ))}
      </div>
    </>
  );
}

// ── Add Light modal — wraps the 3.5 split-summary form (PUI_AddLightSplit)
// in a centered overlay sized for the two-column layout.
function AddLightModal({ onClose }) {
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const Split = window.PUI_AddLightSplit;
  return (
    <div onClick={onClose}
         style={{ position:'absolute', inset: 0, background:'rgba(10,10,10,0.32)', zIndex: 50, display:'flex', alignItems:'center', justifyContent:'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()}
           style={{ width: 820, maxWidth:'100%', height: 600, maxHeight:'100%', background:'#fff', borderRadius: 14, boxShadow:'0 20px 60px rgba(0,0,0,0.25), 0 0 0 1px rgba(0,0,0,0.06)', overflow:'hidden', position:'relative' }}>
        <button onClick={onClose} aria-label="Close"
                style={{ position:'absolute', top: 14, right: 14, background:'transparent', border:'none', padding: 4, cursor:'pointer', color: PR_C.sec, lineHeight: 0, zIndex: 2 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        {Split ? <Split/> : <div style={{ padding: 24, fontSize: 12, color: PR_C.sec }}>Loading…</div>}
      </div>
    </div>
  );
}

// (legacy form kept for reference; superseded by AddLightModal above)
function AddLightForm_legacy({ onClose }) {
  // 1 ✦ Light = 1 cent. Amounts displayed/summarized with k/m, no decimals.
  const EARNINGS_BAL = 24800;       // ✦ available in Earnings pool (~$248)
  const PRESETS = [1000, 5000, 10000, 50000, 100000, 500000];
  const [method, setMethod] = React.useState('transfer'); // 'transfer' | 'wallet' | 'wire'
  const [amount, setAmount] = React.useState('25000');
  const [autoRoute, setAutoRoute] = React.useState(false);

  const numAmount = parseInt(amount, 10) || 0;
  const overEarnings = method === 'transfer' && numAmount > EARNINGS_BAL;
  const submitDisabled = numAmount <= 0 || overEarnings;

  // Format ✦ amount as k / m, no decimals.
  // 1234 → "1k", 25000 → "25k", 1500000 → "2m"
  const fmtL = (n) => {
    if (n >= 1_000_000) return `${Math.round(n / 1_000_000)}m`;
    if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
    return String(Math.round(n));
  };
  // USD equivalent for display ($Stripe fees, etc.)
  const fmtUSD = (cents) => {
    const dollars = cents / 100;
    if (dollars >= 1000) return `$${(dollars / 1000).toFixed(dollars >= 10000 ? 0 : 1).replace(/\.0$/,'')}k`;
    if (dollars >= 1) return `$${Math.round(dollars)}`;
    return `$${dollars.toFixed(2)}`;
  };

  const METHOD_LABEL = { transfer: 'Earnings', wallet: 'Apple/Google Pay', wire: 'Bank wire' };

  // ESC to close
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const cardBase = { display:'grid', gridTemplateColumns:'20px 1fr', gap: 14, alignItems:'center', textAlign:'left', width:'100%', padding:'14px 16px', background:'#fff', cursor:'pointer', fontFamily:'inherit', border:'none' };
  const Radio = ({ active }) => (
    <span style={{ width: 16, height: 16, borderRadius: 9999, border: `1.5px solid ${active ? PR_C.text : PR_C.borderStrong}`, display:'inline-flex', alignItems:'center', justifyContent:'center' }}>
      {active && <span style={{ width: 8, height: 8, borderRadius: 9999, background: PR_C.text }}/>}
    </span>
  );

  return (
    <div onClick={onClose}
         style={{ position:'absolute', inset: 0, background:'rgba(10,10,10,0.32)', zIndex: 50, display:'flex', alignItems:'center', justifyContent:'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()}
           style={{ width: 480, maxWidth:'100%', maxHeight:'100%', overflow:'auto', background:'#fff', borderRadius: 14, boxShadow:'0 20px 60px rgba(0,0,0,0.25), 0 0 0 1px rgba(0,0,0,0.06)' }}>

        {/* Header */}
        <div style={{ padding:'18px 22px 14px', display:'flex', alignItems:'flex-start', justifyContent:'space-between', borderBottom:`1px solid ${PR_C.border}` }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, letterSpacing:'-0.02em' }}>Add Light to Balance</div>
            <div style={{ fontSize: 12, color: PR_C.sec, marginTop: 2 }}>Balance is spendable on Ultralight. Earnings withdraw to bank separately.</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background:'transparent', border:'none', padding: 4, marginTop: -2, cursor:'pointer', color: PR_C.sec, lineHeight: 0 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Amount */}
        <div style={{ padding:'18px 22px 8px' }}>
          <div style={{ fontSize: 10, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.08em', textTransform:'uppercase', color: PR_C.mute, marginBottom: 10 }}>Amount</div>
          <div style={{ display:'flex', alignItems:'center', gap: 10, padding:'10px 14px', border:`1px solid ${overEarnings ? PR_C.red : PR_C.borderStrong}`, borderRadius: 10 }}>
            <span style={{ fontSize: 22, color: PR_C.text }}>✦</span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g,''))}
              inputMode="numeric"
              placeholder="0"
              style={{ flex: 1, border:'none', outline:'none', fontFamily:'var(--ul-font-mono)', fontSize: 22, fontWeight: 600, color: PR_C.text, background:'transparent', fontVariantNumeric:'tabular-nums' }}/>
            <span style={{ fontFamily:'var(--ul-font-mono)', fontSize: 12, color: PR_C.mute, letterSpacing:'0.02em' }}>{numAmount > 0 ? `≈ ${fmtUSD(numAmount)}` : ''}</span>
          </div>
          {/* Presets */}
          <div style={{ display:'flex', gap: 6, marginTop: 10, flexWrap:'wrap' }}>
            {PRESETS.map(v => (
              <button key={v} onClick={() => setAmount(String(v))}
                style={{ fontFamily:'var(--ul-font-mono)', fontSize: 11, padding:'5px 10px', border:`1px solid ${PR_C.border}`, borderRadius: 9999, background: numAmount === v ? PR_C.text : '#fff', color: numAmount === v ? '#fff' : PR_C.sec, cursor:'pointer', letterSpacing:'0.02em' }}>
                ✦{fmtL(v)}
              </button>
            ))}
          </div>
          {overEarnings && (
            <div style={{ fontSize: 11, color: PR_C.red, marginTop: 8, fontFamily:'var(--ul-font-mono)' }}>
              Exceeds Earnings balance (✦{fmtL(EARNINGS_BAL)}).
            </div>
          )}
        </div>

        {/* Source — separate cards w/ own radii so the selected fill never clips a corner */}
        <div style={{ padding:'14px 22px 4px' }}>
          <div style={{ fontSize: 10, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.08em', textTransform:'uppercase', color: PR_C.mute, marginBottom: 10 }}>Source</div>
          <div style={{ display:'flex', flexDirection:'column', gap: 8 }}>

            {/* Transfer from Earnings */}
            <button onClick={() => setMethod('transfer')}
                    style={{ ...cardBase, background: method === 'transfer' ? '#fafafa' : '#fff', border:`1px solid ${method === 'transfer' ? PR_C.text : PR_C.border}`, borderRadius: 10 }}>
              <Radio active={method === 'transfer'}/>
              <div>
                <div style={{ display:'flex', alignItems:'center', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: PR_C.text }}>Transfer from Earnings</span>
                  <span style={{ fontSize: 9, fontFamily:'var(--ul-font-mono)', color: PR_C.sec, border:`1px solid ${PR_C.border}`, padding:'1px 6px', borderRadius: 4, letterSpacing:'0.06em', textTransform:'uppercase' }}>Instant</span>
                </div>
                <div style={{ fontSize: 11, color: PR_C.sec, marginTop: 2 }}>
                  Available <span style={{ fontFamily:'var(--ul-font-mono)', color: PR_C.text }}>✦{fmtL(EARNINGS_BAL)}</span> · spent on Ultralight only, not withdrawable to bank.
                </div>
              </div>
            </button>

            {/* Apple / Google Pay */}
            <button onClick={() => setMethod('wallet')}
                    style={{ ...cardBase, background: method === 'wallet' ? '#fafafa' : '#fff', border:`1px solid ${method === 'wallet' ? PR_C.text : PR_C.border}`, borderRadius: 10 }}>
              <Radio active={method === 'wallet'}/>
              <div>
                <div style={{ display:'flex', alignItems:'center', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: PR_C.text }}>Apple Pay or Google Pay</span>
                  <span style={{ fontSize: 9, fontFamily:'var(--ul-font-mono)', color: PR_C.sec, border:`1px solid ${PR_C.border}`, padding:'1px 6px', borderRadius: 4, letterSpacing:'0.06em', textTransform:'uppercase' }}>Stripe · ~2s</span>
                </div>
                <div style={{ fontSize: 11, color: PR_C.sec, marginTop: 2 }}>Charged to your default wallet card. 2.9% + $0.30 fee.</div>
              </div>
            </button>

            {/* Bank wire */}
            <button onClick={() => setMethod('wire')}
                    style={{ ...cardBase, background: method === 'wire' ? '#fafafa' : '#fff', border:`1px solid ${method === 'wire' ? PR_C.text : PR_C.border}`, borderRadius: 10 }}>
              <Radio active={method === 'wire'}/>
              <div>
                <div style={{ display:'flex', alignItems:'center', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: PR_C.text }}>Bank wire (ACH)</span>
                  <span style={{ fontSize: 9, fontFamily:'var(--ul-font-mono)', color: PR_C.sec, border:`1px solid ${PR_C.border}`, padding:'1px 6px', borderRadius: 4, letterSpacing:'0.06em', textTransform:'uppercase' }}>Stripe · 1–3d</span>
                </div>
                <div style={{ fontSize: 11, color: PR_C.sec, marginTop: 2 }}>No card fees ($8 wire fee per transfer). Funds clear in 1–3 business days.</div>
              </div>
            </button>

          </div>
        </div>

        {/* Auto-route earnings */}
        <div style={{ padding:'18px 22px 8px' }}>
          <div style={{ display:'flex', alignItems:'center', gap: 14, padding:'12px 14px', border:`1px solid ${PR_C.border}`, borderRadius: 10, background:'#fafafa' }}>
            <button onClick={() => setAutoRoute(v => !v)} aria-pressed={autoRoute}
                    style={{ width: 36, height: 20, borderRadius: 9999, background: autoRoute ? PR_C.text : 'rgba(0,0,0,0.18)', position:'relative', flexShrink: 0, border:'none', padding: 0, cursor:'pointer', transition:'background 150ms' }}>
              <span style={{ position:'absolute', left: autoRoute ? 18 : 2, top: 2, width: 16, height: 16, borderRadius: 9999, background:'#fff', transition:'left 150ms', boxShadow:'0 1px 2px rgba(0,0,0,0.2)' }}/>
            </button>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: PR_C.text }}>Auto-add earnings to Balance</div>
              <div style={{ fontSize: 11, color: PR_C.sec, marginTop: 2, lineHeight: 1.5 }}>
                New earnings route into Balance as they arrive. Once moved, they can only be spent on Ultralight — not withdrawn to bank.
              </div>
            </div>
          </div>
        </div>

        {/* Footer / actions — single "Add ✦Xk via Y" verb across all methods */}
        <div style={{ padding:'14px 22px 20px', borderTop:`1px solid ${PR_C.border}`, marginTop: 14, display:'flex', alignItems:'center', justifyContent:'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ background:'transparent', color: PR_C.sec, border:`1px solid ${PR_C.border}`, padding:'9px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor:'pointer' }}>Cancel</button>
          <button disabled={submitDisabled}
                  style={{ background: submitDisabled ? 'rgba(0,0,0,0.18)' : PR_C.text, color:'#fff', border:'none', padding:'9px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: submitDisabled ? 'not-allowed' : 'pointer', letterSpacing:'0.01em' }}>
            Add ✦{fmtL(numAmount)} via {METHOD_LABEL[method]}
          </button>
        </div>
      </div>
    </div>
  );
}

window.PUI_ProfileBefore = PUI_ProfileBefore;
window.PUI_ProfileStatement = ProfileStatement;
window.PUI_ProfileConsole = ProfileConsole;
window.PUI_ProfileReceipt = ProfileReceipt;
window.PUI_ProfileStatementD = ProfileStatementD;
