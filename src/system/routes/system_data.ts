/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/**
 * Visitor logging + log viewer. Mounted at /v2/system-data.
 *   POST/GET /v2/system-data/helper   public ingest (frontend pings on nav)
 *   GET      /v2/system-data/         admin HTML viewer
 *   GET      /v2/system-data/api/*    admin JSON API
 */

import { Hono } from "hono";

import type { Env } from "../hono";
import { logVisitor, LogQuery } from "../services/visitors";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { HttpError } from "../errors";

export const systemDataRoutes = new Hono<Env>();

// ---- Public ingest (must be registered before the admin guard) ------------

systemDataRoutes.post("/helper", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { path?: unknown };
  const path = typeof body.path === "string" ? body.path : undefined;
  await logVisitor(c.req.raw, { path });
  return c.json({ ok: true });
});

systemDataRoutes.get("/helper", async (c) => {
  const path = c.req.query("path");
  await logVisitor(c.req.raw, { path });
  return c.json({ ok: true });
});

// ---- Everything below requires an authenticated admin ---------------------

systemDataRoutes.use("*", requireAuth, requireAdmin);

systemDataRoutes.get("/api/stats", (c) => {
  try {
    return c.json(LogQuery.stats());
  } catch (err) {
    throw new HttpError(500, `DB error: ${String(err)}`);
  }
});

systemDataRoutes.get("/api/recent", (c) => {
  let limit = Number(c.req.query("limit") ?? 100);
  if (Number.isNaN(limit)) limit = 100;
  limit = Math.min(1000, Math.max(1, limit));
  return c.json(LogQuery.recent(limit));
});

systemDataRoutes.get("/api/by-ip/:ip", (c) => c.json(LogQuery.findByIp(c.req.param("ip"))));

systemDataRoutes.get("/api/by-path", (c) => {
  const q = c.req.query("q") ?? "";
  if (!q) throw new HttpError(422, "Query param 'q' is required");
  return c.json(LogQuery.findByPath(q));
});

systemDataRoutes.get("/api/suspicious", (c) => c.json(LogQuery.findSuspiciousPatterns()));

systemDataRoutes.get("/api/entry/:entry_id", (c) => {
  const entryId = Number(c.req.param("entry_id"));
  if (Number.isNaN(entryId)) throw new HttpError(422, "'entry_id' must be an integer");
  const row = LogQuery.entry(entryId);
  if (!row) throw new HttpError(404, "Entry not found");
  return c.json(row);
});

systemDataRoutes.get("/healthz", (c) => c.json({ ok: true, db: "durable-object-sqlite" }));

systemDataRoutes.get("/", (c) => c.html(INDEX_HTML));

// ---------------------------------------------------------------------------
// HTML UI (single page, vanilla JS, no build step). Ported from the old
// relay page; every fetch() is prefixed with the new mount point.
// ---------------------------------------------------------------------------

const INDEX_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Visitor Log Relay</title>
<style>
  /* Comic Code + info dark palette, matching every other app. */
  @font-face { font-family: "Comic Code";
    src: url("https://fonts.doughmination.co.uk/ComicCode-Regular_2022-05-24-151938_hsmz.woff2") format("woff2");
    font-weight: 400; font-style: normal; font-display: swap; }
  @font-face { font-family: "Comic Code";
    src: url("https://fonts.doughmination.co.uk/ComicCode-Bold_2022-05-24-152309_zqkm.woff2") format("woff2");
    font-weight: 700; font-style: normal; font-display: swap; }
  :root { color-scheme: dark; }
  body { font: 14px/1.4 "Comic Code", ui-monospace, monospace; margin: 0; padding: 16px;
         background: #0a0b10; color: #f4f6fb; }
  h1 { margin: 0 0 8px; font-size: 18px; }
  .stats { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
  .stat { background: #12141c; border: 1px solid #232838; border-radius: 8px;
          padding: 8px 12px; min-width: 120px; }
  .stat .n { font-size: 22px; font-weight: 600; }
  .stat .l { font-size: 11px; opacity: 0.7; text-transform: uppercase; letter-spacing: 0.05em; }
  .controls { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; align-items: center; }
  input, select, button { font: inherit; padding: 6px 10px; border-radius: 6px;
                          border: 1px solid #232838; background: #12141c;
                          color: inherit; }
  button { cursor: pointer; }
  button.primary { background: #f5a9b8; border-color: #f5a9b8; color: #0a0b10; }
  table { width: 100%; border-collapse: collapse; background: #0e1017;
          border: 1px solid #232838; border-radius: 8px; overflow: hidden; }
  th, td { padding: 6px 10px; text-align: left; border-bottom: 1px solid #1b1e2a;
           font-size: 13px; vertical-align: top; }
  th { background: #12141c; font-weight: 600; }
  tr:hover { background: #1b1e2a; cursor: pointer; }
  td.ip { font-family: "Comic Code", ui-monospace, monospace; }
  td.path { font-family: "Comic Code", ui-monospace, monospace; max-width: 320px;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .code-2xx { color: #6ee787; }
  .code-3xx { color: #f0c674; }
  .code-4xx, .code-5xx { color: #ff6b6b; }
  .top-paths { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
  .top-paths span { background: #12141c; border: 1px solid #232838;
                    border-radius: 4px; padding: 2px 6px; font-size: 12px;
                    font-family: "Comic Code", ui-monospace, monospace; }
  details { margin-top: 12px; }
  pre { background: #12141c; border: 1px solid #232838; padding: 8px;
        border-radius: 6px; overflow: auto; max-height: 60vh; font-size: 12px; }
  .hint { opacity: 0.6; font-size: 12px; margin-left: auto; }
  .empty { opacity: 0.6; text-align: center; padding: 32px; }
</style>
</head>
<body>
  <h1>Visitor Log Relay</h1>

  <div class="stats" id="stats"></div>

  <div class="controls">
    <select id="mode">
      <option value="recent">Recent</option>
      <option value="ip">By IP</option>
      <option value="path">By path</option>
      <option value="suspicious">Suspicious patterns</option>
    </select>
    <input id="filter" placeholder="filter value" style="min-width: 220px;" />
    <input id="limit" type="number" value="100" min="1" max="1000" style="width: 80px;" />
    <button class="primary" id="go">Load</button>
    <span class="hint">click any row for full details</span>
  </div>

  <div id="results"></div>

  <details>
    <summary>Selected entry</summary>
    <pre id="detail">(click a row)</pre>
  </details>

<script>
const BASE = '/v2/system-data';
const $ = (id) => document.getElementById(id);

async function loadStats() {
  try {
    const s = await fetch(BASE + '/api/stats').then(r => r.json());
    const top = (s.top_paths || []).map(p =>
      \`<span title="\${p.count} visits">\${escapeHtml(p.path || '(none)')} · \${p.count}</span>\`
    ).join('');
    $('stats').innerHTML = \`
      <div class="stat"><div class="n">\${s.total_visits}</div><div class="l">total</div></div>
      <div class="stat"><div class="n">\${s.unique_ips}</div><div class="l">unique IPs</div></div>
      <div class="stat"><div class="n">\${s.last_24h}</div><div class="l">last 24h</div></div>
      <div class="stat" style="flex:1; min-width: 280px;">
        <div class="l">top paths</div>
        <div class="top-paths">\${top || '<span>(none)</span>'}</div>
      </div>\`;
  } catch (e) {
    $('stats').innerHTML = \`<div class="stat"><div class="l">stats unavailable</div></div>\`;
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function codeClass(code) {
  if (!code) return '';
  if (code < 300) return 'code-2xx';
  if (code < 400) return 'code-3xx';
  if (code < 500) return 'code-4xx';
  return 'code-5xx';
}

function renderRows(rows) {
  if (!rows || !rows.length) {
    $('results').innerHTML = '<div class="empty">no results</div>';
    return;
  }
  const head = \`<tr>
    <th>id</th><th>time</th><th>ip</th><th>method</th>
    <th>path</th><th>code</th><th>user agent</th></tr>\`;
  const body = rows.map(r => \`
    <tr data-id="\${r.id}">
      <td>\${r.id}</td>
      <td>\${escapeHtml(r.timestamp || '')}</td>
      <td class="ip">\${escapeHtml(r.ip_address || '')}</td>
      <td>\${escapeHtml(r.method || '')}</td>
      <td class="path" title="\${escapeHtml(r.path || '')}">\${escapeHtml(r.path || '')}</td>
      <td class="\${codeClass(r.response_code)}">\${escapeHtml(r.response_code ?? '')}</td>
      <td class="path" title="\${escapeHtml(r.user_agent || '')}">\${escapeHtml(r.user_agent || '')}</td>
    </tr>\`).join('');
  $('results').innerHTML = \`<table><thead>\${head}</thead><tbody>\${body}</tbody></table>\`;
  $('results').querySelectorAll('tr[data-id]').forEach(tr => {
    tr.addEventListener('click', () => loadDetail(tr.dataset.id));
  });
}

function renderSuspicious(rows) {
  if (!rows || !rows.length) {
    $('results').innerHTML = '<div class="empty">no suspicious activity in the last hour</div>';
    return;
  }
  const head = \`<tr><th>ip</th><th>visits</th><th>first</th><th>last</th></tr>\`;
  const body = rows.map(r => \`
    <tr><td class="ip">\${escapeHtml(r.ip_address)}</td>
        <td>\${r.visit_count}</td>
        <td>\${escapeHtml(r.first_visit)}</td>
        <td>\${escapeHtml(r.last_visit)}</td></tr>\`).join('');
  $('results').innerHTML = \`<table><thead>\${head}</thead><tbody>\${body}</tbody></table>\`;
}

async function loadDetail(id) {
  try {
    const e = await fetch(\`\${BASE}/api/entry/\${id}\`).then(r => r.json());
    $('detail').textContent = JSON.stringify(e, null, 2);
  } catch (err) {
    $('detail').textContent = String(err);
  }
}

async function go() {
  const mode = $('mode').value;
  const filter = $('filter').value.trim();
  const limit = parseInt($('limit').value || '100', 10);
  let url;
  if (mode === 'recent') url = \`\${BASE}/api/recent?limit=\${limit}\`;
  else if (mode === 'ip') url = \`\${BASE}/api/by-ip/\${encodeURIComponent(filter)}\`;
  else if (mode === 'path') url = \`\${BASE}/api/by-path?q=\${encodeURIComponent(filter)}\`;
  else if (mode === 'suspicious') url = \`\${BASE}/api/suspicious\`;

  $('results').innerHTML = '<div class="empty">loading...</div>';
  try {
    const rows = await fetch(url).then(r => r.json());
    if (mode === 'suspicious') renderSuspicious(rows);
    else renderRows(rows);
  } catch (e) {
    $('results').innerHTML = \`<div class="empty">error: \${escapeHtml(e.message)}</div>\`;
  }
}

$('go').addEventListener('click', go);
$('filter').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
$('mode').addEventListener('change', () => {
  const needsFilter = ['ip', 'path'].includes($('mode').value);
  $('filter').style.display = needsFilter ? '' : 'none';
});
$('mode').dispatchEvent(new Event('change'));

loadStats();
go();
</script>
</body>
</html>
`;
