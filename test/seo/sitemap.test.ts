// @vitest-environment node
import { describe, expect, it } from "vitest";
import sitemap from "@/app/sitemap";
import { tools } from "@/lib/constants/tools";

/**
 * /sitemap.xml lists the landing page and every public tool route — and
 * nothing about the comic, which is reachable only through its private link.
 */

const BASE = "https://agile.amrelharony.com";

function urls(): string[] {
  return sitemap().map((entry) => entry.url);
}

describe("sitemap", () => {
  it("lists the landing page and every tool path, once each", () => {
    const list = urls();
    expect(list).toContain(`${BASE}/`);
    for (const tool of tools) expect(list).toContain(`${BASE}${tool.path}`);
    expect(list).toHaveLength(tools.length + 1);
    expect(new Set(list).size).toBe(list.length);
  });

  it("never lists the comic", () => {
    for (const url of urls()) {
      expect(url).not.toMatch(/comic|agile-at-work/);
    }
  });

  it("only emits absolute URLs on the production origin", () => {
    for (const url of urls()) expect(url.startsWith(`${BASE}/`)).toBe(true);
  });
});
