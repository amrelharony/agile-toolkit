/**
 * Bug Triage's and Test Sessions' next steps through their lazy rules, as a
 * page asks for them (`loadNextStepRule`), from the workspace slices the
 * base's selects read: new bugs waiting, a critical bug that went nowhere,
 * bugs whose work is done; a done session's unsent bugs, a session left
 * running. The example's rows never make a step.
 */

import { describe, expect, it } from "vitest";
import { getNextStepRule, loadNextStepRule, type NextStep } from "@/lib/tools/next-steps";
import {
  emptyWorkspace,
  type BugReport,
  type TestSession,
  type Workspace,
} from "@/lib/stores/workspace-types";

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

const steps = async (toolId: string, ws: Partial<Workspace>): Promise<NextStep[]> => {
  await loadNextStepRule(toolId);
  const rule = getNextStepRule(toolId)!;
  return rule.steps(rule.select({ ...emptyWorkspace, ...ws } as Workspace));
};

const bug = (over: Partial<BugReport> = {}): BugReport => ({
  id: "bug_a",
  title: "Payments fail",
  status: "new",
  createdAt: ago(5),
  updatedAt: ago(5),
  ...over,
});

const session = (over: Partial<TestSession> = {}): TestSession => ({
  id: "tsess_a",
  charter: { target: "Saved addresses", toLearn: "x" },
  minutes: 60,
  status: "done",
  notes: [{ id: "n1", at: ago(1), kind: "bug", text: "The list jumps" }],
  createdAt: ago(2),
  updatedAt: ago(1),
  ...over,
});

describe("bug-triage", () => {
  it("has no step for an empty workspace", async () => {
    expect(await steps("bug-triage", {})).toEqual([]);
  });

  it("asks to triage new bugs waiting more than two days", async () => {
    expect(
      await steps("bug-triage", { bugReports: [bug(), bug({ id: "b2", createdAt: ago(1) })] })
    ).toEqual([
      expect.objectContaining({
        id: "bug-triage-new",
        label: "Triage 1 new bug",
        href: "/bug-triage",
      }),
    ]);
  });

  it("asks what happens to a critical bug that went nowhere, and to close bugs whose work is done", async () => {
    const out = await steps("bug-triage", {
      bugReports: [
        bug({
          id: "crit",
          status: "triaged",
          severity: "critical",
          priority: "now",
          createdAt: ago(0),
        }),
        bug({
          id: "done",
          status: "triaged",
          severity: "major",
          priority: "next",
          createdAt: ago(0),
          sentTo: [{ route: "backlog-story", targetId: "s1", at: ago(0) }],
        }),
      ],
      stories: [{ id: "s1", title: "Fix payments", status: "done" }],
    });
    expect(out.map((s) => s.id)).toEqual(["bug-triage-critical", "bug-triage-fixed"]);
    expect(out[0].href).toBe("/bug-triage?bug=crit");
  });

  it("reads a resolved interrupt as work done", async () => {
    const out = await steps("bug-triage", {
      bugReports: [
        bug({
          status: "triaged",
          severity: "critical",
          priority: "now",
          createdAt: ago(0),
          sentTo: [{ route: "interrupt", targetId: "i1", at: ago(0) }],
        }),
      ],
      interruptItems: [
        {
          id: "i1",
          title: "Payments fail",
          kind: "bug",
          emergency: true,
          loggedAt: ago(0),
          resolvedAt: ago(0),
        },
      ],
    });
    expect(out.map((s) => s.id)).toEqual(["bug-triage-fixed"]);
  });

  it("leaves the example out", async () => {
    expect(await steps("bug-triage", { bugReports: [bug({ id: "example-1" })] })).toEqual([]);
  });
});

describe("test-sessions", () => {
  it("has no step for an empty workspace", async () => {
    expect(await steps("test-sessions", {})).toEqual([]);
  });

  it("asks to log a done session's unsent bugs", async () => {
    expect(await steps("test-sessions", { testSessions: [session()] })).toEqual([
      expect.objectContaining({
        id: "test-sessions-bugs",
        label: "Log the bug from “Saved addresses”",
        href: "/test-sessions?session=tsess_a",
      }),
    ]);
  });

  it("asks to finish a session left running a day past its time", async () => {
    expect(
      await steps("test-sessions", {
        testSessions: [session({ status: "running", startedAt: ago(2), notes: [] })],
      })
    ).toEqual([expect.objectContaining({ id: "test-sessions-stuck" })]);
  });

  it("leaves the example out", async () => {
    expect(await steps("test-sessions", { testSessions: [session({ id: "example-1" })] })).toEqual(
      []
    );
  });
});
