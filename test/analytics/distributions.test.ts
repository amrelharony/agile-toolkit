// @vitest-environment node
/**
 * The normal distribution the A/B Calculator reads, against published
 * values: the quantiles behind 90/95/99% confidence and 80/90% power, the
 * CDF at those points, a small upper tail that keeps its digits, and the
 * chi-square tail with one degree of freedom.
 */

import { describe, expect, it } from "vitest";
import { chiSquareSf1, normalCdf, normalQuantile, normalSf } from "@/lib/analytics/distributions";

describe("normalQuantile", () => {
  it.each([
    [0.975, 1.959963984540054],
    [0.8, 0.8416212335729143],
    [0.95, 1.6448536269514722],
    [0.995, 2.5758293035489004],
    [0.9, 1.2815515655446004],
  ])("q(%s) is %s", (p, x) => {
    expect(Math.abs(normalQuantile(p) - x)).toBeLessThan(1e-9);
  });

  it("is symmetric and refines the tails too", () => {
    expect(Math.abs(normalQuantile(0.025) + 1.959963984540054)).toBeLessThan(1e-9);
    expect(Math.abs(normalQuantile(1e-6) + 4.753424308822899)).toBeLessThan(1e-8);
    expect(Math.abs(normalQuantile(1 - 1e-6) - 4.753424308822899)).toBeLessThan(1e-6);
    expect(normalQuantile(0.5)).toBeCloseTo(0, 12);
  });

  it("refuses p outside (0, 1)", () => {
    for (const p of [0, 1, -0.1, 1.5, NaN]) {
      expect(() => normalQuantile(p), String(p)).toThrow(RangeError);
    }
  });
});

describe("normalCdf and normalSf", () => {
  it("matches the known values", () => {
    expect(Math.abs(normalCdf(1.959963984540054) - 0.975)).toBeLessThan(1e-13);
    expect(Math.abs(normalCdf(1) - 0.8413447460685429)).toBeLessThan(1e-13);
    expect(Math.abs(normalCdf(-1) - 0.15865525393145707)).toBeLessThan(1e-13);
    expect(Math.abs(normalCdf(0) - 0.5)).toBeLessThan(1e-15);
    expect(Math.abs(normalCdf(3.5) - 0.9997673709209645)).toBeLessThan(1e-13);
  });

  it("keeps a small upper tail's digits", () => {
    expect(Math.abs(normalSf(5) / 2.866515718791939e-7 - 1)).toBeLessThan(1e-9);
    expect(Math.abs(normalSf(8) / 6.22096057427178e-16 - 1)).toBeLessThan(1e-9);
    expect(Math.abs(normalCdf(-5) / 2.866515718791939e-7 - 1)).toBeLessThan(1e-9);
  });

  it("adds up to one on both sides of the hand-over", () => {
    for (const x of [-6, -3.0001, -3, -2.9999, -1, 0, 0.5, 2.9999, 3, 3.0001, 6]) {
      expect(Math.abs(normalCdf(x) + normalSf(x) - 1), String(x)).toBeLessThan(1e-15);
    }
  });

  it("is continuous where the series hands over to the continued fraction", () => {
    expect(Math.abs(normalSf(2.999999999) - normalSf(3.000000001))).toBeLessThan(1e-11);
  });

  it("reads the infinities", () => {
    expect(normalCdf(Infinity)).toBe(1);
    expect(normalCdf(-Infinity)).toBe(0);
    expect(normalSf(Infinity)).toBe(0);
    expect(normalSf(-Infinity)).toBe(1);
  });
});

describe("chiSquareSf1", () => {
  it("is 0.05 at the 95% critical value", () => {
    expect(Math.abs(chiSquareSf1(3.841458820694124) - 0.05)).toBeLessThan(1e-12);
  });

  it("is 1 at and below zero, and small far out", () => {
    expect(chiSquareSf1(0)).toBe(1);
    expect(chiSquareSf1(-2)).toBe(1);
    expect(chiSquareSf1(25)).toBeCloseTo(5.733031437583878e-7, 15);
  });
});
