import { describe, expect, it } from "vitest";
import { ceremonyTimeboxMinutes } from "@/lib/sprints/cadence";

/** How long each ceremony should take, from the sprint length. */

describe("ceremony timeboxes", () => {
  it("scales planning, review and retro with the sprint, to 15 minutes", () => {
    expect(ceremonyTimeboxMinutes("planning", 14)).toBe(240);
    expect(ceremonyTimeboxMinutes("review", 14)).toBe(120);
    expect(ceremonyTimeboxMinutes("retro", 14)).toBe(90);
    expect(ceremonyTimeboxMinutes("planning", 30)).toBe(480);
    expect(ceremonyTimeboxMinutes("retro", 7)).toBe(45);
    expect(ceremonyTimeboxMinutes("retro", 1)).toBe(15);
  });

  it("keeps the Daily Scrum at 15 and refinement at an hour; a bad length reads as two weeks", () => {
    expect(ceremonyTimeboxMinutes("daily", 28)).toBe(15);
    expect(ceremonyTimeboxMinutes("refinement", 7)).toBe(60);
    expect(ceremonyTimeboxMinutes("review", Number.NaN)).toBe(120);
  });
});
