// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generatePsychSafetyPrompts } from "@/lib/ai-prompts/psych-safety";
import {
  PSYCH_SAFETY_QUESTIONS,
  compareRounds,
  legacyRound,
  roundResult,
} from "@/lib/psych-safety/instrument";
import type {
  PsychSafetyCounts,
  PsychSafetyQuestionId,
  PsychSafetyResponse,
  PsychSafetyRound,
} from "@/lib/stores/workspace-types";

/**
 * The Psych Safety prompt reads one round's aggregates as the instrument
 * scores them: Q1, Q3 and Q5 reverse-scored, a statement with fewer than
 * five answers withheld, and the change per statement since the previous
 * round. It used to take an "org benchmark" (a number with no source) and
 * now takes the previous round's name instead. Nothing per person.
 */

type Counts = Record<PsychSafetyQuestionId, PsychSafetyCounts>;
const IDS = PSYCH_SAFETY_QUESTIONS.map((q) => q.id);

/** Every statement answered `point` by `n` people, with `over` per statement. */
const counts = (n: number, point: number, over: Partial<Counts> = {}): Counts =>
  Object.fromEntries(
    IDS.map((id) => {
      const c: PsychSafetyCounts = [0, 0, 0, 0, 0];
      c[point - 1] = n;
      return [id, over[id] ?? c];
    })
  ) as Counts;

const round = (id: string, c: Counts, responses: number): PsychSafetyRound => ({
  id,
  name: id,
  date: "2026-10-01",
  source: "facilitator",
  responses,
  counts: c,
  createdAt: "2026-10-01T10:00:00.000Z",
});

// Five people agree (4) with every statement, so the negatively worded ones
// score 2 and the rest 4: a team score of (4·4 + 3·2) / 7 = 3.14.
const SPRING = round("Spring", counts(5, 4), 5);
// Q1 ("mistakes are held against me") now mostly disagreed with (2): its
// score rises from 2 to 4; Q2 falls from 4 to 3.
const AUTUMN = round("Autumn", counts(6, 4, { q1: [0, 6, 0, 0, 0], q2: [0, 0, 6, 0, 0] }), 6);

const prompts = (cur: PsychSafetyRound, prev?: PsychSafetyRound) =>
  generatePsychSafetyPrompts({
    roundName: cur.name,
    result: roundResult(cur),
    previousName: prev?.name,
    comparison: compareRounds(prev, cur),
  });

describe("generatePsychSafetyPrompts", () => {
  it("scores the negatively worded statements in reverse, as the instrument does", () => {
    const [lowest, coaching] = prompts(SPRING);
    expect(lowest.prompt).toContain('round "Spring": team score 3.14/5 from 5 anonymous responses');
    expect(lowest.prompt).toContain("Q1, Q3 and Q5 are worded negatively");
    // Agreeing (4) with a reversed statement scores 2; with a positive one, 4.
    expect(lowest.prompt).toMatch(/\| Q1\. [^|]+ \| Yes \| 4\.00 \| 2\.00 \|/);
    expect(lowest.prompt).toMatch(/\| Q2\. [^|]+ \| No \| 4\.00 \| 4\.00 \|/);
    expect(coaching.prompt).toContain("team score 3.14/5");
  });

  it("has no benchmark, and says when a round is the first", () => {
    const [lowest] = prompts(SPRING);
    expect(lowest.prompt).not.toMatch(/benchmark/i);
    expect(lowest.prompt).toContain("This is the team's first round.");
    expect(lowest.prompt).not.toContain("Change since");
  });

  it("gives the previous round's name and the change per statement", () => {
    const [lowest] = prompts(AUTUMN, SPRING);
    // (+2 − 1) / 7 over the seven statements.
    expect(lowest.prompt).toContain('Change since "Spring": +0.14.');
    expect(lowest.prompt).toContain('| Change since "Spring" |');
    expect(lowest.prompt).toMatch(/\| Q1\. [^|]+ \| Yes \| 2\.00 \| 4\.00 \| \+2\.00 \|/);
    expect(lowest.prompt).toMatch(/\| Q2\. [^|]+ \| No \| 3\.00 \| 3\.00 \| -1\.00 \|/);
    expect(lowest.prompt).toMatch(/\| Q3\. [^|]+ \| Yes \| 4\.00 \| 2\.00 \| \+0\.00 \|/);
    expect(lowest.prompt).toContain('Fell by more than 0.5 since "Spring": Q2.');
  });

  it("withholds a statement with too few answers and says what the score covers", () => {
    const thinQ7 = round("Thin", counts(5, 4, { q7: [0, 0, 0, 3, 0] }), 5);
    const [lowest] = prompts(thinQ7, SPRING);
    expect(lowest.prompt).toContain("over 6 of 7 statements (the others had too few answers");
    expect(lowest.prompt).toMatch(/\| Q7\. [^|]+ \| No \| withheld \| — \| — \|/);
    expect(lowest.prompt).toContain("(over the 6 statements both rounds show)");
  });

  it("says when the previous round has too few responses to compare", () => {
    const [lowest] = prompts(AUTUMN, round("Pilot", counts(3, 4), 3));
    expect(lowest.prompt).toContain(
      'The previous round, "Pilot", has too few responses to compare.'
    );
    expect(lowest.prompt).not.toContain("| Change since");
  });

  it("has no prompts for a round below five responses", () => {
    expect(prompts(round("Small", counts(4, 4), 4))).toEqual([]);
  });

  it("never carries anything per person from the older answer sheets", () => {
    const sheets: PsychSafetyResponse[] = ["Ana", "Bo", "Cy", "Di", "Ed"].map((name, i) => ({
      id: `r${i}`,
      ts: `2026-09-0${i + 1}T09:00:00.000Z`,
      scores: Object.fromEntries(IDS.map((q) => [q, 4])) as Record<PsychSafetyQuestionId, number>,
      respondent: name,
      description: `Notes by ${name}`,
    }));
    const legacy = legacyRound(sheets) as PsychSafetyRound;
    const [lowest, coaching] = prompts(legacy);
    for (const p of [lowest.prompt, coaching.prompt]) {
      expect(p).toContain("from 5 anonymous responses");
      expect(p).not.toMatch(/\bAna\b|Notes by/);
    }
  });
});
