/* =====================================================================
 * docs.ts — the /docs API reference page.
 *
 * A single self-contained HTML page (no build step, no external deps). All
 * endpoints are described by the GROUPS data structure in the embedded
 * script and rendered client-side, with a live filter box. Keep this in
 * sync when routes change.
 * ===================================================================== */

export const DOCS_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Doughmination API reference</title>
<style>
  :root {
    color-scheme: dark;

    /* Catppuccin Mocha */
    --base: #1e1e2e;
    --mantle: #181825;
    --crust: #11111b;
    --surface0: #313244;
    --surface1: #45475a;
    --surface2: #585b70;
    --overlay0: #6c7086;
    --overlay1: #7f849c;
    --overlay2: #9399b2;
    --subtext0: #a6adc8;
    --subtext1: #bac2de;
    --text: #cdd6f4;
    --pink: #f5c2e7;
    --mauve: #cba6f7;
    --red: #f38ba8;
    --peach: #fab387;
    --yellow: #f9e2af;
    --green: #a6e3a1;
    --sky: #89dceb;
    --blue: #89b4fa;

    /* App aliases */
    --bg: var(--base);
    --panel: var(--surface0);
    --panel2: var(--surface1);
    --line: var(--surface2);
    --fg: var(--text);
    --muted: var(--subtext0);
    --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
    --accent: var(--pink);

    --get: var(--green); --post: var(--yellow); --put: var(--blue); --del: var(--red); --ws: var(--mauve);
  }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; min-width: 0; }
  html { scroll-behavior: smooth; }
  body { margin: 0; font: 15px/1.6 system-ui, sans-serif; background: var(--bg); color: var(--fg); overflow-x: hidden; }

  header {
    padding: 24px 20px 14px; border-bottom: 1px solid var(--line);
    position: sticky; top: 0; background: linear-gradient(var(--bg), rgba(30,30,46,.94));
    backdrop-filter: blur(6px); z-index: 5;
  }
  h1 { margin: 0 0 4px; font-size: 21px; color: var(--fg); }
  h1 .accent-dot { color: var(--accent); }
  header p { margin: 0; color: var(--subtext0); font-size: 13.5px; }
  header code { color: var(--pink); background: var(--surface0); border: 1px solid var(--line); word-break: break-all; }

  .wrap { display: grid; grid-template-columns: 190px minmax(0, 1fr); gap: 20px; max-width: 980px; margin: 0 auto; padding: 20px; }

  nav {
    position: sticky; top: 108px; align-self: start; font-size: 14px;
    max-height: calc(100vh - 130px); overflow: auto; padding-right: 4px;
  }
  nav a {
    display: block; color: var(--subtext0); text-decoration: none; padding: 6px 10px;
    border-radius: 7px; border-left: 2px solid transparent; margin-bottom: 1px;
  }
  nav a:hover { color: var(--fg); background: var(--surface0); }
  nav a:focus-visible { outline: 2px solid var(--pink); outline-offset: -2px; }

  #filter {
    width: 100%; padding: 10px 14px; border-radius: 9px; border: 1px solid var(--line);
    background: var(--surface0); color: var(--fg); font: inherit; margin-bottom: 14px;
  }
  #filter::placeholder { color: var(--overlay1); }
  #filter:focus { outline: none; border-color: var(--pink); box-shadow: 0 0 0 3px rgba(245,194,231,.18); }

  section { margin-bottom: 32px; scroll-margin-top: 116px; }
  section > h2 { font-size: 16.5px; margin: 0 0 3px; color: var(--fg); }
  section > .blurb { color: var(--subtext0); font-size: 13.5px; margin: 0 0 14px; }

  .ep {
    border: 1px solid var(--line); background: var(--surface0); border-radius: 10px;
    padding: 12px 14px; margin-bottom: 10px;
  }
  .ep-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

  .m {
    font: 700 12px var(--mono); padding: 2px 8px; border-radius: 5px; letter-spacing: .04em;
    border: 1px solid transparent; flex-shrink: 0;
  }
  .m.GET    { background: rgba(166,227,161,.14); color: var(--get);  border-color: rgba(166,227,161,.35); }
  .m.POST   { background: rgba(249,226,175,.14); color: var(--post); border-color: rgba(249,226,175,.35); }
  .m.PUT    { background: rgba(137,180,250,.16); color: var(--put);  border-color: rgba(137,180,250,.35); }
  .m.DELETE { background: rgba(243,139,168,.16); color: var(--del);  border-color: rgba(243,139,168,.35); }
  .m.WS     { background: rgba(203,166,247,.16); color: var(--ws);   border-color: rgba(203,166,247,.35); }

  .path { font: 600 14px/1.35 var(--mono); word-break: break-all; color: var(--fg); }

  .auth {
    margin-left: auto; font-size: 11px; text-transform: uppercase; letter-spacing: .05em;
    color: var(--subtext0); border: 1px solid var(--line); padding: 2px 8px; border-radius: 20px;
    flex-shrink: 0;
  }
  .auth.public { color: var(--green); border-color: rgba(166,227,161,.4); }
  .auth.jwt, .auth.auth { color: var(--blue); border-color: rgba(137,180,250,.4); }
  .auth.admin, .auth.owner, .auth.pet { color: var(--peach); border-color: rgba(250,179,135,.4); }
  .auth.bot, .auth.key { color: var(--mauve); border-color: rgba(203,166,247,.4); }

  .desc { margin: 9px 0 0; color: var(--subtext1); font-size: 14px; }

  .params { margin: 10px 0 0; border-collapse: collapse; width: 100%; table-layout: fixed; font-size: 13px; }
  .params td { padding: 4px 10px 4px 0; vertical-align: top; border-top: 1px solid var(--surface1); word-break: break-word; }
  .params tr:first-child td { border-top: none; }
  .params td:first-child { width: 30%; font: 600 12px var(--mono); color: var(--pink); }

  .note { margin: 9px 0 0; font-size: 13px; color: var(--muted); }

  pre {
    margin: 9px 0 0; background: var(--mantle); border: 1px solid var(--line); border-radius: 8px;
    padding: 9px 11px; overflow: auto; font: 12px/1.5 var(--mono); color: var(--subtext1);
  }
  code { font: 12px var(--mono); background: var(--mantle); color: var(--pink); padding: 1px 5px; border-radius: 4px; }

  .hidden { display: none; }
  a.self { color: var(--accent); text-decoration: none; }

  ::selection { background: rgba(245,194,231,.28); color: var(--fg); }

  /* Scrollbars, for the browsers that respect this */
  * { scrollbar-color: var(--surface2) var(--mantle); scrollbar-width: thin; }

  /* ---------- Responsive ---------- */
  @media (max-width: 760px) {
    .wrap { grid-template-columns: 1fr; gap: 14px; padding: 14px; }
    nav {
      position: sticky; top: 0; z-index: 4; max-height: none;
      display: flex; flex-wrap: nowrap; overflow-x: auto; gap: 4px;
      padding: 8px 2px 10px; margin: -4px -14px 4px; padding-left: 14px; padding-right: 14px;
      background: var(--bg); border-bottom: 1px solid var(--line);
    }
    nav a { white-space: nowrap; padding: 6px 12px; background: var(--surface0); margin-bottom: 0; }
    nav a:hover { background: var(--surface1); }
    header { padding: 18px 14px 12px; }
    h1 { font-size: 18px; }
    header p { font-size: 13px; }
  }

  @media (max-width: 480px) {
    body { font-size: 14px; }
    .ep { padding: 11px 12px; }
    .ep-head { gap: 8px; }
    .auth { margin-left: 0; order: 3; flex-basis: 100%; }
    .path { font-size: 13px; }
    .params td { display: block; padding: 2px 0; }
    .params td:first-child { padding-top: 6px; }
    .params tr:first-child td:first-child { padding-top: 2px; }
    #filter { font-size: 16px; } /* avoid iOS zoom-on-focus */
  }
</style>
</head>
<body>
<header>
  <h1>Doughmination Restful <span class="accent-dot">—</span> API reference</h1>
  <p>Universal API: live Discord presence (Lanyard), Discord profiles, the plural system, and misc services. Base URL: <code>https://doughmination.uk</code></p>
</header>

<div class="wrap">
  <nav id="nav"></nav>
  <div>
    <input id="filter" placeholder="Filter endpoints… (e.g. fronters, battery, ws)" autocomplete="off" />
    <div id="content"></div>
  </div>
</div>

<script>
// Auth legend: public | auth (any logged-in) | admin | owner | pet | jwt | bot | key
var GROUPS = [
  {
    id: "auth-overview", name: "Authentication", blurb: "How protected endpoints are secured.",
    endpoints: [
      { m: "GET", path: "Bearer JWT", auth: "jwt",
        desc: "Most /v2/plural write endpoints require a JWT. Obtain one from POST /v2/plural/login, then send it as 'Authorization: Bearer <token>'. Tokens last 24h. Roles: admin, owner, pet gate specific routes.",
        note: "Passwords are hashed with PBKDF2 (Web Crypto)." },
      { m: "GET", path: "X-Battery-Key", auth: "key",
        desc: "POST /v2/battery requires the 'X-Battery-Key' header matching one of the comma-separated keys in BATTERY_API_KEYS." },
      { m: "GET", path: "Bot token", auth: "bot",
        desc: "The /v2/plural/bot/* endpoints require BOTH 'User-Agent: CloveShortcuts/<version>' and 'Authorization: Bearer <DOUGH_BOT_TOKEN>'." }
    ]
  },
  {
    id: "lanyard", name: "Lanyard — live presence", blurb: "Real-time Discord presence, backed by the gateway Durable Object.",
    endpoints: [
      { m: "GET", path: "/v2/lanyard/users/:id", auth: "public",
        desc: "Live presence for one user: status, activities, Spotify, platform (desktop/mobile/web). 404 if the user shares no monitored guild with the bot.",
        params: [["id", "Discord user snowflake (16–21 digits)."]] },
      { m: "GET", path: "/v2/lanyard/users?ids=a,b,c", auth: "public",
        desc: "Batch presence for up to 100 users in one round-trip. Returns a map of id → presence (or null).",
        params: [["ids", "Comma-separated snowflakes, max 100."]] },
      { m: "WS", path: "/v2/lanyard/ws", auth: "public",
        desc: "WebSocket speaking the Lanyard socket protocol (op1 Hello, op2 Initialize, op3 Heartbeat, op0 INIT_STATE / PRESENCE_UPDATE)." },
      { m: "GET", path: "/v2/lanyard/status", auth: "public",
        desc: "Gateway health/debug: connected state, tracked user count, last close code, reconnect attempts." }
    ]
  },
  {
    id: "discord", name: "Discord — profiles & guilds", blurb: "Profile, badges, and guild/role info from Discord.",
    endpoints: [
      { m: "GET", path: "/v2/discord/users/:id", auth: "public",
        desc: "Full user record: profile + badges + connected accounts + (when a user token is configured) bio/pronouns/reviews, MERGED with live presence. This is the shape the website's presence cards render.",
        params: [["id", "Discord user snowflake."], ["?fresh / ?nocache / ?refresh", "Bypass caches and re-fetch."]] },
      { m: "GET", path: "/v2/discord/users?ids=a,b,c", auth: "public",
        desc: "Batch of the merged record above, up to 100 ids, in one round-trip (one DO call for presence + parallel KV-cached profiles). Map of id → record (or null)." },
      { m: "GET", path: "/v2/discord/guilds/:invite", auth: "public",
        desc: "Public guild info resolved from an invite code: name, icon/banner/splash, member + online counts.",
        params: [["invite", "Invite code (the part after discord.gg/)."]] },
      { m: "GET", path: "/v2/discord/girls/:idType/:id", auth: "public",
        desc: "Resolve a role or member within the configured 'girls' guild.",
        params: [["idType", "'role' or 'member'."], ["id", "Role id or member (user) id."]] }
    ]
  },
  {
    id: "plural-auth", name: "Plural — accounts & auth", blurb: "Login, signup, and the current user.",
    endpoints: [
      { m: "POST", path: "/v2/plural/login", auth: "public",
        desc: "Log in. Accepts JSON { username, password, turnstile_token } (Turnstile-verified) or legacy form data. Returns { access_token, token_type, success }.",
        example: 'POST body: { "username": "admin", "password": "…", "turnstile_token": "…" }  →  { "access_token": "…", "token_type": "bearer", "success": true }' },
      { m: "POST", path: "/v2/plural/signup", auth: "public",
        desc: "Create a non-admin account. Body { username, password (≥10 chars), display_name?, turnstile_token }." },
      { m: "GET", path: "/v2/plural/users/check-username?username=", auth: "public",
        desc: "Check username availability. Returns { username, exists, available }." },
      { m: "GET", path: "/v2/plural/user_info", auth: "auth",
        desc: "The current authenticated user (no password hash)." },
      { m: "GET", path: "/v2/plural/auth/is_admin", auth: "auth", desc: "{ isAdmin } for the current user." },
      { m: "GET", path: "/v2/plural/auth/is_owner", auth: "auth", desc: "{ isOwner } for the current user." },
      { m: "GET", path: "/v2/plural/auth/is_pet", auth: "auth", desc: "{ isPet } for the current user." }
    ]
  },
  {
    id: "plural-system", name: "Plural — system & mental state", blurb: "PluralKit system info and the tracked mental state.",
    endpoints: [
      { m: "GET", path: "/v2/plural/system", auth: "public",
        desc: "PluralKit system info (name, description, tag) with the current mental_state attached." },
      { m: "GET", path: "/v2/plural/mental-state", auth: "public",
        desc: "Current mental state: { level, updated_at, notes }." },
      { m: "POST", path: "/v2/plural/mental-state", auth: "admin",
        desc: "Update mental state. Body { level, notes? }. Broadcasts a mental_state_update over /v2/plural/ws." }
    ]
  },
  {
    id: "plural-members", name: "Plural — members & tags", blurb: "System members, their tags and custom status.",
    endpoints: [
      { m: "GET", path: "/v2/plural/members", auth: "public",
        desc: "All members enriched with tags and custom status." },
      { m: "GET", path: "/v2/plural/member/:member_id", auth: "public",
        desc: "One member by id OR name (case-insensitive), enriched with tags + status.",
        params: [["member_id", "PluralKit member id or name."]] },
      { m: "GET", path: "/v2/plural/member-tags", auth: "admin", desc: "The full member → tags map." },
      { m: "POST", path: "/v2/plural/member-tags/:member_identifier", auth: "admin",
        desc: "Replace a member's tag list. Body: string[] (JSON array of tags)." },
      { m: "POST", path: "/v2/plural/member-tags/:member_identifier/add", auth: "admin",
        desc: "Add one tag. Body { tag }." },
      { m: "DELETE", path: "/v2/plural/member-tags/:member_identifier/:tag", auth: "admin",
        desc: "Remove one tag from a member." },
      { m: "GET", path: "/v2/plural/members/:member_identifier/status", auth: "public",
        desc: "A member's custom status ({ text, emoji, updated_at }) or null." },
      { m: "POST", path: "/v2/plural/members/:member_identifier/status", auth: "admin",
        desc: "Set/update a member's status. Body { text (≤100 chars), emoji? }." },
      { m: "DELETE", path: "/v2/plural/members/:member_identifier/status", auth: "admin",
        desc: "Clear a member's status." }
    ]
  },
  {
    id: "plural-fronting", name: "Plural — fronting", blurb: "Who is fronting, and switching.",
    endpoints: [
      { m: "GET", path: "/v2/plural/fronters", auth: "public",
        desc: "Current fronters, enriched with tags + status. { members: [...] }." },
      { m: "POST", path: "/v2/plural/switch", auth: "auth",
        desc: "Set the front to a list. Body { members: string[] }. Broadcasts fronters_update." },
      { m: "POST", path: "/v2/plural/switch_front", auth: "auth",
        desc: "Switch to a single fronter. Body { member_id }." },
      { m: "POST", path: "/v2/plural/multi_switch", auth: "auth",
        desc: "Switch to several fronters with detailed feedback. Body { member_ids: string[] }." }
    ]
  },
  {
    id: "plural-users", name: "Plural — user management", blurb: "Admin CRUD over accounts.",
    endpoints: [
      { m: "GET", path: "/v2/plural/users", auth: "admin", desc: "List all users (no password hashes)." },
      { m: "POST", path: "/v2/plural/users", auth: "admin",
        desc: "Create a user. Body { username, password, display_name?, is_admin?, is_pet? }." },
      { m: "PUT", path: "/v2/plural/users/:user_id", auth: "auth",
        desc: "Update a user (admin, or the user themselves). Body may include display_name, current_password + new_password, avatar_url (an EXTERNAL image URL — uploads were removed), is_admin, is_pet." },
      { m: "DELETE", path: "/v2/plural/users/:user_id", auth: "admin",
        desc: "Delete a user. Cannot delete yourself or the owner." }
    ]
  },
  {
    id: "plural-metrics", name: "Plural — metrics", blurb: "Fronting analytics.",
    endpoints: [
      { m: "GET", path: "/v2/plural/metrics/fronting-time?days=30", auth: "auth",
        desc: "Per-member fronting time across 24h/48h/5d/7d/30d windows and totals." },
      { m: "GET", path: "/v2/plural/metrics/switch-frequency?days=30", auth: "auth",
        desc: "Switch counts per window and average switches/day." }
    ]
  },
  {
    id: "plural-realtime", name: "Plural — realtime & admin", blurb: "WebSocket + broadcast controls.",
    endpoints: [
      { m: "WS", path: "/v2/plural/ws", auth: "public",
        desc: "Realtime socket. On connect emits connection_established; pushes fronters_update, mental_state_update, and force_refresh. Send 'ping' → 'pong', or 'subscribe'.",
        note: "Hibernatable — idle sockets don't keep the Durable Object awake." },
      { m: "POST", path: "/v2/plural/admin/refresh", auth: "admin",
        desc: "Broadcast a force_refresh to every connected /v2/plural/ws client." }
    ]
  },
  {
    id: "plural-bot", name: "Plural — bot API", blurb: "For the Discord bot (User-Agent + bot token).",
    endpoints: [
      { m: "GET", path: "/v2/plural/bot/health", auth: "bot", desc: "Liveness check." },
      { m: "GET", path: "/v2/plural/bot/system/info", auth: "bot", desc: "System info wrapped as { success, data }." },
      { m: "GET", path: "/v2/plural/bot/members", auth: "bot", desc: "Members with tags + status." },
      { m: "GET", path: "/v2/plural/bot/fronters", auth: "bot", desc: "Current fronters." },
      { m: "POST", path: "/v2/plural/bot/switch", auth: "bot",
        desc: "Switch fronters with validation. Body { member_ids: string[] }." },
      { m: "POST", path: "/v2/plural/bot/token/regenerate", auth: "owner",
        desc: "Gone — returns 410. The bot token is now set manually via the DOUGH_BOT_TOKEN secret." }
    ]
  },
  {
    id: "plural-seo", name: "Plural — SEO", blurb: "Data-driven crawler files.",
    endpoints: [
      { m: "GET", path: "/v2/plural/robots.txt", auth: "public", desc: "robots.txt." },
      { m: "GET", path: "/v2/plural/sitemap.xml", auth: "public", desc: "Sitemap generated from the member list." }
    ]
  },
  {
    id: "battery", name: "Battery", blurb: "Latest known battery level per device.",
    endpoints: [
      { m: "GET", path: "/v2/battery", auth: "public", desc: "All devices → { device, level, updated_at }." },
      { m: "GET", path: "/v2/battery/:device", auth: "public", desc: "One device, or 404." },
      { m: "POST", path: "/v2/battery?device=iphone&level=25", auth: "key",
        desc: "Report a level (0–100) for a device. Send the X-Battery-Key header.",
        params: [["device", "1–64 chars."], ["level", "Integer 0–100."]] }
    ]
  },
  {
    id: "system-data", name: "System-data — visitor logs", blurb: "Visit logging + an admin log viewer (DO SQLite).",
    endpoints: [
      { m: "POST", path: "/v2/system-data/helper", auth: "public",
        desc: "Log a page visit (the frontend pings this on navigation). Body { path? }." },
      { m: "GET", path: "/v2/system-data/helper?path=", auth: "public", desc: "GET variant (sendBeacon / no-CORS)." },
      { m: "GET", path: "/v2/system-data", auth: "admin", desc: "HTML log viewer (single page)." },
      { m: "GET", path: "/v2/system-data/api/stats", auth: "admin", desc: "Totals, unique IPs, last-24h, top paths." },
      { m: "GET", path: "/v2/system-data/api/recent?limit=100", auth: "admin", desc: "Recent visits." },
      { m: "GET", path: "/v2/system-data/api/by-ip/:ip", auth: "admin", desc: "Visits from an IP." },
      { m: "GET", path: "/v2/system-data/api/by-path?q=", auth: "admin", desc: "Visits matching a path substring." },
      { m: "GET", path: "/v2/system-data/api/suspicious", auth: "admin", desc: ">20 hits/hour from one IP." },
      { m: "GET", path: "/v2/system-data/api/entry/:id", auth: "admin", desc: "One full log row." }
    ]
  },
  {
    id: "contrib", name: "Contrib", blurb: "Merged git contribution heatmaps.",
    endpoints: [
      { m: "GET", path: "/v2/contribapi", auth: "public",
        desc: "Merged contribution heatmaps across configured forges (GitHub + Codeberg). Edge-cached for one hour.",
        note: "Configured via GITHUB_USERNAME/GITHUB_TOKEN and CODEBERG_USERNAME." }
    ]
  },
  {
    id: "meta", name: "Meta", blurb: "",
    endpoints: [
      { m: "GET", path: "/", auth: "public", desc: "Service info (JSON) — the namespace map." },
      { m: "GET", path: "/docs", auth: "public", desc: "This page." }
    ]
  }
];

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

function epHtml(ep) {
  var params = "";
  if (ep.params && ep.params.length) {
    params = '<table class="params">' + ep.params.map(function (p) {
      return "<tr><td>" + esc(p[0]) + "</td><td>" + esc(p[1]) + "</td></tr>";
    }).join("") + "</table>";
  }
  var note = ep.note ? '<p class="note">' + esc(ep.note) + "</p>" : "";
  var example = ep.example ? "<pre>" + esc(ep.example) + "</pre>" : "";
  return '<div class="ep" data-q="' + esc((ep.m + " " + ep.path + " " + ep.desc).toLowerCase()) + '">' +
    '<div class="ep-head">' +
    '<span class="m ' + ep.m + '">' + ep.m + "</span>" +
    '<span class="path">' + esc(ep.path) + "</span>" +
    '<span class="auth ' + ep.auth + '">' + ep.auth + "</span>" +
    "</div>" +
    '<p class="desc">' + esc(ep.desc) + "</p>" +
    params + note + example +
    "</div>";
}

function render() {
  var nav = document.getElementById("nav");
  var content = document.getElementById("content");
  nav.innerHTML = GROUPS.map(function (g) {
    return '<a href="#' + g.id + '">' + esc(g.name) + "</a>";
  }).join("");
  content.innerHTML = GROUPS.map(function (g) {
    return '<section id="' + g.id + '">' +
      "<h2>" + esc(g.name) + "</h2>" +
      (g.blurb ? '<p class="blurb">' + esc(g.blurb) + "</p>" : "") +
      g.endpoints.map(epHtml).join("") +
      "</section>";
  }).join("");
}

render();

document.getElementById("filter").addEventListener("input", function (e) {
  var q = e.target.value.trim().toLowerCase();
  document.querySelectorAll("section").forEach(function (sec) {
    var any = false;
    sec.querySelectorAll(".ep").forEach(function (ep) {
      var hit = !q || ep.dataset.q.indexOf(q) !== -1;
      ep.classList.toggle("hidden", !hit);
      if (hit) any = true;
    });
    sec.classList.toggle("hidden", !any);
  });
});
</script>
</body>
</html>
`;