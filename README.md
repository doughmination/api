# Doughmination API

A combined Discord **presence** (Lanyard-style) and **profile/badges** (dstn.to-style) API on a **single Cloudflare Worker + Durable Objects**, powered by **one Discord bot**. It also carries the Doughmination plural-system API (fronting, members, mental state, devices, guestbook), Minecraft/Hypixel lookups, and merged git contribution heatmaps. Everything returns one unified JSON envelope, and all live updates go over a single WebSocket.

- **Live:** https://doughmination.uk · **Docs:** [`/docs`](https://doughmination.uk/docs) · **Abuse & contact:** [`/abuse`](https://doughmination.uk/abuse)
- **Stack:** Cloudflare Workers, Durable Objects, KV, Hono, Zod, TypeScript, Bun
- **Licence:** ESAL-2.1 — see [LICENCE.md](LICENCE.md)

## Thanks

This code wasn't just me. It took a good chunk of my own brain plus a lot of help from Dustin (@dstn.to), who was really generous explaining how he handles the tricky parts: rate limits, caching, and getting Discord to actually trust your requests. Thanks Dustin! And credit to Phineas for Lanyard, which inspired the presence half of this.

## Architecture

Two Durable Objects behind the Worker router (`src/index.ts`):

- **GATEWAY** (`GatewayManager`) — holds the single Discord gateway socket, ingests presences from `READY` / `GUILD_CREATE` / `PRESENCE_UPDATE`, and keeps an in-memory `userId → presence` map. It doesn't serve browser sockets; it relays each live presence change to the SYSTEM DO for fan-out.
- **SYSTEM** (`SystemState`) — all persistent state (users, tags, statuses, mental state, devices) in DO storage, the visitor-log SQLite table, and the single realtime WebSocket hub.

A cron trigger (`*/2 * * * *`) keeps the gateway DO connected. Static assets under `assets/` are served at the site root (`/icon.png`, `/capes/*`, …).

## Endpoints

Full, filterable reference at [`/docs`](https://doughmination.uk/docs). The map:

| Namespace | What it serves |
|---|---|
| `WS /v2/ws` | **The one WebSocket** for all live updates (see below) |
| `/v2/lanyard/users`, `/v2/lanyard/users/:id`, `/v2/lanyard/status` | REST presence (single, batch up to 100, gateway health) |
| `/v2/discord/users/:id`, `/v2/discord/users?ids=…` | Full profile + badges + live presence, single or batch |
| `/v2/discord/guilds/:invite`, `/v2/discord/girls/:idType/:id` | Guild info from an invite; role/member lookups |
| `/v2/minecraft/general/:uuid`, `/v2/minecraft/hypixel/:uuid`, `/v2/minecraft/capes` | Mojang identity + skins/capes, Hypixel stats, vanilla cape catalogue |
| `/v2/contribapi` | Merged git contribution heatmaps (GitHub + Codeberg) |
| `/v2/plural/*`, `/v2/devices/*`, `/v2/guestbook/*`, `/v2/system-data/*` | The plural-system API: fronting, members, mental state, devices/battery, guestbook, visitor logs |
| `/v2/health` | Liveness: gateway connection + DO reachability (200 ok / 503 degraded) — point uptime monitors here |
| `/docs`, `/openapi.json` | Full HTML API reference + machine-readable OpenAPI 3.1 spec (both generated from `src/apidata.ts`) |
| `/abuse`, `/terms`, `/privacy`, `/.well-known/security.txt` | Abuse reports, terms of service, privacy, vulnerability disclosure |

All JSON responses share one envelope: `{ success, data }` on success, `{ success: false, error: { code, message } }` on failure.

## Realtime — the single `/v2/ws`

There's exactly **one** socket (the old `/v2/lanyard/ws` and `/v2/plural/ws` are gone). Every frame is a `{ type, data }` object.

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

See the notes in each source file; the short version:

| Data | Where | TTL |
|---|---|---|
| Presence | GATEWAY DO memory | never cached — live from the gateway |
| PluralKit data (system, members, fronters) | SYSTEM DO memory | `CACHE_TTL` (default **30s**), busted on any switch/member/tag/status change |
| Discord profiles | KV (`PROFILE_CACHE`) | `PROFILE_CACHE_TTL_SECONDS` (default **300s**, min 60), jittered ±20%; rich (userbot) fetches back off on 429 via a shared cooldown key (30–300s) |
| Guild invites | KV | **300s** |
| Guild memberships | KV | **6h** |
| Client-mod badges (Equicord) | KV | **1h**, stale fallback |
| Minecraft general + Hypixel | KV | **5min**; vanilla-cape registry kept permanently |

HTTP `Cache-Control`: JSON API responses are `no-store` (never edge/browser cached). HTML pages (`/docs`, `/abuse`, `/terms`, `/privacy`), `/openapi.json`, and `/v2/contribapi` are `public, max-age=3600`. All responses carry security headers (HSTS, nosniff; CSP + frame-deny on HTML).

## Setup

### 1. Discord application

1. https://discord.com/developers/applications → **New Application** → **Bot**.
2. **Reset Token**, copy it (this is `DISCORD_BOT_TOKEN`).
3. Under **Privileged Gateway Intents**, enable **PRESENCE INTENT** and **SERVER MEMBERS INTENT**.
4. Invite the bot to a server that contains the people you want to track (OAuth2 URL generator → scope `bot`). Presence is only visible for users sharing a server with the bot — same model as Lanyard.
5. Optionally set `TRACKED_GUILD_IDS` in `wrangler.jsonc` (comma-separated) to limit monitoring to specific servers; empty = every guild the bot can see.

### 2. Install & deploy

```bash
# REQUIRED
bun install

# KV namespace for profile cache — paste the printed id into wrangler.jsonc
bunx wrangler kv namespace create PROFILE_CACHE

# Secrets
bunx wrangler secret put DISCORD_BOT_TOKEN
# Optional, ToS risk — only if you want the rich badges:
bunx wrangler secret put DISCORD_USER_TOKEN
# Optional 2nd/3rd userbot:
bunx wrangler secret put DISCORD_USER_TOKEN2
bunx wrangler secret put DISCORD_USER_TOKEN3

# Local dev (uses .dev.vars — see .dev.vars.example)
bun dev

# Production
bun deploy
```

Other secrets for the plural-system half (`JWT_SECRET`, `SYSTEM_TOKEN`, `TURNSTILE_SECRET`, `ADMIN_PASSWORD`, `DOUGH_BOT_TOKEN`, `BATTERY_API_KEYS`) go in `.dev.vars` locally and `wrangler secret put <NAME>` in production — `.dev.vars.example` documents all of them.

### 3. Useful commands

```bash
bun typecheck   # tsc --noEmit
bun tail        # live production logs
# Update X-Super-Properties when Discord bumps the client build:
bun decode "X-Super-Properties: [BASE64 HERE]"
```

### Configuration (`wrangler.jsonc` vars)

| Var | Purpose |
|---|---|
| `TRACKED_GUILD_IDS` | Comma-separated guilds to monitor; empty = all the bot sees |
| `MEMBERSHIP_GUILD_IDS` | Guilds to resolve per-user membership for; falls back to `TRACKED_GUILD_IDS` |
| `PROFILE_CACHE_TTL_SECONDS` | Profile KV cache TTL (min 60) |
| `CACHE_TTL` | PluralKit cache TTL in seconds |
| `DISCORD_CLIENT_BUILD_NUMBER` | For userbot `X-Super-Properties` (update with `bun decode`) |
| `PRONOUNDB_API_BASE`, `TIMEZONE_API_BASE`, `REVIEWDB_API_BASE` | Third-party enrichment sources, overridable for self-hosted forks |
| `BASE_URL`, `CORS_ORIGINS` | Plural-system base URL and CORS allowlist |

## Abuse, privacy & security

- **Terms:** [`/terms`](https://doughmination.uk/terms) — the short version: be reasonable with request volume or your IP gets blocked.
- **Privacy:** [`/privacy`](https://doughmination.uk/privacy) — what's logged (visitor IPs, guestbook entries, brief Discord/Minecraft caches) and how to get it removed.
- **Report abuse / request data removal:** [`/abuse`](https://doughmination.uk/abuse) or email **abuse@doughmination.win**.
- **Opt out of presence tracking:** leave the Discord server(s) the bot is in, or email with your Discord user ID to be blocked from lookups.
- **Vulnerability disclosure:** email the address above; machine-readable contact at [`/.well-known/security.txt`](https://doughmination.uk/.well-known/security.txt). Responsible disclosure appreciated.

## Licence

[ESAL-2.1](LICENCE.md).
