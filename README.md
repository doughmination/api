# dough-restful

A combined Discord **presence** (Lanyard-style) and **profile/badges** (dstn.to-style) API on a **single Cloudflare Worker + Durable Objects**, powered by **one Discord bot**. It also carries the Doughmination plural-system API (fronting, members, mental state, devices, guestbook). Everything returns one unified JSON shape, and all live updates go over a single WebSocket.

## Thanks
This code wasn't just me. It took a good chunk of my own brain plus a lot of
help from Dustin (@dstn.to), who was really generous explaining how he handles
the tricky parts: rate limits, caching, and getting Discord to actually trust
your requests. Thanks Dustin! And credit to Phineas for Lanyard, which inspired
the presence half of this.

## What's in here

Two Durable Objects behind the Worker router (`src/index.ts`):

- **GATEWAY** (`GatewayManager`) — holds the single Discord gateway socket, ingests presences from `READY` / `GUILD_CREATE` / `PRESENCE_UPDATE`, and keeps an in-memory `userId → presence` map. It doesn't serve browser sockets; it relays each live presence change to the SYSTEM DO for fan-out.
- **SYSTEM** (`SystemState`) — the old backend as one object: all persistent state (users, tags, statuses, mental state, devices) in DO storage, the visitor-log SQLite table, and the single realtime WebSocket hub.

### Endpoints (all under `/v2`)

- `/v2/ws` — **the one WebSocket** for all live updates (see below).
- `/v2/lanyard/users`, `/v2/lanyard/users/:id`, `/v2/lanyard/status` — REST presence.
- `/v2/discord/users/:id`, `/v2/discord/users?ids=…`, `/v2/discord/guilds/:invite`, `/v2/discord/girls/:idType/:id` — profiles, badges, guild/role info.
- `/v2/minecraft/general/:uuid`, `/v2/minecraft/hypixel/:uuid`, `/v2/minecraft/capes` — Mojang + Hypixel.
- `/v2/contribapi` — merged git contribution heatmaps.
- `/v2/plural/*`, `/v2/devices/*`, `/v2/guestbook/*`, `/v2/system-data/*` — the plural system API.
- `/docs` — full HTML API reference.

## Realtime — the single `/v2/ws`

There's exactly **one** socket now (the old `/v2/lanyard/ws` and `/v2/plural/ws` are gone). Every frame is a `{ type, data }` object.

On connect you get `connection_established`. These are then pushed to **every** client automatically as they happen:

- `fronters_update` — who's fronting changed
- `mental_state_update` — mental state changed
- `device_update` — a device/battery report changed
- `force_refresh` — admin asked all clients to refresh

Discord **presence is opt-in** (keeps traffic down). Send a subscribe frame:

```jsonc
{ "type": "subscribe", "all": true }              // every tracked user
{ "type": "subscribe", "ids": ["123…", "456…"] }  // just these users
```

You immediately get an `init_state` snapshot of the presences you asked for, then `presence_update` frames for those users only. Subscriptions persist across DO hibernation. Send the string `ping` to get `pong`.

Presence lives in the GATEWAY DO; when it changes, GATEWAY relays it to SYSTEM, which fans it out to the clients subscribed to that user.

## Caching

See the notes in each source file, but the short version:

- **Presence is never cached** — it's live from the Discord gateway, held in memory in the GATEWAY DO and pushed over the socket in real time.
- **PluralKit data** (system, members, fronters) — in-memory in the SYSTEM DO, `CACHE_TTL` seconds (default **30s**). Busted immediately on any switch / member / tag / status change.
- **Discord profiles** — KV (`PROFILE_CACHE`), `PROFILE_CACHE_TTL_SECONDS` (default **300s**, min 60), jittered ±20% so batches don't all expire at once. Rich (userbot) fetches back off on a 429 via a shared cooldown key (30–300s).
- **Guild invites** — KV, **300s**. **Memberships** — KV, **6h**. **Client-mod badges** (Equicord) — KV, **1h** with stale fallback. **Minecraft** general + Hypixel — KV, **5min**; the vanilla-cape registry is kept **permanently**.
- **HTTP `Cache-Control`** — JSON API responses are `no-store` (never edge/browser cached). `/docs` and `/v2/contribapi` are `public, max-age=3600` (1h).

## Setup

### 1. Settings
1. https://discord.com/developers/applications → **New Application** → **Bot**.
2. **Reset Token**, copy it (this is `DISCORD_BOT_TOKEN`).
3. Under **Privileged Gateway Intents**, enable **PRESENCE INTENT** and **SERVER MEMBERS INTENT**.
4. Invite the bot to a server that contains the people you want to track (OAuth2 URL generator → scope `bot`). Presence is only visible for users sharing a server with the bot — same model as Lanyard.
5. Optionally set `TRACKED_GUILD_IDS` in `wrangler.jsonc` (comma-separated) to limit monitoring to specific servers; empty = every guild the bots can see.

### 2. Commands
```bash
# REQUIRED
bun install

# KV namespace for profile cache — paste the printed id into wrangler.jsonc
bunx wrangler kv namespace create PROFILE_CACHE

# Secrets
bunx wrangler secret put DISCORD_BOT_TOKEN
# Optional, ToS risk — only if you want the rich badges:
bunx wrangler secret put DISCORD_USER_TOKEN
# Optional second userbot
bunx wrangler secret put DISCORD_USER_TOKEN2
# Optional 3rd userbot
bunx wrangler secret put DISCORD_USER_TOKEN3

# If you need to update the X-Super-Properties to latest version
bun decode "X-Super-Properties: [BASE64 HERE]"

# Local test
bun dev

# Production
bun deploy
```
