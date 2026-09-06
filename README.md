# Doughmination API

A combined Discord **presence** (Lanyard-style) and **profile/badges** (dstn.to-style) API on a **single Cloudflare Worker + Durable Objects**, powered by **one Discord bot**. It also carries the Doughmination plural-system API (fronting, members, mental state, devices, guestbook), Minecraft lookups, and merged git contribution heatmaps. Everything returns one unified JSON envelope, and all live updates go over a single WebSocket.

- **Live:** https://doughmination.uk · **Docs:** [`/docs`](https://doughmination.uk/docs) · **Abuse & contact:** [`/abuse`](https://doughmination.uk/abuse)
- **Stack:** Cloudflare Workers, Durable Objects, KV, Hono, Zod, TypeScript, Bun
- **Licence:** ESAL-2.1 — see [LICENCE.md](LICENCE.md)

## Thanks

This code wasn't just me. It took a good chunk of my own brain plus a lot of help from Dustin (@dstn.to), who was really generous explaining how he handles the tricky parts: rate limits, caching, and getting Discord to actually trust your requests. Thanks Dustin! And credit to Phineas for Lanyard, which inspired the presence half of this.

## Abuse, privacy & security

- **Terms:** [`/terms`](https://doughmination.uk/terms) — the short version: be reasonable with request volume or your IP gets blocked.
- **Privacy:** [`/privacy`](https://doughmination.uk/privacy) — what's stored (guestbook entries, anonymous visit counts, brief Discord/Minecraft caches) and how to get it removed.
- **Report abuse / request data removal:** [`/abuse`](https://doughmination.uk/abuse) or email **abuse@doughmination.win**.
- **Opt out of presence tracking:** leave the Discord server(s) the bot is in, or email with your Discord user ID to be blocked from lookups.
- **Vulnerability disclosure:** email the address above; machine-readable contact at [`/.well-known/security.txt`](https://doughmination.uk/.well-known/security.txt). Responsible disclosure appreciated.

## Licence

[DASL-1.2](LICENCE.md).
