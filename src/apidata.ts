/* =====================================================================
 * apidata.ts — the single source of truth for the endpoint catalogue.
 *
 * Consumed by docs.ts (rendered client-side on /docs) and openapi.ts
 * (converted to the /openapi.json spec). Keep this in sync when routes
 * change — nothing else needs editing.
 * ===================================================================== */

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "WS";
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
        desc: "Guestbook moderation accepts a signed-in admin's token from the system site (doughmination.co.uk), sent as 'Authorization: Bearer <token>'." },
      { m: "GET", path: "X-Battery-Key", auth: "key",
        desc: "Reporting or deleting device state (POST/DELETE /devices) needs your device key, sent as the 'X-Battery-Key' header." },
    ],
  },
  {
    id: "discord", name: "Discord — profiles, presence & guilds", blurb: "One merged record: profile, badges, equipped collectibles, and live presence.",
    endpoints: [
      { m: "GET", path: "/discord/users/:id", auth: "public",
        desc: "A user's full record in one call: profile (avatar, banner, badges, connected accounts, and — when available — bio, pronouns and reviews), the collectibles they have equipped (nameplate, profile frame, profile effect, avatar decoration — each resolved to its name and image assets), and their live presence (status, activities, Spotify, platforms). Fetched fresh on every request. Presence is null if the user shares no tracked server with the bot.",
        params: [["id", "Discord user ID."], ["?fresh / ?nocache / ?refresh", "Force fresh sub-resource lookups (collectibles/wishlist) instead of their short shared caches."]] },
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
    id: "minecraft", name: "Minecraft", blurb: "Skins and capes for a Minecraft account.",
    endpoints: [
      { m: "GET", path: "/minecraft/general/:uuid", auth: "public",
        desc: "A player's Mojang identity: username, UUID (both dashed and short forms), skin and cape texture URLs, the skin's arm model (classic or slim), every cape the player has across providers (Minecraft, OptiFine, MinecraftCapes, LabyMod, 5zig, TLauncher, SkinMC — plus a custom 'doughmination' cape for hand-picked accounts) via the capes array, and a set of ready-to-embed mc-heads render images (face, head, body, player, combo, skin) — each render includes the overlay/hat layer, with _flat variants for the inner skin only. Returns 404 if no Minecraft account has that UUID.",
        params: [["uuid", "Minecraft UUID — 32 hex characters, dashes optional."], ["?fresh / ?nocache / ?refresh", "Skip the cache and fetch fresh."]],
        example: 'GET /minecraft/general/853c80ef3c3749fdaa49938b674adae6  →  { name, uuid, skin_url, cape_url, skin_model, capes: [ { source, cape_url } ], render: { face, head, body, player, combo, skin } }' },
      { m: "GET", path: "/minecraft/capes", auth: "public",
        desc: "The set of vanilla (Mojang) capes the API has seen, persisted to memory. It grows over time: every account looked up via /minecraft/general has its equipped vanilla cape remembered, deduped by texture hash. Third-party capes (OptiFine, LabyMod, etc.) are loaded fresh per request and are not persisted here.",
        params: [],
        example: 'GET /minecraft/capes  →  { count, capes: [ { source: "minecraft", cape_url } ] }' },
    ],
  },
  {
    id: "genshin", name: "Genshin", blurb: "Owned/not-owned character roster + levels for a Genshin UID, via Enka.Network.",
    endpoints: [
      { m: "GET", path: "/genshin/roster/:uid", auth: "public",
        desc: "Every playable character, merged against a live Enka.Network lookup for the given UID: name, element, rarity, icon_url, whether the account owns it, and its level (null if not owned). Enka only returns a player's FULL roster if they've enabled 'Display all your characters' on their in-game Character Showcase; otherwise only their pinned showcase (up to 8) is visible, and the response's partial flag is true so a UI can prompt the player to enable it. Cached per-UID using the ttl Enka itself returns for that profile (so repeat loads don't hammer Enka); the static character catalog (names/icons) is cached separately for ~24h. Returns 404 if Enka has no record of the UID (private, unindexed, or typo'd), 502 if Enka's upstream errors.",
        params: [["uid", "Genshin UID (in-game numeric player ID, not a Discord/Enka username)."], ["?fresh / ?nocache / ?refresh", "Skip the roster cache and re-fetch from Enka (the character catalog is still served from its own cache)."]],
        example: 'GET /genshin/roster/691386457  →  { uid, nickname, player_level, partial, owned_count, total_count, characters: [ { id, name, element, rarity, icon_url, owned, level } ] }' },
      { m: "GET", path: "/genshin/roster/:uid/:heroId", auth: "public",
        desc: "Full showcase detail for one character — everything needed to render an Enka-style character card. Gacha splash art_url; level, constellation, friendship; talent levels (normal/skill/burst); the totalled sheet stats (Max HP / ATK / DEF each with their base + weapon/artifact-added split, plus EM, CRIT Rate, CRIT DMG, Energy Recharge and the single highest elemental/physical/healing bonus); the equipped weapon (base + sub stat, refinement, level); all five artifacts with main stat, up to four substats and a resolved set name; and the active 2-/4-piece set bonuses. Artifact set names are resolved via Project Amber (Enka's curated loc omits them), cached ~24h. Icon URLs point at the Doughmination CDN, which proxies + edge-caches enka.network/ui/*. A character not in the live showcase comes back with catalog basics only (stats/weapon/artifacts empty, talents null). Append /items or /constellations for just those slices. Same cached Enka fetch as the roster route — no extra upstream call within the ttl window.",
        params: [["uid", "Genshin UID."], ["heroId", "Numeric avatar id from the roster list, e.g. 10000087."], ["?fresh / ?nocache / ?refresh", "Skip the cached Enka fetch."]],
        example: 'GET /genshin/roster/691386457/10000087  →  { name, element, art_url, level, constellation, talents, stats: [ { name, value, is_percent, base?, added? } ], weapon, artifacts: [ { slot, set_name, main_stat, sub_stats } ], sets: [ { name, count } ] }' },
    ],
  },
  {
    id: "realtime", name: "Realtime", blurb: "One WebSocket for every live update.",
    endpoints: [
      { m: "WS", path: "/ws", auth: "public",
        desc: "The realtime socket for presence and devices. On connect you get a connection_established message. Device/battery (device_update) events are pushed to every client automatically. Fronting and mental state are on the system site's socket, wss://doughmination.co.uk/api/plural/ws. For live Discord presence, send a subscribe frame — either { \"type\": \"subscribe\", \"all\": true } or { \"type\": \"subscribe\", \"ids\": [\"<user id>\", …] }; you'll get an init_state snapshot immediately and presence_update events thereafter (only for the users you subscribed to). Every message is a { type, data } object. Send 'ping' to get 'pong'." },
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
        desc: "Sign the guestbook. Honeypot (url2) + Turnstile (when configured) + per-IP rate limit (60s). Returns 201 { ok, entry } with the new UID, or 202 { ok, pending: true } when the word filter holds it for review.",
        example: 'POST body: { "name": "Clove", "message": "hi!", "website": "https://…", "turnstileToken": "…" }' },
      { m: "DELETE", path: "/guestbook/:id", auth: "key",
        desc: "Delete an entry by its UID. Returns 404 if not found. Send the X-Battery-Key header.",
        params: [["id", "The entry's UID (required)."]] },
      { m: "POST", path: "/guestbook/import", auth: "key",
        desc: "Migration import: insert an entry with a fresh UID, bypassing captcha + rate limit. Send the X-Battery-Key header. Body { name, message, website? }." },
      { m: "GET", path: "/guestbook/admin/entries?status=pending", auth: "admin",
        desc: "Moderation list, including held entries and the blocklist terms that flagged them → { entries, total, pending }. Send X-Guestbook-Key or an admin bearer token.",
        params: [["status", "Optional. pending, approved or all (default)."]] },
      { m: "PATCH", path: "/guestbook/admin/entries/:id", auth: "admin",
        desc: "Approve, re-hold or edit an entry. Body { status?: 'approved' | 'pending', name?, message?, website? }." },
      { m: "DELETE", path: "/guestbook/admin/entries/:id", auth: "admin",
        desc: "Delete an entry by its UID." },
      { m: "GET", path: "/guestbook/admin/blocklist", auth: "admin",
        desc: "The word blocklist → { words }. Matching ignores case, accents, spacing, punctuation, repeated letters and common lookalikes (b@d, 8ad, Cyrillic а)." },
      { m: "PUT", path: "/guestbook/admin/blocklist", auth: "admin",
        desc: "Replace the blocklist. Body { words: string[] }. Only affects new posts." },
    ],
  },
  {
    id: "counter", name: "Counter — site visit counters", blurb: "A hit counter per site id. Stores no IPs, no headers, no cookies — just a salted, non-reversible visitor hash.",
    endpoints: [
      { m: "GET", path: "/counter", auth: "public",
        desc: "Every site with a counter, busiest first \u2192 { sites: [{ site_id, total, unique, today, created_at, updated_at }] }." },
      { m: "GET", path: "/counter/:siteId", auth: "public",
        desc: "Read a site's counts without recording a visit \u2192 { site_id, total, unique, today, created_at, updated_at }. 404 if the site has never been hit.",
        params: [["siteId", "1\u201364 chars: lowercase letters, digits, dot, dash, underscore."]] },
      { m: "POST", path: "/counter/:siteId", auth: "public",
        desc: "Record a visit and get the updated counts back, plus 'counted' (false when the 30-minute per-visitor cooldown swallowed it) and 'first_visit'. The site registers itself on its first hit. No request body.",
        params: [["siteId", "1\u201364 chars: lowercase letters, digits, dot, dash, underscore."]],
        example: 'POST /counter/is.doughmination.gay  \u2192  { "site_id": "is.doughmination.gay", "total": 1337, "unique": 402, "today": 12, "counted": true, "first_visit": false }' },
      { m: "GET", path: "/counter/:siteId/hit", auth: "public",
        desc: "The same thing over a plain GET, for callers that can't POST (a no-JS beacon, a hand-typed URL). Reading /counter/:siteId itself never records anything." },
      { m: "GET", path: "/counter/:siteId/history?days=30", auth: "public",
        desc: "Daily visit histogram, oldest first \u2192 { site_id, days, history: [{ day, hits }] }. Days are UTC and kept for 400 days.",
        params: [["?days", "Optional. 1\u2013400, default 30."]] },
      { m: "POST", path: "/counter/:siteId/reset", auth: "key",
        desc: "Zero a site's counters, keeping the site registered. Send the X-Battery-Key header." },
      { m: "DELETE", path: "/counter/:siteId", auth: "key",
        desc: "Delete a site and everything recorded for it. Returns 404 if not found. Send the X-Battery-Key header." },
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
    id: "ops", name: "Ops — cache", blurb: "Operational endpoints. Handle with care.",
    endpoints: [
      { m: "GET", path: "/burst", auth: "public",
        desc: "Purges EVERYTHING from Cloudflare's cache across every zone the configured API token can see — all accounts the token has access to, including the one that owns this Worker. Loads over a plain GET so it can be fired from a browser. Responds { \"code\": \"success\" } once every zone has been purged, or { \"code\": \"<error>\" } with the first zone that failed. Requires the CF_API_TOKEN secret (a token with Zone:Read + Cache Purge); without it the response is { \"code\": \"CF_API_TOKEN is not configured\" } and nothing is purged.",
        note: "UNAUTHENTICATED and destructive: anyone who loads this URL wipes all cached content for every zone the token can reach. Its response is a bare { code } object, NOT the usual { success, data } envelope.",
        example: 'GET /burst  →  { "code": "success" }   (on failure e.g. { "code": "example.com: HTTP 403" })' },
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
      { m: "GET", path: "/privacy", auth: "public", desc: "Privacy page: what's stored (guestbook entries, anonymous visit counts, cached Discord data), why, and how to get it removed.", root: true },
      { m: "GET", path: "/.well-known/security.txt", auth: "public", desc: "RFC 9116 security contact file. Also available at /security.txt.", root: true },
    ],
  },
];