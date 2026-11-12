import { describe, expect, it } from "vitest";
import type { MeetingAudit } from "@/lib/stores/workspace-types";
import {
  auditSummary,
  auditVerdict,
  countedAudits,
  editedMeetingAudit,
  isScrumEvent,
  matchChanges,
  meetingAuditSteps,
  meetingAudits,
  meetingScore,
  normalizeMeetingAudit,
  ratedCount,
  ratingOf,
  resetPlan,
  ruleChanges,
  validateMeetingDraft,
  weeklyHours,
  weeklyText,
  withChange,
  withRating,
  EMPTY_MEETING_DRAFT,
} from "@/lib/meeting-audit/model";
import { toCsv, toMarkdown } from "@/app/(tools)/meeting-audit/markdown";
import { auditAiInput, changedFields } from "@/app/(tools)/meeting-audit/view";

/**
 * Meeting Audit's pure reading: the weekly cost of each cadence, ratings and
 * their average, the summary and the page's sentence, the ritual reset plan,
 * the rules behind "Suggest changes", accepting one, the form's checks, the
 * next step, the export and what Amr is asked.
 */

const AT = "2026-11-12T09:00:00.000Z";
const audit = (over: Partial<MeetingAudit> = {}): MeetingAudit => ({
  id: "m1",
  meeting: "Weekly sync",
  cadence: "weekly",
  minutes: 60,
  attendees: 6,
  purpose: "Share progress.",
  ratings: {},
  createdAt: AT,
  updatedAt: AT,
  ...over,
});

describe("cost", () => {
  it("is attendees × minutes × meetings a week, in person-hours", () => {
    expect(weeklyHours(audit())).toBe(6);
    expect(weeklyHours(audit({ cadence: "daily", minutes: 15, attendees: 8 }))).toBe(10);
    expect(weeklyHours(audit({ cadence: "fortnightly", minutes: 120, attendees: 7 }))).toBe(7);
    expect(weeklyHours(audit({ cadence: "monthly", minutes: 60, attendees: 13 }))).toBeCloseTo(3);
    expect(weeklyHours(audit({ cadence: "quarterly", minutes: 240, attendees: 13 }))).toBeCloseTo(
      4
    );
    expect(weeklyHours(audit({ minutes: 0 }))).toBe(0);
    expect(weeklyText(7.25)).toBe("7.3 person-hours a week");
    expect(weeklyText(1)).toBe("1 person-hour a week");
  });
});

describe("ratings", () => {
  it("reads 1–5 whole numbers only, averages what is rated", () => {
    const a = audit({ ratings: { purpose: 4, people: 2, outcome: 7, length: 2.5, energy: 3 } });
    expect(ratingOf(a, "purpose")).toBe(4);
    expect(ratingOf(a, "outcome")).toBeNull();
    expect(ratingOf(a, "length")).toBeNull();
    expect(ratedCount(a)).toBe(3);
    expect(meetingScore(a)).toBe(3);
    expect(meetingScore(audit())).toBeNull();
    expect(withRating({ purpose: 4 }, "purpose", null)).toEqual({});
    expect(withRating({ purpose: 4 }, "energy", 2)).toEqual({ purpose: 4, energy: 2 });
  });

  it("reads synced rows tolerantly", () => {
    expect(
      normalizeMeetingAudit({
        id: "x",
        meeting: " Sync ",
        cadence: "hourly",
        minutes: -5,
        attendees: "lots",
        ratings: { purpose: 3, people: "4" },
        verdict: "maybe",
      })
    ).toEqual({
      id: "x",
      meeting: "Sync",
      cadence: "weekly",
      minutes: 0,
      attendees: 1,
      purpose: "",
      ratings: { purpose: 3 },
      createdAt: "",
      updatedAt: "",
    });
    expect(normalizeMeetingAudit({ id: "x", meeting: "  " })).toBeNull();
    expect(meetingAudits([audit({ id: "cheap", minutes: 15 }), audit()]).map((a) => a.id)).toEqual([
      "m1",
      "cheap",
    ]);
    expect(countedAudits([audit({ id: "example-1" })]).map((a) => a.id)).toEqual(["example-1"]);
    expect(countedAudits([audit({ id: "example-1" }), audit()]).map((a) => a.id)).toEqual(["m1"]);
  });
});

describe("the summary, the sentence and the plan", () => {
  const rows = [
    audit({ id: "a", ratings: { purpose: 4 }, verdict: "keep" }),
    audit({ id: "b", meeting: "Status", attendees: 12, ratings: { outcome: 1 }, verdict: "drop" }),
    audit({
      id: "c",
      meeting: "Refinement",
      minutes: 30,
      ratings: { length: 2 },
      verdict: "change",
      notes: "Shorten it",
    }),
  ];

  it("counts hours, ratings and verdicts", () => {
    expect(auditSummary(rows)).toEqual({
      meetings: 3,
      weeklyHours: 6 + 12 + 3,
      rated: 3,
      fullyRated: 0,
      verdicts: { keep: 1, change: 1, drop: 1, none: 0 },
      hoursFreed: 12,
      hoursToChange: 3,
    });
  });

  it("says where the audit stands", () => {
    expect(auditVerdict(auditSummary([]))).toBe("No meetings audited yet.");
    expect(auditVerdict(auditSummary([audit()]))).toBe(
      "1 recurring meeting takes 6 person-hours a week. Rate each one with the team."
    );
    expect(auditVerdict(auditSummary([rows[0], audit({ id: "z" })]))).toBe(
      "2 recurring meetings take 12 person-hours a week. 1 meeting still to rate."
    );
    expect(auditVerdict(auditSummary(rows))).toBe(
      "3 recurring meetings take 21 person-hours a week. The plan: 1 meeting to change and 1 meeting to drop, which frees 12 person-hours a week."
    );
    expect(auditVerdict(auditSummary([rows[0]]))).toBe(
      "1 recurring meeting takes 6 person-hours a week. The team keeps every one as it is."
    );
  });

  it("groups the plan by verdict, the costliest first, and works out what the drops free", () => {
    const plan = resetPlan([...rows, audit({ id: "d", minutes: 90 })]);
    expect(plan.keep.map((a) => a.id)).toEqual(["a"]);
    expect(plan.change.map((a) => a.id)).toEqual(["c"]);
    expect(plan.drop.map((a) => a.id)).toEqual(["b"]);
    expect(plan.undecided.map((a) => a.id)).toEqual(["d"]);
    expect(plan.hoursNow).toBe(30);
    expect(plan.hoursFreed).toBe(12);
    expect(plan.hoursAfter).toBe(18);
  });
});

describe("the rules behind 'Suggest changes'", () => {
  it("timeboxes a long daily meeting, even unrated", () => {
    expect(ruleChanges([audit({ cadence: "daily", minutes: 30, attendees: 8 })])).toEqual([
      {
        meetingId: "m1",
        change: "Timebox it to 15 minutes",
        why: "A 30-minute daily meeting takes 20 person-hours a week; at 15 minutes it would take 10.",
      },
    ]);
  });

  it("cuts a long meeting with no outcome, trims the people, moves updates to writing", () => {
    const changes = ruleChanges([
      audit({
        meeting: "Status update",
        attendees: 10,
        ratings: { outcome: 1, people: 2, purpose: 4, energy: 4, length: 3 },
      }),
    ]);
    expect(changes.map((c) => c.change)).toEqual([
      "Cut it to 30 minutes and end with a decision or a next step",
      "Invite only the people it needs, and send notes to the rest",
      "Share the updates in writing, and meet only for what needs a conversation",
    ]);
  });

  it("suggests a trial drop only for a meeting that isn't a Scrum event", () => {
    const low = { purpose: 1, people: 2, outcome: 2, length: 2, energy: 1 };
    const trial = (meeting: string) =>
      ruleChanges([audit({ meeting, ratings: low })]).some((c) =>
        c.change.startsWith("Try dropping")
      );
    expect(trial("Architecture forum")).toBe(true);
    expect(trial("Sprint Review")).toBe(false);
    expect(trial("Retrospective")).toBe(false);
  });

  it("knows the Scrum events by their names, not by a word they share", () => {
    for (const name of [
      "Sprint Planning",
      "Daily Scrum",
      "Daily stand-up",
      "Standup",
      "Sprint Review",
      "Retro",
      "Sprint Retrospective",
    ]) {
      expect(isScrumEvent(name), name).toBe(true);
    }
    for (const name of [
      "Design review",
      "Code review sync",
      "Release planning",
      "Quarterly business review",
      "Capacity planning",
    ]) {
      expect(isScrumEvent(name), name).toBe(false);
    }
    // So a poorly rated one gets the trial drop the Scrum events never get.
    const low = { purpose: 1, people: 2, outcome: 2, length: 2, energy: 1 };
    expect(
      ruleChanges([audit({ meeting: "Design review", ratings: low })]).some((c) =>
        c.change.startsWith("Try dropping")
      )
    ).toBe(true);
  });

  it("gives each meeting one change before any gets a second, at most five, never for a drop", () => {
    const low = { purpose: 1, people: 1, outcome: 1, length: 1, energy: 1 };
    const many = Array.from({ length: 4 }, (_, i) =>
      audit({
        id: `m${i}`,
        meeting: `Forum ${i}`,
        minutes: 60 + i * 10,
        attendees: 8,
        ratings: low,
      })
    );
    const changes = ruleChanges([...many, audit({ id: "gone", ratings: low, verdict: "drop" })]);
    expect(changes).toHaveLength(5);
    expect(changes.slice(0, 4).map((c) => c.meetingId)).toEqual(["m3", "m2", "m1", "m0"]);
    expect(changes.some((c) => c.meetingId === "gone")).toBe(false);
  });

  it("leaves out a change the notes already hold", () => {
    const a = audit({ cadence: "daily", minutes: 30, notes: "Timebox it to 15 minutes" });
    expect(ruleChanges([a])).toEqual([]);
  });
});

describe("accepting a change", () => {
  it("adds it to the notes once and marks the meeting to change (a drop stays a drop)", () => {
    const at = "2026-11-12T10:00:00.000Z";
    const once = withChange(audit({ notes: "Ask the team" }), "Shorten it", at);
    expect(once).toMatchObject({
      notes: "Ask the team\nShorten it",
      verdict: "change",
      updatedAt: at,
    });
    expect(withChange(once, "shorten it", at).notes).toBe("Ask the team\nShorten it");
    expect(withChange(audit({ verdict: "drop" }), "Shorten it", at).verdict).toBe("drop");
  });

  it("matches suggestions to known meetings, drops none twice, at most five", () => {
    const rows = [audit({ id: "a" }), audit({ id: "b", verdict: "drop" })];
    const c = (meetingId: string, change = "Shorten it") => ({
      meetingId,
      change,
      why: "Because.",
    });
    expect(
      matchChanges(
        [c("a"), c("a", " shorten it "), c("b"), c("nope"), c("a", "Fewer people")],
        rows
      )
    ).toEqual([c("a"), c("a", "Fewer people")]);
  });
});

describe("the form's checks", () => {
  const draft = (over = {}) => ({ ...EMPTY_MEETING_DRAFT, ...over });

  it("needs a name, a cadence, whole minutes and people, never a silent 0", () => {
    const v = validateMeetingDraft(draft());
    expect(v.ok || v.errors).toEqual({
      meeting: "Name the meeting.",
      cadence: "Pick how often it meets.",
      minutes: "Say how many minutes it takes.",
      attendees: "Say how many people attend.",
    });
    const bad = validateMeetingDraft(
      draft({ meeting: "X", cadence: "weekly", minutes: "1.5", attendees: "0" })
    );
    expect(bad.ok || bad.errors).toEqual({
      minutes: "Enter whole minutes, 1 or more.",
      attendees: "Enter a whole number of people, 1 or more.",
    });
    const big = validateMeetingDraft(
      draft({ meeting: "X", cadence: "weekly", minutes: "1441", attendees: "1001" })
    );
    expect(big.ok || Object.keys(big.errors)).toEqual(["minutes", "attendees"]);
  });

  it("returns clean values, and an edit keeps the ratings and verdict", () => {
    const v = validateMeetingDraft(
      draft({
        meeting: " Sync ",
        cadence: "daily",
        minutes: "15",
        attendees: "7",
        purpose: " Plan the day ",
      })
    );
    expect(v).toEqual({
      ok: true,
      values: {
        meeting: "Sync",
        cadence: "daily",
        minutes: 15,
        attendees: 7,
        purpose: "Plan the day",
      },
    });
    if (!v.ok) return;
    const before = audit({ ratings: { purpose: 4 }, verdict: "keep", notes: "Old" });
    const after = editedMeetingAudit(before, v.values, "2026-11-12T10:00:00.000Z");
    expect(after).toMatchObject({
      meeting: "Sync",
      cadence: "daily",
      ratings: { purpose: 4 },
      verdict: "keep",
    });
    expect(after).not.toHaveProperty("notes");
    expect(changedFields(before, v.values)).toEqual([
      "meeting",
      "cadence",
      "minutes",
      "attendees",
      "purpose",
      "notes",
    ]);
  });
});

describe("the next step", () => {
  const NOW = new Date("2026-11-12T10:00:00.000Z");

  it("asks to rate, then for verdicts, then takes the changes to the retro", () => {
    expect(meetingAuditSteps([], NOW)).toEqual([]);
    expect(meetingAuditSteps([audit({ id: "example-1" })], NOW)).toEqual([]);
    expect(meetingAuditSteps([audit()], NOW).map((s) => s.id)).toEqual(["meeting-audit-rate"]);
    expect(meetingAuditSteps([audit()], NOW)[0].label).toBe("Rate “Weekly sync” with the team");
    const steps = meetingAuditSteps(
      [
        audit({ id: "a", ratings: { purpose: 3 } }),
        audit({ id: "b", ratings: { purpose: 3 }, verdict: "drop", attendees: 12 }),
      ],
      NOW
    );
    expect(steps.map((s) => s.id)).toEqual(["meeting-audit-verdict", "meeting-audit-retro"]);
    expect(steps[1]).toMatchObject({ href: "/retro" });
    expect(steps[1].detail).toContain("1 meeting to drop, freeing 12 person-hours a week");
  });

  it("asks for the audit again once a quarter has passed", () => {
    const old = audit({
      ratings: { purpose: 4 },
      verdict: "keep",
      updatedAt: "2026-08-01T09:00:00.000Z",
    });
    expect(meetingAuditSteps([old], NOW).map((s) => s.id)).toEqual(["meeting-audit-again"]);
  });
});

describe("the export and what Amr is asked", () => {
  const rows = [
    audit({
      id: "a",
      meeting: "Daily | Scrum",
      cadence: "daily",
      minutes: 15,
      attendees: 8,
      ratings: { purpose: 4, outcome: 4 },
      verdict: "keep",
    }),
    audit({ id: "b", meeting: "Status", attendees: 12, verdict: "drop", notes: "Write it up" }),
  ];

  it("writes the table, the ratings and the ritual reset plan", () => {
    const md = toMarkdown(rows, new Date("2026-11-12T10:00:00"));
    expect(md).toContain("# Meeting audit — 12 Nov 2026");
    expect(md).toContain("| Status | Weekly | 60 | 12 | 12 | — | Drop |");
    expect(md).toContain("| Daily \\| Scrum | Daily | 15 | 8 | 10 | 4 | Keep |");
    expect(md).toContain("| Daily \\| Scrum | 4 | — | 4 | — | — |");
    expect(md).toContain("Now: 22 person-hours a week. After the drops: 10 person-hours a week.");
    expect(md).toContain("### Drop\n\n- Status (frees 12 person-hours a week): Write it up");
    expect(md).toContain("### Keep\n\n- Daily \\| Scrum");
    expect(toMarkdown([], new Date("2026-11-12T10:00:00"))).toContain("No meetings audited yet.");
    const csv = toCsv(rows);
    expect(csv.headers).toContain("Right people");
    expect(csv.rows[0].slice(0, 5)).toEqual(["Status", "Weekly", 60, 12, 12]);
  });

  it("asks Amr about meetings with a length, cut to the task's caps", () => {
    const input = auditAiInput([
      ...rows,
      audit({ id: "broken", minutes: 0 }),
      audit({ id: "long", purpose: "p".repeat(400), ratings: { energy: 9 } }),
    ]);
    expect(input.meetings.map((m) => m.id)).toEqual(["a", "b", "long"]);
    expect(input.meetings[0].ratings).toEqual({ purpose: 4, outcome: 4 });
    expect(input.meetings[2].purpose).toHaveLength(300);
    expect(input.meetings[2].ratings).toEqual({});
  });
});
