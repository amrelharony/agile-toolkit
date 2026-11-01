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

  it("describe the psych-safety rows from before rounds as the old page logged them", () => {
    // The old page logged an added sheet's name and description, a removal as
    // { responseId, removed: true }, and the sheet's scores under ASSESSMENT_SAVED.
    const catalog = source("lib", "history", "event-actions.ts");
    const docOf = (name: string) =>
      (catalog.match(new RegExp(`/\\*\\*((?:(?!\\*/)[\\s\\S])*)\\*/\\s*${name}:`))?.[1] ?? "")
        .replace(/\n\s*\*/g, " ")
        .replace(/\s+/g, " ");
    const response = docOf("RESPONSE_LOGGED");
    for (const key of ["responseId", "respondent", "description", "removed: true"]) {
      expect(response).toContain(key);
    }
    expect(response).not.toMatch(/answers/);
    expect(docOf("ASSESSMENT_SAVED")).toMatch(/before rounds.*responseId and scores/);
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
