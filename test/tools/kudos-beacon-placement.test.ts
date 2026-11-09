import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// The ambient beacon is fixed to the viewport. From sm up Amr stands in the
// bottom-right corner (no band lifts the beacon there), so the beacon must sit
// to his left or he covers it and takes its clicks.
describe("kudos beacon placement", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/app/(tools)/kudos/components/kudos-beacon.tsx"),
    "utf8"
  );

  it("clears Amr's corner from sm up and rides above his band on phones", () => {
    expect(source).toContain("sm:right-[calc(max(1rem,env(safe-area-inset-right))+9rem)]");
    expect(source).toContain("var(--amr-band-bottom,0px)");
  });
});
