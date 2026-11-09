// @vitest-environment node
/**
 * Each tool's link preview is its own inked card (app/og/tools/[id]), set by
 * the tool's route layout. Resolved by Next's own metadata code, the way a page
 * is rendered.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Metadata } from "next";
import {
  resolveOpenGraph,
  resolveTwitter,
} from "next/dist/lib/metadata/resolvers/resolve-opengraph";
import { tools } from "@/lib/constants/tools";
import { SITE_METADATA } from "@/lib/seo/site-metadata";
import { toolShareImageUrl, toolShareMetadata, TOOL_SHARE_SIZE } from "@/lib/seo/tool-share";

const base = SITE_METADATA.metadataBase as URL;
const context = (pathname: string) => ({ pathname, trailingSlash: false, isStandaloneMode: false });

describe("a tool's link preview", () => {
  const meta = toolShareMetadata("retro");

  it("shows the tool's own card, at the size previews ask for", () => {
    expect(meta.openGraph?.images).toEqual([
      { url: "/og/tools/retro", ...TOOL_SHARE_SIZE, alt: "Retro Board, drawn in ink" },
    ]);
    const og = resolveOpenGraph(
      meta.openGraph as Metadata["openGraph"],
      base,
      context("/retro"),
      ""
    );
    expect(og?.images).toEqual([
      expect.objectContaining({ url: new URL("https://agile.amrelharony.com/og/tools/retro") }),
    ]);
  });

  it("keeps the site's openGraph, which a nested openGraph would otherwise replace", () => {
    // Everything the site sets but its image, which the tool's card replaces.
    const site = { ...(SITE_METADATA.openGraph as Record<string, unknown>) };
    delete site.images;
    expect(meta.openGraph).toMatchObject(site);
    const og = resolveOpenGraph(
      meta.openGraph as Metadata["openGraph"],
      base,
      context("/retro"),
      ""
    );
    expect(String(og?.url)).toBe("https://agile.amrelharony.com/retro");
  });

  it("leaves the title and description to each page, so a preview names the page", () => {
    expect(meta.openGraph).not.toHaveProperty("title");
    expect(meta.openGraph).not.toHaveProperty("description");
  });

  it("uses the large card on X and the like too", () => {
    const twitter = resolveTwitter(
      meta.twitter as Metadata["twitter"],
      base,
      context("/retro"),
      ""
    );
    expect(twitter?.card).toBe("summary_large_image");
    expect(twitter?.images).toEqual([
      expect.objectContaining({ url: new URL("https://agile.amrelharony.com/og/tools/retro") }),
    ]);
  });

  it("refuses an id the registry doesn't know", () => {
    expect(() => toolShareMetadata("no-such-tool")).toThrow(/unknown tool/);
  });

  it("is what every tool's layout exports", () => {
    for (const tool of tools) {
      const file = path.join(process.cwd(), "src/app/(tools)", tool.path, "layout.tsx");
      expect(readFileSync(file, "utf8"), tool.id).toContain(
        `export const metadata = toolShareMetadata(${JSON.stringify(tool.id)});`
      );
      expect(toolShareImageUrl(tool.id)).toBe(`/og/tools/${tool.id}`);
    }
  });
});
