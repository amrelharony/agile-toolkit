import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";

const pub = (p: string) => join(process.cwd(), "public", p.replace(/^\//, ""));

describe("web app manifest", () => {
  it("makes the toolkit installable with real PNG icons, including a maskable one", () => {
    const m = manifest();
    expect(m.name).toBe("Agile Toolkit");
    expect(m.start_url).toBe("/");
    expect(m.display).toBe("standalone");
    const sizes = (m.icons ?? []).map((i) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect((m.icons ?? []).some((i) => i.purpose === "maskable")).toBe(true);
    for (const icon of m.icons ?? []) {
      expect(existsSync(pub(icon.src)), icon.src).toBe(true);
      // PNG signature
      expect(readFileSync(pub(icon.src)).subarray(1, 4).toString(), icon.src).toBe("PNG");
    }
  });

  it("ships the iOS touch icon and a service worker that never caches API or auth routes", () => {
    expect(existsSync(pub("apple-touch-icon.png"))).toBe(true);
    const sw = readFileSync(pub("sw.js"), "utf8");
    expect(sw).toMatch(/NEVER_CACHE = \/\^\\\/\(api\|auth\|settings/);
    expect(sw).toContain('request.mode === "navigate"');
  });
});
