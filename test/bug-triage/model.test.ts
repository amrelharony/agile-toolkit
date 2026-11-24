/**
 * Bug Triage's model, with today injected: reading stored rows, where a bug
 * sits, ages and fix-by targets, the rules that suggest a severity and a
 * priority, the grid's advice and "Check" cells, where a bug went
 * (`linkState`, read from the slices), duplicates, the changes the page and
 * Amr make, the log form's checks, and the next steps.
 */

import { describe, expect, it } from "vitest";
import type { BugReport, InterruptItem, Story } from "@/lib/stores/workspace-types";
import { BUG_PRIORITIES, BUG_SEVERITIES, TOOL_TEXT_MAX } from "@/lib/stores/workspace-types";
import {
  CELL_ADVICE,
  EMPTY_BUG_DRAFT,
  FIX_BY_DAYS,
  ageDays,
  bugDescription,
  bugSource,
  bugTriageSteps,
  cellOf,
  closeBug,
  countedBugs,
  duplicateHints,
  duplicateProblem,
  fixByDay,
  gridCounts,
  keptLink,
  linkState,
  mismatched,
  needsTriage,
  normalizeBug,
  oldestFirst,
  overTarget,
  placeOf,
  priorityFor,
  readBugs,
  reopenBug,
  routeFor,
  severityByRules,
  triageBug,
  triageQueue,
  validateBugDraft,
  workDone,
} from "@/lib/bug-triage/model";

const TODAY = "2026-11-20";
const NOW = "2026-11-20T10:00:00.000Z";

/** An ISO time `days` before TODAY, at noon UTC (the same local day anywhere near it). */
const daysAgo = (days: number) => new Date(Date.UTC(2026, 10, 20 - days, 12)).toISOString();

const bug = (over: Partial<BugReport> = {}): BugReport => ({
  id: "bug_a",
  title: "Checkout fails",
  status: "new",
  createdAt: daysAgo(0),
  updatedAt: daysAgo(0),
  ...over,
});

const placed = (over: Partial<BugReport> = {}) =>
  bug({ status: "triaged", severity: "major", priority: "next", triagedAt: daysAgo(0), ...over });

const NO_SLICES = { stories: [] as Story[], interrupts: [] as InterruptItem[] };

describe("reading stored rows", () => {
  it("keeps a usable row, drops unknown values and cuts text to the caps", () => {
    const read = normalizeBug({
      id: "b1",
      title: "  Two\nlines  ",
      status: "weird",
      severity: "huge",
      priority: "now",
      checks: { dataLoss: "yes", security: true, reach: "nobody" },
      steps: "s".repeat(TOOL_TEXT_MAX.text + 50),
      createdAt: daysAgo(1),
    });
    expect(read).toMatchObject({ id: "b1", title: "Two lines", status: "new", priority: "now" });
    expect(read?.severity).toBeUndefined();
    expect(read?.checks).toEqual({ security: true });
    expect(read?.steps).toHaveLength(TOOL_TEXT_MAX.text);
  });

  it("refuses a row with no id or no title", () => {
    expect(normalizeBug({ title: "x" })).toBeNull();
    expect(normalizeBug({ id: "b", title: "   " })).toBeNull();
    expect(readBugs([null, { id: "b", title: "ok", status: "new", createdAt: NOW }])).toHaveLength(
      1
    );
  });

  it("sorts the oldest first, keeping the stored order on a tie", () => {
    const list = [
      bug({ id: "new", createdAt: daysAgo(0) }),
      bug({ id: "old", createdAt: daysAgo(5) }),
      bug({ id: "tie", createdAt: daysAgo(0) }),
    ];
    expect(oldestFirst(list).map((b) => b.id)).toEqual(["old", "new", "tie"]);
  });
});

describe("where a bug sits", () => {
  it("is in the queue until it is triaged with both a severity and a priority", () => {
    expect(placeOf(bug())).toBe("queue");
    expect(placeOf(placed())).toBe("grid");
    expect(placeOf(placed({ priority: undefined }))).toBe("queue");
    expect(placeOf(placed({ status: "closed" }))).toBe("closed");
    expect(needsTriage(bug({ severity: "major", priority: "now" }))).toBe(true);
    expect(cellOf(placed())).toEqual({ severity: "major", priority: "next" });
    expect(cellOf(bug())).toBeNull();
  });

  it("counts the open placed bugs in their cells", () => {
    const counts = gridCounts([
      placed({ id: "1" }),
      placed({ id: "2" }),
      placed({ id: "3", severity: "critical", priority: "now" }),
      placed({ id: "4", status: "closed" }),
      bug({ id: "5" }),
    ]);
    expect(counts.major.next).toBe(2);
    expect(counts.critical.now).toBe(1);
    expect(
      BUG_SEVERITIES.flatMap((s) => BUG_PRIORITIES.map((p) => counts[s][p])).reduce((a, b) => a + b)
    ).toBe(3);
  });

  it("lists the queue oldest first", () => {
    expect(
      triageQueue([
        bug({ id: "b", createdAt: daysAgo(1) }),
        placed(),
        bug({ id: "a", createdAt: daysAgo(3) }),
      ]).map((b) => b.id)
    ).toEqual(["a", "b"]);
  });

  it("counts the team's own bugs, the example's only while there are none", () => {
    const ex = bug({ id: "example-1" });
    expect(countedBugs([ex])).toEqual([ex]);
    expect(countedBugs([ex, bug()]).map((b) => b.id)).toEqual(["bug_a"]);
  });
});

describe("ages and fix-by targets", () => {
  it("counts whole days from the day it was logged", () => {
    expect(ageDays(bug({ createdAt: daysAgo(0) }), TODAY)).toBe(0);
    expect(ageDays(bug({ createdAt: daysAgo(3) }), TODAY)).toBe(3);
    expect(ageDays(bug({ createdAt: "not a date" }), TODAY)).toBe(0);
  });

  it("sets a fix-by day per severity, cosmetic none", () => {
    expect(FIX_BY_DAYS).toEqual({ critical: 2, major: 14, minor: 60, cosmetic: null });
    expect(fixByDay(bug({ severity: "critical", createdAt: daysAgo(3) }))).toBe("2026-11-19");
    expect(fixByDay(bug({ severity: "cosmetic" }))).toBeNull();
    expect(fixByDay(bug())).toBeNull();
  });

  it("is over target once older than its severity allows, and only while open", () => {
    expect(overTarget(placed({ severity: "critical", createdAt: daysAgo(3) }), TODAY)).toBe(true);
    expect(overTarget(placed({ severity: "critical", createdAt: daysAgo(2) }), TODAY)).toBe(false);
    expect(overTarget(placed({ severity: "minor", createdAt: daysAgo(30) }), TODAY)).toBe(false);
    expect(
      overTarget(placed({ severity: "critical", createdAt: daysAgo(9), status: "closed" }), TODAY)
    ).toBe(false);
    expect(overTarget(placed({ severity: "cosmetic", createdAt: daysAgo(400) }), TODAY)).toBe(
      false
    );
  });
});

describe("the rules without AI", () => {
  it("reads the checks first", () => {
    expect(severityByRules("Typo", { dataLoss: true }).severity).toBe("critical");
    expect(severityByRules("Typo", { security: true }).severity).toBe("critical");
    expect(severityByRules("Slow page", { reach: "all", workaround: false }).severity).toBe(
      "critical"
    );
    expect(severityByRules("Typo on the banner", { blocksRelease: true }).severity).toBe("major");
    expect(severityByRules("The app crashes", { blocksRelease: true }).severity).toBe("critical");
  });

  it.each([
    ["The app crashes when I open it", "critical"],
    ["Payments over 1,000 fail", "critical"],
    ["I can't log in with my email", "critical"],
    ["The basket shows the wrong total", "major"],
    ["An error appears on the profile page", "major"],
    ["The search page is slow", "minor"],
    ["The settings are confusing", "minor"],
    ["Typo on the delivery page", "cosmetic"],
    ["Spacing on the footer", "cosmetic"],
  ])("“%s” → %s", (words, severity) => {
    expect(severityByRules(words).severity).toBe(severity);
  });

  it("with nothing to go on, many people make it major, otherwise minor", () => {
    expect(severityByRules("Something odd", { reach: "many" }).severity).toBe("major");
    expect(severityByRules("Something odd").severity).toBe("minor");
    expect(severityByRules("Something odd", { workaround: true }).reason).toMatch(/get round/);
  });

  it("gives a reason in plain words within the AI's cap", () => {
    for (const words of ["Crash", "Typo", "nothing", "error"]) {
      const { reason } = severityByRules(words);
      expect(reason.length).toBeGreaterThan(10);
      expect(reason.length).toBeLessThanOrEqual(160);
    }
  });

  it("gives a priority from the severity and the checks", () => {
    expect(priorityFor("critical")).toBe("now");
    expect(priorityFor("major")).toBe("next");
    expect(priorityFor("major", { blocksRelease: true })).toBe("now");
    expect(priorityFor("minor")).toBe("later");
    expect(priorityFor("minor", { reach: "many" })).toBe("next");
    expect(priorityFor("cosmetic")).toBe("someday");
    expect(priorityFor("cosmetic", { reach: "all" })).toBe("later");
  });
});

describe("the grid's advice", () => {
  it("has a line for every cell, in our words", () => {
    for (const s of BUG_SEVERITIES) {
      for (const p of BUG_PRIORITIES) expect(CELL_ADVICE[s][p].length).toBeGreaterThan(10);
    }
    expect(CELL_ADVICE.critical.now).toMatch(/interrupt buffer/);
    expect(CELL_ADVICE.minor.someday).toMatch(/Close it/);
  });

  it("says Check where severity and priority don't sit well together", () => {
    expect(mismatched("critical", "later")).toBe(true);
    expect(mismatched("critical", "someday")).toBe(true);
    expect(mismatched("cosmetic", "now")).toBe(true);
    expect(mismatched("critical", "now")).toBe(false);
    expect(mismatched("major", "someday")).toBe(false);
  });

  it("routes now to an interrupt, next and later to the backlog, some day nowhere", () => {
    expect(routeFor("now")).toBe("interrupt");
    expect(routeFor("next")).toBe("backlog-story");
    expect(routeFor("later")).toBe("backlog-story");
    expect(routeFor("someday")).toBeNull();
    expect(routeFor(undefined)).toBeNull();
  });
});

describe("sending a bug on", () => {
  it("hands over the details as labelled lines, the bug tag, the area and an interrupt kind", () => {
    const b = placed({
      severity: "critical",
      steps: "Pay",
      expected: "Paid",
      actual: "Error",
      environment: "Web",
      area: "Checkout",
      reportedBy: "Sam",
    });
    expect(bugDescription(b)).toBe(
      "Steps: Pay\nExpected: Paid\nWhat happened: Error\nWhere: Web\nArea: Checkout"
    );
    expect(bugSource(b)).toEqual({
      title: "Checkout fails",
      description: bugDescription(b),
      raisedBy: "Sam",
      area: "Checkout",
      tags: ["bug"],
      interrupt: { kind: "bug", emergency: true },
      sourceRef: { tool: "bug-triage", id: "bug_a" },
    });
    expect(bugSource(bug()).interrupt).toEqual({ kind: "bug", emergency: false });
    expect(bugSource(bug()).description).toBeUndefined();
  });

  it("reads where a link went from the slices: live, done or gone", () => {
    const slices = {
      stories: [
        { id: "s1", status: "in_progress" as const },
        { id: "s2", status: "done" as const },
      ],
      interrupts: [{ id: "i1" }, { id: "i2", resolvedAt: NOW }],
    };
    const at = NOW;
    expect(linkState({ route: "backlog-story", targetId: "s1", at }, slices)).toBe("live");
    expect(linkState({ route: "backlog-story", targetId: "s2", at }, slices)).toBe("done");
    expect(linkState({ route: "backlog-story", targetId: "gone", at }, slices)).toBe("gone");
    expect(linkState({ route: "interrupt", targetId: "i1", at }, slices)).toBe("live");
    expect(linkState({ route: "interrupt", targetId: "i2", at }, slices)).toBe("done");
    expect(linkState({ route: "impediment", targetId: "s1", at }, slices)).toBe("gone");
    const sent = placed({ sentTo: [{ route: "backlog-story", targetId: "s2", at }] });
    expect(workDone(sent, slices)).toBe(true);
    expect(workDone({ ...sent, status: "closed" }, slices)).toBe(false);
    expect(keptLink(sent, "backlog-story", slices)?.targetId).toBe("s2");
    expect(keptLink(sent, "backlog-story", NO_SLICES)).toBeUndefined();
  });
});

describe("duplicates", () => {
  it("points a near-duplicate at the older open bug", () => {
    const hints = duplicateHints([
      bug({
        id: "newer",
        title: "Paying with a saved card fails on a phone",
        createdAt: daysAgo(0),
      }),
      bug({ id: "older", title: "Paying with a saved card fails", createdAt: daysAgo(2) }),
      bug({ id: "other", title: "Typo on the delivery page" }),
      bug({ id: "closed", title: "Paying with a saved card fails", status: "closed" }),
    ]);
    expect(hints.get("newer")).toBe("older");
    expect(hints.has("older")).toBe(false);
    expect(hints.has("other")).toBe(false);
  });

  it("refuses a duplicate close that names no bug, itself or one that's gone", () => {
    const all = [bug(), bug({ id: "bug_b" })];
    expect(duplicateProblem(bug(), undefined, all)).toMatch(/Pick/);
    expect(duplicateProblem(bug(), "bug_a", all)).toMatch(/itself/);
    expect(duplicateProblem(bug(), "bug_z", all)).toMatch(/isn't here/);
    expect(duplicateProblem(bug(), "bug_b", all)).toBeNull();
  });
});

describe("changes", () => {
  it("places a bug, keeping when it was first triaged", () => {
    const next = triageBug(
      bug(),
      { severity: "minor", priority: "later", checks: { reach: "one" } },
      NOW
    );
    expect(next).toMatchObject({
      status: "triaged",
      severity: "minor",
      priority: "later",
      checks: { reach: "one" },
      triagedAt: NOW,
      updatedAt: NOW,
    });
    const moved = triageBug(
      next,
      { severity: "major", priority: "next" },
      "2026-11-21T09:00:00.000Z"
    );
    expect(moved.triagedAt).toBe(NOW);
    expect(moved.checks).toEqual({ reach: "one" });
  });

  it("closes with a reason, naming the bug a duplicate repeats, and reopens where it was", () => {
    const closed = closeBug(placed(), "duplicate", NOW, "bug_b");
    expect(closed).toMatchObject({
      status: "closed",
      closeReason: "duplicate",
      duplicateOf: "bug_b",
      closedAt: NOW,
    });
    expect(closeBug(placed(), "fixed", NOW, "bug_b").duplicateOf).toBeUndefined();
    const back = reopenBug(closed, NOW);
    expect(back.status).toBe("triaged");
    expect(back.closeReason).toBeUndefined();
    expect(back.duplicateOf).toBeUndefined();
    expect(back.closedAt).toBeUndefined();
    expect(reopenBug(closeBug(bug(), "not-a-bug", NOW), NOW).status).toBe("new");
  });
});

describe("the log form", () => {
  it("needs a title on one line, within the caps", () => {
    const blank = validateBugDraft(EMPTY_BUG_DRAFT);
    expect(blank.ok).toBe(false);
    if (!blank.ok) expect(blank.errors.title).toMatch(/what's wrong/);
    const long = validateBugDraft({
      ...EMPTY_BUG_DRAFT,
      title: "x".repeat(TOOL_TEXT_MAX.short + 1),
      steps: "y".repeat(TOOL_TEXT_MAX.text + 1),
    });
    expect(long.ok).toBe(false);
    if (!long.ok) expect(Object.keys(long.errors).sort()).toEqual(["steps", "title"]);
    const ok = validateBugDraft({
      ...EMPTY_BUG_DRAFT,
      title: "  The \n receipt  ",
      area: " Checkout ",
      expected: "   ",
    });
    expect(ok).toEqual({ ok: true, values: { title: "The receipt", area: "Checkout" } });
  });
});

describe("next steps", () => {
  const steps = (bugs: BugReport[], stories: Story[] = [], interrupts: InterruptItem[] = []) =>
    bugTriageSteps({ bugs, stories, interrupts }, TODAY);

  it("has none for an empty or example-only list", () => {
    expect(steps([])).toEqual([]);
    expect(steps([bug({ id: "example-1", createdAt: daysAgo(9) })])).toEqual([]);
    expect(bugTriageSteps({ bugs: undefined, stories: [], interrupts: undefined }, TODAY)).toEqual(
      []
    );
  });

  it("asks to triage new bugs waiting more than two days", () => {
    expect(steps([bug({ createdAt: daysAgo(2) })])).toEqual([]);
    const out = steps([bug({ createdAt: daysAgo(3) }), bug({ id: "b2", createdAt: daysAgo(5) })]);
    expect(out[0]).toMatchObject({
      id: "bug-triage-new",
      label: "Triage 2 new bugs",
      detail: "The oldest has waited 5 days.",
      href: "/bug-triage",
    });
  });

  it("asks what happens to an open critical bug that went nowhere, linking to it", () => {
    const out = steps([placed({ id: "crit", severity: "critical", priority: "later" })]);
    expect(out).toEqual([
      expect.objectContaining({
        id: "bug-triage-critical",
        label: "Decide what happens to “Checkout fails”",
        href: "/bug-triage?bug=crit",
      }),
    ]);
    const sent = placed({
      severity: "critical",
      priority: "now",
      sentTo: [{ route: "interrupt", targetId: "i1", at: NOW }],
    });
    expect(
      steps([sent], [], [{ id: "i1", title: "x", kind: "bug", emergency: true, loggedAt: NOW }])
    ).toEqual([]);
  });

  it("asks to close bugs whose work is done", () => {
    const sent = placed({ sentTo: [{ route: "backlog-story", targetId: "s1", at: NOW }] });
    expect(steps([sent], [{ id: "s1", title: "Fix", status: "done" }])).toEqual([
      expect.objectContaining({ id: "bug-triage-fixed", label: "Close 1 fixed bug" }),
    ]);
    expect(steps([sent], [{ id: "s1", title: "Fix", status: "review" }])).toEqual([]);
  });
});
