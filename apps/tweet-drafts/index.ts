// Tweet Drafts MCP - Store, rate, and categorize tweet drafts

interface TweetDraft {
  id: string;
  text: string;
  category: string | null;
  rating: number | null;
  feedback: string | null;
  notes: string | null;
  charCount: number;
  createdAt: string;
  updatedAt: string;
}

const STORAGE_PREFIX = "draft:";

function makeKey(id: string): string {
  return `${STORAGE_PREFIX}${id}`;
}

export async function saveDraft(args: {
  text: string;
  category?: string;
  notes?: string;
}): Promise<TweetDraft> {
  const { text, category, notes } = args;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const draft: TweetDraft = {
    id,
    text,
    category: category || null,
    rating: null,
    feedback: null,
    notes: notes || null,
    charCount: text.length,
    createdAt: now,
    updatedAt: now,
  };

  await ultralight.store(makeKey(id), draft);
  return draft;
}

export async function rateDraft(args: {
  draftId: string;
  rating: number;
  feedback?: string;
}): Promise<TweetDraft> {
  const { draftId, rating, feedback } = args;

  if (rating < 1 || rating > 5) {
    throw new Error("Rating must be between 1 and 5");
  }

  const draft = (await ultralight.load(makeKey(draftId))) as TweetDraft | null;
  if (!draft) {
    throw new Error(`Draft not found: ${draftId}`);
  }

  draft.rating = Math.round(rating);
  draft.feedback = feedback || draft.feedback;
  draft.updatedAt = new Date().toISOString();

  await ultralight.store(makeKey(draftId), draft);
  return draft;
}

export async function categorizeDraft(args: {
  draftId: string;
  category: string;
}): Promise<TweetDraft> {
  const { draftId, category } = args;

  const draft = (await ultralight.load(makeKey(draftId))) as TweetDraft | null;
  if (!draft) {
    throw new Error(`Draft not found: ${draftId}`);
  }

  draft.category = category;
  draft.updatedAt = new Date().toISOString();

  await ultralight.store(makeKey(draftId), draft);
  return draft;
}

export async function getDraft(args: {
  draftId: string;
}): Promise<TweetDraft> {
  const { draftId } = args;

  const draft = (await ultralight.load(makeKey(draftId))) as TweetDraft | null;
  if (!draft) {
    throw new Error(`Draft not found: ${draftId}`);
  }
  return draft;
}

export async function listDrafts(args: {
  category?: string;
  minRating?: number;
  limit?: number;
} = {}): Promise<{ drafts: TweetDraft[]; total: number }> {
  const { category, minRating, limit } = args;
  const cap = limit || 20;
  const keys = await ultralight.list(STORAGE_PREFIX);
  const drafts: TweetDraft[] = [];

  for (const key of keys) {
    const draft = (await ultralight.load(key)) as TweetDraft | null;
    if (!draft) continue;

    if (category && draft.category !== category) continue;
    if (minRating && (draft.rating === null || draft.rating < minRating)) continue;

    drafts.push(draft);
  }

  drafts.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return {
    drafts: drafts.slice(0, cap),
    total: drafts.length,
  };
}

export async function editDraft(args: {
  draftId: string;
  text: string;
}): Promise<TweetDraft> {
  const { draftId, text } = args;

  const draft = (await ultralight.load(makeKey(draftId))) as TweetDraft | null;
  if (!draft) {
    throw new Error(`Draft not found: ${draftId}`);
  }

  draft.text = text;
  draft.charCount = text.length;
  draft.updatedAt = new Date().toISOString();

  await ultralight.store(makeKey(draftId), draft);
  return draft;
}

export async function deleteDraft(args: {
  draftId: string;
}): Promise<{ deleted: boolean; id: string }> {
  const { draftId } = args;

  const draft = (await ultralight.load(makeKey(draftId))) as TweetDraft | null;
  if (!draft) {
    throw new Error(`Draft not found: ${draftId}`);
  }

  await ultralight.remove(makeKey(draftId));
  return { deleted: true, id: draftId };
}

// ============================================
// SELF-HOSTED UI
// ============================================

export async function ui(request: {
  method: string;
  url: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
}) {
  const tokenFromQuery = request.query.token || "";
  // Extract app ID from the URL: /http/{appId}/ui
  const urlParts = request.url.split("/");
  const httpIdx = urlParts.indexOf("http");
  const appId = httpIdx >= 0 && urlParts.length > httpIdx + 1 ? urlParts[httpIdx + 1] : "";

  const htmlContent = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Tweet Drafts</title><style>' +
    '*{margin:0;padding:0;box-sizing:border-box}' +
    ':root{--bg:#0a0a0a;--surface:#141414;--surface2:#1e1e1e;--border:#2a2a2a;--text:#e5e5e5;--text2:#888;--accent:#3b82f6;--accent-hover:#2563eb;--green:#22c55e;--yellow:#eab308;--red:#ef4444;--orange:#f97316;--purple:#a855f7}' +
    'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;padding:0}' +
    '.container{max-width:720px;margin:0 auto;padding:24px 16px}' +
    'h1{font-size:24px;font-weight:700;margin-bottom:4px}' +
    '.subtitle{color:var(--text2);font-size:14px;margin-bottom:24px}' +
    /* Auth screen */
    '.auth-screen{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;gap:16px}' +
    '.auth-screen h2{font-size:20px}' +
    '.auth-screen p{color:var(--text2);font-size:14px;text-align:center;max-width:360px}' +
    '.token-input{width:100%;max-width:400px;padding:12px 16px;background:var(--surface);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:14px;font-family:monospace;outline:none}' +
    '.token-input:focus{border-color:var(--accent)}' +
    /* Stats bar */
    '.stats{display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap}' +
    '.stat{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 16px;flex:1;min-width:100px}' +
    '.stat-value{font-size:22px;font-weight:700}' +
    '.stat-label{font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-top:2px}' +
    /* Compose area */
    '.compose{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:24px}' +
    '.compose textarea{width:100%;min-height:80px;background:transparent;border:none;color:var(--text);font-size:15px;resize:vertical;outline:none;font-family:inherit;line-height:1.5}' +
    '.compose-footer{display:flex;align-items:center;gap:8px;margin-top:12px;flex-wrap:wrap}' +
    '.char-count{font-size:12px;color:var(--text2);margin-left:auto}' +
    '.char-count.over{color:var(--red)}' +
    /* Buttons */
    'button{cursor:pointer;border:none;border-radius:8px;font-size:13px;font-weight:600;padding:8px 16px;transition:all .15s}' +
    '.btn-primary{background:var(--accent);color:#fff}' +
    '.btn-primary:hover{background:var(--accent-hover)}' +
    '.btn-primary:disabled{opacity:.4;cursor:not-allowed}' +
    '.btn-ghost{background:transparent;color:var(--text2);padding:6px 10px}' +
    '.btn-ghost:hover{background:var(--surface2);color:var(--text)}' +
    '.btn-danger{background:transparent;color:var(--red);padding:6px 10px}' +
    '.btn-danger:hover{background:rgba(239,68,68,.1)}' +
    /* Select / Category */
    'select{background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:6px 10px;font-size:13px;outline:none;cursor:pointer}' +
    /* Draft cards */
    '.drafts-list{display:flex;flex-direction:column;gap:12px}' +
    '.draft-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px;transition:border-color .15s}' +
    '.draft-card:hover{border-color:#333}' +
    '.draft-text{font-size:15px;line-height:1.5;min-height:1.5em;outline:none;word-break:break-word}' +
    '.draft-text[contenteditable="true"]:focus{background:var(--surface2);border-radius:4px;padding:4px;margin:-4px}' +
    '.draft-meta{display:flex;align-items:center;gap:8px;margin-top:12px;flex-wrap:wrap}' +
    '.badge{display:inline-block;padding:3px 10px;border-radius:99px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.3px}' +
    '.badge-cat{background:rgba(168,85,247,.15);color:var(--purple)}' +
    '.draft-time{font-size:11px;color:var(--text2)}' +
    '.draft-chars{font-size:11px;color:var(--text2)}' +
    /* Rating */
    '.rating{display:flex;gap:2px;align-items:center}' +
    '.rating-star{cursor:pointer;font-size:18px;color:var(--border);transition:color .1s;user-select:none;padding:0 1px}' +
    '.rating-star.active{color:var(--yellow)}' +
    '.rating-star:hover{color:var(--yellow)}' +
    /* Feedback */
    '.feedback-text{font-size:12px;color:var(--text2);font-style:italic;margin-top:4px}' +
    /* Notes */
    '.notes-text{font-size:12px;color:var(--text2);margin-top:4px}' +
    /* Inline feedback input */
    '.feedback-input{width:100%;padding:6px 10px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:12px;outline:none;margin-top:6px;font-family:inherit}' +
    /* Filter bar */
    '.filter-bar{display:flex;gap:8px;margin-bottom:16px;align-items:center;flex-wrap:wrap}' +
    '.filter-bar label{font-size:12px;color:var(--text2)}' +
    /* Empty state */
    '.empty{text-align:center;padding:48px 16px;color:var(--text2)}' +
    '.empty-icon{font-size:48px;margin-bottom:12px}' +
    /* Loading */
    '.loading{text-align:center;padding:48px;color:var(--text2)}' +
    '.spinner{display:inline-block;width:24px;height:24px;border:3px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .6s linear infinite}' +
    '@keyframes spin{to{transform:rotate(360deg)}}' +
    /* Toast */
    '.toast{position:fixed;bottom:24px;right:24px;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:12px 20px;border-radius:10px;font-size:13px;opacity:0;transform:translateY(10px);transition:all .3s;pointer-events:none;z-index:99}' +
    '.toast.show{opacity:1;transform:translateY(0)}' +
    '.toast.error{border-color:var(--red);color:var(--red)}' +
    /* Actions row */
    '.actions-right{margin-left:auto;display:flex;gap:4px;align-items:center}' +
    /* Scrollbar */
    '::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}' +
    '</style></head><body>' +
    '<div class="container">' +

    /* Auth screen (hidden by JS if token exists) */
    '<div id="auth-screen" class="auth-screen">' +
    '<div style="font-size:48px">&#9998;</div>' +
    '<h2>Tweet Drafts</h2>' +
    '<p>Enter your Ultralight API token to access your drafts. The token stays in your browser only.</p>' +
    '<input type="password" id="token-input" class="token-input" placeholder="ul_..." />' +
    '<button class="btn-primary" onclick="submitToken()">Connect</button>' +
    '<p style="font-size:11px;color:var(--text2)">Tip: add ?token=ul_... to the URL to skip this step</p>' +
    '</div>' +

    /* Main app (hidden until auth) */
    '<div id="app" style="display:none">' +
    '<h1>&#9998; Tweet Drafts</h1>' +
    '<p class="subtitle">Store, rate &amp; categorize your tweets before they go live</p>' +

    /* Stats row */
    '<div id="stats" class="stats"></div>' +

    /* Compose */
    '<div class="compose">' +
    '<textarea id="compose-text" placeholder="What&#39;s on your mind?" oninput="updateCharCount()"></textarea>' +
    '<div class="compose-footer">' +
    '<select id="compose-cat"><option value="">Category...</option><option value="tech">tech</option><option value="personal">personal</option><option value="promo">promo</option><option value="thread">thread</option><option value="hot-take">hot-take</option></select>' +
    '<input type="text" id="compose-notes" class="token-input" placeholder="Notes (optional)" style="flex:1;max-width:200px;padding:6px 10px;font-family:inherit;font-size:13px" />' +
    '<span id="char-count" class="char-count">0/280</span>' +
    '<button class="btn-primary" id="save-btn" onclick="saveDraft()">Save Draft</button>' +
    '</div></div>' +

    /* Filters */
    '<div class="filter-bar">' +
    '<label>Filter:</label>' +
    '<select id="filter-cat" onchange="loadDrafts()"><option value="">All categories</option><option value="tech">tech</option><option value="personal">personal</option><option value="promo">promo</option><option value="thread">thread</option><option value="hot-take">hot-take</option></select>' +
    '<select id="filter-rating" onchange="loadDrafts()"><option value="">Any rating</option><option value="5">5 only</option><option value="4">4+</option><option value="3">3+</option></select>' +
    '</div>' +

    /* Drafts list */
    '<div id="drafts" class="drafts-list"><div class="loading"><div class="spinner"></div></div></div>' +

    '</div>' +

    /* Toast */
    '<div id="toast" class="toast"></div>' +

    '</div>' +

    '<script>' +
    'const APP_ID = "' + appId + '";' +
    'let TOKEN = sessionStorage.getItem("ul_token") || "";' +
    'const PARAM_TOKEN = "' + tokenFromQuery + '";' +

    'var TOOL_PREFIX = "";' +

    'if (PARAM_TOKEN) { TOKEN = PARAM_TOKEN; sessionStorage.setItem("ul_token", TOKEN); }' +

    'if (TOKEN) { document.getElementById("auth-screen").style.display = "none"; document.getElementById("app").style.display = "block"; init(); }' +

    'function submitToken() {' +
    '  const t = document.getElementById("token-input").value.trim();' +
    '  if (!t) return;' +
    '  TOKEN = t; sessionStorage.setItem("ul_token", TOKEN);' +
    '  document.getElementById("auth-screen").style.display = "none";' +
    '  document.getElementById("app").style.display = "block";' +
    '  init();' +
    '}' +

    'document.getElementById("token-input").addEventListener("keydown", function(e) { if (e.key === "Enter") submitToken(); });' +

    /* Discover tool prefix from tools/list */
    'async function discoverPrefix() {' +
    '  try {' +
    '    const res = await fetch("/mcp/" + APP_ID, {' +
    '      method: "POST",' +
    '      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + TOKEN },' +
    '      body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "tools/list" })' +
    '    });' +
    '    const data = await res.json();' +
    '    if (data.result && data.result.tools) {' +
    '      var t = data.result.tools.find(function(x) { return x.title === "saveDraft"; });' +
    '      if (t && t.name.indexOf("_") > -1) { TOOL_PREFIX = t.name.split("_").slice(0,-1).join("_") + "_"; }' +
    '    }' +
    '  } catch(e) { console.warn("Could not discover prefix:", e); }' +
    '}' +

    /* MCP call helper */
    'async function mcp(tool, args) {' +
    '  const res = await fetch("/mcp/" + APP_ID, {' +
    '    method: "POST",' +
    '    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + TOKEN },' +
    '    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name: TOOL_PREFIX + tool, arguments: args || {} } })' +
    '  });' +
    '  const data = await res.json();' +
    '  if (data.result && data.result.isError) throw new Error(data.result.content[0].text);' +
    '  return data.result ? data.result.structuredContent : null;' +
    '}' +

    /* Toast */
    'let toastTimer;' +
    'function toast(msg, isError) {' +
    '  const el = document.getElementById("toast");' +
    '  el.textContent = msg;' +
    '  el.className = "toast show" + (isError ? " error" : "");' +
    '  clearTimeout(toastTimer);' +
    '  toastTimer = setTimeout(function() { el.className = "toast"; }, 2500);' +
    '}' +

    /* Init */
    'async function init() { await discoverPrefix(); await Promise.all([loadStats(), loadDrafts()]); }' +

    /* Stats */
    'async function loadStats() {' +
    '  try {' +
    '    const s = await mcp("getStats", {});' +
    '    if (!s) return;' +
    '    document.getElementById("stats").innerHTML =' +
    '      \'<div class="stat"><div class="stat-value">\' + s.totalDrafts + \'</div><div class="stat-label">Drafts</div></div>\' +' +
    '      \'<div class="stat"><div class="stat-value">\' + (s.averageRating !== null ? s.averageRating : "-") + \'</div><div class="stat-label">Avg Rating</div></div>\' +' +
    '      \'<div class="stat"><div class="stat-value">\' + s.ratedCount + \'</div><div class="stat-label">Rated</div></div>\' +' +
    '      \'<div class="stat"><div class="stat-value">\' + s.averageCharCount + \'</div><div class="stat-label">Avg Chars</div></div>\';' +
    '  } catch(e) { console.error("Stats error:", e); }' +
    '}' +

    /* Char counter */
    'function updateCharCount() {' +
    '  const len = document.getElementById("compose-text").value.length;' +
    '  const el = document.getElementById("char-count");' +
    '  el.textContent = len + "/280";' +
    '  el.className = "char-count" + (len > 280 ? " over" : "");' +
    '}' +

    /* Save draft */
    'async function saveDraft() {' +
    '  const text = document.getElementById("compose-text").value.trim();' +
    '  if (!text) return;' +
    '  const cat = document.getElementById("compose-cat").value || undefined;' +
    '  const notes = document.getElementById("compose-notes").value.trim() || undefined;' +
    '  document.getElementById("save-btn").disabled = true;' +
    '  try {' +
    '    await mcp("saveDraft", { text: text, category: cat, notes: notes });' +
    '    document.getElementById("compose-text").value = "";' +
    '    document.getElementById("compose-notes").value = "";' +
    '    document.getElementById("compose-cat").value = "";' +
    '    updateCharCount();' +
    '    toast("Draft saved!");' +
    '    await Promise.all([loadStats(), loadDrafts()]);' +
    '  } catch(e) { toast("Failed: " + e.message, true); }' +
    '  document.getElementById("save-btn").disabled = false;' +
    '}' +

    /* Load drafts */
    'async function loadDrafts() {' +
    '  const catFilter = document.getElementById("filter-cat").value || undefined;' +
    '  const minRating = parseInt(document.getElementById("filter-rating").value) || undefined;' +
    '  try {' +
    '    const result = await mcp("listDrafts", { category: catFilter, minRating: minRating, limit: 50 });' +
    '    if (!result || !result.drafts) { document.getElementById("drafts").innerHTML = \'<div class="empty"><div class="empty-icon">&#128221;</div>No drafts yet. Write your first one above!</div>\'; return; }' +
    '    if (result.drafts.length === 0) { document.getElementById("drafts").innerHTML = \'<div class="empty"><div class="empty-icon">&#128269;</div>No drafts match your filters</div>\'; return; }' +
    '    document.getElementById("drafts").innerHTML = result.drafts.map(renderDraft).join("");' +
    '  } catch(e) { document.getElementById("drafts").innerHTML = \'<div class="empty" style="color:var(--red)">Failed to load: \' + e.message + \'</div>\'; }' +
    '}' +

    /* Render a single draft card */
    'function renderDraft(d) {' +
    '  var stars = "";' +
    '  for (var i = 1; i <= 5; i++) {' +
    '    stars += \'<span class="rating-star\' + (d.rating !== null && i <= d.rating ? " active" : "") + \'" onclick="rateDraft(\\x27\' + d.id + \'\\x27,\' + i + \')">\' + (d.rating !== null && i <= d.rating ? "&#9733;" : "&#9734;") + \'</span>\';' +
    '  }' +
    '  var catBadge = d.category ? \'<span class="badge badge-cat">\' + d.category + \'</span>\' : "";' +
    '  var feedback = d.feedback ? \'<div class="feedback-text">&ldquo;\' + escHtml(d.feedback) + \'&rdquo;</div>\' : "";' +
    '  var notes = d.notes ? \'<div class="notes-text">&#128203; \' + escHtml(d.notes) + \'</div>\' : "";' +
    '  var timeAgo = formatTime(d.createdAt);' +
    '  return \'<div class="draft-card" id="draft-\' + d.id + \'">\' +' +
    '    \'<div class="draft-text" contenteditable="true" onblur="onEditBlur(\\x27\' + d.id + \'\\x27, this)">\' + escHtml(d.text) + \'</div>\' +' +
    '    feedback + notes +' +
    '    \'<div class="draft-meta">\' +' +
    '    \'<div class="rating">\' + stars + \'</div>\' +' +
    '    catBadge +' +
    '    \'<span class="draft-chars">\' + d.charCount + \' chars</span>\' +' +
    '    \'<span class="draft-time">\' + timeAgo + \'</span>\' +' +
    '    \'<div class="actions-right">\' +' +
    '    \'<select onchange="onCatChange(\\x27\' + d.id + \'\\x27, this.value)" style="font-size:11px;padding:3px 6px"><option value="">\' + (d.category || "set category") + \'</option><option value="tech">tech</option><option value="personal">personal</option><option value="promo">promo</option><option value="thread">thread</option><option value="hot-take">hot-take</option></select>\' +' +
    '    \'<button class="btn-ghost" onclick="promptFeedback(\\x27\' + d.id + \'\\x27)" title="Add feedback">&#128172;</button>\' +' +
    '    \'<button class="btn-danger" onclick="deleteDraft(\\x27\' + d.id + \'\\x27)" title="Delete">&#128465;</button>\' +' +
    '    \'</div></div></div>\';' +
    '}' +

    /* Escape HTML */
    'function escHtml(s) { var d = document.createElement("div"); d.textContent = s; return d.innerHTML; }' +

    /* Time formatting */
    'function formatTime(iso) {' +
    '  var diff = Date.now() - new Date(iso).getTime();' +
    '  var mins = Math.floor(diff / 60000);' +
    '  if (mins < 1) return "just now";' +
    '  if (mins < 60) return mins + "m ago";' +
    '  var hrs = Math.floor(mins / 60);' +
    '  if (hrs < 24) return hrs + "h ago";' +
    '  var days = Math.floor(hrs / 24);' +
    '  return days + "d ago";' +
    '}' +

    /* Inline edit */
    'async function onEditBlur(id, el) {' +
    '  var newText = el.textContent.trim();' +
    '  if (!newText) return;' +
    '  try {' +
    '    await mcp("editDraft", { draftId: id, text: newText });' +
    '    toast("Saved edit");' +
    '    loadStats();' +
    '  } catch(e) { toast("Edit failed: " + e.message, true); }' +
    '}' +

    /* Rate */
    'async function rateDraft(id, rating) {' +
    '  try {' +
    '    await mcp("rateDraft", { draftId: id, rating: rating });' +
    '    toast("Rated " + rating + "/5");' +
    '    await Promise.all([loadStats(), loadDrafts()]);' +
    '  } catch(e) { toast("Rate failed: " + e.message, true); }' +
    '}' +

    /* Category change */
    'async function onCatChange(id, cat) {' +
    '  if (!cat) return;' +
    '  try {' +
    '    await mcp("categorizeDraft", { draftId: id, category: cat });' +
    '    toast("Category: " + cat);' +
    '    await Promise.all([loadStats(), loadDrafts()]);' +
    '  } catch(e) { toast("Failed: " + e.message, true); }' +
    '}' +

    /* Feedback prompt */
    'async function promptFeedback(id) {' +
    '  var card = document.getElementById("draft-" + id);' +
    '  if (card.querySelector(".feedback-input")) return;' +
    '  var input = document.createElement("input");' +
    '  input.className = "feedback-input";' +
    '  input.placeholder = "Add feedback for this draft...";' +
    '  input.onkeydown = async function(e) {' +
    '    if (e.key === "Enter" && input.value.trim()) {' +
    '      try {' +
    '        var currentRating = card.querySelectorAll(".rating-star.active").length || 3;' +
    '        await mcp("rateDraft", { draftId: id, rating: currentRating, feedback: input.value.trim() });' +
    '        toast("Feedback saved");' +
    '        loadDrafts();' +
    '      } catch(err) { toast("Failed: " + err.message, true); }' +
    '    }' +
    '    if (e.key === "Escape") input.remove();' +
    '  };' +
    '  card.appendChild(input);' +
    '  input.focus();' +
    '}' +

    /* Delete */
    'async function deleteDraft(id) {' +
    '  if (!confirm("Delete this draft?")) return;' +
    '  try {' +
    '    await mcp("deleteDraft", { draftId: id });' +
    '    toast("Deleted");' +
    '    await Promise.all([loadStats(), loadDrafts()]);' +
    '  } catch(e) { toast("Delete failed: " + e.message, true); }' +
    '}' +

    '</script></body></html>';

  return http.html(htmlContent);
}

// ============================================
// STATS
// ============================================

export async function getStats(): Promise<Record<string, unknown>> {
  const keys = await ultralight.list(STORAGE_PREFIX);
  const drafts: TweetDraft[] = [];

  for (const key of keys) {
    const draft = (await ultralight.load(key)) as TweetDraft | null;
    if (draft) drafts.push(draft);
  }

  const rated = drafts.filter((d) => d.rating !== null);
  const avgRating =
    rated.length > 0
      ? Math.round(
          (rated.reduce((sum, d) => sum + (d.rating as number), 0) / rated.length) * 10
        ) / 10
      : null;

  const categoryCounts: Record<string, number> = {};
  for (const d of drafts) {
    const cat = d.category || "uncategorized";
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
  }

  const ratingDistribution: Record<string, number> = {};
  for (const d of rated) {
    const r = String(d.rating);
    ratingDistribution[r] = (ratingDistribution[r] || 0) + 1;
  }

  const totalChars = drafts.reduce((sum, d) => sum + d.charCount, 0);
  const meanChars = drafts.length > 0 ? Math.round(totalChars / drafts.length) : 0;

  return {
    totalDrafts: drafts.length,
    averageRating: avgRating,
    ratedCount: rated.length,
    categoryCounts: categoryCounts,
    ratingDistribution: ratingDistribution,
    averageCharCount: meanChars,
  };
}
