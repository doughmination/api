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
<link rel="icon" type="image/png" href="/icon.png" />
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
    backdrop-filter: blur(6px); z-index: 20;
    display: flex; align-items: flex-start; justify-content: space-between; gap: 14px;
  }
  .header-text { min-width: 0; }
  h1 { margin: 0 0 4px; font-size: 21px; color: var(--fg); }
  h1 .accent-dot { color: var(--accent); }
  header p { margin: 0; color: var(--subtext0); font-size: 13.5px; }
  header code { color: var(--pink); background: var(--surface0); border: 1px solid var(--line); word-break: break-all; }

  .nav-toggle {
    display: none; flex-shrink: 0; width: 38px; height: 38px; align-items: center; justify-content: center;
    background: var(--surface0); border: 1px solid var(--line); border-radius: 8px;
    color: var(--fg); font-size: 17px; cursor: pointer;
  }
  .nav-toggle:hover { background: var(--surface1); }
  .nav-toggle:focus-visible { outline: 2px solid var(--pink); outline-offset: 1px; }

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
    .nav-toggle { display: flex; }
    nav {
      position: static; z-index: auto; align-self: auto;
      display: flex; flex-direction: column; gap: 2px;
      max-height: 0; overflow: hidden; padding: 0 6px;
      background: var(--mantle); border: 1px solid var(--line); border-radius: 10px;
      transition: max-height .22s ease, padding .22s ease, margin .22s ease;
      margin-bottom: 0;
    }
    body.nav-open nav {
      max-height: 60vh; overflow-y: auto; padding: 8px 6px; margin-bottom: 4px;
    }
    nav a { white-space: normal; padding: 9px 10px; border-radius: 7px; }
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
  <div class="header-text">
    <h1>Doughmination API reference</h1>
    <p>Universal API: live Discord presence (Lanyard), Discord profiles, Minecraft skins & Hypixel stats, the plural system, and misc services. Base URL: <code>https://doughmination.uk/v2</code></p>
  </div>
  <button id="navToggle" class="nav-toggle" type="button" aria-expanded="false" aria-controls="nav">
    <span aria-hidden="true">☰</span>
  </button>
</header>

<div class="wrap">
  <nav id="nav"></nav>
  <div>
    <input id="filter" placeholder="Filter endpoints… (e.g. fronters, devices, ws)" autocomplete="off" />
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
        desc: "Most /plural write endpoints need a login token. Get one from POST /plural/login, then send it as 'Authorization: Bearer <token>'. Tokens last 24 hours. Some routes additionally require an admin, owner, or pet role." },
      { m: "GET", path: "X-Battery-Key", auth: "key",
        desc: "Reporting or deleting device state (POST/DELETE /devices) needs your device key, sent as the 'X-Battery-Key' header." },
      { m: "GET", path: "Bot token", auth: "bot",
        desc: "The /plural/bot/* endpoints are for the companion Discord bot: they need both a 'User-Agent: CloveShortcuts/<version>' header and the bot's token as 'Authorization: Bearer <token>'." }
    ]
  },
  {
    id: "lanyard", name: "Lanyard — live presence", blurb: "Real-time Discord presence.",
    endpoints: [
      { m: "GET", path: "/lanyard/users/:id", auth: "public",
        desc: "A user's live presence: online status, current activities, Spotify, and which platforms they're on (desktop/mobile/web). Returns 404 if the user doesn't share a tracked server with the bot.",
        params: [["id", "Discord user ID."]] },
      { m: "GET", path: "/lanyard/users?ids=a,b,c", auth: "public",
        desc: "Live presence for up to 100 users at once. Returns a map of user ID → presence (or null).",
        params: [["ids", "Comma-separated Discord user IDs, max 100."]] },
      { m: "GET", path: "/lanyard/status", auth: "public",
        desc: "Live-presence connection health: whether it's connected, how many users are tracked, and recent reconnect activity." }
    ]
  },
  {
    id: "discord", name: "Discord — profiles & guilds", blurb: "Profile, badges, and guild/role info from Discord.",
    endpoints: [
      { m: "GET", path: "/discord/users/:id", auth: "public",
        desc: "A user's full profile — avatar, banner, badges, connected accounts, and (when available) bio, pronouns and reviews — combined with their live presence.",
        params: [["id", "Discord user ID."], ["?fresh / ?nocache / ?refresh", "Skip the cache and fetch fresh."]] },
      { m: "GET", path: "/discord/users?ids=a,b,c", auth: "public",
        desc: "The same full profile for up to 100 users at once. Returns a map of user ID → profile (or null if not found).",
        params: [["ids", "Comma-separated Discord user IDs, max 100."]] },
      { m: "GET", path: "/discord/guilds/:invite", auth: "public",
        desc: "Public guild info resolved from an invite code: name, icon/banner/splash, member + online counts.",
        params: [["invite", "Invite code (the part after discord.gg/)."]] },
      { m: "GET", path: "/discord/girls/:idType/:id", auth: "public",
        desc: "Look up a role or a member inside the 'girls' server.",
        params: [["idType", "'role' or 'member'."], ["id", "The role ID or member (user) ID."]] }
    ]
  },
  {
    id: "minecraft", name: "Minecraft", blurb: "Skins and Hypixel stats for a Minecraft account.",
    endpoints: [
      { m: "GET", path: "/minecraft/general/:uuid", auth: "public",
        desc: "A player's Mojang identity: username, UUID (both dashed and short forms), skin and cape texture URLs, the skin's arm model (classic or slim), every cape the player has across providers (Minecraft, OptiFine, MinecraftCapes, LabyMod, 5zig, TLauncher, SkinMC — plus a custom 'doughmination' cape for hand-picked accounts) via the capes array, and a set of ready-to-embed mc-heads render images (face, head, body, player, combo, skin) — each render includes the overlay/hat layer, with _flat variants for the inner skin only. Returns 404 if no Minecraft account has that UUID.",
        params: [["uuid", "Minecraft UUID — 32 hex characters, dashes optional."], ["?fresh / ?nocache / ?refresh", "Skip the cache and fetch fresh."]],
        example: 'GET /minecraft/general/853c80ef3c3749fdaa49938b674adae6  →  { name, uuid, skin_url, cape_url, skin_model, capes: [ { source, cape_url } ], render: { face, head, body, player, combo, skin } }' },
      { m: "GET", path: "/minecraft/capes", auth: "public",
        desc: "The set of vanilla (Mojang) capes the API has seen, persisted to memory. It grows over time: every account looked up via /minecraft/general has its equipped vanilla cape remembered, deduped by texture hash. Third-party capes (OptiFine, LabyMod, etc.) are loaded fresh per request and are not persisted here.",
        params: [],
        example: 'GET /minecraft/capes  →  { count, capes: [ { source: "minecraft", cape_url } ] }' },
      { m: "GET", path: "/minecraft/hypixel/:uuid", auth: "public",
        desc: "A player's Hypixel stats: the full player object (network level and every game's stats — Bedwars, SkyWars, Duels, and the rest) plus their SkyBlock profiles. Always returns 200; the 'source' field tells you whether each section loaded ('ok') or why it's null — 'not_found' if the player has never joined Hypixel, 'unavailable' if this server isn't serving Hypixel data.",
        params: [["uuid", "Minecraft UUID — 32 hex characters, dashes optional."], ["?fresh / ?nocache / ?refresh", "Skip the cache and fetch fresh."]],
        example: 'GET /minecraft/hypixel/853c80ef3c3749fdaa49938b674adae6  →  { name, player: {…}, skyblock: [{…}], source: { player: "ok", skyblock: "ok" } }' }
    ]
  },
  {
    id: "plural-auth", name: "Plural — accounts & auth", blurb: "Login, signup, and the current user.",
    endpoints: [
      { m: "POST", path: "/plural/login", auth: "public",
        desc: "Log in with your username and password (plus a Turnstile captcha token). Returns an access token to use on protected endpoints.",
        example: 'POST body: { "username": "admin", "password": "…", "turnstile_token": "…" }  →  { "access_token": "…", "token_type": "bearer", "success": true }' },
      { m: "POST", path: "/plural/signup", auth: "public",
        desc: "Create a non-admin account. Body { username, password (≥10 chars), display_name?, turnstile_token }." },
      { m: "GET", path: "/plural/users/check-username?username=", auth: "public",
        desc: "Check username availability. Returns { username, exists, available }." },
      { m: "GET", path: "/plural/user_info", auth: "auth",
        desc: "The current authenticated user (no password hash)." },
      { m: "GET", path: "/plural/auth/is_admin", auth: "auth", desc: "{ isAdmin } for the current user." },
      { m: "GET", path: "/plural/auth/is_owner", auth: "auth", desc: "{ isOwner } for the current user." },
      { m: "GET", path: "/plural/auth/is_pet", auth: "auth", desc: "{ isPet } for the current user." }
    ]
  },
  {
    id: "plural-system", name: "Plural — system & mental state", blurb: "PluralKit system info and the tracked mental state.",
    endpoints: [
      { m: "GET", path: "/plural/system", auth: "public",
        desc: "PluralKit system info (name, description, tag) with the current mental_state attached." },
      { m: "GET", path: "/plural/mental-state", auth: "public",
        desc: "Current mental state: { level, updated_at, notes }." },
      { m: "POST", path: "/plural/mental-state", auth: "admin",
        desc: "Update mental state. Body { level, notes? }. Broadcasts a mental_state_update over /ws." }
    ]
  },
  {
    id: "plural-members", name: "Plural — members & tags", blurb: "System members, their tags and custom status.",
    endpoints: [
      { m: "GET", path: "/plural/members", auth: "public",
        desc: "All members enriched with tags and custom status." },
      { m: "GET", path: "/plural/member/:member_id", auth: "public",
        desc: "One member by id OR name (case-insensitive), enriched with tags + status.",
        params: [["member_id", "PluralKit member id or name."]] },
      { m: "GET", path: "/plural/member-tags", auth: "admin", desc: "The full member → tags map." },
      { m: "POST", path: "/plural/member-tags/:member_identifier", auth: "admin",
        desc: "Replace a member's tag list. Body: string[] (JSON array of tags)." },
      { m: "POST", path: "/plural/member-tags/:member_identifier/add", auth: "admin",
        desc: "Add one tag. Body { tag }." },
      { m: "DELETE", path: "/plural/member-tags/:member_identifier/:tag", auth: "admin",
        desc: "Remove one tag from a member." },
      { m: "GET", path: "/plural/members/:member_identifier/status", auth: "public",
        desc: "A member's custom status ({ text, emoji, updated_at }) or null." },
      { m: "POST", path: "/plural/members/:member_identifier/status", auth: "admin",
        desc: "Set/update a member's status. Body { text (≤100 chars), emoji? }." },
      { m: "DELETE", path: "/plural/members/:member_identifier/status", auth: "admin",
        desc: "Clear a member's status." }
    ]
  },
  {
    id: "plural-fronting", name: "Plural — fronting", blurb: "Who is fronting, and switching.",
    endpoints: [
      { m: "GET", path: "/plural/fronters", auth: "public",
        desc: "Current fronters, enriched with tags + status. { members: [...] }." },
      { m: "POST", path: "/plural/switch", auth: "auth",
        desc: "Set the front to a list. Body { members: string[] }. Broadcasts fronters_update." },
      { m: "POST", path: "/plural/switch_front", auth: "auth",
        desc: "Switch to a single fronter. Body { member_id }." },
      { m: "POST", path: "/plural/multi_switch", auth: "auth",
        desc: "Switch to several fronters with detailed feedback. Body { member_ids: string[] }." }
    ]
  },
  {
    id: "plural-users", name: "Plural — user management", blurb: "Admin CRUD over accounts.",
    endpoints: [
      { m: "GET", path: "/plural/users", auth: "admin", desc: "List all users (no password hashes)." },
      { m: "POST", path: "/plural/users", auth: "admin",
        desc: "Create a user. Body { username, password, display_name?, is_admin?, is_pet? }." },
      { m: "PUT", path: "/plural/users/:user_id", auth: "auth",
        desc: "Update a user (admin, or the user themselves). Body may include display_name, current_password + new_password, avatar_url (an EXTERNAL image URL — uploads were removed), is_admin, is_pet." },
      { m: "DELETE", path: "/plural/users/:user_id", auth: "admin",
        desc: "Delete a user. Cannot delete yourself or the owner." }
    ]
  },
  {
    id: "plural-metrics", name: "Plural — metrics", blurb: "Fronting analytics.",
    endpoints: [
      { m: "GET", path: "/plural/metrics/fronting-time?days=30", auth: "auth",
        desc: "Per-member fronting time across 24h/48h/5d/7d/30d windows and totals." },
      { m: "GET", path: "/plural/metrics/switch-frequency?days=30", auth: "auth",
        desc: "Switch counts per window and average switches/day." }
    ]
  },
  {
    id: "plural-realtime", name: "Plural — realtime & admin", blurb: "The unified WebSocket + broadcast controls.",
    endpoints: [
      { m: "WS", path: "/ws", auth: "public",
        desc: "The single realtime socket for ALL live updates. On connect you get a connection_established message. Fronting (fronters_update), mental state (mental_state_update), device/battery (device_update) and force_refresh events are pushed to every client automatically. For live Discord presence, send a subscribe frame — either { \"type\": \"subscribe\", \"all\": true } or { \"type\": \"subscribe\", \"ids\": [\"<user id>\", …] }; you'll get an init_state snapshot immediately and presence_update events thereafter (only for the users you subscribed to). Every message is a { type, data } object. Send 'ping' to get 'pong'." },
      { m: "POST", path: "/plural/admin/refresh", auth: "admin",
        desc: "Broadcast a force_refresh to every connected /ws client." }
    ]
  },
  {
    id: "plural-bot", name: "Plural — bot API", blurb: "For the Discord bot (User-Agent + bot token).",
    endpoints: [
      { m: "GET", path: "/plural/bot/health", auth: "bot", desc: "Liveness check." },
      { m: "GET", path: "/plural/bot/system/info", auth: "bot", desc: "System info wrapped as { success, data }." },
      { m: "GET", path: "/plural/bot/members", auth: "bot", desc: "Members with tags + status." },
      { m: "GET", path: "/plural/bot/fronters", auth: "bot", desc: "Current fronters." },
      { m: "POST", path: "/plural/bot/switch", auth: "bot",
        desc: "Switch fronters with validation. Body { member_ids: string[] }." },
      { m: "POST", path: "/plural/bot/token/regenerate", auth: "owner",
        desc: "No longer available — returns 410. The bot token is now set manually by the server operator." }
    ]
  },
  {
    id: "plural-seo", name: "Plural — SEO", blurb: "Data-driven crawler files.",
    endpoints: [
      { m: "GET", path: "/plural/robots.txt", auth: "public", desc: "robots.txt." },
      { m: "GET", path: "/plural/sitemap.xml", auth: "public", desc: "Sitemap generated from the member list." }
    ]
  },
  {
    id: "devices", name: "Devices", blurb: "Latest known device state (battery, charging, low power mode, wifi).",
    endpoints: [
      { m: "GET", path: "/devices", auth: "public", desc: "All devices → { device, level, charging, lowPowerMode, wifi, updated_at }." },
      { m: "GET", path: "/devices/:device", auth: "public", desc: "One device, or 404." },
      { m: "POST", path: "/devices?device=iphone&level=25&charging=1&lpm=0&wifi=Home", auth: "key",
        desc: "Report device state. Only 'device' is required; supplied fields are updated, the rest untouched. Send the X-Battery-Key header.",
        params: [["device", "1–64 chars (required)."], ["level", "Optional. Integer 0–100."], ["charging", "Optional. 1 (true) or 0 (false)."], ["lpm", "Optional. 1 (true) or 0 (false) → lowPowerMode."], ["wifi", "Optional. Any string (network name), ≤128 chars."]] },
      { m: "DELETE", path: "/devices?device=iphone", auth: "key",
        desc: "Delete a device's state. Returns 404 if the device doesn't exist. Send the X-Battery-Key header.",
        params: [["device", "1–64 chars (required)."]] }
    ]
  },
  {
    id: "guestbook", name: "Guestbook", blurb: "Public guestbook. Each entry gets a random UID so it can be deleted individually.",
    endpoints: [
      { m: "GET", path: "/guestbook?limit=50&offset=0", auth: "public",
        desc: "List entries, newest first → { entries: [{ id, name, message, website, ts }], total, limit, offset }.",
        params: [["limit", "Optional. 1–200, default 50."], ["offset", "Optional. ≥0, default 0."]] },
      { m: "POST", path: "/guestbook", auth: "public",
        desc: "Sign the guestbook. Honeypot (url2) + Turnstile (when configured) + per-IP rate limit (60s). Returns { ok, entry } with the new UID.",
        example: 'POST body: { "name": "Clove", "message": "hi!", "website": "https://…", "turnstileToken": "…" }' },
      { m: "DELETE", path: "/guestbook/:id", auth: "key",
        desc: "Delete an entry by its UID. Returns 404 if not found. Send the X-Battery-Key header.",
        params: [["id", "The entry's UID (required)."]] },
      { m: "POST", path: "/guestbook/import", auth: "key",
        desc: "Migration import: insert an entry with a fresh UID, bypassing captcha + rate limit. Send the X-Battery-Key header. Body { name, message, website? }." }
    ]
  },
  {
    id: "system-data", name: "System-data — visitor logs", blurb: "Visit logging plus an admin-only log viewer.",
    endpoints: [
      { m: "POST", path: "/system-data/helper", auth: "public",
        desc: "Log a page visit (the frontend pings this on navigation). Body { path? }." },
      { m: "GET", path: "/system-data/helper?path=", auth: "public", desc: "Log a page visit via a plain GET, for cases where a POST isn't convenient." },
      { m: "GET", path: "/system-data", auth: "admin", desc: "HTML log viewer (single page)." },
      { m: "GET", path: "/system-data/api/stats", auth: "admin", desc: "Totals, unique IPs, last-24h, top paths." },
      { m: "GET", path: "/system-data/api/recent?limit=100", auth: "admin", desc: "Recent visits." },
      { m: "GET", path: "/system-data/api/by-ip/:ip", auth: "admin", desc: "Visits from an IP." },
      { m: "GET", path: "/system-data/api/by-path?q=", auth: "admin", desc: "Visits matching a path substring." },
      { m: "GET", path: "/system-data/api/suspicious", auth: "admin", desc: ">20 hits/hour from one IP." },
      { m: "GET", path: "/system-data/api/entry/:id", auth: "admin", desc: "One full log row." }
    ]
  },
  {
    id: "contrib", name: "Contrib", blurb: "Merged git contribution heatmaps.",
    endpoints: [
      { m: "GET", path: "/contribapi", auth: "public",
        desc: "A single contribution heatmap that merges activity from GitHub and Codeberg. Updated at most hourly." }
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

var navToggle = document.getElementById("navToggle");
var navEl = document.getElementById("nav");

function setNavOpen(open) {
  document.body.classList.toggle("nav-open", open);
  navToggle.setAttribute("aria-expanded", open ? "true" : "false");
  navToggle.querySelector("span").textContent = open ? "✕" : "☰";
}

navToggle.addEventListener("click", function () {
  setNavOpen(!document.body.classList.contains("nav-open"));
});

navEl.addEventListener("click", function (e) {
  if (e.target.tagName === "A") setNavOpen(false);
});

document.addEventListener("click", function (e) {
  if (!document.body.classList.contains("nav-open")) return;
  if (navEl.contains(e.target) || navToggle.contains(e.target)) return;
  setNavOpen(false);
});


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