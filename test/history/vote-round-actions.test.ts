import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  HEALTH_CHECK_ACTIONS,
  PSYCH_SAFETY_ACTIONS,
  isMilestoneAction,
} from "@/lib/history/event-actions";

/**
 * The vote-round history actions live in the shared catalog, with the
 * strings the pages have always logged (stored history rows keep them),
 * and a psych-safety answer sheet is no longer logged at all.
 */

const source = (...parts: string[]) => readFileSync(join(process.cwd(), "src", ...parts), "utf8");

describe("the vote-round history actions", () => {
  it("keep the strings the pages log", () => {
    expect(HEALTH_CHECK_ACTIONS.ROUND_SAVED).toBe("round_saved");
    expect(PSYCH_SAFETY_ACTIONS.ROUND_REMOVED).toBe("round_removed");
    // Old rows still read under their name.
    expect(PSYCH_SAFETY_ACTIONS.RESPONSE_LOGGED).toBe("response_logged");
  });

  it("are not milestones", () => {
    expect(isMilestoneAction("health-check", HEALTH_CHECK_ACTIONS.ROUND_SAVED)).toBe(false);
    expect(isMilestoneAction("psych-safety", PSYCH_SAFETY_ACTIONS.ROUND_REMOVED)).toBe(false);
  });

  it("come from the catalog on the pages, which no longer log an answer sheet", () => {
    const health = source("app", "(tools)", "health-check", "health-check-client.tsx");
    const psych = source("app", "(tools)", "psych-safety", "psych-safety-client.tsx");
    expect(health).toContain("HEALTH_CHECK_ACTIONS.ROUND_SAVED");
    expect(health).not.toContain('"round_saved"');
    expect(psych).toContain("PSYCH_SAFETY_ACTIONS.ROUND_REMOVED");
    expect(psych).not.toContain('"round_removed"');
    expect(psych).not.toMatch(/RESPONSE_LOGGED|response_logged/);
  });
});
