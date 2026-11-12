import { describe, expect, it } from "vitest";
import {
  FEELINGS,
  PRESET_IDS,
  QUICK_VOTE_PRESETS,
  SENSITIVE_MIN_N,
  feelingsOptions,
  presetAnswers,
  presetById,
} from "@/lib/quick-vote/presets";
import {
  currentDraft,
  draftEdited,
  draftFromPreset,
  hasDecimalComma,
  typedNumber,
  normalizeDraft,
  parseLines,
  validateRoundDraft,
  type RoundDraft,
} from "@/lib/quick-vote/draft";
import { readSheetId, roundFor, sheetIdFor } from "@/lib/quick-vote/sheets";
import { wireSpec } from "@/lib/realtime/vote-room/kinds";
import { VOTE_LIMITS, toolRunsKind } from "@/lib/realtime/vote-room/protocol";
import { FIBONACCI_VALUES } from "@/lib/prioritization/methods/fibonacci";

/**
 * Quick Vote's formats and the round check (lib/quick-vote): every format
 * gives a round the vote kit takes as it is, the answers are the format's
 * own where it has them, and the form's text is checked against the kit's
 * caps with a plain message per field instead of a default.
 */

const draftOf = (id: (typeof PRESET_IDS)[number], over: Partial<RoundDraft> = {}): RoundDraft => ({
  ...draftFromPreset(presetById(id)!),
  ...over,
});

/** A draft for every format that runs as it is, options filled where the host gives them. */
const runnable = (id: (typeof PRESET_IDS)[number]) =>
  draftOf(id, presetById(id)!.editable === "options" ? { optionsText: "Alpha\nBeta\nGamma" } : {});

describe("the formats", () => {
  it("lists every format once, in the picker's order, with the brief's sixteen", () => {
    expect(QUICK_VOTE_PRESETS.map((p) => p.id)).toEqual([...PRESET_IDS]);
    expect(new Set(PRESET_IDS).size).toBe(16);
  });

  it("gives each format a kind Quick Vote runs, a question, a blurb and a tip", () => {
    for (const p of QUICK_VOTE_PRESETS) {
      expect(toolRunsKind("quick-vote", p.kind), p.id).toBe(true);
      expect(p.question.length, p.id).toBeGreaterThan(3);
      expect(p.question.length, p.id).toBeLessThanOrEqual(VOTE_LIMITS.maxTitleChars);
      expect(p.blurb && p.tip, p.id).toBeTruthy();
    }
  });

  it("keeps the brief's scales: fist of five 0–5, confidence 1–5, ROTI 0–4, perfection 1–10", () => {
    const values = (id: (typeof PRESET_IDS)[number]) => presetById(id)!.points!.map((p) => p.value);
    expect(values("fist-of-five")).toEqual([0, 1, 2, 3, 4, 5]);
    expect(values("confidence")).toEqual([1, 2, 3, 4, 5]);
    expect(values("roti")).toEqual([0, 1, 2, 3, 4]);
    expect(values("perfection")).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(values("safety-check")).toEqual([1, 2, 3, 4, 5]);
    for (const p of QUICK_VOTE_PRESETS.filter((x) => x.points)) {
      for (const pt of p.points!) expect(pt.label.length, p.id).toBeLessThanOrEqual(LABEL);
    }
  });

  it("keeps the fixed answers: Roman vote, the 8-step gradient, ELMO's signals, ESVP, value poker", () => {
    expect(presetAnswers(presetById("roman")!)).toEqual(["Thumbs up", "Sideways", "Thumbs down"]);
    expect(presetAnswers(presetById("consent")!)).toHaveLength(8);
    expect(presetAnswers(presetById("elmo")!)).toEqual([
      "Keep going",
      "Enough, let's move on",
      "Slow down",
      "Louder, please",
    ]);
    expect(presetById("elmo")!.standing).toBe(true);
    expect(presetAnswers(presetById("esvp")!)).toEqual([
      "Explorer",
      "Shopper",
      "Vacationer",
      "Prisoner",
    ]);
    expect(presetAnswers(presetById("value-poker")!).map(Number)).toEqual([...FIBONACCI_VALUES]);
  });

  it("shows ESVP and the safety check from 5 answers, like Psych Safety, and the rest from 3", () => {
    for (const p of QUICK_VOTE_PRESETS) {
      const sensitive = p.id === "esvp" || p.id === "safety-check";
      const check = validateRoundDraft(runnable(p.id));
      expect(check.ok && check.values.minN, p.id).toBe(sensitive ? SENSITIVE_MIN_N : 3);
    }
  });

  it("has a two-step feelings wheel: core feelings, then a core's finer words", () => {
    expect(feelingsOptions(null).map((o) => o.text)).toEqual(FEELINGS.map((f) => f.core));
    expect(feelingsOptions("glad").map((o) => o.text)).toEqual([...FEELINGS[0].finer]);
    for (const f of FEELINGS)
      expect(f.finer.length).toBeLessThanOrEqual(VOTE_LIMITS.maxChoiceOptions);
  });
});

const LABEL = VOTE_LIMITS.maxPointLabelChars;

describe("every format's round is one the vote kit takes as it is", () => {
  it.each([...PRESET_IDS])("%s", (id) => {
    const check = validateRoundDraft(runnable(id));
    expect(check.ok, id).toBe(true);
    if (!check.ok) return;
    const round = roundFor(check.values);
    expect(round.kind).toBe(presetById(id)!.kind);
    const input = round.kind === "scale" ? round.questionnaire : round.sheet;
    const wire = wireSpec(round.kind, input);
    expect(wire.ok ? null : wire.problem, id).toBeNull();
  });

  it("files the round under its format, and value poker under its backlog item when the id fits", () => {
    const poll = validateRoundDraft(runnable("poll"));
    expect(poll.ok && sheetIdFor(poll.values)).toBe("qv:poll");
    const vp = validateRoundDraft(draftOf("value-poker", { backlogItemId: "bi_42" }));
    expect(vp.ok && sheetIdFor(vp.values)).toBe("qv:value-poker:bi_42");
    expect(readSheetId("qv:value-poker:bi_42")).toEqual({
      presetId: "value-poker",
      backlogItemId: "bi_42",
    });
    // An id the kit can't carry is left off; the round still runs.
    const odd = validateRoundDraft(draftOf("value-poker", { backlogItemId: "item with spaces" }));
    expect(odd.ok && sheetIdFor(odd.values)).toBe("qv:value-poker");
    expect(readSheetId("not-ours")).toEqual({ presetId: null, backlogItemId: null });
  });
});

describe("checking the round (validateRoundDraft)", () => {
  it("asks for a question instead of defaulting one", () => {
    const check = validateRoundDraft(draftOf("fist-of-five", { question: "   " }));
    expect(check).toEqual({ ok: false, errors: { question: "Type the question people answer." } });
  });

  it("needs 2 to 12 different options for a poll, and at most 10 to rank", () => {
    const one = validateRoundDraft(draftOf("poll", { optionsText: "Only one" }));
    expect(!one.ok && one.errors.options).toBe("Give at least 2 options, one per line.");
    const twice = validateRoundDraft(draftOf("poll", { optionsText: "Cafe\ncafe" }));
    expect(!twice.ok && twice.errors.options).toBe("“cafe” is in the list twice.");
    const many = Array.from({ length: 11 }, (_, i) => `Option ${i + 1}`).join("\n");
    expect(validateRoundDraft(draftOf("poll", { optionsText: many })).ok).toBe(true);
    const rank = validateRoundDraft(draftOf("ranking", { optionsText: many }));
    expect(!rank.ok && rank.errors.options).toBe(
      "A live round takes at most 10 options: you have 11."
    );
  });

  it("checks a poll's most picks and dot voting's dots as typed", () => {
    const multi = (limit: string) =>
      validateRoundDraft(draftOf("poll", { optionsText: "A\nB\nC", mode: "multi", limit }));
    expect(!multi("").ok && (multi("") as { errors: { limit?: string } }).errors.limit).toBe(
      "Say how many options one person may pick."
    );
    expect(!multi("4").ok).toBe(true);
    const two = multi("2");
    expect(two.ok && two.values.kind === "choice" && two.values.limit).toBe(2);
    const dots = (limit: string) =>
      validateRoundDraft(draftOf("dots", { optionsText: "A\nB", limit }));
    expect(dots("3").ok).toBe(true);
    expect(!dots("11").ok && (dots("11") as { errors: { limit?: string } }).errors.limit).toBe(
      "Each person's dots need to be a whole number from 1 to 10."
    );
  });

  it("needs 2 to 11 labels, each once, for a custom scale, numbered from 1", () => {
    const check = validateRoundDraft(draftOf("custom-scale", { labelsText: "Bad\nOK\nGreat" }));
    expect(check.ok && check.values.kind === "scale" && check.values.points).toEqual([
      { value: 1, label: "Bad" },
      { value: 2, label: "OK" },
      { value: 3, label: "Great" },
    ]);
    const one = validateRoundDraft(draftOf("custom-scale", { labelsText: "Only" }));
    expect(!one.ok && one.errors.labels).toBe(
      "Give at least 2 answers, one per line, lowest first."
    );
  });

  it("checks a guess's range: both ends, low to high, its decimals and a short unit", () => {
    const g = (over: Partial<RoundDraft>) => validateRoundDraft(draftOf("guess-number", over));
    expect(!g({ min: "" }).ok && (g({ min: "" }) as { errors: { min?: string } }).errors.min).toBe(
      "Give the lowest answer people can give."
    );
    const backwards = g({ min: "10", max: "5" });
    expect(!backwards.ok && backwards.errors.max).toBe(
      "The highest answer needs to be above the lowest."
    );
    const precise = g({ min: "0.5" });
    expect(!precise.ok && precise.errors.min).toBe(
      "The lowest answer needs to be a whole number, or allow decimals."
    );
    expect(g({ min: "0.5", decimals: 1 }).ok).toBe(true);
    const unit = g({ unit: "kilometres" });
    expect(!unit.ok && unit.errors.unit).toBe("Keep the unit to 8 characters, like % or days.");
    const ok = g({ min: "1,000", max: "5000" });
    expect(ok.ok && ok.values.kind === "number" && [ok.values.min, ok.values.max]).toEqual([
      1000, 5000,
    ]);
  });

  it("refuses a decimal comma instead of reading 2,5 as 25", () => {
    const g = (over: Partial<RoundDraft>) => validateRoundDraft(draftOf("guess-number", over));
    const comma = g({ min: "0", max: "2,5", decimals: 1 });
    expect(!comma.ok && comma.errors.max).toBe(
      "Use a point for decimals in the highest answer, like 2.5."
    );
    expect(hasDecimalComma("2,5")).toBe(true);
    expect(hasDecimalComma("1,50")).toBe(true);
    expect(hasDecimalComma("1,500")).toBe(false);
    expect(hasDecimalComma("12,000.5")).toBe(false);
    expect(hasDecimalComma("2.5")).toBe(false);
    expect(typedNumber("14,5")).toBeNaN();
    expect(typedNumber("1,500")).toBe(1500);
    expect(typedNumber(" ")).toBeUndefined();
  });

  it("shows a fresh fist of five when nothing is set up, as the page does", () => {
    expect(currentDraft(null)).toEqual(draftOf("fist-of-five"));
    expect(currentDraft({ presetId: "roti" }).presetId).toBe("roti");
  });

  it("uses a format's own answers whatever text is in the options box", () => {
    const check = validateRoundDraft(draftOf("roman", { optionsText: "Sneaky\nExtra" }));
    expect(
      check.ok && check.values.kind === "choice" && check.values.options.map((o) => o.text)
    ).toEqual(["Thumbs up", "Sideways", "Thumbs down"]);
  });
});

describe("text and stored drafts", () => {
  it("reads a pasted list: bullets and numbers dropped, blanks skipped, long lines cut", () => {
    expect(parseLines("- One\n* Two\n\n3. Three\n• Four\n2) Five", 120)).toEqual([
      "One",
      "Two",
      "Three",
      "Four",
      "Five",
    ]);
    expect(parseLines("x".repeat(200), 120)[0]).toHaveLength(120);
    // Hidden characters never reach the wire.
    expect(parseLines("Ca‮fe", 120)).toEqual(["Cafe"]);
  });

  it("reads a stored draft back: unknown formats dropped, dot voting always dots, junk cut", () => {
    expect(normalizeDraft({ presetId: "nope" })).toBeNull();
    expect(normalizeDraft("x")).toBeNull();
    const d = normalizeDraft({ presetId: "dots", mode: "single", question: 7, limit: "4" });
    expect(d).toMatchObject({ presetId: "dots", mode: "dots", question: "", limit: "4" });
    const poll = normalizeDraft({ presetId: "poll", mode: "dots" });
    expect(poll?.mode).toBe("single");
    const vp = normalizeDraft({ presetId: "roti", backlogItemId: "x", feelingsCore: "Glad" });
    expect(vp).toMatchObject({ backlogItemId: null, feelingsCore: null });
    expect(normalizeDraft({ presetId: "feelings", feelingsCore: "sad" })?.feelingsCore).toBe("Sad");
  });

  it("tells a round the host changed from the one its format starts with", () => {
    const base = draftOf("poll");
    expect(draftEdited(base, base)).toBe(false);
    expect(draftEdited({ ...base, question: ` ${base.question} ` }, base)).toBe(false);
    expect(draftEdited({ ...base, optionsText: "Cafe" }, base)).toBe(true);
    expect(draftEdited({ ...base, mode: "multi" }, base)).toBe(true);
    const g = draftOf("guess-number");
    expect(draftEdited({ ...g, decimals: 1 }, g)).toBe(true);
  });
});
