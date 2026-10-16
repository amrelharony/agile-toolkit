// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { MASCOT_GLB_URL } from "@/components/agent/mascot/mascot-asset";

describe("mascot model asset", () => {
  const file = path.join(process.cwd(), "public", MASCOT_GLB_URL);

  it("is committed under public/ at the URL the mascot loads", () => {
    expect(MASCOT_GLB_URL).toMatch(/^\/mascot\/mascot\.[0-9a-f]{8}\.glb$/);
    expect(statSync(file).isFile()).toBe(true);
  });

  it("is named after its content, so immutable caching is safe", () => {
    const bytes = readFileSync(file);
    const prefix = createHash("sha256").update(bytes).digest("hex").slice(0, 8);
    expect(MASCOT_GLB_URL).toContain(`mascot.${prefix}.glb`);
  });

  it("is the optimised build, not the 16 MB export", () => {
    expect(statSync(file).size).toBeLessThan(3.5 * 1024 * 1024);
    // A binary glTF starts with the ASCII magic "glTF".
    expect(readFileSync(file).subarray(0, 4).toString("ascii")).toBe("glTF");
  });
});
