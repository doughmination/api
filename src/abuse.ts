/* =====================================================================
 * abuse.ts — the /abuse page + /.well-known/security.txt.
 *
 * Self-contained HTML (same Catppuccin Mocha look as /docs, no deps).
 * Covers abuse reports, acceptable use, privacy / opt-out, takedowns,
 * and vulnerability disclosure. Keep ABUSE_CONTACT in sync everywhere.
 * ===================================================================== */

export const ABUSE_CONTACT = "abuse@doughmination.win";

/** RFC 9116 security.txt. Expires is generated per-request (must be < 1 year
 *  out), so this is a function rather than a constant. */
export function securityTxt(origin: string): string {
  const expires = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000); // ~6 months
  return [
    `Contact: mailto:${ABUSE_CONTACT}`,
    `Expires: ${expires.toISOString()}`,
    `Preferred-Languages: en`,
    `Canonical: ${origin}/.well-known/security.txt`,
    `Policy: ${origin}/abuse`,
    "",
  ].join("\n");
}

export const ABUSE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="icon" type="image/png" href="/icon.png" />
<title>Abuse & contact — Doughmination API</title>
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
  .back { font-size: 13.5px; }
  ::selection { background: rgba(245,169,184,.28); }
</style>
</head>
<body>
<header><div class="inner">
  <h1>Abuse &amp; contact</h1>
  <p>How to report abuse, request data removal, or disclose a vulnerability. <a class="back" href="/docs">← API reference</a></p>
</div></header>
<main>

<div class="card">
  <strong>Contact:</strong> <a href="mailto:${ABUSE_CONTACT}">${ABUSE_CONTACT}</a><br />
  Reports are usually answered within a few days. This is a small, personally-run service — please be patient.
</div>

<h2>What this service is</h2>
<p>This API serves live Discord presence and public profile data for a small set of tracked users, Minecraft skin/Hypixel lookups, a public guestbook, and the Doughmination plural-system API. It only tracks Discord users who share a server with its bot.</p>

<h2>Reporting abuse</h2>
<p>Email <a href="mailto:${ABUSE_CONTACT}">${ABUSE_CONTACT}</a> if you see this service being used for, or serving, any of the following:</p>
<ul>
  <li>Harassment, spam, or illegal content in the public guestbook</li>
  <li>Impersonation, or profile/presence data being used to stalk or harass someone</li>
  <li>Content that infringes your rights (copyright, trademark, personal data)</li>
  <li>Abusive automated traffic originating from or targeting this API</li>
</ul>
<p>Please include: the full URL(s) involved, what the problem is, timestamps if relevant, and how to reach you. For guestbook entries, the entry text or its position in the list is enough — every entry has a deletable ID on our side.</p>

<h2>Privacy &amp; data removal (opt-out)</h2>
<p>If your Discord presence or profile appears on this API and you want it gone:</p>
<ul>
  <li>Leaving the Discord server(s) the tracking bot is in removes your live presence automatically.</li>
  <li>For anything else — cached profile data, guestbook entries you posted, or a block on future lookups of your account — email <a href="mailto:${ABUSE_CONTACT}">${ABUSE_CONTACT}</a> with your Discord user ID and it will be removed.</li>
</ul>
<p>Profile caches expire on their own within hours; presence is never stored beyond live memory.</p>

<h2>Security vulnerabilities</h2>
<p>Found a vulnerability? Email <a href="mailto:${ABUSE_CONTACT}">${ABUSE_CONTACT}</a> with reproduction steps. Please practise responsible disclosure: no destructive testing, no accessing other people's data, and give a reasonable window to fix before publishing. Machine-readable details live at <a href="/.well-known/security.txt"><code>/.well-known/security.txt</code></a>.</p>

<h2>Acceptable use</h2>
<p>The public endpoints are free to use, but don't hammer them: batch endpoints exist so 100 users cost one request, JSON responses are intentionally <code>no-store</code>, and abusive traffic gets blocked at the edge. Don't use this API to build harassment, stalking, or mass-surveillance tooling — that's grounds for an immediate block and a report to the relevant platform.</p>

</main>
<footer style="max-width:720px;margin:0 auto;padding:8px 20px 28px;font-size:13px;color:var(--muted)">
  <a href="/docs">API reference</a> · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a>
</footer>
</body>
</html>
`;
