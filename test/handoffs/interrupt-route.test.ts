/**
 * The "interrupt" route (targets/interrupt.ts) on its own: the sprint it
 * logs into (the newest running one that isn't the example's), the
 * interrupt it builds (one-line title cut to its cap, the kind and
 * emergency a source gives or the title's kind, the size from points within
 * its bounds, stamped with the time given), problem() with no sprint or only
 * an example one, where it opens, and done once resolved. Bug Triage's
 * "fix now" goes through it.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint } from "@/lib/stores/workspace-types";
import { TOOL_TEXT_MAX } from "@/lib/stores/workspace-types";
import { INTERRUPT_SIZE_MAX } from "@/lib/sprints/interrupts";
import {
  NO_SPRINT_RUNNING,
  activeSprintOf,
  buildInterruptItem,
  interruptRoute,
} from "@/lib/handoffs/targets/interrupt";
import { sendHandoff } from "@/lib/handoffs/send";
import type { HandoffLink, HandoffSource } from "@/lib/handoffs/types";
import { bugSource } from "@/lib/bug-triage/model";

const NOW = "2026-11-20T10:00:00.000Z";

const sprint = (over: Partial<Sprint> = {}): Sprint => ({
  id: "sprint_1",
  name: "Sprint 1",
  startDate: "2026-11-16",
  endDate: "2026-11-27",
  pointsPlanned: 30,
  status: "active",
  ...over,
});

const src = (over: Partial<HandoffSource> = {}): HandoffSource => ({
  title: "Checkout is down",
  sourceRef: { tool: "bug-triage", id: "bug_1" },
  ...over,
});

const ws = () => useWorkspaceStore.getState();

function linkStore() {
  let links: HandoffLink[] = [];
  return {
    getLinks: () => links,
    setLinks: (update: (l: readonly HandoffLink[] | undefined) => HandoffLink[]) => {
      links = update(links);
    },
  };
}

beforeEach(() => {
  useWorkspaceStore.setState({ sprints: [], interruptItems: [] });
});

describe("the sprint it logs into", () => {
  it("is the newest running sprint that isn't the example's", () => {
    expect(activeSprintOf([])).toBeUndefined();
    expect(
      activeSprintOf([
        sprint({ id: "old", startDate: "2026-10-01" }),
        sprint({ id: "new", startDate: "2026-11-16" }),
        sprint({ id: "example-s", startDate: "2026-12-01" }),
        sprint({ id: "next", startDate: "2026-12-01", status: "planned" }),
      ])?.id
    ).toBe("new");
  });

  it("says no sprint is running with none, or only the example's, and skips the send", () => {
    expect(interruptRoute.problem?.(src())).toBe(NO_SPRINT_RUNNING);
    useWorkspaceStore.setState({ sprints: [sprint({ id: "example-s" })] });
    expect(interruptRoute.problem?.(src())).toBe(NO_SPRINT_RUNNING);
    expect(() => interruptRoute.send(src())).toThrow(NO_SPRINT_RUNNING);
    expect(sendHandoff("interrupt", src(), linkStore())).toBeNull();
    expect(ws().interruptItems).toEqual([]);
    useWorkspaceStore.setState({ sprints: [sprint()] });
    expect(interruptRoute.problem?.(src())).toBeNull();
  });
});

describe("the interrupt it builds", () => {
  it("puts the title on one line within its cap, stamped with the time given", () => {
    const item = buildInterruptItem(
      src({ title: `  Checkout\n is   down ${"x".repeat(TOOL_TEXT_MAX.text)}` }),
      "sprint_1",
      "interrupt_1",
      NOW
    );
    expect(item.title.startsWith("Checkout is down x")).toBe(true);
    expect(item.title).toHaveLength(TOOL_TEXT_MAX.text);
    expect(item).toMatchObject({
      id: "interrupt_1",
      sprintId: "sprint_1",
      loggedAt: NOW,
      emergency: false,
      sourceRef: { tool: "bug-triage", id: "bug_1" },
    });
    expect(item).not.toHaveProperty("resolvedAt");
  });

  it("keeps the size within its bounds, and none for a missing or broken one", () => {
    expect(buildInterruptItem(src({ points: -3 }), "s").size).toBe(0);
    expect(buildInterruptItem(src({ points: INTERRUPT_SIZE_MAX + 50 }), "s").size).toBe(
      INTERRUPT_SIZE_MAX
    );
    expect(buildInterruptItem(src({ points: Number.NaN }), "s")).not.toHaveProperty("size");
  });

  it("takes a bug from Bug Triage as a bug, an emergency when it is critical", () => {
    const base = {
      id: "bug_1",
      title: "Payments fail",
      status: "triaged" as const,
      priority: "now" as const,
      createdAt: NOW,
      updatedAt: NOW,
    };
    expect(buildInterruptItem(bugSource({ ...base, severity: "critical" }), "s")).toMatchObject({
      kind: "bug",
      emergency: true,
    });
    expect(buildInterruptItem(bugSource({ ...base, severity: "major" }), "s")).toMatchObject({
      kind: "bug",
      emergency: false,
    });
  });
});

describe("the route", () => {
  it("opens the interrupt's sprint, and is done once resolved; Undo removes it", () => {
    useWorkspaceStore.setState({ sprints: [sprint()] });
    const link = sendHandoff("interrupt", src(), linkStore())!;
    expect(interruptRoute.targetHref(link.targetId)).toBe("/interrupt-buffer?sprint=sprint_1");
    expect(interruptRoute.isDone?.(link.targetId)).toBe(false);
    const item = (ws().interruptItems ?? [])[0];
    ws().upsertInterruptItem({ ...item, resolvedAt: NOW });
    expect(interruptRoute.isDone?.(link.targetId)).toBe(true);
    interruptRoute.remove(link.targetId);
    expect(interruptRoute.exists(link.targetId)).toBe(false);
    expect(interruptRoute.targetHref(link.targetId)).toBe("/interrupt-buffer");
    expect(interruptRoute).toMatchObject({
      label: "Interrupt in this sprint",
      doneLabel: "Logged as an interrupt",
      targetToolId: "interrupt-buffer",
    });
  });
});
