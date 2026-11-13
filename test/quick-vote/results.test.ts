import { describe, expect, it } from "vitest";
import {
  emptyTally,
  foldCounts,
  revealTally,
  toRoundResult,
} from "@/lib/realtime/vote-room/aggregate";
import { toChoiceResult, type ChoiceSheet } from "@/lib/realtime/vote-room/choice";
import { toRankResult } from "@/lib/realtime/vote-room/rank";
import { toNumberResult } from "@/lib/realtime/vote-room/number";
import { draftFromPreset, validateRoundDraft } from "@/lib/quick-vote/draft";
import { presetById, type PresetId } from "@/lib/quick-vote/presets";
import { roundFor } from "@/lib/quick-vote/sheets";
import {
  MAX_RESULTS,
  guessVerdict,
  latestVerdict,
  normalizeResults,
  normalizeRoundResult,
  resultSummary,
  savedDay,
  showsAgreement,
  valuePicks,
  type SavedResult,
  type StoredNumberResult,
} from "@/lib/quick-vote/results";
import { normalizeQuickVoteState } from "@/lib/quick-vote/state";
import {
  composerSources,
  handCountResult,
  resultHandoff,
  savedFromRound,
  savedResultMarkdown,
  validateHandCounts,
} from "@/app/(tools)/quick-vote/model";
import { toMarkdown } from "@/app/(tools)/quick-vote/markdown";
import { buildExample } from "@/app/(tools)/quick-vote/example";

/**
 * Quick Vote's saved results (lib/quick-vote/results.ts and the page's
 * model.ts): a kit result is filed as it is, totals only, under the format
 * it ran as; anything read back is rebuilt and capped; the one-line
 * summaries, the guess's verdict, value poker's pick, the agreement cheer,
 * the hand-off and the Markdown all read the same totals.
 */

const META = {
  tool: "quick-vote" as const,
  roundId: "round-abcdefg",
  closedAt: "2026-11-10T10:00:00.000Z",
  minN: 3,
  source: "live" as const,
};

function setupOf(id: PresetId, over: Record<string, unknown> = {}) {
  const check = validateRoundDraft({ ...draftFromPreset(presetById(id)!), ...over });
  if (!check.ok) throw new Error(JSON.stringify(check.errors));
  return roundFor(check.values);
}

/** A scale result from per-point counts, folded by the kit's own counting. */
function scaleResult(id: PresetId, counts: number[]) {
  const round = setupOf(id);
  if (round.kind !== "scale") throw new Error("not a scale");
  const q = round.questionnaire;
  const ballots = counts.reduce((a, b) => a + b, 0);
  const tally = foldCounts(emptyTally("r", q), [counts], ballots);
  if (!tally) throw new Error("bad counts");
  return toRoundResult(q, revealTally(tally, round.minN), { ...META, ballots, minN: round.minN });
}

function choiceResult(
  id: PresetId,
  totals: number[],
  ballots: number,
  over: Record<string, unknown> = {}
) {
  const round = setupOf(id, over);
  if (round.kind !== "choice") throw new Error("not a choice");
  const r = toChoiceResult(
    round.sheet,
    totals.map((total) => ({ total, backers: null })),
    { ...META, ballots, minN: round.minN }
  );
  if (!r) throw new Error("no result");
  return r;
}

const saved = (
  result: unknown,
  presetId: PresetId,
  extra: Partial<SavedResult> = {}
): SavedResult => ({
  id: "qvr-1",
  presetId,
  savedAt: "2026-11-10T10:05:00.000Z",
  result: normalizeRoundResult(result)!,
  ...extra,
});

describe("filing a kit result", () => {
  it("keeps the kit's totals as they are, under the format the sheet id names", () => {
    const kit = choiceResult("roman", [4, 1, 0], 5);
    const filed = savedFromRound(kit, "poll", new Date("2026-11-10T11:00:00Z"))!;
    expect(filed.presetId).toBe("roman");
    expect(filed.result).toEqual(kit);
    expect(filed.savedAt).toBe("2026-11-10T11:00:00.000Z");
    expect(filed.id).toMatch(/^qvr-/);
  });

  it("carries value poker's backlog item from the sheet id", () => {
    const kit = choiceResult("value-poker", [0, 0, 1, 3, 1, 0, 0], 5, { backlogItemId: "bi_7" });
    expect(savedFromRound(kit, "poll")).toMatchObject({
      presetId: "value-poker",
      backlogItemId: "bi_7",
    });
  });

  it("refuses another tool's result", () => {
    const kit = { ...choiceResult("roman", [3, 0, 0], 3), tool: "health-check" };
    expect(savedFromRound(kit as never, "roman")).toBeNull();
  });
});

describe("reading saved results back", () => {
  it("round-trips every kind the kit hands over", () => {
    const rank = setupOf("ranking", { optionsText: "A\nB\nC" });
    const number = setupOf("guess-number");
    if (rank.kind !== "rank" || number.kind !== "number") throw new Error("kinds");
    const kits = [
      scaleResult("fist-of-five", [0, 0, 1, 2, 1, 1]),
      choiceResult("dots", [5, 3, 1], 3, { optionsText: "A\nB\nC", limit: "3" }),
      toRankResult(rank.sheet, [{ points: 5 }, { points: 3 }, { points: 1 }], {
        ...META,
        ballots: 3,
      })!,
      toNumberResult(
        number.sheet,
        { count: 3, median: 12, spread: null },
        { ...META, ballots: 3 }
      )!,
    ];
    for (const kit of kits)
      expect(normalizeRoundResult(JSON.parse(JSON.stringify(kit)))).toEqual(kit);
  });

  it("drops what isn't a result: another tool's, a wrong shape, a bad count", () => {
    const good = choiceResult("roman", [3, 0, 0], 3);
    expect(normalizeRoundResult({ ...good, tool: "kano-model" })).toBeNull();
    expect(normalizeRoundResult({ ...good, kind: "pair" })).toBeNull();
    expect(normalizeRoundResult({ ...good, ballots: -1 })).toBeNull();
    expect(
      normalizeRoundResult({
        ...good,
        options: [{ id: "o1", text: "x", total: 1.5, backers: null }],
      })
    ).toBeNull();
    expect(normalizeRoundResult(null)).toBeNull();
  });

  it("keeps each id once, newest first, at most 100, with only the extras its kind can have", () => {
    const kit = choiceResult("roman", [3, 0, 0], 3);
    const rows = Array.from({ length: MAX_RESULTS + 5 }, (_, i) => ({
      id: `r${i}`,
      presetId: "roman",
      savedAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
      result: kit,
      realAnswer: 4,
      valueSaved: 8,
      sentTo: [
        { route: "decision", targetId: "d1", at: "2026-11-10T10:00:00.000Z" },
        { route: "risk", targetId: "x", at: "2026-11-10T10:00:00.000Z" },
      ],
    }));
    const out = normalizeResults([...rows, rows[0]]);
    expect(out).toHaveLength(MAX_RESULTS);
    expect(out[0].id).toBe(`r${MAX_RESULTS + 4}`);
    expect(out[0].realAnswer).toBeUndefined();
    expect(out[0].valueSaved).toBeUndefined();
    expect(out[0].sentTo).toEqual([
      { route: "decision", targetId: "d1", at: "2026-11-10T10:00:00.000Z" },
    ]);
  });

  it("files a result under a format of its own kind only", () => {
    const kit = choiceResult("roman", [3, 0, 0], 3);
    const [row] = normalizeResults([
      { id: "x", presetId: "roti", savedAt: META.closedAt, result: kit },
    ]);
    expect(row.presetId).toBe("poll");
  });

  it("reads the store's state, the synced row or the browser's { state } copy", () => {
    const state = { results: [], customPresets: [], draft: { presetId: "roti" } };
    expect(normalizeQuickVoteState(state).draft?.presetId).toBe("roti");
    expect(normalizeQuickVoteState({ state, version: 0 }).draft?.presetId).toBe("roti");
    expect(normalizeQuickVoteState(null)).toEqual({ results: [], customPresets: [], draft: null });
  });
});

describe("reading a result", () => {
  it("sums up a scale with its average and its most-given answer", () => {
    const s = saved(scaleResult("roti", [0, 1, 2, 3, 1]), "roti");
    // (1×1 + 2×2 + 3×3 + 4×1) / 7 = 2.57.
    expect(resultSummary(s)).toBe(
      "7 people answered. Average 2.6 of 4; most said 3: More than I gave (3)."
    );
  });

  it("names a choice round's leader, or the tie", () => {
    expect(resultSummary(saved(choiceResult("roman", [4, 1, 0], 5), "roman"))).toBe(
      "5 people answered. Top: Thumbs up (4 votes)."
    );
    expect(resultSummary(saved(choiceResult("roman", [2, 2, 0], 4), "roman"))).toBe(
      "4 people answered. Tied at the top: Thumbs up and Sideways (2 votes each)."
    );
  });

  it("compares a guess with the real answer, against the spread from 5 answers", () => {
    const number = setupOf("guess-number");
    if (number.kind !== "number") throw new Error("kind");
    const base = toNumberResult(
      number.sheet,
      {
        count: 6,
        median: 8,
        spread: { min: 3, q1: 5, q3: 12, max: 20, histogram: [3, 2, 1, 0, 0, 0, 0, 0, 0, 0] },
      },
      { ...META, ballots: 6 }
    ) as unknown as StoredNumberResult;
    expect(guessVerdict(base, 11)).toBe(
      "The real answer was 11 days: the median guess was 3 days low (27%). It sits inside the middle half of the guesses."
    );
    expect(guessVerdict(base, 30)).toMatch(/Nobody guessed that far out\.$/);
    expect(guessVerdict({ ...base, spread: null }, 8)).toBe(
      "The real answer was 8 days: the median guess was spot on."
    );
  });

  it("gives value poker's most-picked value, or every tied one", () => {
    expect(valuePicks(choiceResult("value-poker", [0, 0, 1, 3, 1, 0, 0], 5))).toEqual([5]);
    expect(valuePicks(choiceResult("value-poker", [0, 0, 0, 2, 2, 0, 0], 4))).toEqual([5, 8]);
  });

  it("cheers only for agreement: fist of five all 3 and up, consent with no concerns, most thumbs up", () => {
    expect(
      showsAgreement(saved(scaleResult("fist-of-five", [0, 0, 0, 2, 2, 1]), "fist-of-five"))
    ).toBe(true);
    expect(
      showsAgreement(saved(scaleResult("fist-of-five", [0, 0, 1, 2, 2, 1]), "fist-of-five"))
    ).toBe(false);
    expect(
      showsAgreement(saved(choiceResult("consent", [2, 1, 1, 1, 0, 0, 0, 0], 5), "consent"))
    ).toBe(true);
    expect(
      showsAgreement(saved(choiceResult("consent", [2, 1, 1, 0, 0, 0, 0, 1], 5), "consent"))
    ).toBe(false);
    expect(showsAgreement(saved(choiceResult("roman", [3, 1, 0], 4), "roman"))).toBe(true);
    expect(showsAgreement(saved(choiceResult("roman", [3, 0, 1], 4), "roman"))).toBe(false);
    expect(showsAgreement(saved(scaleResult("roti", [0, 0, 0, 3, 3]), "roti"))).toBe(false);
  });

  it("says the latest result on the page, or how to start", () => {
    expect(latestVerdict([])).toMatch(/^No results saved yet/);
    expect(latestVerdict([saved(choiceResult("roman", [4, 1, 0], 5), "roman")])).toBe(
      "Latest, Roman vote: “Do we go ahead with this?”. 5 people answered. Top: Thumbs up (4 votes)."
    );
  });
});

describe("sending and exporting", () => {
  it("hands over the question with its headline, the options in order and the leader", () => {
    const src = resultHandoff(saved(choiceResult("roman", [1, 3, 0], 4), "roman"));
    expect(src).toMatchObject({
      title: "Do we go ahead with this? Most picked: Sideways (3)",
      tone: "question",
      sourceRef: { tool: "quick-vote", id: "qvr-1" },
      decision: { options: ["Sideways", "Thumbs up", "Thumbs down"], recommendation: "Sideways" },
    });
    expect(src.description).toBe("Roman vote. 4 people answered. Top: Sideways (3 votes).");
  });

  it("ends a question with no mark of its own before the headline", () => {
    const r = saved(scaleResult("roti", [0, 1, 2, 3, 1]), "roti");
    r.result = { ...r.result, title: "Thursday demos" };
    expect(resultHandoff(r).title).toMatch(/^Thursday demos\. Average \d(\.\d)? of 4$/);
  });

  it("dates an export by the local day it was saved, not the UTC one", () => {
    // 01:00 local time: in Cairo the UTC day is the day before.
    expect(savedDay(new Date(2026, 10, 12, 1, 0).toISOString())).toBe("2026-11-12");
    expect(savedDay("junk")).toBe("junk");
  });

  it("leaves the recommendation out of a tie, and decisions out of a scale", () => {
    expect(resultHandoff(saved(choiceResult("roman", [2, 2, 0], 4), "roman")).decision).toEqual({
      options: ["Thumbs up", "Sideways", "Thumbs down"],
    });
    expect(
      resultHandoff(saved(scaleResult("roti", [0, 1, 2, 3, 1]), "roti")).decision
    ).toBeUndefined();
  });

  it("exports the kit's own tables under the format's name, with what the host added", () => {
    const ex = buildExample(new Date("2026-11-12T12:00:00Z"));
    const md = toMarkdown(ex.results, ex.customPresets);
    expect(md).toMatch(
      /^# Quick Vote results\n\n4 saved rounds, newest first\. Only the totals are kept/
    );
    expect(md).toContain("## Fist of five: How much do you support moving the demo to Thursdays?");
    expect(md).toContain("Real answer: 11 days.");
    expect(md).toContain("| Flaky end-to-end tests | 7 |");
    expect(md).toContain("## Saved formats\n\n- Sprint Review ROTI (ROTI):");
    expect(savedResultMarkdown(ex.results[0])).not.toMatch(/^# /m);
    expect(toMarkdown([])).toBe("# Quick Vote results\n\nNo rounds saved yet.\n");
  });

  it("has an example the store would keep as it is", () => {
    const ex = buildExample(new Date("2026-11-12T12:00:00Z"));
    expect(normalizeResults(ex.results)).toEqual(ex.results);
    expect(
      normalizeQuickVoteState({ results: ex.results, customPresets: ex.customPresets })
        .customPresets
    ).toHaveLength(1);
  });
});

describe("counting hands for a choice round", () => {
  const sheet = (mode: "single" | "multi" | "dots", limit = 1): ChoiceSheet => ({
    id: "qv:poll",
    title: "Where?",
    mode,
    limit,
    options: [
      { id: "o1", text: "Room" },
      { id: "o2", text: "Cafe" },
    ],
  });

  it("asks for every count, whole numbers, and at least the round's minimum", () => {
    const s = sheet("single");
    expect(validateHandCounts(s, { counts: { o1: "2" }, people: "" }, 3)).toEqual({
      ok: false,
      errors: { counts: "Give a count for “Cafe”, 0 if nobody." },
    });
    expect(validateHandCounts(s, { counts: { o1: "2", o2: "x" }, people: "" }, 3)).toEqual({
      ok: false,
      errors: { counts: "“Cafe” needs a whole number from 0." },
    });
    expect(validateHandCounts(s, { counts: { o1: "1", o2: "1" }, people: "" }, 3)).toEqual({
      ok: false,
      errors: { counts: "Totals show from 3 people, so nobody's answer stands out." },
    });
    expect(validateHandCounts(s, { counts: { o1: "2", o2: "1" }, people: "" }, 3)).toEqual({
      ok: true,
      values: { totals: [2, 1], ballots: 3 },
    });
  });

  it("checks several picks and dots against the people who answered", () => {
    const dots = sheet("dots", 3);
    const res = validateHandCounts(dots, { counts: { o1: "2", o2: "1" }, people: "3" }, 3);
    expect(res.ok).toBe(true);
    const over = validateHandCounts(dots, { counts: { o1: "9", o2: "3" }, people: "3" }, 3);
    expect(!over.ok && over.errors.counts).toBe(
      "3 people with 3 dots each give between 3 and 9 dots in all; these add up to 12."
    );
    const noPeople = validateHandCounts(
      sheet("multi", 2),
      { counts: { o1: "2", o2: "2" }, people: "" },
      3
    );
    expect(!noPeople.ok && noPeople.errors.people).toBe("Say how many people answered.");
  });

  it("makes the kit's result, counted by hand, with no spread", () => {
    const r = handCountResult(
      sheet("single"),
      { totals: [2, 1], ballots: 3 },
      3,
      new Date("2026-11-10T10:00:00Z")
    );
    expect(r).toMatchObject({
      kind: "choice",
      tool: "quick-vote",
      source: "facilitator",
      ballots: 3,
      closedAt: "2026-11-10T10:00:00.000Z",
      options: [
        { id: "o1", text: "Room", total: 2, backers: null },
        { id: "o2", text: "Cafe", total: 1, backers: null },
      ],
    });
  });
});

describe("lists from the workspace", () => {
  it("reads the backlog, then backlog stories, and the current retro's cards, most voted first", () => {
    const out = composerSources(
      [{ id: "b1", name: "Search" } as never, { id: "example-b2", name: "Example item" } as never],
      [
        { id: "s1", title: "Login", status: "todo" } as never,
        { id: "s2", title: "In a sprint", status: "todo", sprintId: "sp" } as never,
        { id: "s3", title: "search", status: "todo" } as never,
      ],
      [
        {
          id: "retro:current",
          cards: [
            { id: "c1", text: "Flaky tests", votes: 1, isActionItem: false, groupedWith: null },
            { id: "c2", text: "On-call", votes: 4, isActionItem: false, groupedWith: null },
            { id: "c3", text: "Fix it", votes: 9, isActionItem: true, groupedWith: null },
            { id: "c4", text: "Grouped", votes: 9, isActionItem: false, groupedWith: "c1" },
          ],
        } as never,
      ]
    );
    expect(out.backlog).toEqual(["Search", "Login"]);
    expect(out.retro).toEqual(["On-call", "Flaky tests"]);
    expect(out.items).toEqual([{ id: "b1", name: "Search" }]);
  });
});
