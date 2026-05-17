// Premium composer — refined per Claude Code-style brief.
//
// Mental model:
//   • LEFT: paperclip · Tools popover (connected + ambient suggestions)
//   • RIGHT: Models popover (Flash + Heavy) · Send
//   • No persistent "@agent" chip — escalation is automatic in the backend.
//     The user can still type @ in the textarea to address an agent inline,
//     but it's not a permanent slot of the composer chrome.
//   • Single hairline row, generous breathing room around the textarea,
//     no keyboard-hint clutter — just the ↵ on hover/focus.
//
// Tools popover layout:
//   • CONNECTED — apps the user has authed (gmail, calendar, slack…)
//   • AMBIENT   — Tool Dealer suggestions surfaced from current context.
//                 Subtitle reads "Suggested for this thread · auto-curated".
//                 Each row has a one-tap Add button.
//
// Models popover layout:
//   • FLASH ▸ small, fast model used for the bulk of turns
//   • HEAVY ▸ larger model used when the orchestrator escalates
//   • Both are pickable; "Auto" is the recommended default for each tier.

const { PUI_Icons } = window;
const PC_C = window.PUI_Primitives.C;

const SLASH_CMDS = [
  { cmd: '/deploy',  desc: 'Ship a tool to staging or production', Icon: PUI_Icons.IconBolt },
  { cmd: '/share',   desc: 'Create a shareable link to this run',  Icon: PUI_Icons.IconShare },
  { cmd: '/test',    desc: 'Run validation against the schema',    Icon: PUI_Icons.IconBeaker },
  { cmd: '/tool',    desc: 'Insert a tool reference',              Icon: PUI_Icons.IconPackage },
  { cmd: '/clear',   desc: 'Reset this conversation',              Icon: PUI_Icons.IconCirclePlus },
];

const CONNECTED_TOOLS = [
  { name:'Gmail',     hint:'4 inboxes · auto-approve', dot:'#ea4335' },
  { name:'Calendar',  hint:'Primary · ask first',      dot:'#1a73e8' },
  { name:'Slack',     hint:'2 workspaces',             dot:'#611f69' },
  { name:'Notion',    hint:'Personal',                 dot:'#000000' },
];

const AMBIENT_TOOLS = [
  { name:'Weather',     hint:'Forecast · current conditions', desc:'Matches "Tokyo" + "rain" in your message.' },
  { name:'Currency',    hint:'FX rates',                       desc:'Often paired with travel queries.' },
  { name:'Air Quality', hint:'AQI by city',                    desc:'Frequently co-installed with Weather.' },
];

// Models are scoped to a PROVIDER. Two providers exist:
//   • ultralight  — usage is denominated in ✦ (Light), metered per call.
//   • byok        — Bring-Your-Own-Key. User's own API key is synced through
//                   the keychain and we just pass through the request.
// The Heavy/Flash split is provider-independent: any model can sit in either
// tier, but each provider exposes its own catalog.
// Providers come in two shapes:
//   • Ultralight AI — house provider, billed in ✦ Light, pay per call.
//   • BYOK providers — user's own API key, billed by the upstream vendor.
//     Each major BYOK route is its own entry (OpenRouter, Anthropic, OpenAI,
//     Deepseek, …) so the user picks the route up front and only sees that
//     route's catalog below — same mental model as choosing a base URL.
// Per-provider connection status. The composer reads this so the model
// popover can flag whether the provider is ready to use:
//   • ultralight — billed in ✦ Light; "balance" is the user's prepaid
//     balance and "needsTopup" surfaces a warning when low.
//   • BYOK providers — "connected" reflects whether the user has pasted
//     an API key into Settings. Demo defaults: Anthropic + OpenAI on,
//     OpenRouter + Deepseek off, so the UI shows both states.
const PROVIDER_STATUS = {
  ultralight: { kind:'light', balance: 1284,        needsTopup: false },
  openrouter: { kind:'byok',  connected: false },
  anthropic:  { kind:'byok',  connected: true  },
  openai:     { kind:'byok',  connected: true  },
  deepseek:   { kind:'byok',  connected: false },
};

const PROVIDERS = [
  { id: 'ultralight', label: 'Ultralight',    hint:'Light-denominated · pay per call' },
  { id: 'openrouter', label: 'OpenRouter',    hint:'BYOK · 200+ models, one key' },
  { id: 'anthropic',  label: 'Anthropic',     hint:'BYOK · Claude direct' },
  { id: 'openai',     label: 'OpenAI',        hint:'BYOK · GPT direct' },
  { id: 'deepseek',   label: 'Deepseek',      hint:'BYOK · DeepSeek direct' },
];

const MODELS_BY_PROVIDER = {
  ultralight: {
    flash: [
      { id:'gemini-3.1-flash-lite', label:'Gemini 3.1 Flash Lite', hint:'Default · fastest' },
      { id:'claude-haiku-4.5',      label:'Claude Haiku 4.5',      hint:'Higher quality · same speed tier' },
      { id:'gpt-5-nano',            label:'GPT-5 Nano',            hint:'Cheapest' },
    ],
    heavy: [
      { id:'claude-sonnet-4.6',     label:'Claude Sonnet 4.6',     hint:'Default · balanced' },
      { id:'claude-opus-4.5',       label:'Claude Opus 4.5',       hint:'Slowest · highest quality' },
      { id:'gpt-5',                 label:'GPT-5',                 hint:'Alternative reasoning style' },
    ],
  },
  openrouter: {
    flash: [
      { id:'or-haiku-4.5',     label:'anthropic/claude-haiku-4.5', hint:'Routed via OpenRouter' },
      { id:'or-gpt-5-nano',    label:'openai/gpt-5-nano',          hint:'Routed via OpenRouter' },
      { id:'or-gemini-flash',  label:'google/gemini-3.1-flash',    hint:'Routed via OpenRouter' },
      { id:'or-llama-3.3',     label:'meta/llama-3.3-70b',         hint:'Routed via OpenRouter' },
    ],
    heavy: [
      { id:'or-sonnet-4.6',    label:'anthropic/claude-sonnet-4.6', hint:'Routed via OpenRouter' },
      { id:'or-opus-4.5',      label:'anthropic/claude-opus-4.5',   hint:'Routed via OpenRouter' },
      { id:'or-gpt-5',         label:'openai/gpt-5',                hint:'Routed via OpenRouter' },
    ],
  },
  anthropic: {
    flash: [
      { id:'a-haiku-4.5',  label:'Claude Haiku 4.5', hint:'Default · fastest' },
    ],
    heavy: [
      { id:'a-sonnet-4.6', label:'Claude Sonnet 4.6', hint:'Default · balanced' },
      { id:'a-opus-4.5',   label:'Claude Opus 4.5',   hint:'Slowest · highest quality' },
    ],
  },
  openai: {
    flash: [
      { id:'o-gpt-5-nano',  label:'GPT-5 Nano',  hint:'Default · fastest' },
      { id:'o-gpt-5-mini',  label:'GPT-5 Mini',  hint:'Mid-tier' },
    ],
    heavy: [
      { id:'o-gpt-5',       label:'GPT-5',       hint:'Default · balanced' },
      { id:'o-o3',          label:'o3',          hint:'Reasoning' },
    ],
  },
  deepseek: {
    flash: [
      { id:'ds-v3-chat',    label:'DeepSeek V3 Chat', hint:'Default · fastest' },
    ],
    heavy: [
      { id:'ds-r1',         label:'DeepSeek R1',      hint:'Reasoning' },
    ],
  },
};

// Default Flash + Heavy model per provider — used when the user picks a
// provider for a tier so we can immediately reflect a sensible model in the
// composer label without forcing them into the menu.
const DEFAULT_MODEL = {
  ultralight: { flash: 'gemini-3.1-flash-lite', heavy: 'claude-sonnet-4.6' },
  openrouter: { flash: 'or-haiku-4.5',          heavy: 'or-sonnet-4.6' },
  anthropic:  { flash: 'a-haiku-4.5',           heavy: 'a-sonnet-4.6' },
  openai:     { flash: 'o-gpt-5-nano',          heavy: 'o-gpt-5' },
  deepseek:   { flash: 'ds-v3-chat',            heavy: 'ds-r1' },
};

// Tiny shared popover. Anchors above the trigger (which sits on the bottom
// row of the composer); positioned by the parent via `bottom: calc(100%+8px)`.
function Popover({ open, onClose, anchor, width = 320, maxHeight, align = 'left', flex = false, children }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target) && (!anchor.current || !anchor.current.contains(e.target))) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  if (!open) return null;
  // Align right when the trigger is on the right side of the composer row,
  // so the popover grows leftward instead of overflowing the container.
  const horiz = align === 'right' ? { right: 0 } : { left: 0 };
  return (
    <div ref={ref} style={{
      position:'absolute', bottom:'calc(100% + 8px)', ...horiz, width,
      maxHeight: maxHeight || undefined,
      overflowY: maxHeight && !flex ? 'auto' : 'hidden',
      display: flex ? 'flex' : 'block',
      flexDirection: flex ? 'column' : undefined,
      background:'#fff', border:`1px solid ${PC_C.border}`, borderRadius: 12,
      boxShadow:'0 12px 32px rgba(0,0,0,0.10), 0 0 0 1px rgba(0,0,0,0.02)',
      zIndex: 20, animation:'pui-fade-up 160ms ease-out',
    }}>
      {children}
    </div>
  );
}

function PopSection({ label, children, accent }) {
  return (
    <div>
      <div style={{ padding:'10px 14px 6px', fontSize: 9, fontFamily:'var(--ul-font-mono)', color: PC_C.mute, letterSpacing:'0.12em', textTransform:'uppercase', display:'flex', alignItems:'center', gap: 6 }}>
        {accent && <span style={{ width: 5, height: 5, borderRadius: 9999, background: accent }}/>}
        {label}
      </div>
      {children}
    </div>
  );
}

function PopRow({ left, title, hint, right, onClick, dim }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onClick && onClick(); }}
      style={{ display:'flex', alignItems:'center', gap: 10, padding:'7px 14px', cursor:'pointer', background: hover ? 'rgba(0,0,0,0.035)' : 'transparent', opacity: dim ? 0.55 : 1 }}>
      {left}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: PC_C.text, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{title}</div>
        {hint && <div style={{ fontSize: 10, color: PC_C.mute, fontFamily:'var(--ul-font-mono)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{hint}</div>}
      </div>
      {right}
    </div>
  );
}

// Per-tier provider chip — same visual as a model row so the popover reads
// as a unified left-aligned list. Click toggles the provider sub-list.
function SearchBar({ value, onChange, placeholder }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap: 6, padding:'6px 10px', background:'transparent', border:`1px solid ${PC_C.border}`, borderRadius: 8 }}>
      <span style={{ color: PC_C.mute, display:'inline-flex' }}><PUI_Icons.IconSearch size={11}/></span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ flex: 1, border:'none', outline:'none', background:'transparent', fontFamily:'inherit', fontSize: 11, color: PC_C.text }}
      />
      {value && (
        <button onMouseDown={(e) => { e.preventDefault(); onChange(''); }}
          style={{ border:'none', background:'transparent', color: PC_C.mute, cursor:'pointer', padding: 0, fontSize: 12, lineHeight: 1, fontFamily:'var(--ul-font-mono)' }}>×</button>
      )}
    </div>
  );
}

// Inline status badge for a provider — communicates ✦ Light balance for
// Ultralight, "Connected"/"No key" for BYOK providers. Color-coded so a
// quick glance tells you which providers are usable right now.
function ProviderStatusBadge({ providerId, compact = false }) {
  const status = PROVIDER_STATUS[providerId];
  if (!status) return null;
  if (status.kind === 'light') {
    const warn = status.needsTopup;
    const tone = warn ? '#C04D2E' : '#3F6D54';
    const bg = warn ? 'rgba(192,77,46,0.08)' : 'rgba(63,109,84,0.08)';
    return (
      <span style={{
        display:'inline-flex', alignItems:'center', gap: 4,
        padding: compact ? '1px 6px' : '2px 7px',
        borderRadius: 9999,
        background: bg, color: tone,
        fontFamily:'var(--ul-font-mono)', fontSize: 9.5, letterSpacing:'0.02em',
        whiteSpace:'nowrap',
      }}>
        <span style={{ fontWeight: 600 }}>✦</span>
        <span>{status.balance.toLocaleString()}</span>
        {warn && <span> · top up</span>}
      </span>
    );
  }
  const connected = status.connected;
  const tone = connected ? '#3F6D54' : '#9A9A9A';
  const bg = connected ? 'rgba(63,109,84,0.08)' : 'rgba(0,0,0,0.04)';
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap: 4,
      padding: compact ? '1px 6px' : '2px 7px',
      borderRadius: 9999,
      background: bg, color: tone,
      fontFamily:'var(--ul-font-mono)', fontSize: 9.5, letterSpacing:'0.02em',
      whiteSpace:'nowrap',
    }}>
      <span style={{ width: 5, height: 5, borderRadius: 9999, background: tone, opacity: connected ? 1 : 0.6 }}/>
      <span>{connected ? 'connected' : 'no key'}</span>
    </span>
  );
}

// Per-tier detail panel — provider dropdown (collapsed by default) + model
// list scoped to that provider. Search/paste appears for Ultralight +
// OpenRouter only; everything else gets a compact "+ more models" toggle
// that unions the provider's flash + heavy catalogs. Rendered directly
// inside each tier's popover (no overview hop), so no back button.
function TierDetail({ tier, tierSub, providerId, onPickProvider, catalog, moreOpen, setMoreOpen, query, setQuery, selected, onPickModel, onCustom, defaultTierKey }) {
  const [providerOpen, setProviderOpen] = React.useState(false);
  const q = query.trim().toLowerCase();
  const allowCustom = providerId === 'ultralight' || providerId === 'openrouter';
  // For Ultralight + OpenRouter the search filters across both tiers, so
  // we render a single combined list. For other providers the default tier
  // shows by default, and the OPPOSITE tier's models live in a smoothly
  // animated reveal under "+ more from this provider".
  const oppositeTierKey = defaultTierKey === 'flash' ? 'heavy' : 'flash';
  const customFiltered = allowCustom
    ? [...catalog.flash, ...catalog.heavy].filter(m => !q || m.label.toLowerCase().includes(q))
    : [];
  const showCustom = allowCustom && q.length > 0 && customFiltered.length === 0;
  const currentProvider = PROVIDERS.find(p => p.id === providerId);

  return (
    <React.Fragment>
      {/* Top — fixed header, divider, provider section, model header. None
          of this scrolls; only the model list does. */}
      <div style={{ flexShrink: 0 }}>
        <div style={{ padding:'12px 14px 10px' }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: PC_C.text }}>{tier}</div>
          <div style={{ fontSize: 9.5, color: PC_C.mute, fontFamily:'var(--ul-font-mono)', letterSpacing:'0.04em', textTransform:'uppercase', marginTop: 1 }}>{tierSub}</div>
        </div>
        <div style={{ height: 1, background: PC_C.border }}/>

        <div style={{ padding:'10px 14px 6px', fontSize: 9, fontFamily:'var(--ul-font-mono)', color: PC_C.mute, letterSpacing:'0.12em', textTransform:'uppercase' }}>
          Provider
        </div>
        {/* Provider chip — visually a model row (no border container). Click
            opens an inline sublist below. The expand uses grid-template-rows
            with a slow ease-out so the height animates smoothly while the
            content fades in for added polish. */}
        <PopRow
          title={
            <span style={{ display:'inline-flex', alignItems:'center', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: PC_C.text }}>{currentProvider.label}</span>
              <ProviderStatusBadge providerId={providerId} compact/>
            </span>
          }
          hint={currentProvider.hint}
          right={
            <span style={{ display:'inline-flex', transform: providerOpen ? 'rotate(180deg)' : 'none', transition:'transform 280ms cubic-bezier(.32,.72,0,1)', color: PC_C.mute }}>
              <PUI_Icons.IconChevronDown size={11}/>
            </span>
          }
          onClick={() => setProviderOpen(o => !o)}
        />
        <div style={{
          display:'grid',
          gridTemplateRows: providerOpen ? '1fr' : '0fr',
          opacity: providerOpen ? 1 : 0,
          transition:'grid-template-rows 320ms cubic-bezier(.32,.72,0,1), opacity 220ms ease-out',
        }}>
          <div style={{ minHeight: 0, overflow:'hidden' }}>
            {PROVIDERS.filter(p => p.id !== providerId).map(p => (
              <PopRow key={p.id}
                title={p.label} hint={p.hint}
                right={<ProviderStatusBadge providerId={p.id} compact/>}
                onClick={() => { onPickProvider(p.id); setProviderOpen(false); }}
              />
            ))}
          </div>
        </div>

        <div style={{ padding:'10px 14px 6px', display:'flex', alignItems:'center', justifyContent:'space-between', gap: 8 }}>
          <div style={{ fontSize: 9, fontFamily:'var(--ul-font-mono)', color: PC_C.mute, letterSpacing:'0.12em', textTransform:'uppercase' }}>
            Model
          </div>
          {!allowCustom && (
            <button
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setMoreOpen(o => !o); }}
              style={{ border:'none', background:'transparent', color: PC_C.mute, cursor:'pointer', padding: 0, fontFamily:'var(--ul-font-mono)', fontSize: 9.5, letterSpacing:'0.04em' }}>
              {moreOpen ? '— fewer' : '+ more from this provider'}
            </button>
          )}
        </div>
      </div>

      {/* Middle — model list scrolls. */}
      <div style={{ flex: 1, minHeight: 0, overflowY:'auto', paddingBottom: 6 }}>
        {allowCustom ? (
          <React.Fragment>
            {customFiltered.map(m => (
              <PopRow key={m.id}
                title={m.label} hint={m.hint}
                right={<span style={{ width: 14, display:'inline-flex', justifyContent:'center', color: m.id === selected ? PC_C.text : 'transparent', fontSize: 12 }}>✓</span>}
                onClick={() => onPickModel(m.id)}
              />
            ))}
            {showCustom && (
              <div style={{ padding:'6px 14px 4px' }}>
                <button
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onCustom(query); }}
                  style={{ width:'100%', padding:'7px 10px', fontSize: 11, fontWeight: 600, background:'#fff', color: PC_C.text, border:`1px dashed ${PC_C.border}`, borderRadius: 6, cursor:'pointer', fontFamily:'inherit', textAlign:'left' }}>
                  Use <span style={{ fontFamily:'var(--ul-font-mono)' }}>{query}</span> as {tier}
                </button>
              </div>
            )}
            {!customFiltered.length && !showCustom && (
              <div style={{ padding:'4px 14px 6px', fontSize: 11, color: PC_C.mute }}>No matches.</div>
            )}
          </React.Fragment>
        ) : (
          <React.Fragment>
            {/* Always-visible default-tier models for this provider. */}
            {catalog[defaultTierKey].map(m => (
              <PopRow key={m.id}
                title={m.label} hint={m.hint}
                right={<span style={{ width: 14, display:'inline-flex', justifyContent:'center', color: m.id === selected ? PC_C.text : 'transparent', fontSize: 12 }}>✓</span>}
                onClick={() => onPickModel(m.id)}
              />
            ))}
            {/* Animated reveal for the opposite-tier models. Same
                grid-template-rows trick as the provider sublist so the
                expand/collapse motion is identical. */}
            <div style={{
              display:'grid',
              gridTemplateRows: moreOpen ? '1fr' : '0fr',
              opacity: moreOpen ? 1 : 0,
              transition:'grid-template-rows 320ms cubic-bezier(.32,.72,0,1), opacity 220ms ease-out',
            }}>
              <div style={{ minHeight: 0, overflow:'hidden' }}>
                {catalog[oppositeTierKey].map(m => (
                  <PopRow key={m.id}
                    title={m.label} hint={m.hint}
                    right={<span style={{ width: 14, display:'inline-flex', justifyContent:'center', color: m.id === selected ? PC_C.text : 'transparent', fontSize: 12 }}>✓</span>}
                    onClick={() => onPickModel(m.id)}
                  />
                ))}
              </div>
            </div>
          </React.Fragment>
        )}
      </div>

      {/* Bottom — sticky search for Ultralight + OpenRouter. Pinned so the
          paste-a-model affordance is always reachable as the user scrolls
          through long catalogs. */}
      {allowCustom && (
        <div style={{ flexShrink: 0, padding:'8px 14px 10px', borderTop:`1px solid ${PC_C.border}`, background:'#fff' }}>
          <SearchBar value={query} onChange={setQuery} placeholder={`Search or paste a ${tier} model…`}/>
        </div>
      )}
    </React.Fragment>
  );
}

function PremiumComposer({ agents, onSend, isLoading, onToolDealer, toolDealerAmbient = false, toolDealerCount = 0, toolDealerOpen = false }) {
  const [v, setV] = React.useState('');
  const [send, setSend] = React.useState('idle'); // idle|armed|flying|landed
  const [menu, setMenu] = React.useState(null);   // slash/@ inline autocomplete
  const [popover, setPopover] = React.useState(null); // 'tools' | 'models-flash' | 'models-heavy' | 'plus'
  const [focused, setFocused] = React.useState(false);
  const [flashProvider, setFlashProvider] = React.useState('ultralight');
  const [heavyProvider, setHeavyProvider] = React.useState('ultralight');
  const [flashMoreOpen, setFlashMoreOpen] = React.useState(false);
  const [heavyMoreOpen, setHeavyMoreOpen] = React.useState(false);
  // Per-section search — flash and heavy each have their own filter so the
  // paste-a-model-name affordance can pin the result to the correct tier.
  const [flashQuery, setFlashQuery] = React.useState('');
  const [heavyQuery, setHeavyQuery] = React.useState('');
  const [customModel, setCustomModel] = React.useState('');
  const [flash, setFlash] = React.useState('gemini-3.1-flash-lite');
  const [heavy, setHeavy] = React.useState('claude-sonnet-4.6');
  const taRef = React.useRef(null);
  const toolsBtnRef = React.useRef(null);
  const modelsFlashBtnRef = React.useRef(null);
  const modelsHeavyBtnRef = React.useRef(null);
  const plusBtnRef = React.useRef(null);

  const has = v.trim().length > 0;

  React.useEffect(() => {
    const m = v.match(/(^|\s)(\/[\w-]*)$/);
    const a = v.match(/(^|\s)@([\w-]*)$/);
    if (m) setMenu({ kind:'slash', q: m[2].slice(1).toLowerCase(), idx: 0 });
    else if (a) setMenu({ kind:'at', q: a[2].toLowerCase(), idx: 0 });
    else setMenu(null);
  }, [v]);

  React.useEffect(() => {
    setSend(s => has ? (s === 'idle' ? 'armed' : s) : 'idle');
  }, [has]);

  const filtered = React.useMemo(() => {
    if (!menu) return [];
    if (menu.kind === 'slash') return SLASH_CMDS.filter(c => c.cmd.slice(1).startsWith(menu.q));
    return agents.filter(a => a.name.toLowerCase().replace(/\s/g,'').startsWith(menu.q.replace(/\s/g,'')));
  }, [menu, agents]);

  const apply = (item) => {
    const text = menu.kind === 'slash' ? item.cmd : '@' + item.name.replace(/\s/g, '');
    setV(prev => prev.replace(menu.kind === 'slash' ? /(\/[\w-]*)$/ : /@([\w-]*)$/, text + ' '));
    setMenu(null);
    setTimeout(() => taRef.current && taRef.current.focus(), 0);
  };

  const launch = () => {
    if (!has || send === 'flying') return;
    setSend('flying');
    setTimeout(() => {
      onSend && onSend(v);
      setV('');
      setSend('landed');
      setTimeout(() => setSend('idle'), 280);
    }, 180);
  };

  const onKey = (e) => {
    if (menu && filtered.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMenu(m => ({ ...m, idx: (m.idx + 1) % filtered.length })); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setMenu(m => ({ ...m, idx: (m.idx - 1 + filtered.length) % filtered.length })); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); apply(filtered[menu.idx]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setMenu(null); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); launch(); }
  };

  // Outlined send button — transparent background with a border + arrow
  // that share a color. Idle = muted grey; armed (has text) = full black;
  // flying briefly inverts to a filled blue puck so the launch reads as a
  // commit. Landed scales down for the spring-back.
  const sendBorder = send === 'flying' ? PC_C.blue : has ? PC_C.text : PC_C.border;
  const sendFg     = send === 'flying' ? '#fff'    : has ? PC_C.text : PC_C.mute;
  const sendBg     = send === 'flying' ? PC_C.blue : 'transparent';
  const sendT = send === 'flying' ? 'translateY(-2px) scale(1.05)' : send === 'landed' ? 'scale(0.92)' : 'scale(1)';

  // Compact label for the Models button — shows the heavy model since
  // it's what the user cares about for complex tasks. Flash is implicit.
  const flashCatalog = MODELS_BY_PROVIDER[flashProvider];
  const heavyCatalog = MODELS_BY_PROVIDER[heavyProvider];
  const flashLabel = flashCatalog.flash.find(m => m.id === flash)?.label
    || flashCatalog.heavy.find(m => m.id === flash)?.label
    || (flash && flash.startsWith('custom:') ? flash.slice(7) : flash);
  const heavyLabel = heavyCatalog.heavy.find(m => m.id === heavy)?.label
    || heavyCatalog.flash.find(m => m.id === heavy)?.label
    || (heavy && heavy.startsWith('custom:') ? heavy.slice(7) : heavy);
  const heavyShort = heavyLabel.replace('Claude ', '').replace('GPT-', 'gpt-');
  const flashShort = flashLabel.replace('Claude ', '').replace('GPT-', 'gpt-').replace('Gemini ', 'gem-');

  // Pick a tier's provider AND auto-select that provider's default model
  // for the tier. The user can override via the model list.
  const pickFlashProvider = (pid) => {
    setFlashProvider(pid);
    setFlash(DEFAULT_MODEL[pid].flash);
    setFlashQuery('');
    setFlashMoreOpen(false);
  };
  const pickHeavyProvider = (pid) => {
    setHeavyProvider(pid);
    setHeavy(DEFAULT_MODEL[pid].heavy);
    setHeavyQuery('');
    setHeavyMoreOpen(false);
  };

  // Filtering + custom-paste rules now live inside TierDetail. Each tier
  // owns its own provider, query state, and "+ more models" toggle so the
  // overview popover stays a quiet two-row summary until you drill in.

  return (
    <div style={{ flexShrink: 0, padding:'8px 24px 24px', background: PC_C.bg, position:'relative' }}>
      <div style={{ maxWidth: 720, margin:'0 auto', position:'relative' }}>
        {/* Inline / and @ autocomplete (separate from the button popovers) */}
        {menu && filtered.length > 0 && (
          <div style={{ position:'absolute', bottom:'calc(100% + 4px)', left: 0, right: 0, background:'#fff', border:`1px solid ${PC_C.border}`, borderRadius: 12, boxShadow:'0 8px 30px rgba(0,0,0,0.10)', overflow:'hidden', zIndex: 10, animation:'pui-fade-up 140ms ease-out' }}>
            <div style={{ fontSize: 9, fontFamily:'var(--ul-font-mono)', color: PC_C.mute, padding:'10px 14px 4px', letterSpacing:'0.12em', textTransform:'uppercase' }}>{menu.kind === 'slash' ? 'Slash commands' : 'Agents'}</div>
            {filtered.map((it, i) => {
              const sel = i === menu.idx;
              return (
                <div key={i} onMouseEnter={() => setMenu(m => ({ ...m, idx: i }))} onMouseDown={(e) => { e.preventDefault(); apply(it); }}
                  style={{ display:'flex', alignItems:'center', gap: 10, padding:'8px 14px', background: sel ? 'rgba(0,0,0,0.04)' : 'transparent', cursor:'pointer' }}>
                  <span style={{ color: menu.kind === 'slash' ? PC_C.text : it.color, width: 16, display:'inline-flex' }}>
                    <it.Icon size={14}/>
                  </span>
                  <span style={{ fontFamily:'var(--ul-font-mono)', fontSize: 12, color: PC_C.text, fontWeight: 500 }}>
                    {menu.kind === 'slash' ? it.cmd : '@' + it.name}
                  </span>
                  <span style={{ fontSize: 12, color: PC_C.mute, flex: 1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {menu.kind === 'slash' ? it.desc : 'System agent'}
                  </span>
                  {sel && <span style={{ fontSize: 10, fontFamily:'var(--ul-font-mono)', color: PC_C.mute }}>↵</span>}
                </div>
              );
            })}
          </div>
        )}

        <div style={{ border:`1px solid ${PC_C.border}`, borderRadius: 16, background: PC_C.bg, transition:'border-color 200ms, box-shadow 200ms', boxShadow: focused ? '0 0 0 3px rgba(0,0,0,0.04)' : 'none' }}>
          {/* Input lives on its own line with the send button to the right —
              tools/models row sits beneath, Claude-Code-style. */}
          <div style={{ display:'flex', alignItems:'flex-end', gap: 8, padding:'14px 12px 10px 16px' }}>
            <textarea ref={taRef} value={v} onChange={e => setV(e.target.value)} onKeyDown={onKey}
              onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
              placeholder={isLoading ? 'Queue a follow-up…' : 'Message…'}
              rows={1}
              style={{ flex: 1, border:'none', outline:'none', resize:'none', fontFamily:'inherit', fontSize: 14, lineHeight: 1.6, color: PC_C.text, background:'transparent', padding: 0, minHeight: 24, caretColor: PC_C.text }}/>
            <button onClick={launch} disabled={!has}
              style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 9999, border:`1px solid ${sendBorder}`, background: sendBg, color: sendFg, display:'flex', alignItems:'center', justifyContent:'center', cursor: has ? 'pointer' : 'not-allowed', transform: sendT, transition:'all 200ms cubic-bezier(0.4, 0, 0.2, 1)' }}>
              <PUI_Icons.IconArrowUp size={14}/>
            </button>
          </div>

          {/* Bottom row — tools + model selector, beneath input. */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 10px 8px', gap: 8 }}>
            <div style={{ display:'flex', gap: 4, alignItems:'center' }}>
              {/* Plus button — attachments + commands menu */}
              <div style={{ position:'relative' }}>
                <button
                  ref={plusBtnRef}
                  onClick={() => setPopover(p => p === 'plus' ? null : 'plus')}
                  title="Add"
                  style={{ width: 28, height: 28, border:'none', background: popover === 'plus' ? 'rgba(0,0,0,0.06)' : 'transparent', color: PC_C.mute, cursor:'pointer', borderRadius: 6, display:'inline-flex', alignItems:'center', justifyContent:'center' }}>
                  <PUI_Icons.IconPlus size={15}/>
                </button>
                <Popover open={popover === 'plus'} onClose={() => setPopover(null)} anchor={plusBtnRef} width={240}>
                  <div style={{ padding: 6 }}>
                    {[
                      { Icon: PUI_Icons.IconPaperclip, label: 'Add files or photos' },
                      { Icon: PUI_Icons.IconSlash,     label: 'Slash commands',     hint:'⌘K' },
                      { Icon: PUI_Icons.IconPencil,    label: 'Edit custom instructions' },
                    ].map((it, i) => (
                      <div key={i}
                        onMouseDown={(e) => { e.preventDefault(); setPopover(null); }}
                        style={{ display:'flex', alignItems:'center', gap: 10, padding:'7px 10px', cursor:'pointer', borderRadius: 6 }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(0,0,0,0.04)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                        <span style={{ width: 16, color: PC_C.text, display:'inline-flex' }}><it.Icon size={14}/></span>
                        <span style={{ flex: 1, fontSize: 12.5, color: PC_C.text }}>{it.label}</span>
                        {it.hint && <span style={{ fontSize: 10, fontFamily:'var(--ul-font-mono)', color: PC_C.mute }}>{it.hint}</span>}
                        {it.chev && <PUI_Icons.IconChevronRight size={11}/>}
                      </div>
                    ))}
                  </div>
                </Popover>
              </div>

              {/* TOOLS button + popover */}
              <div style={{ position:'relative' }}>
                <button
                  ref={toolsBtnRef}
                  onClick={() => {
                    // Pill is a strict toggle for tool-selection UI.
                    //   • popover open  → close everything (popover + dealer cards)
                    //   • dealer  open  → close dealer cards (no popover)
                    //   • neither open  → open the popover
                    // Parent owns dealer state; we tell it via onToolDealer.
                    if (popover === 'tools') {
                      setPopover(null);
                      onToolDealer && onToolDealer('close');
                    } else if (toolDealerOpen) {
                      onToolDealer && onToolDealer('close');
                    } else {
                      setPopover('tools');
                    }
                  }}
                  style={{
                    display:'inline-flex', alignItems:'center', gap: 7,
                    height: 28, padding:'0 12px',
                    border:'none', borderRadius: 9999,
                    background: popover === 'tools' ? 'rgba(0,0,0,0.06)' : 'transparent',
                    color:'#777',
                    fontSize: 12, fontWeight: 500, fontFamily:'inherit', cursor:'pointer',
                    transition:'background 160ms ease, color 160ms ease',
                  }}>
                  {/* Animated halo — ALWAYS present so the pill has a
                      consistent silhouette. When the popover is open the
                      halo's outer ring fades to a near-flat dot, signaling
                      "you're already looking at it" without removing the
                      affordance. */}
                  {toolDealerAmbient && (
                    <span style={{ position:'relative', width: 7, height: 7 }}>
                      <span style={{ position:'absolute', inset: 0, borderRadius: 9999, border:'1px solid rgba(0,0,0,0.55)', boxSizing:'border-box' }}/>
                      {popover !== 'tools' && (
                        <span style={{ position:'absolute', inset: 0, borderRadius: 9999, border:'1px solid rgba(0,0,0,0.55)', boxSizing:'border-box', animation:'pui-halo 1.8s ease-out infinite' }}/>
                      )}
                    </span>
                  )}
                  <span>Tool selection</span>
                </button>
                <Popover
                  open={popover === 'tools'}
                  onClose={() => {
                    // Click-outside also returns to default state — both
                    // popover and any dealer cards close together.
                    setPopover(null);
                    if (onToolDealer) onToolDealer('close');
                  }}
                  anchor={toolsBtnRef} width={340}>
                  <div style={{ padding:'12px 14px 10px' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: PC_C.text }}>Tool selection</div>
                    <div style={{ fontSize: 11, color: PC_C.mute, lineHeight: 1.5, marginTop: 2 }}>
                      Connected apps and Tool Dealer suggestions auto-curated from this thread.
                    </div>
                  </div>
                  <div style={{ height: 1, background: PC_C.border }}/>
                  <PopSection label="Connected" accent={PC_C.text}>
                    {CONNECTED_TOOLS.map(t => (
                      <PopRow key={t.name}
                        left={<span style={{ width: 6, height: 6, borderRadius: 9999, background: t.dot }}/>}
                        title={t.name} hint={t.hint}
                        right={<span style={{ fontSize: 10, color: PC_C.mute, fontFamily:'var(--ul-font-mono)' }}>on</span>}
                      />
                    ))}
                    <div style={{ padding:'6px 14px 10px' }}>
                      <button style={{ fontSize: 11, color: PC_C.mute, background:'transparent', border:'none', cursor:'pointer', padding: 0, fontFamily:'inherit' }}>+ Connect app…</button>
                    </div>
                  </PopSection>
                  <div style={{ height: 1, background: PC_C.border }}/>
                  <PopSection label={`Tool Dealer surfaced ${toolDealerCount || AMBIENT_TOOLS.length} from this thread`} accent="#0b6b57">
                    <div style={{ padding:'0 14px 4px', fontSize: 10, color: PC_C.mute, lineHeight: 1.5 }}>
                      Auto-curated from the whole thread.{onToolDealer ? ' ' : ''}
                      {onToolDealer && (
                        <button onMouseDown={(e) => { e.preventDefault(); setPopover(null); onToolDealer(); }}
                          style={{ background:'transparent', border:'none', padding: 0, color:'#0b6b57', cursor:'pointer', fontFamily:'inherit', fontSize: 10, textDecoration:'underline' }}>
                          Open in chat →
                        </button>
                      )}
                    </div>
                    {AMBIENT_TOOLS.map(t => (
                      <PopRow key={t.name}
                        left={<span style={{ width: 6, height: 6, borderRadius: 9999, background:'#0b6b57' }}/>}
                        title={t.name} hint={t.hint}
                        onClick={() => { /* opens detail / install card; same surface as clicking the row body */ }}
                        right={
                          <button
                            onMouseDown={(e) => { e.stopPropagation(); /* + Add installs without opening details */ }}
                            style={{ fontSize: 10, fontFamily:'var(--ul-font-mono)', color:'#0b6b57', background:'rgba(11,107,87,0.10)', padding:'2px 6px', borderRadius: 4, border:'none', cursor:'pointer' }}>
                            + Add
                          </button>
                        }
                      />
                    ))}
                  </PopSection>
                </Popover>
              </div>
            </div>

            <div style={{ display:'flex', gap: 6, alignItems:'center' }}>
              {/* MODEL TIER PILLS — Flash and Heavy each get their own
                  button so the user can see both selections at once and
                  jump directly into either tier's provider+model picker.
                  The two pills are visually grouped with a faint divider
                  in between. */}
              <div style={{ display:'flex', alignItems:'center', gap: 0 }}>
                <div style={{ position:'relative' }}>
                  <button
                    ref={modelsFlashBtnRef}
                    onClick={() => setPopover(p => p === 'models-flash' ? null : 'models-flash')}
                    style={{
                      display:'inline-flex', alignItems:'center', gap: 6,
                      height: 28, padding:'0 8px 0 10px',
                      border:'none', borderRadius: '9999px 0 0 9999px',
                      background: popover === 'models-flash' ? 'rgba(0,0,0,0.06)' : 'transparent',
                      color:'#888', fontSize: 11, fontWeight: 400, fontFamily:'inherit', cursor:'pointer',
                      transition:'background 160ms ease',
                    }}>
                    <span>{flashShort}</span>
                  </button>
                  <Popover open={popover === 'models-flash'} onClose={() => setPopover(null)} anchor={modelsFlashBtnRef} width={340} maxHeight={480} align="right" flex>
                    <TierDetail
                      tier="Flash"
                      tierSub="Runs every turn"
                      providerId={flashProvider}
                      onPickProvider={pickFlashProvider}
                      catalog={flashCatalog}
                      moreOpen={flashMoreOpen}
                      setMoreOpen={setFlashMoreOpen}
                      query={flashQuery}
                      setQuery={setFlashQuery}
                      selected={flash}
                      onPickModel={setFlash}
                      onCustom={(q) => { setFlash('custom:' + q); setCustomModel(q); setFlashQuery(''); }}
                      defaultTierKey="flash"
                    />
                  </Popover>
                </div>

                {/* Faint vertical divider — sells the two pills as one
                    group ("models") while letting either be the click
                    target individually. */}
                <span style={{ width: 1, height: 14, background: PC_C.border, opacity: 0.7 }}/>

                <div style={{ position:'relative' }}>
                  <button
                    ref={modelsHeavyBtnRef}
                    onClick={() => setPopover(p => p === 'models-heavy' ? null : 'models-heavy')}
                    style={{
                      display:'inline-flex', alignItems:'center', gap: 6,
                      height: 28, padding:'0 10px 0 8px',
                      border:'none', borderRadius: '0 9999px 9999px 0',
                      background: popover === 'models-heavy' ? 'rgba(0,0,0,0.06)' : 'transparent',
                      color:'#888', fontSize: 11, fontWeight: 400, fontFamily:'inherit', cursor:'pointer',
                      transition:'background 160ms ease',
                    }}>
                    <span>{heavyShort}</span>
                    <PUI_Icons.IconChevronDown size={11}/>
                  </button>
                  <Popover open={popover === 'models-heavy'} onClose={() => setPopover(null)} anchor={modelsHeavyBtnRef} width={340} maxHeight={480} align="right" flex>
                    <TierDetail
                      tier="Heavy"
                      tierSub="On escalation"
                      providerId={heavyProvider}
                      onPickProvider={pickHeavyProvider}
                      catalog={heavyCatalog}
                      moreOpen={heavyMoreOpen}
                      setMoreOpen={setHeavyMoreOpen}
                      query={heavyQuery}
                      setQuery={setHeavyQuery}
                      selected={heavy}
                      onPickModel={setHeavy}
                      onCustom={(q) => { setHeavy('custom:' + q); setCustomModel(q); setHeavyQuery(''); }}
                      defaultTierKey="heavy"
                    />
                  </Popover>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.PremiumComposer = PremiumComposer;
