/**
 * /comics/feed.xml: enough to know a new story is out, and a link to read it.
 * Each item carries the title, the lesson and one small image. Never the full
 * panels, so the feed can't be used to collect the comic.
 */

import { COMICS_ROUTE, comicHref } from "./entry";
import { panelImageUrl } from "./images";
import { COPYRIGHT_NOTICE, SITE_URL } from "./rights";
import type { StorySummary } from "./types";

export const FEED_ITEM_LIMIT = 20;

/** Escapes markup, and drops the control characters XML 1.0 can't hold at all. */
export function escapeXml(value: string): string {
  return (
    value
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;")
  );
}

function renderItem(story: StorySummary): string {
  const link = escapeXml(`${SITE_URL}${comicHref(story.ep)}`);
  const lines = [
    `<title>${escapeXml(story.title)}</title>`,
    `<link>${link}</link>`,
    `<guid isPermaLink="true">${link}</guid>`,
    `<pubDate>${new Date(story.releaseAt).toUTCString()}</pubDate>`,
    `<description>${escapeXml(story.lesson)}</description>`,
  ];
  if (story.cover) {
    const url = escapeXml(panelImageUrl(story.cover.pathSmall));
    lines.push(
      `<media:thumbnail url="${url}" width="${story.cover.width}" height="${story.cover.height}"/>`
    );
  }
  return `<item>\n${lines.join("\n")}\n</item>`;
}

export function renderFeed(stories: readonly StorySummary[]): string {
  const home = escapeXml(`${SITE_URL}${COMICS_ROUTE}`);
  const self = escapeXml(`${SITE_URL}${COMICS_ROUTE}/feed.xml`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
<channel>
<title>Agile at Work</title>
<link>${home}</link>
<atom:link href="${self}" rel="self" type="application/rss+xml"/>
<description>New workplace comics by Amr Elharony.</description>
<language>en</language>
<copyright>${escapeXml(COPYRIGHT_NOTICE)}</copyright>
${stories.slice(0, FEED_ITEM_LIMIT).map(renderItem).join("\n")}
</channel>
</rss>
`;
}
