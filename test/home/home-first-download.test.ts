// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Home's first download and hydration skip what isn't in its server HTML:
 * the sprint cockpit (the sprint tools' code) and the insight rules (most
 * tools' stores) both need this browser's workspace, so they load client-only.
 */
const src = readFileSync(path.join(process.cwd(), "src/components/home/home-page.tsx"), "utf8");
const staticImports = Array.from(src.matchAll(/^import[^;]*?from\s+["']([^"']+)["']/gm)).map(
  (m) => m[1]
);

describe("home's first download", () => {
  it.each(["@/components/shared/insights-engine", "@/app/(tools)/sprint/cockpit"])(
    "loads %s on the client only, never statically",
    (spec) => {
      expect(staticImports).not.toContain(spec);
      const start = src.indexOf(`import("${spec}")`);
      expect(start).toBeGreaterThan(-1);
      expect(src.slice(start).split(");")[0]).toMatch(/ssr:\s*false/);
    }
  );
});
