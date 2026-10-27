/**
 * lib/risks/scales: one 1–5 likelihood and impact scale, each value with
 * what it means, which the Risk Register and the Premortem both re-export,
 * so a 4 means the same on both pages.
 */

import { describe, expect, it } from "vitest";
import * as lib from "@/lib/risks/scales";
import * as premortem from "@/app/(tools)/premortem/scales";
import * as register from "@/app/(tools)/risk-register/scales";

describe("the risk scales", () => {
  it("give every value from 1 to 5 a meaning", () => {
    for (const steps of [lib.LIKELIHOOD_STEPS, lib.IMPACT_STEPS]) {
      expect(steps.map((s) => s.value)).toEqual([1, 2, 3, 4, 5]);
      for (const s of steps) expect(s.meaning.trim()).not.toBe("");
    }
  });

  it("are the same definition on the Premortem and the Risk Register", () => {
    for (const page of [premortem, register]) {
      expect(page.LIKELIHOOD_STEPS).toBe(lib.LIKELIHOOD_STEPS);
      expect(page.IMPACT_STEPS).toBe(lib.IMPACT_STEPS);
      expect(page.LIKELIHOOD_HINT).toBe(lib.LIKELIHOOD_HINT);
      expect(page.IMPACT_HINT).toBe(lib.IMPACT_HINT);
    }
  });
});
