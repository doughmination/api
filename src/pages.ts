/* =====================================================================
 * pages.ts — shared HTML shell + the /terms, /privacy and 404 pages.
 *
 * Same self-contained Catppuccin Mocha look as /docs. The shell is also
 * used by abuse.ts so the styling lives in exactly one place.
 * ===================================================================== */

import { ABUSE_CONTACT } from "./abuse";

const FOOTER_LINKS = `<a href="/docs">API reference</a> · <a href="/abuse">Abuse</a> · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a>`;

/** Wraps page content in the shared document shell. `body` is trusted HTML. */
export function pageShell(title: string, subtitle: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="icon" type="image/png" href="/icon.png" />
<title>${title} — Doughmination API</title>
<style>
  /* Comic Code + info dark palette, matching every other app. */
  @font-face { font-family: "Comic Code";
    src: url("https://fonts.doughmination.co.uk/ComicCode-Regular_2022-05-24-151938_hsmz.woff2") format("woff2");
    font-weight: 400; font-style: normal; font-display: swap; }
  @font-face { font-family: "Comic Code";
    src: url("https://fonts.doughmination.co.uk/ComicCode-Bold_2022-05-24-152309_zqkm.woff2") format("woff2");
    font-weight: 700; font-style: normal; font-display: swap; }
  :root {
    color-scheme: dark;
    --base: #0a0b10; --mantle: #070810; --surface0: #12141c; --surface1: #1b1e2a;
    --surface2: #232838; --subtext0: #9aa3c2; --subtext1: #c9cfe0; --text: #f4f6fb;
    --pink: #f5a9b8; --red: #f38ba8; --green: #a6e3a1; --blue: #89b4fa;
    --bg: var(--base); --line: var(--surface2); --fg: var(--text); --muted: var(--subtext0);
    --mono: "Comic Code", ui-monospace, SFMono-Regular, Menlo, monospace; --accent: var(--pink);
  }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.65 "Comic Code", ui-monospace, monospace; background: var(--bg); color: var(--fg); }
  header { padding: 24px 20px 14px; border-bottom: 1px solid var(--line); }
  .inner { max-width: 720px; margin: 0 auto; }
  h1 { margin: 0 0 4px; font-size: 21px; }
  header p { margin: 0; color: var(--subtext0); font-size: 13.5px; }
  main { max-width: 720px; margin: 0 auto; padding: 20px; }
  h2 { font-size: 16.5px; margin: 28px 0 8px; }
  p, li { color: var(--subtext1); font-size: 14.5px; }
  ul { padding-left: 22px; margin: 8px 0; }
  a { color: var(--accent); }
  code { font: 12.5px var(--mono); background: var(--mantle); color: var(--pink); padding: 1px 5px; border-radius: 4px; border: 1px solid var(--line); }
  .card { border: 1px solid var(--line); background: var(--surface0); border-radius: 10px; padding: 14px 16px; margin: 14px 0; }
  .card strong { color: var(--fg); }
  footer { max-width: 720px; margin: 0 auto; padding: 8px 20px 28px; font-size: 13px; color: var(--muted); }
  .big { font: 700 64px var(--mono); color: var(--accent); margin: 30px 0 6px; }
  ::selection { background: rgba(245,169,184,.28); }
</style>
</head>
<body>
<header><div class="inner">
  <h1>${title}</h1>
  <p>${subtitle}</p>
</div></header>
<main>
${body}
</main>
<footer>${FOOTER_LINKS}</footer>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// /terms
// ---------------------------------------------------------------------------

export const TERMS_HTML = pageShell(
  "Terms of service",
  `The short version: be reasonable, and this stays free and open. <a href="/docs">← API reference</a>`,
  `
<div class="card">
  <strong>tl;dr:</strong> the public endpoints are free to use. Please be reasonable with your request volume — if you hammer the API, your IP gets blocked. That's the whole deal.
</div>

<h2>Use of the API</h2>
<ul>
  <li>The public endpoints are free for personal and non-commercial projects. No API key, no signup.</li>
  <li><strong>Be reasonable with requests.</strong> Use the batch endpoints (100 users per call), respect the cache TTLs instead of polling with <code>?fresh</code>, and use the WebSocket (<code>/v2/ws</code>) for live data instead of tight polling loops. Unreasonable traffic — floods, scraping loops, cache-bust spam — gets the source IP blocked at the edge, usually without warning.</li>
  <li>Don't use this API to harass, stalk, or surveil anyone. That's an immediate permanent block and, where relevant, a report to the platform involved.</li>
  <li>Authenticated endpoints (the plural-system API, devices, admin routes) are for authorised users only. Don't probe them.</li>
</ul>

<h2>No guarantees</h2>
<p>This is a small, personally-run service on Cloudflare Workers. It's provided <strong>as-is, with no warranty and no uptime guarantee</strong>. Endpoints, response shapes, and these terms may change — or the whole service may shut down — at any time, though breaking changes are versioned under <code>/v2</code> where practical. Check <a href="/v2/health"><code>/v2/health</code></a> if something seems down.</p>

<h2>Data served</h2>
<p>Discord and Minecraft data served by this API belongs to its respective owners and is passed through (briefly cached) for convenience. If your data appears here and you want it removed, see the <a href="/privacy">privacy page</a> or the <a href="/abuse">abuse page</a>.</p>

<h2>Contact</h2>
<p>Questions, problems, or an appeal to an IP block: <a href="mailto:${ABUSE_CONTACT}">${ABUSE_CONTACT}</a>.</p>
`,
);

// ---------------------------------------------------------------------------
// /privacy
// ---------------------------------------------------------------------------

export const PRIVACY_HTML = pageShell(
  "Privacy",
  `What this service stores, why, and how to get it removed. <a href="/docs">← API reference</a>`,
  `
<div class="card">
  <strong>tl;dr:</strong> no ads, no analytics, no selling anything. Visit logs (IP + path) are kept for abuse monitoring, guestbook posts are public, and Discord/Minecraft data is cached briefly. Email <a href="mailto:${ABUSE_CONTACT}">${ABUSE_CONTACT}</a> to have anything about you removed.
</div>

<h2>What's collected</h2>
<ul>
  <li><strong>Visit logs.</strong> Requests logged via the site frontend record IP address, request path, user agent, and timestamp. They exist purely for security and abuse monitoring (spotting floods and probes) and are visible only to the admin. They are not shared with anyone and are cleared periodically.</li>
  <li><strong>Guestbook entries.</strong> Name, message, and optional website are public by design. The submitting IP is used transiently for rate limiting (one post per 60 seconds) and spam protection (Cloudflare Turnstile).</li>
  <li><strong>Discord presence & profiles.</strong> The API tracks live presence only for users who share a Discord server with its bot. Presence is held in memory only and never written to storage. Profile data (avatar, badges, connections) is fetched live from Discord on each request and not stored.</li>
  <li><strong>Minecraft & Hypixel data.</strong> Public data fetched from Mojang/Hypixel on request, cached for about 5 minutes. The vanilla-cape catalogue keeps cape textures (not player identities) permanently.</li>
  <li><strong>Accounts & devices.</strong> Plural-system accounts (username, password hash, display name) and device/battery reports are stored for the people who use them — these are private to the system's own users.</li>
</ul>

<h2>What's NOT collected</h2>
<p>No advertising, no third-party analytics, no tracking cookies, no fingerprinting, and nothing is ever sold or shared. Cloudflare hosts the service, so requests pass through their network like any Cloudflare-proxied site.</p>

<h2>Your data, your call</h2>
<ul>
  <li><strong>Presence opt-out:</strong> leave the Discord server(s) the bot is in — your presence disappears automatically — or email to be blocked from lookups entirely.</li>
  <li><strong>Guestbook removal:</strong> email with (roughly) what the entry says; every entry is individually deletable.</li>
  <li><strong>Anything else:</strong> email <a href="mailto:${ABUSE_CONTACT}">${ABUSE_CONTACT}</a> with your Discord user ID or details, and it gets removed.</li>
</ul>
`,
);

// ---------------------------------------------------------------------------
// 404
// ---------------------------------------------------------------------------

export const NOT_FOUND_HTML = pageShell(
  "Not found",
  `This route doesn't exist.`,
  `
<div style="text-align:center">
  <div class="big">404</div>
  <p>Nothing lives at this path. Everything real is under <code>/v2</code> — the full list is on the <a href="/docs">API reference</a>.</p>
  <p><a href="/">← service info</a> · <a href="/docs">docs</a> · <a href="/v2/health">health</a></p>
</div>
`,
);
