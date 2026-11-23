// @vitest-environment node
/**
 * Lighthouse must never open a VIP page. `npm run lighthouse` uploads its
 * reports to temporary public storage (lighthouserc.json, upload.target), where
 * anyone with the link can read the page's address and contents, so a /vip
 * address there would publish the printed book link. VIP pages are checked
 * only in a local browser unlocked by hand, with nothing uploaded.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const raw = readFileSync(path.join(process.cwd(), "lighthouserc.json"), "utf8");
const config = JSON.parse(raw) as { ci: { collect: { url: string[] } } };

describe("lighthouserc.json", () => {
  it("lists pages to audit", () => {
    expect(config.ci.collect.url.length).toBeGreaterThan(0);
  });

  it("has no /vip address, in the url list or anywhere else in the file", () => {
    for (const url of config.ci.collect.url) expect(url.toLowerCase()).not.toContain("/vip");
    expect(raw.toLowerCase()).not.toContain("/vip");
  });
});
