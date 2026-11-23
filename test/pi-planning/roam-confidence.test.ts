// @vitest-environment node
/**
 * ROAM (lib/pi-planning/roam) and the confidence vote's reading
 * (lib/pi-planning/confidence): risks grouped by status, the verdict, the
 * keyword guess in its order, and the totals a saved round keeps.
 */

import { describe, expect, it } from "vitest";
import type { PiItem, PiState } from "@/lib/pi-planning/model";
import {
  canLogRisk,
  guessRoam,
  piRisks,
  roamGroups,
  roamLabel,
  roamVerdict,
} from "@/lib/pi-planning/roam";
import {
  TRAIN_SCOPE,
  averageText,
  confidenceQuestion,
  confidenceRule,
  countsFrom,
  latestVote,
  scopeInText,
  scopeLabel,
  voteAverage,
} from "@/lib/pi-planning/confidence";
import { QUESTION_MAX, cleanLine } from "@/lib/quick-vote/draft";

const risk = (id: string, over: Partial<PiItem> = {}): PiItem => ({
  id,
  title: id,
  teamId: "a",
  iteration: 0,
  kind: "risk",
  ...over,
});

const board = (items: PiItem[]): PiState => ({
  teams: [
    { id: "a", name: "Checkout" },
    { id: "b", name: "Payments" },
  ],
  items,
  iterations: 3,
});

describe("ROAM groups and verdict", () => {
  const s = board([
    risk("r1", { roam: "owned", roamOwner: "Sam" }),
    risk("r2", { roam: "owned" }),
    risk("r3"),
    risk("r4", { roam: "mitigated", teamId: "b" }),
    risk("f1", { kind: "feature" }),
    risk("late", { iteration: 5 }), // past the last iteration: hidden, like on the board
    risk("gone", { teamId: "zz" }), // its team is gone
  ]);

  it("takes risks on the board's teams and iterations only", () => {
    expect(piRisks(s).map((r) => r.id)).toEqual(["r1", "r2", "r3", "r4"]);
  });

  it("groups them by status, to sort first", () => {
    const g = roamGroups(s);
    expect(g.unsorted.map((r) => r.id)).toEqual(["r3"]);
    expect(g.owned.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(g.mitigated.map((r) => r.id)).toEqual(["r4"]);
    expect(g.resolved).toEqual([]);
    expect(g.accepted).toEqual([]);
  });

  it("sums them up in one sentence, with owned risks nobody owns yet", () => {
    expect(roamVerdict(s)).toBe(
      "4 risks: 2 owned and 1 mitigated; 1 still to sort. 1 owned risk has no owner yet."
    );
    expect(roamVerdict(board([risk("x")]))).toBe("1 risk: none sorted yet.");
    expect(roamVerdict(board([]))).toBe("No risks on the board yet.");
  });

  it("names a risk's status in words, and logs only owned or mitigated ones", () => {
    expect(roamLabel({})).toBe("To sort");
    expect(roamLabel({ roam: "accepted" })).toBe("Accepted");
    expect(
      [undefined, "resolved", "owned", "accepted", "mitigated"].map((roam) =>
        canLogRisk({ roam: roam as PiItem["roam"] })
      )
    ).toEqual([false, false, true, false, true]);
  });
});

describe("the keyword guess", () => {
  it("owns a risk that depends on someone outside the team", () => {
    expect(guessRoam("Depends on the vendor's new API").roam).toBe("owned");
    expect(guessRoam("Legal hasn't approved the terms").roam).toBe("owned");
    expect(guessRoam("Waiting for approval").action).toBe("Name who chases it and by when.");
  });

  it("accepts one that reads as unlikely or small, before reading a note", () => {
    expect(guessRoam("Search might be a little slower").roam).toBe("accepted");
    expect(guessRoam("Small chance the CDN moves", "We will add a fallback").roam).toBe("accepted");
  });

  it("calls it mitigated when the note reads as a plan", () => {
    expect(guessRoam("Release could slip", "We'll run a load test by iteration 2").roam).toBe(
      "mitigated"
    );
  });

  it("owns anything else, and never says resolved", () => {
    const g = guessRoam("PCI audit could slip the release");
    expect(g.roam).toBe("owned");
    for (const t of ["", "x", "Approval might come late"]) {
      expect(guessRoam(t, "done").roam).not.toBe("resolved");
    }
    expect(g.reason.length).toBeLessThanOrEqual(120);
    expect(g.action.length).toBeLessThanOrEqual(160);
  });
});

describe("the confidence vote", () => {
  it("asks the train or one team", () => {
    expect(confidenceQuestion()).toBe(
      "How confident are you that we'll meet this PI's objectives?"
    );
    expect(confidenceQuestion("Payments")).toBe(
      "How confident are you that Payments will meet its PI objectives?"
    );
  });

  it("shortens a long team name so the whole question fits the vote kit's cap", () => {
    const fits = (q: string) => expect(cleanLine(q, QUESTION_MAX)).toBe(q);
    const room = QUESTION_MAX - 56; // the question's own words take 56 characters
    const exact = confidenceQuestion("x".repeat(room), QUESTION_MAX);
    expect(exact).toBe(
      `How confident are you that ${"x".repeat(room)} will meet its PI objectives?`
    );
    fits(exact);
    const long = confidenceQuestion(`${"x".repeat(room)}y`, QUESTION_MAX);
    expect(long).toBe(
      `How confident are you that ${"x".repeat(room - 1)}… will meet its PI objectives?`
    );
    fits(long);
    // Counted by character, as the kit counts, so an emoji is never split.
    const emoji = confidenceQuestion("😀".repeat(room + 5), QUESTION_MAX);
    expect(emoji).toContain(`${"😀".repeat(room - 1)}… will`);
    fits(emoji);
    // Spaces in a name read as one, as the kit reads them.
    expect(confidenceQuestion("  Mobile   apps ")).toBe(
      "How confident are you that Mobile apps will meet its PI objectives?"
    );
  });

  it("averages to one decimal and says how many voted under 3", () => {
    const counts = [0, 1, 3, 5, 2];
    expect(voteAverage(counts)).toBeCloseTo(41 / 11);
    expect(averageText(counts)).toBe("3.7");
    expect(confidenceRule(counts)).toBe("1 vote under 3: talk it through before you commit.");
    expect(confidenceRule([2, 1, 0, 3, 0])).toBe(
      "3 votes under 3: talk them through before you commit."
    );
    expect(confidenceRule([0, 0, 4, 3, 1])).toBe("Nobody voted under 3.");
    expect(voteAverage([0, 0, 0, 0, 0])).toBeNull();
  });

  it("keeps a round's totals, or nothing when the kit held them back", () => {
    expect(countsFrom({ questions: [{ distribution: [0, 1, 3, 5, 2] }] })).toEqual([0, 1, 3, 5, 2]);
    expect(countsFrom({ questions: [{ distribution: null }] })).toBeNull();
    expect(countsFrom({ questions: [] })).toBeNull();
    expect(countsFrom({ questions: [{ distribution: [1, 2, 3] }] })).toBeNull();
    expect(countsFrom({ questions: [{ distribution: [0, 0, 0, 0, 0] }] })).toBeNull();
  });

  it("names a vote by its team, or the name it was saved under once the team is gone", () => {
    const s = board([]);
    expect(scopeLabel(s, TRAIN_SCOPE)).toBe("Whole train");
    expect(scopeLabel(s, "b", "Old name")).toBe("Payments");
    expect(scopeLabel(s, "gone", "Mobile")).toBe("Mobile");
    // Inside a sentence the train reads in lower case; a team keeps its name.
    expect(scopeInText(s, TRAIN_SCOPE, "Whole train")).toBe("the whole train");
    expect(scopeInText(s, "b")).toBe("Payments");
    expect(scopeInText(s, "gone", "Mobile")).toBe("Mobile");
  });

  it("finds the latest vote, for any scope or one", () => {
    const v = (id: string, scope: string) => ({
      id,
      at: "2026-11-20T00:00:00Z",
      scope,
      scopeName: scope,
      counts: [0, 0, 1, 0, 0],
      ballots: 1,
      source: "facilitator" as const,
    });
    const s = { confidence: [v("1", "train"), v("2", "a"), v("3", "train")] };
    expect(latestVote(s)?.id).toBe("3");
    expect(latestVote(s, "a")?.id).toBe("2");
    expect(latestVote({})).toBeUndefined();
  });
});
