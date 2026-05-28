/**
 * tool.a11y_tracker.* coverage (singleton doc, S9).
 *
 *   1. registration — list_state read; add_issue/set_status write + mcpHandler
 *      + no confirm.
 *   2. add_issue + list_state — bySeverity/byStatus/byComponent/openCount.
 *   3. set_status — stamps resolvedAt on "resolved"; unknown → {updated:false}.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { A11yTracker } from "@/lib/stores/workspace-types";

import "@/lib/actions/tools/a11y-tracker";

const AT_ID = "a11yTracker:current";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

describe("tool.a11y_tracker — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.a11y_tracker.list_state")?.category).toBe("read");
    for (const verb of ["add_issue", "set_status"]) {
      expect(registry.get(`tool.a11y_tracker.${verb}`)?.category).toBe("write");
      expect(registry.get(`tool.a11y_tracker.${verb}`)?.mcpHandler).toBeTypeOf("function");
      expect(registry.get(`tool.a11y_tracker.${verb}`)?.requiresConfirmation).toBe(false);
    }
  });
});

describe("tool.a11y_tracker.add_issue + list_state", () => {
  beforeEach(() => useWorkspaceStore.setState({ a11yTrackers: [] }));

  it("appends with default status 'open' and openedAt", async () => {
    const r = (await registry
      .get("tool.a11y_tracker.add_issue")!
      .handler({ component: "Button", wcagCriterion: "1.4.3", severity: "serious" }, ctx())) as {
      added: boolean;
      id: string;
    };
    expect(r.added).toBe(true);
    const docs = useWorkspaceStore.getState().a11yTrackers ?? [];
    expect(docs).toHaveLength(1);
    expect(docs[0].id).toBe(AT_ID);
    expect(docs[0].issues[0].status).toBe("open");
    expect(docs[0].issues[0].openedAt).toBeTruthy();
  });

  it("breaks down by severity/status/component and counts open", async () => {
    await registry
      .get("tool.a11y_tracker.add_issue")!
      .handler({ component: "Button", wcagCriterion: "1.4.3", severity: "critical" }, ctx());
    await registry
      .get("tool.a11y_tracker.add_issue")!
      .handler(
        { component: "Button", wcagCriterion: "2.1.1", severity: "minor", status: "resolved" },
        ctx()
      );

    const r = (await registry.get("tool.a11y_tracker.list_state")!.handler({}, ctx())) as {
      total: number;
      bySeverity: Record<string, number>;
      byStatus: Record<string, number>;
      byComponent: Record<string, number>;
      openCount: number;
    };
    expect(r.total).toBe(2);
    expect(r.bySeverity.critical).toBe(1);
    expect(r.byStatus.resolved).toBe(1);
    expect(r.byComponent.Button).toBe(2);
    expect(r.openCount).toBe(1); // the resolved one doesn't count
  });
});

describe("tool.a11y_tracker.set_status", () => {
  beforeEach(() =>
    useWorkspaceStore.setState({
      a11yTrackers: [
        {
          id: AT_ID,
          issues: [
            {
              id: "i1",
              component: "Nav",
              wcagCriterion: "2.4.1",
              severity: "serious",
              status: "open",
              openedAt: "2026-01-01",
            },
          ],
        } as A11yTracker,
      ],
    })
  );

  it("stamps resolvedAt when set to 'resolved'", async () => {
    const r = (await registry
      .get("tool.a11y_tracker.set_status")!
      .handler({ issueId: "i1", status: "resolved" }, ctx())) as { updated: boolean };
    expect(r.updated).toBe(true);
    const i = (useWorkspaceStore.getState().a11yTrackers ?? [])[0].issues[0];
    expect(i.status).toBe("resolved");
    expect(i.resolvedAt).toBeTruthy();
  });

  it("returns updated:false for an unknown issue id", async () => {
    const r = (await registry
      .get("tool.a11y_tracker.set_status")!
      .handler({ issueId: "nope", status: "in_progress" }, ctx())) as { updated: boolean };
    expect(r.updated).toBe(false);
  });
});
