// Tool-call ceremony — stages, glow, ring-pulse, auto-collapse, expand inline panel.

const TC_C = window.PUI_Primitives.C;
const PUI_STAGES_DEPLOY = ['Compiling', 'Uploading', 'Live'];

function PUI_ToolCallCeremony({ name, args, stages, currentStage, status, result, ceremony = 'full' }) {
  const [expanded, setExpanded] = React.useState(false);
  // Pre-completed calls (rendered directly in done state) start collapsed —
  // matches the auto-collapsed look so all resolved tool calls share one style.
  const [collapsed, setCollapsed] = React.useState(status === 'completed');
  const [resolveK, setResolveK] = React.useState(0);
  const prevStatus = React.useRef(status);

  React.useEffect(() => {
    if (prevStatus.current !== 'completed' && status === 'completed') {
      setResolveK(k => k + 1);
      const t = setTimeout(() => setCollapsed(true), 1400);
      return () => clearTimeout(t);
    }
    prevStatus.current = status;
  }, [status]);

  const isRunning = status === 'running' || status === 'executing' || (!status && currentStage != null && stages && currentStage < stages.length);
  const isDone = status === 'completed';

  // Collapsed dense one-liner
  if (collapsed && !expanded) {
    return (
      <div onClick={() => { setCollapsed(false); setExpanded(true); }}
        style={{ display:'flex', alignItems:'center', gap: 8, padding:'6px 10px', marginBottom: 8, borderRadius: 6, background: 'rgba(0,0,0,0.02)', cursor:'pointer', fontFamily:'var(--ul-font-mono)', fontSize: 11, color: TC_C.sec }}>
        <span style={{ width: 14, height: 14, borderRadius: 9999, background: TC_C.green, color:'#fff', display:'inline-flex', alignItems:'center', justifyContent:'center', flexShrink: 0 }}>
          <window.PUI_Icons.IconCheck size={9}/>
        </span>
        <span style={{ color: TC_C.text }}>{name}</span>
        <span style={{ color: TC_C.mute, flex: 1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{result || 'completed'}</span>
        <span style={{ fontSize: 9, color: TC_C.mute }}>▸</span>
      </div>
    );
  }

  const showCeremony = ceremony !== 'off';
  const fullCeremony = ceremony === 'full';

  return (
    <div style={{
      marginBottom: 10,
      borderRadius: 10,
      // Borderless: same uniform "soft fill" language whether running, completed, or expanded.
      // Running gets a softer blue tint; otherwise the same neutral 0.02 fill we use when collapsed.
      border: 'none',
      background: isRunning && showCeremony ? 'rgba(59,130,246,0.04)' : 'rgba(0,0,0,0.02)',
      animation: fullCeremony ? 'pui-toolpop 280ms cubic-bezier(0.2, 0.9, 0.3, 1)' : 'none',
      boxShadow: isRunning && showCeremony ? '0 0 0 4px rgba(59,130,246,0.06)' : 'none',
      transition: 'box-shadow 220ms, background 220ms',
      overflow: 'hidden',
    }}>
      <div onClick={() => isDone && (expanded ? (setExpanded(false), setCollapsed(true)) : setExpanded(true))}
        style={{ padding:'10px 12px', display:'flex', alignItems:'center', gap: 10, cursor: isDone ? 'pointer' : 'default', position:'relative' }}
        key={resolveK}>
        {isRunning ? (
          <span style={{ width: 10, height: 10, border:`2px solid rgba(59,130,246,0.2)`, borderTopColor: TC_C.blue, borderRadius: 9999, animation:'pui-spin 0.7s linear infinite' }}/>
        ) : (
          <span style={{ width: 14, height: 14, borderRadius: 9999, background: TC_C.green, color:'#fff', display:'inline-flex', alignItems:'center', justifyContent:'center', animation: fullCeremony ? 'pui-ring-resolve 700ms ease-out' : 'none' }}>
            <window.PUI_Icons.IconCheck size={9}/>
          </span>
        )}
        <span style={{ fontFamily:'var(--ul-font-mono)', fontSize: 12, color: TC_C.text, fontWeight: 500 }}>{name}</span>

        {stages && (
          <div style={{ display:'flex', alignItems:'center', gap: 6, marginLeft: 4 }}>
            {stages.map((s, i) => {
              const done = (currentStage ?? 0) > i || isDone;
              const active = (currentStage ?? 0) === i && isRunning;
              return (
                <React.Fragment key={i}>
                  {i > 0 && <span style={{ width: 12, height: 1, background: done ? TC_C.green : TC_C.border, transition:'background 240ms' }}/>}
                  <span style={{ display:'inline-flex', alignItems:'center', gap: 4, fontFamily:'var(--ul-font-mono)', fontSize: 10, color: active ? TC_C.blue : done ? TC_C.green : TC_C.mute, fontWeight: active ? 600 : 400 }}>
                    <span style={{ width: 5, height: 5, borderRadius: 9999, background: active ? TC_C.blue : done ? TC_C.green : TC_C.border, animation: active ? 'pui-pulse 1.4s ease-in-out infinite' : 'none' }}/>
                    {s}
                  </span>
                </React.Fragment>
              );
            })}
          </div>
        )}

        <span style={{ flex: 1, fontFamily:'var(--ul-font-mono)', fontSize: 11, color: TC_C.mute, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', textAlign:'right' }}>
          {isDone && result ? result : args}
        </span>
        {isDone && <span style={{ fontSize: 10, color: TC_C.mute, fontFamily:'var(--ul-font-mono)' }}>{expanded ? '▾' : '▸'}</span>}
      </div>

      {expanded && isDone && (
        <div style={{
          // Borderless: divider is a hairline fill change rather than a border line.
          padding:'10px 12px 12px',
          background:'rgba(0,0,0,0.015)',
          fontFamily:'var(--ul-font-mono)', fontSize: 11, color: TC_C.sec,
          animation:'pui-fade-up 200ms ease-out',
        }}>
          <div style={{ color: TC_C.mute, marginBottom: 4 }}>input</div>
          <div style={{ marginBottom: 8, color: TC_C.text }}>{args || '—'}</div>
          <div style={{ color: TC_C.mute, marginBottom: 4 }}>output</div>
          <div style={{ color: TC_C.text }}>{result || '—'}</div>
        </div>
      )}
    </div>
  );
}

// ── Premium chat body — message rise, hairline shimmer while thinking ──
//
// Tool calls are now grouped: a run of consecutive {type: 'tool'} messages
// renders as a single subtle one-liner — "Worked for 3m 25s" with a small
// chevron — that expands to reveal every individual tool-call card. This
// lifts the visual weight off finished work; the chat reads as conversation,
// the tool plumbing is recoverable on click.
//
// Group duration is summed from each tool message's `duration` field (ms),
// or estimated as 1.4s if absent. While the agent is still running and the
// last group is open, the group auto-expands and shows live progress.

function PUI_formatDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r === 0 ? `${m}m` : `${m}m ${r}s`;
}

function PUI_ToolCallGroup({ tools, isLoading, ceremony }) {
  const allDone = tools.every(t => t.status === 'completed');
  // Auto-collapse a few hundred ms after the last tool finishes; expand on click.
  const [open, setOpen] = React.useState(!allDone);
  const [didCollapse, setDidCollapse] = React.useState(false);

  React.useEffect(() => {
    if (allDone && !didCollapse) {
      const t = setTimeout(() => { setOpen(false); setDidCollapse(true); }, 1600);
      return () => clearTimeout(t);
    }
    if (!allDone) setOpen(true);
  }, [allDone, didCollapse]);

  const totalMs = tools.reduce((sum, t) => sum + (t.duration || 1400), 0);
  const summary = allDone
    ? `Worked for ${PUI_formatDuration(totalMs)}`
    : `Working… ${tools.filter(t => t.status === 'completed').length} / ${tools.length}`;

  return (
    <div style={{ marginBottom: 14 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display:'flex', alignItems:'center', gap: 8, padding:'4px 0',
          background:'transparent', border:'none', cursor:'pointer',
          fontFamily:'var(--ul-font-mono)', fontSize: 11,
          color: TC_C.mute,
        }}
      >
        <span style={{
          display:'inline-flex', alignItems:'center', justifyContent:'center',
          width: 10, transition:'transform 200ms ease',
          transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
        }}>▸</span>
        <span>{summary}</span>
        <span style={{ color: TC_C.mute }}>· {tools.length} tool{tools.length === 1 ? '' : 's'}</span>
      </button>
      {open && (
        <div style={{ marginTop: 8, paddingLeft: 18, animation:'pui-fade-up 180ms ease-out' }}>
          {tools.map((t, i) => (
            <PUI_ToolCallCeremony key={i} {...t} ceremony={ceremony}/>
          ))}
        </div>
      )}
    </div>
  );
}

function PUI_PremiumChatBody({ messages, isLoading, agent, ceremony = 'full', motionOn = true, statusPulseOn = true }) {
  // Group consecutive tool messages into a single "Worked for X" summary.
  const grouped = React.useMemo(() => {
    const out = [];
    let buf = null;
    for (const m of messages) {
      if (m.type === 'tool') {
        if (!buf) { buf = { kind: 'toolgroup', tools: [] }; out.push(buf); }
        buf.tools.push(m);
      } else {
        buf = null;
        out.push({ kind: 'msg', m });
      }
    }
    return out;
  }, [messages]);

  return (
    <div style={{ flex: 1, overflow:'auto', padding:'24px 24px 8px', position:'relative' }}>
      {isLoading && statusPulseOn && (
        <div style={{ position:'sticky', top: -24, marginTop: -24, marginBottom: 24, height: 2, marginLeft: -24, marginRight: -24, background: 'linear-gradient(90deg, transparent 0%, rgba(59,130,246,0.5) 50%, transparent 100%)', backgroundSize: '40% 100%', animation:'pui-shimmer 1.4s linear infinite', zIndex: 5 }}/>
      )}
      <div style={{ maxWidth: 720, margin:'0 auto' }}>
        <div style={{ display:'inline-flex', alignItems:'center', gap: 8, fontSize: 12, fontWeight: 500, marginBottom: 16, color: TC_C.text }}>
          <span style={{ position:'relative', width: 8, height: 8 }}>
            <span style={{ position:'absolute', inset: 1, background: TC_C.green, borderRadius: 9999 }}/>
            {statusPulseOn && <span style={{ position:'absolute', inset: 1, background: TC_C.green, borderRadius: 9999, animation:'pui-halo 1.8s ease-out infinite' }}/>}
          </span>
          <span style={{ color: agent.color }}><agent.Icon size={12}/></span>
          {agent.name}
        </div>
        {grouped.map((g, i) => {
          if (g.kind === 'toolgroup') {
            return <PUI_ToolCallGroup key={i} tools={g.tools} isLoading={isLoading} ceremony={ceremony}/>;
          }
          const m = g.m;
          return (
            <div key={i} style={{ display:'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 16, animation: motionOn ? 'pui-msg-rise 260ms ease-out' : 'none' }}>
              {m.role === 'user' ?
                <div style={{ background: TC_C.text, color:'#fff', padding:'8px 16px', borderRadius: 16, fontSize: 14, maxWidth: '70%' }}>{m.content}</div> :
                <div style={{ fontSize: 14, lineHeight: 1.6 }}>{m.content}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

window.PUI_ToolCallCeremony = PUI_ToolCallCeremony;
window.PUI_ToolCallGroup = PUI_ToolCallGroup;
window.PUI_PremiumChatBody = PUI_PremiumChatBody;
window.PUI_STAGES_DEPLOY = PUI_STAGES_DEPLOY;
