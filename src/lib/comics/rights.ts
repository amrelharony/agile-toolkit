/**
 * Who owns the comic and where to get a licence, in the forms search engines
 * read. The visible notice is components/rights-notice; both link to one page.
 */

import { comicHref } from "./entry";
import { panelImageUrl } from "./images";
import type { Story } from "./types";

/** Mirrors `metadataBase` in src/app/layout.tsx. */
export const SITE_URL = "https://agile.amrelharony.com";
export const LICENSE_PATH = "/comics/license";
export const CREATOR = "Amr Elharony";
export const COPYRIGHT_NOTICE = `© ${CREATOR}`;

const LICENSE_URL = `${SITE_URL}${LICENSE_PATH}`;

/**
 * ComicStory plus one ImageObject per panel, naming the licence and the credit.
 * Only the 768 px files are named here: the larger one stays a click away.
 */
export function storyJsonLd(story: Story): Record<string, unknown> {
  const creator = { "@type": "Person", name: CREATOR };
  return {
    "@context": "https://schema.org",
    "@type": "ComicStory",
    name: story.title,
    description: story.lesson,
    url: `${SITE_URL}${comicHref(story.ep)}`,
    datePublished: story.releaseAt,
    dateModified: story.updatedAt,
    author: creator,
    copyrightHolder: creator,
    copyrightNotice: COPYRIGHT_NOTICE,
    license: LICENSE_URL,
    image: story.panels.map((panel) => ({
      "@type": "ImageObject",
      contentUrl: panelImageUrl(panel.pathSmall),
      width: panel.width,
      height: panel.height,
      description: panel.alt,
      license: LICENSE_URL,
      acquireLicensePage: LICENSE_URL,
      creditText: CREATOR,
      creator,
      copyrightNotice: COPYRIGHT_NOTICE,
    })),
  };
}

/** JSON for a <script> tag: a "</script>" in a title must not close the tag. */
export function jsonLdScript(value: Record<string, unknown>): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
