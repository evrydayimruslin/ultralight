// Public Homepage
// Server-rendered landing page showcasing top MCP servers, content,
// open gaps, recent fulfillments, and the points leaderboard.

function esc(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function relTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = Date.now();
  const diff = now - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export interface HomepageData {
  topApps: Array<{
    id: string;
    name: string;
    slug: string;
    description: string | null;
    weighted_likes: number;
    runs_30d: number;
  }>;
  topContent: Array<{
    slug: string;
    title: string | null;
    owner_id: string;
    updated_at: string;
    tags: string[] | null;
  }>;
  openGaps: Array<{
    id: string;
    title: string;
    description: string;
    severity: string;
    points_value: number;
  }>;
  recentFulfillments: Array<{
    gap_title: string;
    app_name: string;
    user_name: string;
    user_id: string;
    awarded_points: number;
    reviewed_at: string;
  }>;
  leaderboard: Array<{
    user_id: string;
    display_name: string;
    total_points: number;
  }>;
  baseUrl: string;
}

export function getHomepageHTML(data: HomepageData): string {
  const severityColor: Record<string, string> = {
    critical: '#ef4444',
    high: '#f59e0b',
    medium: '#a78bfa',
    low: '#71717a',
  };

  const topAppsHtml = data.topApps.length > 0
    ? data.topApps.map((a, i) => `
      <a href="/app/${esc(a.id)}" class="card">
        <div class="card-rank">${i + 1}</div>
        <div class="card-icon">&#9889;</div>
        <div class="card-body">
          <div class="card-title">${esc(a.name || a.slug)}</div>
          ${a.description ? `<div class="card-desc">${esc(a.description).slice(0, 120)}</div>` : ''}
          <div class="card-meta">
            <span class="stat">${a.weighted_likes ?? 0} &#9829;</span>
            <span class="stat">${a.runs_30d ?? 0} runs</span>
          </div>
        </div>
      </a>`).join('')
    : '<p class="empty">No MCP servers published yet. Be the first!</p>';

  const topContentHtml = data.topContent.length > 0
    ? data.topContent.map(p => `
      <a href="/p/${esc(p.owner_id)}/${esc(p.slug)}" class="card card-sm">
        <div class="card-icon">&#128196;</div>
        <div class="card-body">
          <div class="card-title">${esc(p.title || p.slug)}</div>
          <div class="card-meta">
            ${(p.tags || []).slice(0, 3).map(t => `<span class="tag">${esc(t)}</span>`).join('')}
            <span class="card-date">${relTime(p.updated_at)}</span>
          </div>
        </div>
      </a>`).join('')
    : '<p class="empty">No published content yet.</p>';

  const gapsHtml = data.openGaps.length > 0
    ? data.openGaps.map(g => `
      <div class="gap-card">
        <div class="gap-header">
          <span class="severity-badge" style="background:${severityColor[g.severity] || '#71717a'}">${esc(g.severity)}</span>
          <span class="points-badge">${g.points_value} pts</span>
        </div>
        <div class="gap-title">${esc(g.title)}</div>
        <div class="gap-desc">${esc(g.description).slice(0, 160)}</div>
      </div>`).join('')
    : '<p class="empty">No open gaps right now. Check back soon!</p>';

  const fulfillmentsHtml = data.recentFulfillments.length > 0
    ? data.recentFulfillments.map(f => `
      <div class="fulfillment">
        <a href="/u/${esc(f.user_id)}" class="fulfillment-user">${esc(f.user_name)}</a>
        solved <span class="fulfillment-gap">${esc(f.gap_title)}</span>
        with <span class="fulfillment-app">${esc(f.app_name)}</span>
        and earned <span class="fulfillment-pts">${f.awarded_points} pts</span>
        <span class="fulfillment-time">${relTime(f.reviewed_at)}</span>
      </div>`).join('')
    : '<p class="empty">No fulfillments yet. Claim a gap and be first!</p>';

  const leaderboardHtml = data.leaderboard.length > 0
    ? data.leaderboard.map((u, i) => `
      <div class="lb-row">
        <span class="lb-rank">${i + 1}</span>
        <a href="/u/${esc(u.user_id)}" class="lb-name">${esc(u.display_name)}</a>
        <span class="lb-pts">${u.total_points.toLocaleString()} pts</span>
      </div>`).join('')
    : '<p class="empty">Leaderboard is empty. Start earning points!</p>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ultralight — Turn TypeScript Functions into MCP Servers</title>
<meta name="description" content="Build, publish, and discover MCP servers. Turn any TypeScript function into a tool AI agents can use.">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;background:#0a0a0f;color:#e4e4e7;line-height:1.6}
a{color:#a78bfa;text-decoration:none}
a:hover{color:#c4b5fd}

.hero{text-align:center;padding:4rem 1.5rem 3rem;max-width:640px;margin:0 auto}
.hero-logo{font-size:1.5rem;font-weight:700;background:linear-gradient(135deg,#6366f1,#8b5cf6);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:1rem;letter-spacing:-0.02em}
.hero h1{font-size:2.25rem;font-weight:700;color:#fafafa;line-height:1.2;margin-bottom:0.75rem}
.hero p{color:#a1a1aa;font-size:1.05rem;margin-bottom:1.5rem}
.hero-actions{display:flex;gap:0.75rem;justify-content:center;flex-wrap:wrap}
.btn{display:inline-flex;align-items:center;gap:0.4rem;padding:0.6rem 1.25rem;border-radius:8px;font-size:0.875rem;font-weight:500;transition:all 0.15s}
.btn-primary{background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff}
.btn-primary:hover{opacity:0.9;color:#fff}
.btn-secondary{background:#18181b;color:#e4e4e7;border:1px solid #27272a}
.btn-secondary:hover{border-color:#3f3f46;color:#fff}

.container{max-width:1080px;margin:0 auto;padding:0 1.5rem 3rem}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:2rem}
@media(max-width:768px){.grid{grid-template-columns:1fr}}

.section{margin-bottom:2.5rem}
.section-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem}
.section-title{font-size:0.75rem;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:#71717a}
.section-link{font-size:0.8rem;color:#a78bfa}

.card{display:flex;gap:0.75rem;padding:0.875rem;background:#18181b;border:1px solid #27272a;border-radius:10px;transition:border-color 0.15s;margin-bottom:0.5rem}
.card:hover{border-color:#3f3f46;color:#e4e4e7}
.card-sm{padding:0.65rem 0.875rem}
.card-rank{width:1.5rem;font-size:0.8rem;font-weight:700;color:#71717a;display:flex;align-items:flex-start;padding-top:0.1rem}
.card-icon{font-size:1.25rem;flex-shrink:0;width:2rem;height:2rem;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:8px}
.card-body{flex:1;min-width:0}
.card-title{font-size:0.875rem;font-weight:600;color:#fafafa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.card-desc{font-size:0.8rem;color:#a1a1aa;margin-top:0.15rem;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card-meta{display:flex;gap:0.5rem;align-items:center;margin-top:0.35rem;flex-wrap:wrap}
.card-date{font-size:0.75rem;color:#52525b}
.stat{font-size:0.75rem;color:#71717a}

.tag{font-size:0.65rem;padding:0.15rem 0.5rem;background:#27272a;border-radius:9999px;color:#a1a1aa}

.gap-card{padding:0.875rem;background:#18181b;border:1px solid #27272a;border-radius:10px;margin-bottom:0.5rem}
.gap-header{display:flex;gap:0.5rem;align-items:center;margin-bottom:0.4rem}
.severity-badge{font-size:0.65rem;padding:0.1rem 0.5rem;border-radius:9999px;color:#fff;font-weight:600;text-transform:uppercase}
.points-badge{font-size:0.75rem;font-weight:600;color:#a78bfa;margin-left:auto}
.gap-title{font-size:0.875rem;font-weight:600;color:#fafafa}
.gap-desc{font-size:0.8rem;color:#a1a1aa;margin-top:0.2rem;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}

.fulfillment{font-size:0.8rem;color:#a1a1aa;padding:0.5rem 0;border-bottom:1px solid #1e1e24}
.fulfillment:last-child{border-bottom:none}
.fulfillment-user{color:#a78bfa;font-weight:500}
.fulfillment-gap{color:#fafafa;font-weight:500}
.fulfillment-app{color:#22c55e;font-weight:500}
.fulfillment-pts{color:#f59e0b;font-weight:600}
.fulfillment-time{color:#52525b;float:right}

.lb-row{display:flex;align-items:center;gap:0.75rem;padding:0.5rem 0;border-bottom:1px solid #1e1e24}
.lb-row:last-child{border-bottom:none}
.lb-rank{width:1.5rem;font-size:0.8rem;font-weight:700;color:#71717a;text-align:center}
.lb-name{flex:1;font-size:0.875rem;font-weight:500}
.lb-pts{font-size:0.8rem;font-weight:600;color:#f59e0b}

.empty{color:#52525b;font-size:0.8rem;text-align:center;padding:1.5rem}

.footer{text-align:center;padding:2rem 0;color:#3f3f46;font-size:0.75rem}
.footer a{color:#52525b}
</style>
</head>
<body>

<div class="hero">
  <div class="hero-logo">Ultralight</div>
  <h1>Turn TypeScript functions into MCP servers</h1>
  <p>Build, publish, and discover tools that AI agents can use. Earn points by filling platform gaps.</p>
  <div class="hero-actions">
    <a href="/dash" class="btn btn-primary">&#9889; Open Dashboard</a>
    <a href="/gaps" class="btn btn-secondary">Browse Gaps</a>
    <a href="/leaderboard" class="btn btn-secondary">&#127942; Leaderboard</a>
  </div>
</div>

<div class="container">
  <div class="grid">
    <div>
      <div class="section">
        <div class="section-header">
          <div class="section-title">Top MCP Servers</div>
        </div>
        ${topAppsHtml}
      </div>

      <div class="section">
        <div class="section-header">
          <div class="section-title">Recent Content</div>
        </div>
        ${topContentHtml}
      </div>
    </div>

    <div>
      <div class="section">
        <div class="section-header">
          <div class="section-title">Open Gaps</div>
          <a href="/gaps" class="section-link">View all &rarr;</a>
        </div>
        ${gapsHtml}
      </div>

      <div class="section">
        <div class="section-header">
          <div class="section-title">Recent Fulfillments</div>
        </div>
        ${fulfillmentsHtml}
      </div>

      <div class="section">
        <div class="section-header">
          <div class="section-title">Leaderboard</div>
          <a href="/leaderboard" class="section-link">Full rankings &rarr;</a>
        </div>
        ${leaderboardHtml}
      </div>
    </div>
  </div>
</div>

<div class="footer">
  <a href="/dash">Dashboard</a> &middot; <a href="/gaps">Gaps</a> &middot; <a href="/leaderboard">Leaderboard</a>
</div>

</body>
</html>`;
}

export function getGapsPageHTML(gaps: Array<{
  id: string;
  title: string;
  description: string;
  severity: string;
  points_value: number;
  season: number;
  status: string;
  created_at: string;
}>, filters: { status: string; severity?: string }): string {
  const severityColor: Record<string, string> = {
    critical: '#ef4444',
    high: '#f59e0b',
    medium: '#a78bfa',
    low: '#71717a',
  };

  const gapRows = gaps.length > 0
    ? gaps.map(g => `
      <div class="gap-row">
        <div class="gap-left">
          <span class="severity-badge" style="background:${severityColor[g.severity] || '#71717a'}">${esc(g.severity)}</span>
          <div>
            <div class="gap-title">${esc(g.title)}</div>
            <div class="gap-desc">${esc(g.description)}</div>
          </div>
        </div>
        <div class="gap-right">
          <div class="gap-pts">${g.points_value} pts</div>
          <div class="gap-status">${esc(g.status)}</div>
          <div class="gap-date">${relTime(g.created_at)}</div>
        </div>
      </div>`).join('')
    : '<p class="empty">No gaps match your filters.</p>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Platform Gaps — Ultralight</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;background:#0a0a0f;color:#e4e4e7;line-height:1.6}
a{color:#a78bfa;text-decoration:none}
a:hover{color:#c4b5fd}

.header{text-align:center;padding:3rem 1.5rem 2rem}
.header h1{font-size:1.75rem;font-weight:700;color:#fafafa;margin-bottom:0.5rem}
.header p{color:#a1a1aa;font-size:0.9rem}

.nav{display:flex;justify-content:center;gap:0.5rem;padding:0 1.5rem 2rem;flex-wrap:wrap}
.nav a{padding:0.4rem 0.9rem;border-radius:9999px;font-size:0.8rem;font-weight:500;background:#18181b;border:1px solid #27272a;color:#a1a1aa;transition:all 0.15s}
.nav a:hover,.nav a.active{border-color:#a78bfa;color:#a78bfa}

.container{max-width:800px;margin:0 auto;padding:0 1.5rem 3rem}

.gap-row{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;padding:1rem;background:#18181b;border:1px solid #27272a;border-radius:10px;margin-bottom:0.5rem}
.gap-left{display:flex;gap:0.75rem;align-items:flex-start;flex:1;min-width:0}
.gap-right{text-align:right;flex-shrink:0}
.severity-badge{font-size:0.65rem;padding:0.15rem 0.5rem;border-radius:9999px;color:#fff;font-weight:600;text-transform:uppercase;white-space:nowrap;display:inline-block;margin-top:0.15rem}
.gap-title{font-size:0.875rem;font-weight:600;color:#fafafa}
.gap-desc{font-size:0.8rem;color:#a1a1aa;margin-top:0.2rem;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.gap-pts{font-size:0.9rem;font-weight:700;color:#f59e0b}
.gap-status{font-size:0.7rem;color:#71717a;text-transform:uppercase;margin-top:0.15rem}
.gap-date{font-size:0.7rem;color:#52525b;margin-top:0.1rem}

.empty{color:#52525b;font-size:0.875rem;text-align:center;padding:2rem}

.footer{text-align:center;padding:2rem 0;color:#3f3f46;font-size:0.75rem}
.footer a{color:#52525b}
@media(max-width:600px){.gap-row{flex-direction:column}.gap-right{text-align:left;display:flex;gap:1rem;align-items:center}}
</style>
</head>
<body>

<div class="header">
  <h1>Platform Gaps</h1>
  <p>MCP servers the platform needs. Build one, earn points, strengthen the ecosystem.</p>
</div>

<div class="nav">
  <a href="/gaps?status=open" class="${filters.status === 'open' ? 'active' : ''}">Open</a>
  <a href="/gaps?status=claimed" class="${filters.status === 'claimed' ? 'active' : ''}">Claimed</a>
  <a href="/gaps?status=fulfilled" class="${filters.status === 'fulfilled' ? 'active' : ''}">Fulfilled</a>
  <a href="/gaps?status=all" class="${filters.status === 'all' ? 'active' : ''}">All</a>
</div>

<div class="container">
  ${gapRows}
</div>

<div class="footer">
  <a href="/">Home</a> &middot; <a href="/dash">Dashboard</a> &middot; <a href="/leaderboard">Leaderboard</a>
</div>

</body>
</html>`;
}

export function getLeaderboardPageHTML(entries: Array<{
  user_id: string;
  display_name: string;
  total_points: number;
}>, season: { id: number; name: string } | null): string {
  const rows = entries.length > 0
    ? entries.map((u, i) => {
        const medal = i === 0 ? '&#129351;' : i === 1 ? '&#129352;' : i === 2 ? '&#129353;' : '';
        return `
      <div class="lb-row${i < 3 ? ' lb-top' : ''}">
        <span class="lb-rank">${medal || (i + 1)}</span>
        <a href="/u/${esc(u.user_id)}" class="lb-name">${esc(u.display_name)}</a>
        <span class="lb-pts">${u.total_points.toLocaleString()} pts</span>
      </div>`;
      }).join('')
    : '<p class="empty">No points earned yet this season. Be the first!</p>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Leaderboard — Ultralight</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;background:#0a0a0f;color:#e4e4e7;line-height:1.6}
a{color:#a78bfa;text-decoration:none}
a:hover{color:#c4b5fd}

.header{text-align:center;padding:3rem 1.5rem 2rem}
.header h1{font-size:1.75rem;font-weight:700;color:#fafafa;margin-bottom:0.5rem}
.header p{color:#a1a1aa;font-size:0.9rem}
.season-name{display:inline-block;background:#27272a;padding:0.2rem 0.75rem;border-radius:9999px;font-size:0.8rem;color:#a78bfa;font-weight:500;margin-top:0.5rem}

.container{max-width:600px;margin:0 auto;padding:0 1.5rem 3rem}

.lb-row{display:flex;align-items:center;gap:0.75rem;padding:0.75rem 1rem;border-bottom:1px solid #1e1e24}
.lb-row:last-child{border-bottom:none}
.lb-top{background:#18181b;border-radius:10px;border-bottom:none;margin-bottom:0.25rem}
.lb-rank{width:2rem;font-size:1rem;font-weight:700;color:#71717a;text-align:center}
.lb-top .lb-rank{font-size:1.25rem}
.lb-name{flex:1;font-size:0.9rem;font-weight:500}
.lb-pts{font-size:0.875rem;font-weight:700;color:#f59e0b}

.empty{color:#52525b;font-size:0.875rem;text-align:center;padding:2rem}

.footer{text-align:center;padding:2rem 0;color:#3f3f46;font-size:0.75rem}
.footer a{color:#52525b}
</style>
</head>
<body>

<div class="header">
  <h1>Leaderboard</h1>
  <p>Earn points by building MCP servers that fill platform gaps.</p>
  ${season ? `<div class="season-name">${esc(season.name)}</div>` : ''}
</div>

<div class="container">
  ${rows}
</div>

<div class="footer">
  <a href="/">Home</a> &middot; <a href="/dash">Dashboard</a> &middot; <a href="/gaps">Gaps</a>
</div>

</body>
</html>`;
}
