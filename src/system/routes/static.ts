/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/**
 * Data-driven SEO files. Mounted under /v2/plural.
 *
 * NOTE: the old backend also served the frontend SPA (index.html) and
 * per-member SSR OG pages (/:member_name, /fronting) plus /avatars file
 * serving. Those are intentionally NOT ported — this Worker is now an API
 * and no longer hosts the website bundle or a filesystem. Serve the SPA +
 * OG meta from the frontend deploy. robots.txt + sitemap.xml are kept here
 * because they are self-contained and data-driven off PluralKit.
 */

import { Hono } from "hono";

import type { Env } from "../hono";
import { getMembers } from "../services/pluralkit";

export const staticRoutes = new Hono<Env>();

const ROBOTS_TXT = `# Doughmination System® - Robots.txt
User-agent: *
Allow: /
Crawl-delay: 1

User-agent: Googlebot
Allow: /
Crawl-delay: 0

User-agent: Bingbot
Allow: /
Crawl-delay: 1

User-agent: Slurp
Allow: /

User-agent: AhrefsBot
Disallow: /

User-agent: SemrushBot
Disallow: /

User-agent: MJ12bot
Disallow: /

Sitemap: https://doughmination.uk/sitemap.xml
`;

staticRoutes.get("/robots.txt", (c) => c.text(ROBOTS_TXT));

staticRoutes.get("/sitemap.xml", async (c) => {
  const today = new Date().toISOString().slice(0, 10);

  try {
    const members = await getMembers();

    let sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url>
    <loc>https://doughmination.uk/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
`;

    for (const member of members) {
      const memberName = String(member.name ?? "").replace(/ /g, "%20");
      const avatarUrl = member.avatar_url ?? "";
      const displayName = member.display_name ?? member.name;

      sitemap += `  <url>
    <loc>https://doughmination.uk/${memberName}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>`;

      if (avatarUrl) {
        sitemap += `
    <image:image>
      <image:loc>${avatarUrl}</image:loc>
      <image:title>${displayName}</image:title>
    </image:image>`;
      }

      sitemap += `
  </url>
`;
    }

    sitemap += "</urlset>";
    return c.body(sitemap, 200, { "Content-Type": "application/xml" });
  } catch (err) {
    console.error(`Error generating sitemap: ${String(err)}`);
    return c.body(
      `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://doughmination.uk/</loc><lastmod>${today}</lastmod></url>
</urlset>`,
      200,
      { "Content-Type": "application/xml" },
    );
  }
});
