// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import robots from "@/app/robots";
import { tools } from "@/lib/constants/tools";

/**
 * /sitemap.xml lists the landing page, the team page, the More tools shelf
 * and every public tool route, and stays sync: the stories have their own
 * /comics/sitemap.xml. The module is re-imported per case so a future
 * module-level read of the env can't make these tests pass by accident.
 */

const BASE = "https://agile.amrelharony.com";

/** The public pages the registry doesn't name. */
const SITE_PAGES = ["/team", "/more-tools"];

async function loadSitemap() {
  vi.resetModules();
  const { default: sitemap } = await import("@/app/sitemap");
  return sitemap();
}

async function loadSitemapUrls(): Promise<string[]> {
  return (await loadSitemap()).map((entry) => entry.url);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sitemap", () => {
  it("lists the landing page and every public tool path, the comics included", async () => {
    const urls = await loadSitemapUrls();
    const listed = tools.filter((t) => t.access !== "vip");

    expect(urls).toContain(`${BASE}/`);
    for (const tool of listed) expect(urls).toContain(`${BASE}${tool.path}`);
    expect(urls).toContain(`${BASE}/comics`);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls).toHaveLength(listed.length + 1 + SITE_PAGES.length);
  });

  it("lists the team page and the More tools shelf, which no tool route covers", async () => {
    const urls = await loadSitemapUrls();
    const disallowed = [robots().rules].flat().flatMap((rule) => rule.disallow ?? []);
    for (const page of SITE_PAGES) {
      expect(urls).toContain(`${BASE}${page}`);
      // A page that exists, that crawlers may fetch and that doesn't say noindex.
      const dir = path.join(process.cwd(), "src/app/(meta)", page);
      expect(existsSync(path.join(dir, "page.tsx")), page).toBe(true);
      expect(readFileSync(path.join(dir, "layout.tsx"), "utf8"), page).not.toMatch(
        /robots|noindex/
      );
      expect(
        disallowed.filter((prefix) => page.startsWith(prefix)),
        page
      ).toEqual([]);
    }
  });

  it("leaves out pages about one browser's own activity, and the owner's", async () => {
    const urls = await loadSitemapUrls();
    for (const page of ["/history", "/insights", "/settings", "/vip"]) {
      expect(urls.filter((url) => url.startsWith(`${BASE}${page}`))).toEqual([]);
    }
  });

  it("gives no dates: the registry holds none, and a made-up one is worse than none", async () => {
    for (const entry of await loadSitemap()) {
      expect(Object.keys(entry), entry.url).toEqual(["url"]);
    }
  });

  it("leaves out the VIP tools", async () => {
    const urls = await loadSitemapUrls();
    const vip = tools.filter((t) => t.access === "vip");
    expect(vip.length).toBeGreaterThan(0);
    for (const tool of vip) expect(urls).not.toContain(`${BASE}${tool.path}`);
  });

  it("only emits absolute URLs on the production origin", async () => {
    const urls = await loadSitemapUrls();
    for (const url of urls) expect(url.startsWith(`${BASE}/`)).toBe(true);
  });
});
