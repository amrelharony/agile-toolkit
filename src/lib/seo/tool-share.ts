import type { Metadata } from "next";
import { getToolById } from "@/lib/constants/tools";
import { SITE_METADATA } from "@/lib/seo/site-metadata";

export const TOOL_SHARE_SIZE = { width: 1200, height: 630 } as const;

/** Where a tool's link-preview image is served (app/og/tools/[id]). */
export function toolShareImageUrl(toolId: string): string {
  return `/og/tools/${toolId}`;
}

/**
 * A tool's link preview: its own inked card instead of the site-wide picture.
 * Set by the tool's route layout, so its pages inherit it. Only the image:
 * the preview still takes each page's own title and description (Next fills
 * them in), and it spreads the site's openGraph because a nested openGraph
 * replaces the parent's whole object.
 */
export function toolShareMetadata(toolId: string): Metadata {
  const tool = getToolById(toolId);
  if (!tool) throw new Error(`toolShareMetadata: unknown tool "${toolId}"`);
  const image = {
    url: toolShareImageUrl(tool.id),
    ...TOOL_SHARE_SIZE,
    alt: `${tool.name}, drawn in ink`,
  };
  return {
    openGraph: { ...(SITE_METADATA.openGraph ?? {}), images: [image] },
    twitter: { card: "summary_large_image", images: [image] },
  };
}
