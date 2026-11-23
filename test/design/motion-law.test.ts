// @vitest-environment node
/**
 * The motion rules in design-system/DNA-SPEC.md that code relies on. Lines are
 * found by how they start, not by number, so edits above them don't break this.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const spec = readFileSync(path.join(process.cwd(), "design-system/DNA-SPEC.md"), "utf8");
const lines = spec.split(/\r?\n/);

function line(prefix: string): string {
  const found = lines.filter((l) => l.startsWith(prefix));
  expect(found, prefix).toHaveLength(1);
  return found[0];
}

describe("DNA-SPEC motion rules", () => {
  it("names what follows its own rules in the motion line", () => {
    const motion = line("- Motion is small and physical");
    for (const clause of [
      "These follow their own rules",
      "may fade and scale from 96%",
      "Amr keeps his own pop-in",
      "ink art draws itself in",
    ]) {
      expect(motion).toContain(clause);
    }
  });

  it("ties the hand's speed to one live spring built from settle", () => {
    expect(line("- Motion is small and physical")).toContain(
      "A dragged board card's tilt and a released reader panel take the hand's speed through one live spring (lib/motion/spring.ts) built from the same constants as settle."
    );
    for (const file of ["src/lib/motion/tokens.ts", "src/lib/motion/spring.ts"]) {
      expect(existsSync(path.join(process.cwd(), file)), file).toBe(true);
    }
  });

  it("caps the page-change hold by name", () => {
    expect(line("- Page changes run one at a time")).toContain("HOLD_CAP_MS");
  });

  it("keeps the paper grain out of high contrast", () => {
    expect(line("- High contrast stays maximally legible")).toContain("no paper grain");
  });
});

describe("DNA-SPEC cast puppet rules", () => {
  it("keeps the cast inside the page, calm, and drawn rather than bent", () => {
    const cast = line("- The cast live inside the page.");
    for (const clause of [
      "never fixed, never full-screen, never over a panel, a control or Amr",
      "Amr keeps the corner",
      "a head 10° at most, an arm 15°",
      "never a limb bent into place",
      "8° at most",
      "0.9 s at most, rising 12px at most",
      "a guess has no right or wrong",
      "three at most on a phone and six on a wider screen",
      "Reduced motion, Save-Data and 2G show every figure in its rest pose",
      "High contrast keeps the figures",
      "print leaves them out",
      "no balloons and no new lines, Amr's existing intro balloon aside",
    ]) {
      expect(cast).toContain(clause);
    }
  });

  it("stills the cast under reduced motion and in quiet contexts", () => {
    expect(line("- Reduced motion turns animation off globally")).toContain(
      "every cast figure stands in its rest pose"
    );
    const quiet = line("- Nothing starts moving by itself in a quiet context");
    expect(quiet).toContain("the cast stand still");
    expect(quiet).toContain("a tapped figure, a guess");
  });

  it("keeps Amr the only celebration and names the cast as the one raster drawing", () => {
    expect(line("- Ink moments sit beside")).toContain("a reaction, not a celebration");
    expect(line("- New pictures follow the same pen")).toContain(
      "The one raster drawing besides the comic's own pictures"
    );
  });
});
