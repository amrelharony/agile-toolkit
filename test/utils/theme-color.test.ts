import { describe, expect, it } from "vitest";
import { themed, tint } from "@/lib/utils/theme-color";

describe("theme-aware brand colours", () => {
  it("maps neon brand hexes to theme variables", () => {
    expect(themed("#00ff88")).toBe("var(--neon-green)");
    expect(themed("#00F0FF")).toBe("var(--accent)");
    expect(themed("#ef4444")).toBe("var(--danger)");
  });

  it("passes unknown colours through", () => {
    expect(themed("#123456")).toBe("#123456");
    expect(themed("rebeccapurple")).toBe("rebeccapurple");
  });

  it("tints with color-mix so it works for variables too", () => {
    expect(tint("#00ff88", 33)).toBe("color-mix(in srgb, var(--neon-green) 33%, transparent)");
    expect(tint("#123456", 150)).toContain("100%");
  });
});
