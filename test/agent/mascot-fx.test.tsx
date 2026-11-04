import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import {
  FX_SHEETS,
  particles,
  sceneFx,
  type SceneFx,
} from "@/components/agent/mascot/engine/scene-fx";
import { SCENES } from "@/components/agent/mascot/engine/scenes";
import { WEATHER_SCENES } from "@/lib/agent/mascot/context/moments";
import { MascotFx } from "@/components/agent/mascot/mascot-fx";

const KINDS: SceneFx[] = [
  "rain",
  "downpour",
  "storm",
  "snow",
  "wind",
  "fog",
  "dust",
  "stars",
  "sparks",
];

describe("the air around a scene", () => {
  it.each<[string, SceneFx | null]>([
    ["scene:rain", "rain"],
    ["scene:rain.feel", "rain"],
    ["scene:downpour.oops", "downpour"],
    ["scene:storm.peek", "storm"],
    ["scene:snow.ball", "snow"],
    ["scene:wind.brace", "wind"],
    ["scene:grey.dream", "fog"],
    ["scene:dust.mask", "dust"],
    ["scene:stars.wish", "stars"],
    ["scene:fireworks.sparkler", "sparks"],
    ["scene:sun", null],
    ["scene:heat.drink", null],
    ["scene:eid", null],
    ["poke", null],
    ["hold.dozing", null],
  ])("%s → %s", (clip, fx) => {
    expect(sceneFx(clip)).toBe(fx);
  });

  it("names only sheets that have scenes", () => {
    const sheets = new Set(Object.keys(SCENES).map((name) => name.split(".")[0]));
    for (const sheet of FX_SHEETS) expect(sheets.has(sheet), sheet).toBe(true);
  });

  it("greets rain, snow, wind, fog, dust and a starry night with their air", () => {
    for (const w of [
      "rain",
      "downpour",
      "storm",
      "snow",
      "wind",
      "grey",
      "dust",
      "stars",
    ] as const) {
      // The greeting is the moment's first scene, from its own sheet.
      expect(sceneFx(`scene:${WEATHER_SCENES[w][0]}`), w).not.toBeNull();
    }
    // A scene borrowed from another sheet keeps that sheet's air: shivering has none.
    expect(sceneFx("scene:cold")).toBeNull();
  });

  it.each(KINDS)("scatters %s the same way every time, inside the air", (kind) => {
    const ps = particles(kind);
    expect(ps.length).toBeGreaterThan(0);
    expect(particles(kind)).toEqual(ps);
    for (const p of ps) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(100);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThan(1);
      expect(p.dur).toBeGreaterThan(0);
      // Already on its way when the scene starts, never waiting to begin.
      expect(p.delay).toBeLessThanOrEqual(0);
      expect(p.delay).toBeGreaterThan(-p.dur);
    }
  });
});

describe("<MascotFx />", () => {
  const box = { width: 132, height: 143 };

  it("reaches past his box on both sides and above it, never below his floor", () => {
    const { container } = render(<MascotFx kind="rain" leaving={false} {...box} />);
    const fx = container.querySelector<HTMLElement>("[data-amr-fx]")!;
    const left = parseFloat(fx.style.left);
    const top = parseFloat(fx.style.top);
    expect(left).toBeLessThan(0);
    expect(top).toBeLessThan(0);
    expect(left + parseFloat(fx.style.width)).toBeCloseTo(box.width - left);
    expect(top + parseFloat(fx.style.height)).toBeCloseTo(box.height);
    expect(fx.getAttribute("aria-hidden")).toBe("true");
  });

  it("adds lightning to a storm, a haze to dust, and rays to each burst of sparks", () => {
    const storm = render(<MascotFx kind="storm" leaving={false} {...box} />).container;
    expect(storm.querySelector("[data-amr-fx]")!.children).toHaveLength(
      particles("storm").length + 1
    );
    const dust = render(<MascotFx kind="dust" leaving={false} {...box} />).container;
    expect(dust.querySelector("[data-amr-fx]")!.children).toHaveLength(
      particles("dust").length + 1
    );
    const sparks = render(<MascotFx kind="sparks" leaving={false} {...box} />).container;
    const bursts = sparks.querySelector("[data-amr-fx]")!.children;
    expect(bursts).toHaveLength(particles("sparks").length);
    for (const b of Array.from(bursts)) expect(b.children).toHaveLength(8);
  });
});
