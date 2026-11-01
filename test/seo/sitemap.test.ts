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
  it("lists the landing page and every tool path, the comics included", async () => {
    const urls = await loadSitemapUrls();

    expect(urls).toContain(`${BASE}/`);
    for (const tool of tools) expect(urls).toContain(`${BASE}${tool.path}`);
    expect(urls).toContain(`${BASE}/comics`);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls).toHaveLength(tools.length + 1);
  });

  it("only emits absolute URLs on the production origin", async () => {
    const urls = await loadSitemapUrls();
    for (const url of urls) expect(url.startsWith(`${BASE}/`)).toBe(true);
  });
});
