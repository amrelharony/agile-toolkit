// @vitest-environment node
/**
 * The golden test for async-standup.digest: a summary of one day's written
 * updates. A canned answer reads into the summary, a partly bad one is
 * salvaged or refused, asks and hand-overs are kept to the people and
 * places given, the rules' fallback answers validly, which updates are kept
 * over 25, and the fitter brings the largest input (in 3-byte text) inside
 * the route's body budget.
 */

import { describe, expect, it } from "vitest";
import { parseAnswer } from "@/lib/ai/parse-answer";
import { buildTaskSystem, buildTaskUser } from "@/lib/ai/run-task.server";
import { TOOL_AI_BODY_BUDGET } from "@/lib/ai/contract";
import { asyncStandupDigestTask } from "@/lib/ai/tasks/async-standup";
import { asyncStandupDigestPrompt } from "@/lib/ai/tasks/async-standup.server";
import {
  DIGEST_MAX,
  cleanDigestOutput,
  digestFallback,
  digestInput,
  digestWithSummary,
  fitDigestInput,
  type DigestInput,
} from "@/lib/standup/digest-ai";
import type { StandupEntry } from "@/lib/stores/workspace-types";
import type { StandupPlace } from "@/lib/team-time/sun";
import { nameKey } from "@/lib/team/names";
import { jsonBytes } from "@/lib/utils/json-bytes";

const task = asyncStandupDigestTask;
/** A BMP character that is 3 bytes in UTF-8 and counts 1 toward `.max()`. */
const wide = (n: number) => "時".repeat(n);

const DAY = "2026-11-17";
const entry = (id: string, member: string, over: Partial<StandupEntry> = {}): StandupEntry => ({
  id,
  member,
  date: DAY,
  yesterday: "y",
  today: "t",
  blockers: "",
  timestamp: 1,
  mode: "async",
  ...over,
});
const placesOf = (pairs: [string, StandupPlace][]) =>
  new Map(pairs.map(([name, p]) => [nameKey(name), p]));
const SYDNEY = { label: "Sydney", zone: "Australia/Sydney" };
const LONDON = { label: "London", zone: "Europe/London" };
const TORONTO = { label: "Toronto", zone: "America/Toronto" };

describe("async-standup.digest", () => {
  it("is a quick task anyone may run, with a list's token budget", () => {
    expect(task).toMatchObject({
      id: "async-standup.digest",
      toolId: "async-standup",
      tier: "flash",
      effort: "low",
      maxTokens: 4096,
    });
    expect(task.ownerOnly).toBeUndefined();
  });

  it("caps its input: 1 to 25 updates, the field lengths and the lists", () => {
    const one = task.sample.entries[0];
    expect(task.input.safeParse(task.sample).success).toBe(true);
    expect(task.input.safeParse({ ...task.sample, entries: [] }).success).toBe(false);
    expect(
      task.input.safeParse({ ...task.sample, entries: Array.from({ length: 26 }, () => one) })
        .success
    ).toBe(false);
    expect(
      task.input.safeParse({ ...task.sample, entries: [{ ...one, done: wide(601) }] }).success
    ).toBe(false);
    expect(
      task.input.safeParse({ ...task.sample, shifts: Array.from({ length: 9 }, () => "x") }).success
    ).toBe(false);
    expect(task.input.safeParse({ ...task.sample, date: "17 Nov" }).success).toBe(false);
  });

  it("reads a typical model answer", () => {
    const answer =
      '```json\n{"headline":"2 updates, 1 blocker","summary":"Lee is blocked on sandbox keys.","asks":[{"who":"Priya (PM)","text":"Chase the payments team for the keys."}],"risks":["Ana\'s migration review is 4 days old."],"handoffs":[{"from":"Sydney","to":"Cairo","text":"Run the retry case on staging."}]}\n```';
    const parsed = parseAnswer(answer, task.output);
    expect(parsed).toEqual({
      ok: true,
      data: {
        headline: "2 updates, 1 blocker",
        summary: "Lee is blocked on sandbox keys.",
        asks: [{ who: "Priya (PM)", text: "Chase the payments team for the keys." }],
        risks: ["Ana's migration review is 4 days old."],
        handoffs: [{ from: "Sydney", to: "Cairo", text: "Run the retry case on staging." }],
      },
    });
  });

  it("salvages a partly bad answer and refuses one with no headline", () => {
    const parsed = parseAnswer(
      JSON.stringify({
        headline: "A day",
        summary: "",
        asks: [
          { who: "", text: "x" },
          { who: "Ana (Backend)", text: "Ship it." },
        ],
        risks: ["", "One."],
        handoffs: [],
      }),
      task.output
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.asks).toEqual([{ who: "Ana (Backend)", text: "Ship it." }]);
      expect(parsed.data.risks).toEqual(["One."]);
    }
    expect(
      parseAnswer('{"headline":" ","summary":"","asks":[],"risks":[],"handoffs":[]}', task.output)
        .ok
    ).toBe(false);
  });

  it("keeps asks to the people given and hand-overs between the places given", () => {
    const input = task.input.parse(task.sample);
    const out = cleanDigestOutput(input, {
      headline: "h",
      summary: "s",
      asks: [
        { who: "priya (pm)", text: "Chase the keys." },
        { who: "Lee (iOS)", text: "Test the picker." },
        { who: "The CEO", text: "Approve." },
      ],
      risks: [],
      handoffs: [
        { from: "Sydney", to: "cairo", text: "Retry case." },
        { from: "Sydney", to: "Mars", text: "No." },
      ],
    });
    expect(out.asks.map((a) => a.who)).toEqual(["priya (pm)", "Lee (iOS)"]);
    expect(out.handoffs.map((h) => h.to)).toEqual(["cairo"]);
  });

  it("answers without AI with a valid summary: counts, asks to the DRI, risks and hand-overs", () => {
    const out = task.fallback(task.input.parse(task.sample));
    expect(task.output.safeParse(out).success).toBe(true);
    expect(out.headline).toBe("2 updates posted, 1 still to come; 2 blockers open");
    expect(out.summary).toBe(
      "Blocked today: Lee (iOS). The oldest open blocker is Ana (Backend)'s, 4 days old: The index migration needs a DBA review. Not posted yet: Sam (QA)."
    );
    expect(out.asks).toEqual([
      { who: "Priya (PM)", text: "Still waiting on sandbox keys from the payments team." },
    ]);
    expect(out.risks).toEqual([
      "Ana (Backend)'s blocker is 4 days old: The index migration needs a DBA review.",
    ]);
    expect(out.handoffs).toEqual([
      {
        from: "Sydney",
        to: "Cairo",
        text: "The picker build is on staging; please run the retry case.",
      },
    ]);
    expect(() => digestFallback({ ...task.sample, entries: [] } as DigestInput)).toThrow();
  });

  it("builds the page's input: problems first, then east to west, the oldest blockers first", () => {
    const places = placesOf([
      ["Tom", TORONTO],
      ["Lou", LONDON],
      ["Sky", SYDNEY],
    ]);
    const input = digestInput({
      date: DAY,
      places,
      notPosted: ["Kim"],
      entries: [
        entry("a", "Tom"),
        entry("b", "Lou", { blockers: "Keys", blockerDri: "Bo", format: "ppp" }),
        entry("c", "Sky", { handoff: "Run the retry case", description: "Off at 3" }),
        entry("d", "Nobody"),
        entry("old", "Tom", { date: "2026-11-12", blockers: "DBA review" }),
        entry("done", "Lou", { date: "2026-11-10", blockers: "Fixed", blockerResolved: true }),
        entry("e", "Res", { blockers: "Gone", blockerResolved: true }),
      ],
    });
    expect(task.input.safeParse(input).success).toBe(true);
    expect(input.entries.map((e) => [e.member, e.site ?? null, e.problem])).toEqual([
      ["Lou", "London", "Keys"],
      ["Sky", "Sydney", ""],
      ["Tom", "Toronto", ""],
      ["Nobody", null, ""],
      ["Res", null, ""],
    ]);
    expect(input.entries[0]).toMatchObject({ format: "ppp", dri: "Bo" });
    expect(input.entries[1]).toMatchObject({ handoff: "Run the retry case", notes: "Off at 3" });
    expect(input.olderBlockers).toEqual([{ member: "Tom", text: "DBA review", ageDays: 5 }]);
    expect(input.shifts).toEqual(["Sydney", "London", "Toronto"]);
    expect(input.notPosted).toEqual(["Kim"]);
  });

  it("gives the AI one shift per clock, and each poster their shift's name", () => {
    const places = placesOf([
      ["Priya", { label: "London office", zone: "Europe/London" }],
      ["Tom", LONDON],
      ["Sky", SYDNEY],
    ]);
    const input = digestInput({
      date: DAY,
      places,
      notPosted: [],
      entries: [
        entry("p", "Priya", { handoff: "Watch the deploy" }),
        entry("t", "Tom"),
        entry("s", "Sky", { handoff: "Build is green" }),
      ],
    });
    expect(task.input.safeParse(input).success).toBe(true);
    expect(input.shifts).toEqual(["Sydney", "London office / London"]);
    expect(input.entries.map((e) => [e.member, e.site])).toEqual([
      ["Sky", "Sydney"],
      ["Priya", "London office / London"],
      ["Tom", "London office / London"],
    ]);
    // Without AI: each hand-over goes to the other clock, never within one.
    expect(digestFallback(input).handoffs).toEqual([
      { from: "Sydney", to: "London office / London", text: "Build is green" },
      { from: "London office / London", to: "Sydney", text: "Watch the deploy" },
    ]);
  });

  it("keeps 25 updates: everyone with a problem first", () => {
    const entries = Array.from({ length: 30 }, (_, i) =>
      entry(`e${i}`, `P${i}`, i >= 26 ? { blockers: `stuck ${i}` } : {})
    );
    const input = digestInput({ date: DAY, entries, notPosted: [] });
    expect(input.entries).toHaveLength(DIGEST_MAX.entries);
    expect(input.entries.slice(0, 4).map((e) => e.member)).toEqual(["P26", "P27", "P28", "P29"]);
    expect(input.entries[4].member).toBe("P0");
  });

  it("fits the largest input, in 3-byte text, inside the route's budget", () => {
    const largest: DigestInput = {
      date: DAY,
      entries: Array.from({ length: DIGEST_MAX.entries }, (_, i) => ({
        member: `${i}${wide(DIGEST_MAX.member - 3)}`,
        format: "ppp" as const,
        site: wide(DIGEST_MAX.site),
        done: wide(DIGEST_MAX.field),
        next: wide(DIGEST_MAX.field),
        problem: wide(DIGEST_MAX.field),
        dri: wide(DIGEST_MAX.dri),
        handoff: wide(DIGEST_MAX.handoff),
        notes: wide(DIGEST_MAX.notes),
      })),
      notPosted: Array.from({ length: DIGEST_MAX.notPosted }, () => wide(DIGEST_MAX.member)),
      olderBlockers: Array.from({ length: DIGEST_MAX.olderBlockers }, () => ({
        member: wide(DIGEST_MAX.member),
        text: wide(DIGEST_MAX.olderText),
        ageDays: 365,
        dri: wide(DIGEST_MAX.dri),
      })),
      shifts: Array.from({ length: DIGEST_MAX.shifts }, () => wide(DIGEST_MAX.site)),
    };
    expect(task.input.safeParse(largest).success).toBe(true);
    expect(jsonBytes({ task: task.id, input: largest })).toBeGreaterThan(TOOL_AI_BODY_BUDGET);
    const fitted = fitDigestInput(largest);
    expect(task.input.safeParse(fitted).success).toBe(true);
    expect(jsonBytes({ task: task.id, input: fitted })).toBeLessThanOrEqual(TOOL_AI_BODY_BUDGET);
    expect(fitted.entries.every((e) => e.notes === undefined)).toBe(true);
    expect(fitted.olderBlockers).toHaveLength(5);
    expect(fitted.entries.length).toBeGreaterThan(0);
    expect(task.output.safeParse(task.fallback(fitted)).success).toBe(true);
    // Something small fits as it is.
    const small = task.input.parse(task.sample);
    expect(fitDigestInput(small)).toBe(small);
  });

  it("drops people without a problem from the end before anyone else", () => {
    const base: DigestInput = {
      date: DAY,
      entries: Array.from({ length: 10 }, (_, i) => ({
        member: `P${i}`,
        format: "classic" as const,
        done: wide(300),
        next: wide(300),
        problem: i < 3 ? wide(300) : "",
      })),
      notPosted: [],
      olderBlockers: [],
      shifts: [],
    };
    const tight = jsonBytes({
      task: task.id,
      input: { ...base, entries: base.entries.slice(0, 5) },
    });
    const fitted = fitDigestInput(base, tight);
    expect(fitted.entries.map((e) => e.member)).toEqual(["P0", "P1", "P2", "P3", "P4"]);
  });

  it("builds the prompt on the server, the updates inside the block", () => {
    expect(buildTaskSystem(task, asyncStandupDigestPrompt)).toContain("Use only the facts given");
    const user = buildTaskUser(asyncStandupDigestPrompt, task.input.parse(task.sample));
    expect(user.startsWith("<user_content>\n")).toBe(true);
    expect(user).toContain("- Lee (iOS) (Sydney)");
    expect(user).toContain(
      "  Problems: Still waiting on sandbox keys from the payments team. (DRI: Priya (PM))"
    );
    expect(user).toContain("  Yesterday: Found the double charge.");
    expect(user).toContain("Shifts east to west: Sydney, Cairo, London office, Toronto");
    expect(user).toContain("- Ana (Backend), 4 days: The index migration needs a DBA review.");
  });

  it("puts the summary after the digest's title, escaped", () => {
    const md = digestWithSummary("# Standup — 2026-11-17\n\n## Ana\n- **Today**: Ship", {
      headline: "1 update *posted*",
      summary: "All clear.",
      asks: [{ who: "Bo", text: "Review #12" }],
      risks: [],
      handoffs: [{ from: "Sydney", to: "London", text: "Pick up the build" }],
    });
    expect(md.split("\n")).toEqual([
      "# Standup — 2026-11-17",
      "",
      "## Summary",
      "1 update \\*posted\\*",
      "",
      "All clear.",
      "",
      "- Ask Bo: Review \\#12",
      "- Hand-over, Sydney → London: Pick up the build",
      "",
      "## Ana",
      "- **Today**: Ship",
    ]);
  });
});
