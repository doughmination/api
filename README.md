# dough-restful

A combined Discord **presence** (Lanyard-style) and **profile/badges** (dstn.to-style) API on a **single Cloudflare Worker + Durable Object**, powered by **one Discord bot**. It exposes a REST endpoint and a Lanyard-compatible WebSocket, returning a single unified JSON shape.

## Thanks
This code wasn't just me. It took a good chunk of my own brain plus a lot of
help from Dustin (@dstn.to), who was really generous explaining how he handles
the tricky parts: rate limits, caching, and getting Discord to actually trust
your requests. Thanks Dustin! And credit to Phineas for Lanyard, which inspired
the presence half of this.

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
pnpm install

# KV namespace for profile cache — paste the printed id into wrangler.jsonc
pnpx wrangler kv namespace create PROFILE_CACHE

# Secrets
pnpx wrangler secret put DISCORD_BOT_TOKEN
# Optional, ToS risk — only if you want the rich badges:
pnpx wrangler secret put DISCORD_USER_TOKEN
# Optional second userbot
pnpx wrangler secret put DISCORD_USER_TOKEN2

# If you need to update the X-Super-Properties to latest version
pnpm decode "X-Super-Properties: [BASE64 HERE]"

# Local test
pnpm dev

# Production
pnpm deploy
```