/* =====================================================================
 * apidata.ts — the single source of truth for the endpoint catalogue.
 *
 * Consumed by docs.ts (rendered client-side on /docs) and openapi.ts
 * (converted to the /openapi.json spec). Keep this in sync when routes
 * change — nothing else needs editing.
 * ===================================================================== */

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "WS";
export type AuthKind = "public" | "auth" | "admin" | "owner" | "pet" | "jwt" | "bot" | "key";

export interface EndpointDef {
  m: HttpMethod;
  path: string;
  auth: AuthKind;
  desc: string;
  /** [name, description] pairs; names starting with "?" are query params. */
  params?: [string, string][];
  example?: string;
  note?: string;
  /** True when the path is at the site root rather than under /v2. */
  root?: boolean;
}

export interface GroupDef {
  id: string;
  name: string;
  blurb: string;
  endpoints: EndpointDef[];
}

export const GROUPS: GroupDef[] = [
  {
    id: "auth-overview", name: "Authentication", blurb: "How protected endpoints are secured.",
    endpoints: [
      { m: "GET", path: "Bearer JWT", auth: "jwt",
        desc: "Most /plural write endpoints need a login token. Get one from POST /plural/login, then send it as 'Authorization: Bearer <token>'. Tokens last 24 hours. Some routes additionally require an admin, owner, or pet role." },
      { m: "GET", path: "X-Battery-Key", auth: "key",
        desc: "Reporting or deleting device state (POST/DELETE /devices) needs your device key, sent as the 'X-Battery-Key' header." },
      { m: "GET", path: "Bot token", auth: "bot",
        desc: "The /plural/bot/* endpoints are for the companion Discord bot: they need both a 'User-Agent: CloveShortcuts/<version>' header and the bot's token as 'Authorization: Bearer <token>'." },
    ],
  },
  {
    id: "discord", name: "Discord — profiles, presence & guilds", blurb: "One merged record: profile, badges, equipped collectibles, and live presence.",
    endpoints: [
      { m: "GET", path: "/discord/users/:id", auth: "public",
        desc: "A user's full record in one call: profile (avatar, banner, badges, connected accounts, and — when available — bio, pronouns and reviews), the collectibles they have equipped (nameplate, profile frame, profile effect, avatar decoration — each resolved to its name and image assets), and their live presence (status, activities, Spotify, platforms). Fetched fresh on every request. Presence is null if the user shares no tracked server with the bot.",
        params: [["id", "Discord user ID."], ["?fresh / ?nocache / ?refresh", "Force fresh sub-resource lookups (collectibles/wishlist) instead of their short shared caches."]] },
      { m: "GET", path: "/discord/users?ids=a,b,c", auth: "public",
        desc: "The same full record for up to 100 users at once. Returns a map of user ID → record (or null if not found).",
        params: [["ids", "Comma-separated Discord user IDs, max 100."]] },
      { m: "GET", path: "/discord/status", auth: "public",
        desc: "Live-presence connection health: whether it's connected, how many users are tracked, and recent reconnect activity." },
      { m: "GET", path: "/discord/guilds/:invite", auth: "public",
        desc: "Public guild info resolved from an invite code: name, icon/banner/splash, member + online counts.",
        params: [["invite", "Invite code (the part after discord.gg/)."]] },
      { m: "GET", path: "/discord/girls/:idType/:id", auth: "public",
        desc: "Look up a role or a member inside the 'girls' server.",
        params: [["idType", "'role' or 'member'."], ["id", "The role ID or member (user) ID."]] },
    ],
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
        desc: "Hypixel stats for one of the operator's OWN Minecraft accounts: the player object (network level and per-game stats — Bedwars, SkyWars, Duels, and the rest) plus their SkyBlock profiles. Per Hypixel API policy this only serves the operator's allowlisted accounts — any other UUID returns 403. Cache-first with a 5-minute TTL (no manual cache-bypass). Always returns 200 for an allowed account; the 'source' field says whether each section loaded ('ok') or why it's null ('not_found' if the account never joined Hypixel, 'unavailable' if Hypixel data isn't configured). Not affiliated with or endorsed by Hypixel Inc.",
        params: [["uuid", "Minecraft UUID (32 hex, dashes optional) — must be one of the operator's own accounts."]],
        example: 'GET /minecraft/hypixel/853c80ef3c3749fdaa49938b674adae6  →  { name, player: {…}, skyblock: [{…}], source: { player: "ok", skyblock: "ok" } }' },
    ],
  },
  {
    id: "plural-auth", name: "Plural — accounts & auth", blurb: "Login, signup, password reset, and the current user.",
    endpoints: [
      { m: "POST", path: "/plural/login", auth: "public",
        desc: "Log in with your username and password (plus a Turnstile captcha token). Returns an access token to use on protected endpoints.",
        example: 'POST body: { "username": "admin", "password": "…", "turnstile_token": "…" }  →  { "access_token": "…", "token_type": "bearer", "success": true }' },
      { m: "POST", path: "/plural/signup", auth: "public",
        desc: "Create a non-admin account. Body { username, password (≥10 chars), email, display_name?, turnstile_token }. Email is required and unique. The account starts UNCONFIRMED: login is refused until the emailed link is used, and unconfirmed accounts are deleted after 24 hours. The response includes a short-lived correction_token — hold onto it, it's the only way to fix a mistyped address without a password.",
        example: 'POST body: { "username": "clove", "password": "…", "email": "you@example.com", "turnstile_token": "…" }  →  { "success": true, "email_sent": true, "correction_token": "…", "user": { … } }' },
      { m: "POST", path: "/plural/verify-email", auth: "public",
        desc: "Confirm an address using the token from the email. Body { token }. Single use, valid 24 hours. Also applies a pending email change." },
      { m: "POST", path: "/plural/resend-verification", auth: "public",
        desc: "Send the confirmation link again. Body { turnstile_token } plus either { correction_token } or { username, password }. Rate limited to one per IP per minute." },
      { m: "POST", path: "/plural/correct-email", auth: "public",
        desc: "Fix a mistyped address before confirmation, without a password. Body { correction_token, email, turnstile_token }. The correction token is issued only to the client that signed up, lasts 2 hours, and stops working once the account is confirmed — it is what stops anyone repointing an unconfirmed account at their own inbox." },
      { m: "GET", path: "/plural/users/check-username?username=", auth: "public",
        desc: "Check username availability. Returns { username, exists, available }." },
      { m: "GET", path: "/plural/users/check-email?email=", auth: "public",
        desc: "Check email availability. Returns { email, exists, available }. Rate limited to 20 lookups per IP per minute." },
      { m: "POST", path: "/plural/forgot-password", auth: "public",
        desc: "Request a password-reset link by USERNAME. Body { username, turnstile_token }. The link is emailed to the address on file for that account; the response reports a masked hint so the user knows which inbox to check. Returns 404 for an unknown username and 409 if the account has no email on file. Rate limited to one request per IP per minute.",
        example: 'POST body: { "username": "clove", "turnstile_token": "…" }  →  { "success": true, "message": "Reset link sent. The link expires in 15 minutes.", "sent_to": "a•••@d•••.win" }' },
      { m: "POST", path: "/plural/forgot-username", auth: "public",
        desc: "Recover a forgotten username by EMAIL. Body { email, turnstile_token }. The username is emailed to that address rather than returned, so knowing an address isn't enough to learn the username on it. Returns 404 if the address isn't registered. Rate limited to one request per IP per minute.",
        example: 'POST body: { "email": "you@example.com", "turnstile_token": "…" }  →  { "success": true, "message": "We\'ve sent your username to that address.", "sent_to": "y•••@e•••.com" }' },
      { m: "GET", path: "/plural/reset-password/check?token=", auth: "public",
        desc: "Check whether a reset token is still usable before rendering the form. Returns { valid }." },
      { m: "POST", path: "/plural/reset-password", auth: "public",
        desc: "Set a new password using a token from the reset email. Body { token, new_password (≥10 chars), turnstile_token }. Tokens last 15 minutes, are single-use, and requesting a new one revokes the previous.",
        example: 'POST body: { "token": "…", "new_password": "…", "turnstile_token": "…" }  →  { "success": true, "message": "Your password has been reset. …" }' },
      { m: "GET", path: "/plural/user_info", auth: "auth",
        desc: "The current authenticated user (no password hash)." },
      { m: "GET", path: "/plural/auth/is_admin", auth: "auth", desc: "{ isAdmin } for the current user." },
      { m: "GET", path: "/plural/auth/is_owner", auth: "auth", desc: "{ isOwner } for the current user." },
      { m: "GET", path: "/plural/auth/is_pet", auth: "auth", desc: "{ isPet } for the current user." },
    ],
  },
  {
    id: "plural-system", name: "Plural — system & mental state", blurb: "PluralKit system info and the tracked mental state.",
    endpoints: [
      { m: "GET", path: "/plural/system", auth: "public",
        desc: "PluralKit system info (name, description, tag) with the current mental_state attached." },
      { m: "GET", path: "/plural/mental-state", auth: "public",
        desc: "Current mental state: { level, updated_at, notes }." },
      { m: "POST", path: "/plural/mental-state", auth: "admin",
        desc: "Update mental state. Body { level, notes? }. Broadcasts a mental_state_update over /ws." },
    ],
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
        desc: "Clear a member's status." },
    ],
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
        desc: "Switch to several fronters with detailed feedback. Body { member_ids: string[] }." },
    ],
  },
  {
    id: "plural-users", name: "Plural — user management", blurb: "Admin CRUD over accounts.",
    endpoints: [
      { m: "GET", path: "/plural/users", auth: "admin", desc: "List all users (no password hashes)." },
      { m: "POST", path: "/plural/users", auth: "admin",
        desc: "Create a user. Body { username, password, email?, display_name?, is_admin?, is_pet? }. Accounts created here are pre-confirmed — the address is being assigned deliberately — so they can log in immediately and are never touched by the unconfirmed-account sweep." },
      { m: "PUT", path: "/plural/users/:user_id", auth: "auth",
        desc: "Update a user (admin, or the user themselves). Body may include display_name, current_password + new_password, avatar_url (an EXTERNAL image URL — uploads were removed), is_admin, is_pet, email. EMAIL RULES: a user may change their own address but must supply current_password, and the new address is held in pending_email until confirmed (the old one keeps working, and gets an alert). The owner may set anyone's address outright. A plain admin may NOT change someone else's." },
      { m: "DELETE", path: "/plural/users/:user_id", auth: "admin",
        desc: "Delete a user. Cannot delete yourself or the owner." },
    ],
  },
  {
    id: "plural-metrics", name: "Plural — metrics", blurb: "Fronting analytics.",
    endpoints: [
      { m: "GET", path: "/plural/metrics/fronting-time?days=30", auth: "auth",
        desc: "Per-member fronting time across 24h/48h/5d/7d/30d windows and totals." },
      { m: "GET", path: "/plural/metrics/switch-frequency?days=30", auth: "auth",
        desc: "Switch counts per window and average switches/day." },
    ],
  },
  {
    id: "plural-realtime", name: "Plural — realtime & admin", blurb: "The unified WebSocket + broadcast controls.",
    endpoints: [
      { m: "WS", path: "/ws", auth: "public",
        desc: "The single realtime socket for ALL live updates. On connect you get a connection_established message. Fronting (fronters_update), mental state (mental_state_update), device/battery (device_update) and force_refresh events are pushed to every client automatically. For live Discord presence, send a subscribe frame — either { \"type\": \"subscribe\", \"all\": true } or { \"type\": \"subscribe\", \"ids\": [\"<user id>\", …] }; you'll get an init_state snapshot immediately and presence_update events thereafter (only for the users you subscribed to). Every message is a { type, data } object. Send 'ping' to get 'pong'." },
      { m: "POST", path: "/plural/admin/refresh", auth: "admin",
        desc: "Broadcast a force_refresh to every connected /ws client." },
    ],
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
        desc: "No longer available — returns 410. The bot token is now set manually by the server operator." },
    ],
  },
  {
    id: "plural-seo", name: "Plural — SEO", blurb: "Data-driven crawler files.",
    endpoints: [
      { m: "GET", path: "/plural/robots.txt", auth: "public", desc: "robots.txt." },
      { m: "GET", path: "/plural/sitemap.xml", auth: "public", desc: "Sitemap generated from the member list." },
    ],
  },
  {
    id: "devices", name: "Devices", blurb: "Latest known device state (battery, charging, low power mode, wifi).",
    endpoints: [
      { m: "GET", path: "/devices", auth: "public", desc: "All devices → { device, level, charging, lowPowerMode, wifi, watch, airpods, updated_at }." },
      { m: "GET", path: "/devices/:device", auth: "public", desc: "One device, or 404." },
      { m: "POST", path: "/devices?device=iphone&level=25&charging=1&lpm=0&wifi=Home&watch=1&airpods=0", auth: "key",
        desc: "Report device state. Only 'device' is required; supplied fields are updated, the rest untouched. Send the X-Battery-Key header.",
        params: [["device", "1–64 chars (required)."], ["level", "Optional. Integer 0–100."], ["charging", "Optional. 1 (true) or 0 (false)."], ["lpm", "Optional. 1 (true) or 0 (false) → lowPowerMode."], ["wifi", "Optional. Any string (network name), ≤128 chars."], ["watch", "Optional. 1 (connected) or 0 (not connected)."], ["airpods", "Optional. 1 (connected) or 0 (not connected)."]] },
      { m: "DELETE", path: "/devices?device=iphone", auth: "key",
        desc: "Delete a device's state. Returns 404 if the device doesn't exist. Send the X-Battery-Key header.",
        params: [["device", "1–64 chars (required)."]] },
    ],
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
        desc: "Migration import: insert an entry with a fresh UID, bypassing captcha + rate limit. Send the X-Battery-Key header. Body { name, message, website? }." },
    ],
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
      { m: "GET", path: "/system-data/api/entry/:id", auth: "admin", desc: "One full log row." },
    ],
  },
  {
    id: "contrib", name: "Contrib", blurb: "Merged git contribution heatmaps.",
    endpoints: [
      { m: "GET", path: "/contribapi", auth: "public",
        desc: "A single contribution heatmap that merges activity from GitHub and Codeberg. Updated at most hourly." },
    ],
  },
  {
    id: "meta", name: "Meta", blurb: "Service info, health, docs, and legal pages.",
    endpoints: [
      { m: "GET", path: "/", auth: "public", desc: "Service info (JSON) — the namespace map, plus docs/health/abuse/terms/privacy links.", root: true },
      { m: "GET", path: "/health", auth: "public",
        desc: "Liveness: Discord gateway connection state + tracked-user count + SYSTEM DO reachability. Returns HTTP 200 when everything is up, 503 when degraded — point your uptime monitor here." },
      { m: "GET", path: "/docs", auth: "public", desc: "This page.", root: true },
      { m: "GET", path: "/openapi.json", auth: "public", desc: "Machine-readable OpenAPI 3.1 spec generated from the same catalogue that renders this page.", root: true },
      { m: "GET", path: "/abuse", auth: "public", desc: "Abuse & contact page: how to report abuse, request data removal / opt-out, or disclose a vulnerability.", root: true },
      { m: "GET", path: "/terms", auth: "public", desc: "Terms of service — the short version: be reasonable with request volume or your IP gets blocked.", root: true },
      { m: "GET", path: "/privacy", auth: "public", desc: "Privacy page: what's logged (visitor IPs, guestbook entries, cached Discord data), why, and how to get it removed.", root: true },
      { m: "GET", path: "/.well-known/security.txt", auth: "public", desc: "RFC 9116 security contact file. Also available at /security.txt.", root: true },
    ],
  },
];
