/**
 * The "bug" route (targets/bug.ts) on its own: the bug a send logs (the
 * first line as a one-line title, the description as what happened, the
 * area and who raised it, each cut to its cap, new and stamped with the time
 * given), its id and where it opens, Undo removing it, and done once closed.
 * Test Sessions' and Notes to Actions' sends go through it.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { BUG_ID_PREFIX } from "@/lib/bug-triage/model";
import { bugHref, bugRoute, buildBugReport, newBugId } from "@/lib/handoffs/targets/bug";
import { sendHandoff } from "@/lib/handoffs/send";
import type { HandoffLink, HandoffSource } from "@/lib/handoffs/types";
import { noteToBug } from "@/lib/test-sessions/model";

const NOW = "2026-11-20T10:00:00.000Z";

const src = (over: Partial<HandoffSource> = {}): HandoffSource => ({
  title: "Refund button does nothing",
  sourceRef: { tool: "test-sessions", id: "n1", doc: "tsess_1" },
  ...over,
});

const ws = () => useWorkspaceStore.getState();
const bugs = () => ws().bugReports ?? [];

function linkStore() {
  let links: HandoffLink[] = [];
  return {
    get links() {
      return links;
    },
    getLinks: () => links,
    setLinks: (update: (l: readonly HandoffLink[] | undefined) => HandoffLink[]) => {
      links = update(links);
    },
  };
}

beforeEach(() => {
  useWorkspaceStore.setState({ bugReports: [] });
});

describe("the bug a send logs", () => {
  it("takes the first line with words as the title, on one line", () => {
    const bug = buildBugReport(
      src({ title: "\n \n  Refund\tbutton   fails \n on Android" }),
      "bug_1",
      NOW
    );
    expect(bug).toEqual({
      id: "bug_1",
      title: "Refund button fails",
      status: "new",
      sourceRef: { tool: "test-sessions", id: "n1", doc: "tsess_1" },
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it("keeps what happened, the area and who raised it, trimmed and cut to their caps", () => {
    const bug = buildBugReport(
      src({
        description: `  ${"d".repeat(1100)}  `,
        area: ` ${"a".repeat(250)} `,
        raisedBy: " Priya ",
      }),
      "bug_1",
      NOW
    );
    expect(bug.actual).toHaveLength(1000);
    expect(bug.area).toHaveLength(200);
    expect(bug.reportedBy).toBe("Priya");
    const bare = buildBugReport(src({ description: "  ", area: "", raisedBy: " " }), "bug_2", NOW);
    expect(bare).not.toHaveProperty("actual");
    expect(bare).not.toHaveProperty("area");
    expect(bare).not.toHaveProperty("reportedBy");
  });

  it("stores a test-session note whole as what happened", () => {
    const note = { id: "n9", text: "The list jumps\nto the top after picking one." };
    const bug = buildBugReport(
      noteToBug(note, { id: "tsess_9", tester: "Sam", area: "Checkout" }),
      "b",
      NOW
    );
    expect(bug).toMatchObject({
      title: "The list jumps",
      actual: "The list jumps\nto the top after picking one.",
      reportedBy: "Sam",
      area: "Checkout",
      sourceRef: { tool: "test-sessions", id: "n9", doc: "tsess_9" },
    });
  });

  it("mints ids as the CRUD does and opens the bug in Bug Triage", () => {
    expect(newBugId()).toMatch(new RegExp(`^${BUG_ID_PREFIX}[\\w-]{8}$`));
    expect(bugHref("bug 1")).toBe("/bug-triage?bug=bug%201");
    expect(bugRoute.targetHref("bug_1")).toBe("/bug-triage?bug=bug_1");
    expect(bugRoute).toMatchObject({
      id: "bug",
      label: "Bug to triage",
      doneLabel: "Added to Bug Triage",
      targetToolId: "bug-triage",
    });
  });
});

describe("the route", () => {
  it("sends, is there until Undo removes it, and is done once closed", () => {
    const store = linkStore();
    const link = sendHandoff("bug", src(), store)!;
    expect(bugs()).toHaveLength(1);
    expect(bugRoute.exists(link.targetId)).toBe(true);
    expect(bugRoute.isDone?.(link.targetId)).toBe(false);
    ws().upsertBugReport({ ...bugs()[0], status: "triaged" });
    expect(bugRoute.isDone?.(link.targetId)).toBe(false);
    ws().upsertBugReport({ ...bugs()[0], status: "closed", closeReason: "fixed" });
    expect(bugRoute.isDone?.(link.targetId)).toBe(true);
    // A second send of the same item while its bug is there is refused.
    expect(sendHandoff("bug", src(), store)).toBeNull();
    bugRoute.remove(link.targetId);
    expect(bugRoute.exists(link.targetId)).toBe(false);
    expect(() => bugRoute.remove("nope")).not.toThrow();
    // Once the bug is gone it can be sent again.
    expect(sendHandoff("bug", src(), store)).not.toBeNull();
  });

  it("never takes a blank title", () => {
    expect(sendHandoff("bug", src({ title: "   " }), linkStore())).toBeNull();
    expect(bugs()).toEqual([]);
  });
});
