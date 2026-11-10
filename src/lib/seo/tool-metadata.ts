import type { Metadata } from "next";
import { getToolById } from "@/lib/constants/tools";
import { coreSearchName } from "@/lib/seo/core-tools";
import { SITE_METADATA } from "@/lib/seo/site-metadata";

/** What a core tool's title says after its name: what someone searching wants to know. */
export const TITLE_OFFER = ": free, no sign-up";

/** The longest title a search result shows whole. */
export const TITLE_MAX = 60;

/** What the root layout's title template puts after a page's own title: " | Agile Toolkit". */
export const SITE_TITLE_SUFFIX = siteTitleSuffix();

function siteTitleSuffix(): string {
  const title = SITE_METADATA.title;
  const template = title && typeof title === "object" && "template" in title ? title.template : "";
  return (template ?? "").replace("%s", "");
}

/**
 * A core tool's title, from the name people search for:
 * "<name>: free, no sign-up | Agile Toolkit", in 60 characters at most. The
 * root layout's template adds the site name, so a title that fits is returned
 * without it. One that doesn't fit drops the site name first (`absolute` keeps
 * the template off), and a name too long even for that stands alone.
 */
export function searchTitle(searchName: string): string | { absolute: string } {
  const offer = `${searchName}${TITLE_OFFER}`;
  if (offer.length + SITE_TITLE_SUFFIX.length <= TITLE_MAX) return offer;
  if (offer.length <= TITLE_MAX) return { absolute: offer };
  return searchName;
}

/**
 * Page metadata for a tool, from the tool registry: its one-line description
 * for search results and link previews, and its title. A core Scrum tool
 * (lib/seo/core-tools.ts) is titled by what people search for, as
 * `searchTitle` builds it; every other tool by its name, and the root layout's
 * template appends " | Agile Toolkit". A link preview takes the same title:
 * no layout sets one of its own, so Next fills it in from the page's.
 */
export function toolMetadata(toolId: string, overrides: Metadata = {}): Metadata {
  const tool = getToolById(toolId);
  if (!tool) throw new Error(`toolMetadata: unknown tool "${toolId}"`);
  const searchName = coreSearchName(tool.id);
  return {
    title: searchName ? searchTitle(searchName) : tool.name,
    description: tool.description,
    ...overrides,
  };
}
