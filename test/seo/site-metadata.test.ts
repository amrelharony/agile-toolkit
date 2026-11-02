// @vitest-environment node
/**
 * What every page tells search engines and link previews unless it says
 * otherwise. Resolved by Next's own metadata code, the way a page is rendered.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Metadata } from "next";
import { resolveAlternates } from "next/dist/lib/metadata/resolvers/resolve-basics";
import { resolveOpenGraph } from "next/dist/lib/metadata/resolvers/resolve-opengraph";
import { metadata as notFound } from "@/app/not-found";
import { SITE_METADATA as metadata } from "@/lib/seo/site-metadata";
import { SHARE_SIZE, SITE_SHARE_URL } from "@/lib/book/art";

const base = metadata.metadataBase as URL;
const context = (pathname: string) => ({ pathname, trailingSlash: false, isStandaloneMode: false });

describe("the site's metadata", () => {
  it.each([
    ["/", "https://agile.amrelharony.com"],
    ["/retro", "https://agile.amrelharony.com/retro"],
    ["/comics/license", "https://agile.amrelharony.com/comics/license"],
  ])("makes %s its own canonical address", (pathname, expected) => {
    const alternates = resolveAlternates(metadata.alternates!, base, context(pathname));
    expect(String(alternates?.canonical?.url)).toBe(expected);
    const og = resolveOpenGraph(
      metadata.openGraph as Metadata["openGraph"],
      base,
      context(pathname),
      ""
    );
    expect(String(og?.url)).toBe(expected);
  });

  it("shares the site's image, at the size previews ask for", () => {
    expect(metadata.openGraph?.images).toEqual([
      expect.objectContaining({ url: SITE_SHARE_URL, ...SHARE_SIZE }),
    ]);
    expect(metadata.twitter).toEqual({ card: "summary_large_image" });
  });

  it("is what the root layout exports", () => {
    const layout = readFileSync(path.join(process.cwd(), "src/app/layout.tsx"), "utf8");
    expect(layout).toContain("export const metadata: Metadata = SITE_METADATA;");
  });

  it("leaves the title and description to each page, so a preview names the page", () => {
    expect(metadata.openGraph).not.toHaveProperty("title");
    expect(metadata.openGraph).not.toHaveProperty("description");
  });

  it("gives the 404 page no address, since it answers for every unknown one", () => {
    // Prerendered as /_not-found, which "./" would otherwise name.
    const context404 = context("/_not-found");
    expect(resolveAlternates(notFound.alternates!, base, context404)?.canonical).toBeNull();
    const og = resolveOpenGraph(notFound.openGraph as Metadata["openGraph"], base, context404, "");
    expect(og?.url).toBeNull();
    expect(og?.images).toEqual([expect.objectContaining({ url: expect.any(URL) })]);
  });
});
