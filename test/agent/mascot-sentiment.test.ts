/**
 * Sentiment analysis that drives the mascot's mood — ported from the vanilla
 * mascot (Personal Website mascot-assistant.js analyzeSentiment). Pure lexicon
 * scoring: valence ±0.08 per positive/negative word, energy bumped by ?/!/
 * question words. Returns {valence, energy} in 0..1 for useMascotStore.setMood.
 */

import { describe, it, expect } from "vitest";
import { analyzeSentiment } from "@/lib/agent/mascot/sentiment";

describe("analyzeSentiment", () => {
  it("is neutral (0.5/0.5) for empty text", () => {
    expect(analyzeSentiment("")).toEqual({ valence: 0.5, energy: 0.5 });
  });

  it("raises valence for positive words", () => {
    const r = analyzeSentiment("thanks, this is awesome and perfect");
    expect(r.valence).toBeGreaterThan(0.5);
    // thanks + awesome + perfect = 3 × 0.08
    expect(r.valence).toBeCloseTo(0.74, 5);
  });

  it("lowers valence for negative words", () => {
    const r = analyzeSentiment("this is broken and the error is awful");
    expect(r.valence).toBeLessThan(0.5);
    // broken + error + awful = 3 × 0.08
    expect(r.valence).toBeCloseTo(0.26, 5);
  });

  it("bumps energy for ! and ?", () => {
    expect(analyzeSentiment("wow!").energy).toBeCloseTo(0.6, 5); // +0.1
    expect(analyzeSentiment("really?").energy).toBeCloseTo(0.55, 5); // +0.05
  });

  it("bumps energy once for a question word", () => {
    // "how" (+0.03) + "?" (+0.05) = 0.58
    expect(analyzeSentiment("how do I do this?").energy).toBeCloseTo(0.58, 5);
  });

  it("clamps valence/energy to [0,1]", () => {
    const veryNeg = analyzeSentiment(
      "bad wrong hate terrible broken error awful problem fail stuck issue"
    );
    expect(veryNeg.valence).toBe(0);
    const veryPos = analyzeSentiment(
      "great awesome love nice amazing excellent perfect good wonderful fantastic brilliant!"
    );
    expect(veryPos.valence).toBe(1);
    expect(veryPos.energy).toBeLessThanOrEqual(1);
  });
});
