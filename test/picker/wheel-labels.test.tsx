import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { PickerWheel } from "@/components/picker/picker-wheel";

/** Each label's angle on screen: its own turn plus the disc's, in (-180, 180]. */
function screenAngles(rotation: number): number[] {
  const { container, unmount } = render(
    <PickerWheel
      names={["Ana", "Ben", "Cleo", "Dev", "Elif", "Farah", "Gus"]}
      weights={[1, 1, 1, 1, 1, 1, 1]}
      rotation={rotation}
      spinning={false}
      label="Wheel with 7 names"
    />
  );
  const angles = Array.from(container.querySelectorAll("text")).map((t) => {
    const m = /rotate\((-?[\d.]+)/.exec(t.getAttribute("transform") ?? "");
    const a = ((((Number(m?.[1]) + rotation) % 360) + 540) % 360) - 180;
    return a;
  });
  unmount();
  return angles;
}

describe("the Picker wheel's names", () => {
  it("read upright where the wheel comes to rest: none turned past a quarter either way", () => {
    for (const rotation of [0, 47, 133, 200, 291, 1800 + 77]) {
      const angles = screenAngles(rotation);
      expect(angles).toHaveLength(7);
      for (const a of angles) expect(Math.abs(a), `rotation ${rotation}`).toBeLessThanOrEqual(90);
    }
  });
});
