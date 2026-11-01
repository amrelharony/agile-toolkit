// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { tools } from "@/lib/constants/tools";

/**
 * /sitemap.xml lists the landing page and every public tool route, and stays
 * sync: the stories have their own /comics/sitemap.xml. The module is
 * re-imported per case so a future module-level read of the env can't make
 * these tests pass by accident.
 */

const BASE = "https://agile.amrelharony.com";

async function loadSitemapUrls(): Promise<string[]> {
  vi.resetModules();
  const { default: sitemap } = await import("@/app/sitemap");
  return sitemap().map((entry) => entry.url);
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
    expect(urls).toHaveLength(listed.length + 1);
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
