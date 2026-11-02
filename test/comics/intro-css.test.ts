import { describe, expect, it } from "vitest";
import { endsAt, sceneAnimations } from "./intro-css";

const FIXTURE = "test/comics/fixtures/intro-scene.module.css";

describe("sceneAnimations", () => {
  it("reads name, duration and delay from each shorthand, commas in functions included", () => {
    expect(sceneAnimations(FIXTURE)).toEqual([
      { selector: ".overlay", name: "exit", duration: 0.6, delay: 2.4, iterations: 1 },
      { selector: ".title", name: "rise", duration: 0.4, delay: 0.2, iterations: 1 },
      { selector: ".title", name: "settle", duration: 0.3, delay: 0.6, iterations: 1 },
      { selector: ".panel", name: "wipe", duration: 0.5, delay: 1, iterations: 1 },
    ]);
  });

  it("says when each one is over", () => {
    const ends = sceneAnimations(FIXTURE).map(endsAt);
    [3, 0.6, 0.9, 1.5].forEach((expected, i) => expect(ends[i]).toBeCloseTo(expected, 9));
  });

  it("refuses a time it can't read rather than taking it as no delay", () => {
    expect(() => sceneAnimations("test/comics/fixtures/intro-scene-var-delay.module.css")).toThrow(
      /var\(--exit-at\).*isn't a literal time/
    );
  });

  it("treats a loop as never ending", () => {
    expect(
      endsAt({ selector: ".x", name: "x", duration: 1, delay: 0, iterations: "infinite" })
    ).toBe(Infinity);
  });
});
