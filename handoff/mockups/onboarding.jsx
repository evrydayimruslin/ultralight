// Platform Guide / first-launch onboarding — before vs after.
//
// BEFORE: faithful recreation of desktop/src/components/OnboardingWizard.tsx.
//   4 screens (Welcome, Apps, Ways, Build), big emoji on cards, dot indicator
//   with skip link. Functional but reads as a generic stepper.
//
// AFTER: a single choreographed Platform Guide.
//   • Hero is iconographic, not emoji — uses the actual platform mark and
//     system-agent icons (the same ones used in NavSidebar / Empty State).
//   • The wordmark types itself in on screen 0 (echo of the empty-state).
//   • The 5 apps, the 2 modes, and the 3 builder roles arrive in staggered
//     waves so each screen feels alive instead of static.
//   • Bottom rhythm bar replaces the dot indicator: 4 segments fill as you
//     progress, so it reads as completion, not just position.
//   • Final screen ends with a live composer the user can type into. The
//     wizard chrome dissolves into chat — onboarding ends where work begins.
//   • Source character mapping: source uses "Tool Maker / Tool Dealer" as
//     the build-and-earn pair; that matches our platform-mark direction
//     (the marketer character has been rebranded "Tool Dealer" in product).

const { C: PUI_OB_C, SYS_AGENTS: PUI_OB_AGENTS, Spark: PUI_OB_Spark, Wordmark: PUI_OB_Wordmark } = window.PUI_Primitives;

// ── BEFORE: faithful, slightly compressed for the artboard ──────────────────
function PUI_Onboarding_Before({ replayKey = 0 }) {
  const [step, setStep] = React.useState(0);

  React.useEffect(() => { setStep(0); }, [replayKey]);

  const SCREENS = ['welcome', 'apps', 'ways', 'build'];

  return (
    <div style={{ position:'absolute', inset: 0, background:'#fff', display:'flex', flexDirection:'column' }}>
      <div style={{ flex: 1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'8px 28px', overflowY:'auto', textAlign:'center' }}>
        {step === 0 && (
          <div style={{ maxWidth: 440 }}>
            <div style={{ width: 48, height: 48, background: PUI_OB_C.text, borderRadius: 14, margin:'0 auto 22px', display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontWeight: 700, fontSize: 20 }}>U</div>
            <div style={{ fontSize: 26, fontWeight: 700, letterSpacing:'-0.02em' }}>Welcome to Ultralight</div>
            <div style={{ fontSize: 14, color: PUI_OB_C.sec, marginTop: 12, lineHeight: 1.55 }}>
              An AI platform where every app works with chat — and anyone can build, share, and sell apps.
            </div>
          </div>
        )}
        {step === 1 && (
          <div style={{ width:'100%', maxWidth: 560 }}>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing:'0.12em', color:'#16a34a', textTransform:'uppercase', marginBottom: 8 }}>Pre-installed</div>
            <div style={{ fontSize: 24, fontWeight: 700, letterSpacing:'-0.02em' }}>Your apps are ready</div>
            <div style={{ fontSize: 13, color: PUI_OB_C.sec, marginTop: 8 }}>Start using them in chat right away.</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap: 10, marginTop: 22 }}>
              {[
                { emoji:'\u2709\uFE0F', name:'Email Ops', desc:'Approval workflows for your inbox' },
                { emoji:'\uD83C\uDF93', name:'Private Tutor', desc:'Quizzes that find your weak spots' },
                { emoji:'\uD83C\uDF73', name:'Recipe Box', desc:'Recipes from what\'s in the fridge' },
              ].map(a => (
                <div key={a.name} style={{ background: PUI_OB_C.raised, borderRadius: 14, padding:'16px 12px', textAlign:'center' }}>
                  <div style={{ fontSize: 30, marginBottom: 8 }}>{a.emoji}</div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{a.name}</div>
                  <div style={{ fontSize: 11, color: PUI_OB_C.mute, marginTop: 4, lineHeight: 1.4 }}>{a.desc}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 12, color: PUI_OB_C.mute, marginTop: 14 }}>
              + Memory Wiki, Smart Budget, Reading List and 15 more in Tools
            </div>
          </div>
        )}
        {step === 2 && (
          <div style={{ width:'100%', maxWidth: 540 }}>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing:'0.12em', color:'#16a34a', textTransform:'uppercase', marginBottom: 8 }}>How it works</div>
            <div style={{ fontSize: 24, fontWeight: 700, letterSpacing:'-0.02em' }}>Two ways to work</div>
            <div style={{ fontSize: 13, color: PUI_OB_C.sec, marginTop: 8 }}>Use your apps through conversation or a live dashboard.</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap: 12, marginTop: 22 }}>
              <div style={{ background: PUI_OB_C.raised, borderRadius: 14, padding: 18, textAlign:'left' }}>
                <div style={{ fontSize: 26, marginBottom: 10 }}>⚙️</div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>Command</div>
                <div style={{ fontSize: 12, color: PUI_OB_C.sec, marginTop: 6, lineHeight: 1.5 }}>Live widgets, approval queues, and activity from everything running in the background.</div>
              </div>
              <div style={{ background: PUI_OB_C.raised, borderRadius: 14, padding: 18, textAlign:'left' }}>
                <div style={{ fontSize: 26, marginBottom: 10 }}>💬</div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>Chat</div>
                <div style={{ fontSize: 12, color: PUI_OB_C.sec, marginTop: 6, lineHeight: 1.5 }}>Talk to AI with all your apps connected. Ask it to use any tool.</div>
              </div>
            </div>
          </div>
        )}
        {step === 3 && (
          <div style={{ width:'100%', maxWidth: 560 }}>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing:'0.12em', color:'#16a34a', textTransform:'uppercase', marginBottom: 8 }}>For builders</div>
            <div style={{ fontSize: 24, fontWeight: 700, letterSpacing:'-0.02em' }}>Build and earn</div>
            <div style={{ fontSize: 13, color: PUI_OB_C.sec, marginTop: 8 }}>
              Every app gets hosting, database, auth, and payments automatically. Just write the logic.
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap: 10, marginTop: 22, textAlign:'left' }}>
              {[
                { emoji:'🔧', t:'Tool Maker', s:'builds it for you' },
                { emoji:'🏫', t:'Tool Dealer', s:'gets it listed' },
                { emoji:'⚡', t:'GPU Runtimes', s:'when you need them' },
              ].map(f => (
                <div key={f.t} style={{ background: PUI_OB_C.raised, borderRadius: 14, padding:'16px 12px' }}>
                  <div style={{ fontSize: 22, marginBottom: 8 }}>{f.emoji}</div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{f.t}</div>
                  <div style={{ fontSize: 11, color: PUI_OB_C.mute }}>{f.s}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {/* Footer */}
      <div style={{ flexShrink: 0, padding:'14px 0 18px', display:'flex', flexDirection:'column', alignItems:'center', gap: 12 }}>
        <div style={{ display:'flex', gap: 8 }}>
          {step === 0 ? (
            <button onClick={() => setStep(1)} style={{ background: PUI_OB_C.text, color:'#fff', border:'none', padding:'9px 22px', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor:'pointer' }}>Get Started</button>
          ) : step < 3 ? (
            <>
              <button onClick={() => setStep(step - 1)} style={{ background:'rgba(0,0,0,0.04)', color: PUI_OB_C.text, border:'none', padding:'9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor:'pointer' }}>Back</button>
              <button onClick={() => setStep(step + 1)} style={{ background: PUI_OB_C.text, color:'#fff', border:'none', padding:'9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor:'pointer' }}>Next</button>
            </>
          ) : (
            <>
              <button style={{ background:'rgba(0,0,0,0.04)', color: PUI_OB_C.text, border:'none', padding:'9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor:'pointer' }}>Explore Tools</button>
              <button style={{ background: PUI_OB_C.text, color:'#fff', border:'none', padding:'9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor:'pointer' }}>Start chatting</button>
            </>
          )}
        </div>
        <div style={{ display:'flex', gap: 6 }}>
          {SCREENS.map((_, i) => (
            <button key={i} onClick={() => setStep(i)} style={{
              width: i === step ? 12 : 6, height: 6, borderRadius: 9999,
              background: i === step ? PUI_OB_C.text : 'rgba(0,0,0,0.14)',
              border:'none', cursor:'pointer', transition:'all 200ms',
            }}/>
          ))}
        </div>
        {step < 3 && (
          <button style={{ background:'transparent', border:'none', color: PUI_OB_C.mute, fontSize: 12, cursor:'pointer' }}>Skip tutorial</button>
        )}
      </div>
    </div>
  );
}

// ── AFTER pieces ────────────────────────────────────────────────────────────

// E3 / platform mark — three dots in a triangle, one accent color highlighted.
function PUI_OB_Mark({ size = 56, accent = null, idx = 0 }) {
  // 3-dot triangle. accent (color) highlights one dot.
  const r = size * 0.11;
  const cx = size / 2;
  const dy = size * 0.18;
  const positions = [
    { x: cx, y: cx - dy * 1.1 },
    { x: cx - dy, y: cx + dy * 0.5 },
    { x: cx + dy, y: cx + dy * 0.5 },
  ];
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display:'block' }}>
      {positions.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={r}
          fill={accent && i === idx ? accent : (accent ? 'rgba(0,0,0,0.16)' : PUI_OB_C.text)}
          style={{ transition:'fill 320ms ease' }}/>
      ))}
    </svg>
  );
}

// Typing wordmark — used on welcome screen.
// Uses the E3 platform mark (three colored agent dots + Light spark + dashed
// orbit) instead of the corporate Spark, so first-launch reads as the product
// constellation, not the wordmark lockup. Tighter icon↔text gap so the mark
// sits right next to "Ultralight" rather than floating to the side.
function PUI_OB_E3Mark({ size = 36 }) {
  // Inline copy of E3 from ui_kits/desktop/Logo.jsx so we don't depend on
  // external script load order. Three colored dots + dashed orbit + light spark.
  const k = 0.28, r = 44, cx = 128, cy = 128;
  const sparkP = [
    [cx, cy - r], [cx + r*k, cy - r*k], [cx + r, cy], [cx + r*k, cy + r*k],
    [cx, cy + r], [cx - r*k, cy + r*k], [cx - r, cy], [cx - r*k, cy - r*k],
  ].map(p => p.join(',')).join(' ');
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" style={{ display:'block' }}>
      <circle cx="128" cy="128" r="84" fill="none" stroke={PUI_OB_C.text} strokeWidth="2" strokeDasharray="2 6"/>
      <circle cx="128" cy="40"  r="12" fill="#004225"/>
      <circle cx="204" cy="174" r="12" fill="#722F37"/>
      <circle cx="52"  cy="174" r="12" fill="#3b82f6"/>
      <polygon points={sparkP} fill={PUI_OB_C.text}/>
    </svg>
  );
}

function PUI_OB_TypingWordmark({ replayKey }) {
  const target = 'Ultralight';
  const [n, setN] = React.useState(0);

  React.useEffect(() => {
    setN(0);
    const t = setInterval(() => {
      setN(prev => {
        if (prev >= target.length) { clearInterval(t); return prev; }
        return prev + 1;
      });
    }, 70);
    return () => clearInterval(t);
  }, [replayKey]);

  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap: 8 }}>
      {/* The E3 mark's viewBox is centered on the spark, but the orbit ring
          and three colored dots extend further than the cap-height of
          "Ultralight" — so flex-center alignment leaves the mark looking
          slightly off. A small positive top margin pulls the spark's
          midline down to the wordmark's optical center. */}
      <span style={{ display:'inline-flex', marginTop: 4 }}>
        <PUI_OB_E3Mark size={42}/>
      </span>
      <span style={{ fontSize: 36, fontWeight: 700, letterSpacing:'-0.03em', lineHeight: 1, color: PUI_OB_C.text }}>
        {target.slice(0, n)}
        {n < target.length && <span style={{ display:'inline-block', width: 2, height: 28, background: PUI_OB_C.text, marginLeft: 2, verticalAlign:'middle', animation:'pui-caret 1s steps(1) infinite' }}/>}
      </span>
    </span>
  );
}

// Reusable staggered tile.
function PUI_OB_Tile({ active, delay, children, style }) {
  return (
    <div style={{
      ...style,
      opacity: active ? 1 : 0,
      transform: active ? 'translateY(0)' : 'translateY(8px)',
      transition: `opacity 480ms cubic-bezier(.2,.9,.3,1) ${delay}ms, transform 480ms cubic-bezier(.2,.9,.3,1) ${delay}ms`,
    }}>{children}</div>
  );
}

// ── AFTER: Platform Guide ───────────────────────────────────────────────────
function PUI_Onboarding_After({ replayKey = 0 }) {
  const [step, setStep] = React.useState(0);
  const [reveal, setReveal] = React.useState(false);
  const [stepKey, setStepKey] = React.useState(0);
  const [draft, setDraft] = React.useState('');
  const [dissolved, setDissolved] = React.useState(false);

  React.useEffect(() => {
    setStep(0); setStepKey(k => k + 1); setDraft(''); setDissolved(false);
  }, [replayKey]);

  React.useEffect(() => {
    setReveal(false);
    const t = setTimeout(() => setReveal(true), 80);
    return () => clearTimeout(t);
  }, [stepKey]);

  const goTo = (n) => {
    setStep(n);
    setStepKey(k => k + 1);
  };

  const STEPS = ['welcome', 'apps', 'ways', 'build'];

  // Pull system-agent icon refs in canonical order:
  // Tool Builder (= Tool Maker), Tool Marketer (= Tool Dealer), Platform Manager (= Platform Guide).
  const builder = PUI_OB_AGENTS[0];
  const dealer = PUI_OB_AGENTS[1];
  const manager = PUI_OB_AGENTS[2];

  // Final dissolve when user types & sends.
  if (dissolved) {
    return (
      <div style={{ position:'absolute', inset: 0, background:'#fff', display:'flex', flexDirection:'column', justifyContent:'center', alignItems:'center', padding: 40, textAlign:'center' }}>
        <PUI_OB_Spark size={32} color={PUI_OB_C.text}/>
        <div style={{ fontSize: 14, fontWeight: 600, marginTop: 12 }}>Tool Builder is on it.</div>
        <div style={{ fontSize: 12, color: PUI_OB_C.mute, marginTop: 6, fontFamily:'var(--ul-font-mono)', maxWidth: 380, lineHeight: 1.5 }}>
          “{draft}”
        </div>
        <button onClick={() => { setDissolved(false); setStep(3); setStepKey(k => k + 1); setDraft(''); }} style={{
          marginTop: 18, fontSize: 11, color: PUI_OB_C.mute, background:'rgba(0,0,0,0.04)',
          border:'none', padding:'6px 12px', borderRadius: 6, cursor:'pointer', fontFamily:'var(--ul-font-mono)',
        }}>↻ replay</button>
      </div>
    );
  }

  return (
    <div style={{ position:'absolute', inset: 0, background:'#fff', display:'flex', flexDirection:'column' }}>
      <div style={{ flex: 1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'8px 28px', overflowY:'auto', textAlign:'center' }}>

        {/* 0 — Welcome: typing wordmark + orbit */}
        {step === 0 && (
          <div key={stepKey} style={{ maxWidth: 480 }}>
            <div style={{
              opacity: reveal ? 1 : 0,
              transform: reveal ? 'translateY(0)' : 'translateY(6px)',
              transition:'opacity 600ms ease, transform 600ms ease',
              marginBottom: 18,
            }}>
              <PUI_OB_TypingWordmark replayKey={stepKey}/>
            </div>
            <PUI_OB_Tile active={reveal} delay={900} style={{}}>
              <div style={{ fontSize: 14, color: PUI_OB_C.sec, lineHeight: 1.6 }}>
                A platform where every app works with chat — and anyone can build, share, and sell apps.
              </div>
            </PUI_OB_Tile>
            <PUI_OB_Tile active={reveal} delay={1200} style={{ marginTop: 24 }}>
              <div style={{ fontSize: 11, color: PUI_OB_C.mute, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.04em' }}>
                4 stops · ~30 seconds
              </div>
            </PUI_OB_Tile>
          </div>
        )}

        {/* 1 — Apps: tiles arrive in waves with the platform mark watermark */}
        {step === 1 && (
          <div key={stepKey} style={{ width:'100%', maxWidth: 580 }}>
            <PUI_OB_Tile active={reveal} delay={0} style={{}}>
              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing:'0.16em', color:'#16a34a', textTransform:'uppercase' }}>Pre-installed · 18 tools</div>
            </PUI_OB_Tile>
            <PUI_OB_Tile active={reveal} delay={120} style={{ marginTop: 8 }}>
              <div style={{ fontSize: 28, fontWeight: 700, letterSpacing:'-0.025em' }}>Your apps are ready.</div>
            </PUI_OB_Tile>
            <PUI_OB_Tile active={reveal} delay={240} style={{ marginTop: 8 }}>
              <div style={{ fontSize: 13, color: PUI_OB_C.sec, lineHeight: 1.55 }}>Start using them in chat right away — every one signed and metered in <span style={{ fontWeight: 600, color: PUI_OB_C.text }}>✦Light</span>.</div>
            </PUI_OB_Tile>

            <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap: 12, marginTop: 24, textAlign:'left' }}>
              {[
                { name:'Email Ops',     desc:'Approval workflows for your inbox',     hue: 0 },
                { name:'Private Tutor', desc:'Quizzes that find your weak spots',     hue: 1 },
                { name:'Recipe Box',    desc:'Recipes from what\'s in the fridge',    hue: 2 },
              ].map((a, i) => (
                <PUI_OB_Tile key={a.name} active={reveal} delay={420 + i * 120} style={{}}>
                  <div style={{
                    background:'#fff', borderRadius: 14, padding: 14,
                    boxShadow:'0 1px 0 rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.05)',
                    display:'flex', flexDirection:'column', gap: 8, height: 130,
                  }}>
                    <PUI_OB_Mark size={28} accent={['#3b82f6', '#722F37', '#004225'][i]} idx={i}/>
                    <div style={{ fontSize: 13, fontWeight: 600, marginTop: 'auto' }}>{a.name}</div>
                    <div style={{ fontSize: 11, color: PUI_OB_C.mute, lineHeight: 1.4 }}>{a.desc}</div>
                  </div>
                </PUI_OB_Tile>
              ))}
            </div>

            <PUI_OB_Tile active={reveal} delay={900} style={{ marginTop: 16 }}>
              <div style={{ fontSize: 11, color: PUI_OB_C.mute, fontFamily:'var(--ul-font-mono)' }}>
                + Memory Wiki · Smart Budget · Reading List · 15 more
              </div>
            </PUI_OB_Tile>
          </div>
        )}

        {/* 2 — Ways: Command + Chat. Both render iconographically. */}
        {step === 2 && (
          <div key={stepKey} style={{ width:'100%', maxWidth: 600 }}>
            <PUI_OB_Tile active={reveal} delay={0} style={{}}>
              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing:'0.16em', color:'#16a34a', textTransform:'uppercase' }}>How it works</div>
            </PUI_OB_Tile>
            <PUI_OB_Tile active={reveal} delay={120} style={{ marginTop: 8 }}>
              <div style={{ fontSize: 28, fontWeight: 700, letterSpacing:'-0.025em' }}>Two surfaces, one platform.</div>
            </PUI_OB_Tile>
            <PUI_OB_Tile active={reveal} delay={240} style={{ marginTop: 8 }}>
              <div style={{ fontSize: 13, color: PUI_OB_C.sec, lineHeight: 1.55 }}>Command is your dashboard. Chat is your conversation. Same apps. Same wallet.</div>
            </PUI_OB_Tile>

            <div style={{ display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap: 14, marginTop: 24, textAlign:'left' }}>
              {/* Command — real dashboard widgets, not gray slabs.
                  Each widget is a recognizable kind: a balance, an approvals
                  count with stacked colored bars, a 24h activity histogram.
                  Title bar uses tabbed surfaces (Today / Live) so the surface
                  reads as a real dashboard. */}
              <PUI_OB_Tile active={reveal} delay={420}>
                <div style={{
                  background:'#fff', color: PUI_OB_C.text, borderRadius: 14,
                  boxShadow:'0 1px 0 rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.05)',
                  display:'flex', flexDirection:'column', height: 220, overflow:'hidden',
                }}>
                  <div style={{ display:'flex', alignItems:'center', gap: 8, padding:'10px 12px', borderBottom:'1px solid rgba(0,0,0,0.05)' }}>
                    <span style={{ width: 18, height: 18, borderRadius: 5, background: PUI_OB_C.raised, display:'flex', alignItems:'center', justifyContent:'center', color: PUI_OB_C.text }}>
                      <window.PUI_Icons.IconCompass size={11}/>
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 700 }}>Command</span>
                    <span style={{ marginLeft:'auto', fontSize: 9, fontFamily:'var(--ul-font-mono)', color: PUI_OB_C.mute, letterSpacing:'0.08em', textTransform:'uppercase' }}>Today</span>
                  </div>
                  <div style={{ flex: 1, padding: 10, display:'grid', gridTemplateColumns:'1fr 1fr', gap: 8 }}>
                    <div style={{ background: PUI_OB_C.raised, borderRadius: 8, padding:'8px 10px', display:'flex', flexDirection:'column', justifyContent:'space-between' }}>
                      <div style={{ fontSize: 8, fontFamily:'var(--ul-font-mono)', color: PUI_OB_C.mute, letterSpacing:'0.08em', textTransform:'uppercase' }}>Light</div>
                      <div style={{ fontSize: 16, fontWeight: 700, fontVariantNumeric:'tabular-nums', letterSpacing:'-0.02em' }}>✦12.402</div>
                      <div style={{ fontSize: 9, color:'#16a34a', fontFamily:'var(--ul-font-mono)', fontVariantNumeric:'tabular-nums' }}>+0.084 24h</div>
                    </div>
                    <div style={{ background: PUI_OB_C.raised, borderRadius: 8, padding:'8px 10px', display:'flex', flexDirection:'column', justifyContent:'space-between' }}>
                      <div style={{ fontSize: 8, fontFamily:'var(--ul-font-mono)', color: PUI_OB_C.mute, letterSpacing:'0.08em', textTransform:'uppercase' }}>Approvals</div>
                      <div style={{ fontSize: 16, fontWeight: 700, fontVariantNumeric:'tabular-nums', letterSpacing:'-0.02em' }}>3</div>
                      <div style={{ display:'flex', gap: 3 }}>
                        <span style={{ width: 14, height: 4, borderRadius: 2, background:'#f59e0b' }}/>
                        <span style={{ width: 14, height: 4, borderRadius: 2, background:'#3b82f6' }}/>
                        <span style={{ width: 14, height: 4, borderRadius: 2, background:'#722F37' }}/>
                      </div>
                    </div>
                    <div style={{ gridColumn:'span 2', background: PUI_OB_C.raised, borderRadius: 8, padding:'8px 10px' }}>
                      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                        <div style={{ fontSize: 8, fontFamily:'var(--ul-font-mono)', color: PUI_OB_C.mute, letterSpacing:'0.08em', textTransform:'uppercase' }}>Calls / 24h</div>
                        <div style={{ fontSize: 10, fontWeight: 700, fontVariantNumeric:'tabular-nums' }}>1,284</div>
                      </div>
                      <div style={{ display:'flex', alignItems:'flex-end', gap: 2, height: 26, marginTop: 5 }}>
                        {[6,9,5,12,18,10,14,22,15,11,8,17,24,19,13,9,11,16,21,15].map((h, i) => (
                          <span key={i} style={{ flex: 1, height: `${h*100/24}%`, background: PUI_OB_C.text, opacity: 0.7, borderRadius: 1 }}/>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </PUI_OB_Tile>
              {/* Chat — real conversation thread with a tool receipt + reply,
                  matching the actual Premium chat ceremony elsewhere in this doc. */}
              <PUI_OB_Tile active={reveal} delay={520}>
                <div style={{
                  background:'#fff', borderRadius: 14,
                  boxShadow:'0 1px 0 rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.05)',
                  display:'flex', flexDirection:'column', height: 220, overflow:'hidden',
                }}>
                  <div style={{ display:'flex', alignItems:'center', gap: 8, padding:'10px 12px', borderBottom:'1px solid rgba(0,0,0,0.05)' }}>
                    <span style={{ width: 18, height: 18, borderRadius: 5, background: PUI_OB_C.raised, display:'flex', alignItems:'center', justifyContent:'center', color: PUI_OB_C.text }}>
                      <window.PUI_Icons.IconCornerDownLeft size={11}/>
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 700 }}>Private Tutor</span>
                    <span style={{ width: 5, height: 5, borderRadius: 9999, background:'#16a34a' }}/>
                    <span style={{ marginLeft:'auto', fontSize: 9, fontFamily:'var(--ul-font-mono)', color: PUI_OB_C.mute, letterSpacing:'0.08em', textTransform:'uppercase' }}>Live</span>
                  </div>
                  <div style={{ flex: 1, padding: 10, display:'flex', flexDirection:'column', gap: 8, overflow:'hidden' }}>
                    <div style={{ alignSelf:'flex-end', background: PUI_OB_C.text, color:'#fff', padding:'5px 10px', borderRadius: 12, fontSize: 11, maxWidth:'85%' }}>
                      quiz me on Spanish irregular verbs
                    </div>
                    <div style={{ display:'flex', alignItems:'center', gap: 6, padding:'4px 8px', background: PUI_OB_C.raised, borderRadius: 6, fontSize: 10, fontFamily:'var(--ul-font-mono)', maxWidth:'85%' }}>
                      <span style={{ width: 10, height: 10, borderRadius: 9999, background:'#16a34a', display:'inline-flex', alignItems:'center', justifyContent:'center' }}>
                        <svg width="6" height="6" viewBox="0 0 8 8" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round"><path d="M1.5 4 L3.3 5.8 L6.5 2.5"/></svg>
                      </span>
                      <span style={{ color: PUI_OB_C.text }}>private_tutor.start</span>
                      <span style={{ color: PUI_OB_C.mute }}>·</span>
                      <span style={{ color: PUI_OB_C.mute }}>✦0.001</span>
                    </div>
                    <div style={{ fontSize: 11, color: PUI_OB_C.text, lineHeight: 1.4 }}>
                      Let&apos;s start with <strong>tener</strong>. How would you say
                    </div>
                    <div style={{ fontSize: 11, color: PUI_OB_C.text, lineHeight: 1.4 }}>
                      &ldquo;I have two brothers&rdquo;?
                    </div>
                  </div>
                  <div style={{ padding:'8px 10px', borderTop:'1px solid rgba(0,0,0,0.05)', display:'flex', alignItems:'center', gap: 6 }}>
                    <span style={{ flex: 1, fontSize: 10, color: PUI_OB_C.mute, fontStyle:'italic' }}>Type your answer…</span>
                    <span style={{ fontSize: 9, fontFamily:'var(--ul-font-mono)', color: PUI_OB_C.mute, padding:'2px 5px', background: PUI_OB_C.raised, borderRadius: 4 }}>↵</span>
                  </div>
                </div>
              </PUI_OB_Tile>
            </div>
          </div>
        )}

        {/* 3 — Build: introduces the three system agents in sequence */}
        {step === 3 && (
          <div key={stepKey} style={{ width:'100%', maxWidth: 620 }}>
            <PUI_OB_Tile active={reveal} delay={0} style={{}}>
              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing:'0.16em', color:'#16a34a', textTransform:'uppercase' }}>For builders</div>
            </PUI_OB_Tile>
            <PUI_OB_Tile active={reveal} delay={120} style={{ marginTop: 8 }}>
              <div style={{ fontSize: 28, fontWeight: 700, letterSpacing:'-0.025em' }}>Three guides. One pipeline.</div>
            </PUI_OB_Tile>
            <PUI_OB_Tile active={reveal} delay={240} style={{ marginTop: 8 }}>
              <div style={{ fontSize: 13, color: PUI_OB_C.sec, lineHeight: 1.55 }}>
                Hosting, database, auth, payments — automatic. You write the logic. They handle the rest.
              </div>
            </PUI_OB_Tile>

            <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap: 12, marginTop: 24, textAlign:'left' }}>
              {[
                { agent: builder, t:'Tool Builder',   role:'builds it', desc:'Describe what you want. It writes, tests, deploys — in chat.' },
                { agent: dealer,  t:'Tool Dealer',    role:'sells it',  desc:'Lists to the marketplace, sets your price. Real Stripe payouts.' },
                { agent: manager, t:'Platform Guide', role:'tunes it',  desc:'Spend caps, permissions, receipts. Quietly running.' },
              ].map((f, i) => (
                <PUI_OB_Tile key={f.t} active={reveal} delay={420 + i * 140}>
                  <div style={{
                    background:'#fff', borderRadius: 14, padding: 16,
                    boxShadow:'0 1px 0 rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.05)',
                    height: 168, display:'flex', flexDirection:'column',
                  }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: 8,
                      background: f.agent.color, color:'#fff',
                      display:'flex', alignItems:'center', justifyContent:'center',
                    }}>
                      <f.agent.Icon size={16}/>
                    </div>
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{f.t}</div>
                      <div style={{ fontSize: 11, color: PUI_OB_C.mute, fontFamily:'var(--ul-font-mono)' }}>{f.role}</div>
                    </div>
                    <div style={{ fontSize: 11, color: PUI_OB_C.sec, lineHeight: 1.5, marginTop: 10 }}>{f.desc}</div>
                  </div>
                </PUI_OB_Tile>
              ))}
            </div>

            {/* End-where-work-begins composer */}
            <PUI_OB_Tile active={reveal} delay={900} style={{ marginTop: 24 }}>
              <div style={{
                background: PUI_OB_C.raised, borderRadius: 14, padding: 12,
                display:'flex', alignItems:'center', gap: 10,
                boxShadow:'inset 0 0 0 1px rgba(0,0,0,0.04)',
              }}>
                <PUI_OB_Spark size={16} color={PUI_OB_C.mute}/>
                <input
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && draft.trim()) setDissolved(true); }}
                  placeholder="Try it: deploy a hello-world tool…"
                  style={{
                    flex: 1, border:'none', outline:'none', background:'transparent',
                    fontSize: 13, color: PUI_OB_C.text, fontFamily:'inherit',
                  }}/>
                <button
                  disabled={!draft.trim()}
                  onClick={() => { if (draft.trim()) setDissolved(true); }}
                  style={{
                    padding:'6px 12px', fontSize: 11, fontWeight: 600,
                    background: draft.trim() ? PUI_OB_C.text : 'rgba(0,0,0,0.06)',
                    color: draft.trim() ? '#fff' : PUI_OB_C.mute,
                    border:'none', borderRadius: 6,
                    cursor: draft.trim() ? 'pointer' : 'not-allowed',
                    fontFamily:'var(--ul-font-mono)',
                  }}>send ↵</button>
              </div>
              <div style={{ fontSize: 11, color: PUI_OB_C.mute, marginTop: 6, fontFamily:'var(--ul-font-mono)' }}>
                Your first message ends the tour and starts the work.
              </div>
            </PUI_OB_Tile>
          </div>
        )}
      </div>

      {/* Footer — rhythm bar replaces dots */}
      <div style={{ flexShrink: 0, padding:'14px 20px 18px', display:'flex', flexDirection:'column', gap: 12 }}>
        {/* Rhythm bar */}
        <div style={{ display:'flex', gap: 4 }}>
          {STEPS.map((_, i) => (
            <button key={i} onClick={() => goTo(i)} style={{
              flex: 1, height: 3, background:'transparent', border:'none', padding: 0, cursor:'pointer',
            }}>
              <div style={{
                width:'100%', height: 3, borderRadius: 2,
                background: i <= step ? PUI_OB_C.text : 'rgba(0,0,0,0.08)',
                transition:'background 320ms ease',
              }}/>
            </button>
          ))}
        </div>

        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap: 12 }}>
          <div style={{ fontSize: 11, color: PUI_OB_C.mute, fontFamily:'var(--ul-font-mono)' }}>
            {step + 1} / {STEPS.length} · {STEPS[step]}
          </div>

          <div style={{ display:'flex', gap: 8 }}>
            {step > 0 && (
              <button onClick={() => goTo(step - 1)} style={{
                background:'transparent', color: PUI_OB_C.sec, border:'none',
                padding:'7px 12px', fontSize: 12, cursor:'pointer', fontFamily:'inherit',
              }}>Back</button>
            )}
            {step < STEPS.length - 1 ? (
              <button onClick={() => goTo(step + 1)} style={{
                background: PUI_OB_C.text, color:'#fff', border:'none',
                padding:'8px 18px', fontSize: 12, fontWeight: 500, borderRadius: 8, cursor:'pointer', fontFamily:'inherit',
                display:'inline-flex', alignItems:'center', gap: 6,
              }}>
                {step === 0 ? 'Begin' : 'Next'} <span style={{ fontFamily:'var(--ul-font-mono)', fontSize: 11, opacity: 0.7 }}>→</span>
              </button>
            ) : (
              <span style={{ fontSize: 11, color: PUI_OB_C.mute, fontFamily:'var(--ul-font-mono)', alignSelf:'center' }}>↵ to begin</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

window.PUI_Onboarding_Before = PUI_Onboarding_Before;
window.PUI_Onboarding_After = PUI_Onboarding_After;
