// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { tools } from "@/lib/constants/tools";

/**
 * /sitemap.xml lists the landing page and every public tool route, and only
 * advertises the comic reader once its PDF exists (build-time env written by
 * next.config.mjs). The module is re-imported per case so a future
 * module-level read of the env can't make these tests pass by accident.
 */

const BASE = "https://agile.amrelharony.com";
const COMIC_URL = `${BASE}/agile-at-work`;

async function loadSitemapUrls(): Promise<string[]> {
  vi.resetModules();
  const { default: sitemap } = await import("@/app/sitemap");
  return sitemap().map((entry) => entry.url);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sitemap", () => {
  it("lists the landing page and every tool path except the comic while its PDF is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_COMIC_PDF_SIZE", "");
    vi.stubEnv("NEXT_PUBLIC_COMIC_PDF_VERSION", "");
    const urls = await loadSitemapUrls();

    expect(urls).toContain(`${BASE}/`);
    for (const tool of tools) {
      if (tool.path === "/agile-at-work") continue;
      expect(urls).toContain(`${BASE}${tool.path}`);
    }
    expect(urls).not.toContain(COMIC_URL);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("includes the comic reader once the PDF is available", async () => {
    vi.stubEnv("NEXT_PUBLIC_COMIC_PDF_SIZE", "12897485");
    vi.stubEnv("NEXT_PUBLIC_COMIC_PDF_VERSION", "a163ac728a97");
    const urls = await loadSitemapUrls();

    expect(urls).toContain(COMIC_URL);
    expect(urls).toHaveLength(tools.length + 1);
  });

  it("only emits absolute URLs on the production origin", async () => {
    const urls = await loadSitemapUrls();
    for (const url of urls) expect(url.startsWith(`${BASE}/`)).toBe(true);
  });
});
