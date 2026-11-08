import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Lighthouse CI (mobile profile) watches layout shift on the routes whose
 * pre-hydration placeholders shifted the most on phones: home, the Sprint
 * Cockpit and the Capacity Planner (CLS up to 0.46 before they reserved the
 * tool's room).
 */
describe("Lighthouse watches load-time layout shift", () => {
  const config = JSON.parse(readFileSync(path.join(process.cwd(), "lighthouserc.json"), "utf8"));

  it("collects home, the Sprint Cockpit and the Capacity Planner", () => {
    const urls: string[] = config.ci.collect.url;
    for (const route of ["/", "/sprint", "/capacity-planner"]) {
      expect(urls).toContain(`http://localhost:3000${route}`);
    }
  });

  it("flags a CLS above 0.1", () => {
    const [, options] = config.ci.assert.assertions["cumulative-layout-shift"];
    expect(options.maxNumericValue).toBeLessThanOrEqual(0.1);
  });
});
