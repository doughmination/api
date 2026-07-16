/* =====================================================================
 * docs.ts — the /docs API reference page.
 *
 * A single self-contained HTML page (no build step, no external deps). All
 * endpoints are described by the GROUPS data structure in the embedded
 * script and rendered client-side, with a live filter box. Keep this in
 * sync when routes change.
 * ===================================================================== */

import { GROUPS } from "./apidata";

// Serialised for the client-side renderer; "<" escaped so "</script>" in a
// description can never terminate the inline script block.
const GROUPS_JSON = JSON.stringify(GROUPS).replace(/</g, "\\u003c");

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
  header p.disclaimer { margin: 6px 0 0; font-size: 12px; color: var(--muted); font-style: italic; }
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
    <p>Universal API: live Discord presence, Discord profiles, Minecraft skins & Hypixel stats, the plural system, and misc services. Base URL: <code>https://doughmination.uk/v2</code> · <a class="self" href="/openapi.json">OpenAPI spec</a> · <a class="self" href="/abuse">Abuse</a> · <a class="self" href="/terms">Terms</a> · <a class="self" href="/privacy">Privacy</a></p>
    <p class="disclaimer">Not affiliated with, endorsed by, or associated with Hypixel Inc. or Mojang/Microsoft. Hypixel stats are provided via the Hypixel Public API for the operator's own accounts only.</p>
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
var GROUPS = ${GROUPS_JSON};

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