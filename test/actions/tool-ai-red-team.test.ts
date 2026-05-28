/**
 * tool.ai_red_team.* coverage.
 *
 *   1. registration — list_state/compute read; log_finding/mark_resolved
 *      write + mcpHandler + no confirm.
 *   2. list_state — bySeverity, open/resolved, successful count + rate,
 *      dueForRetest (past due-date on an open finding).
 *   3. compute_exposure — only open AND successful findings, severity-weighted.
 *   4. log_finding — appends with auto id + default loggedAt.
 *   5. mark_resolved — stamps resolvedAt + mitigation; {updated:false} on
 *      unknown id.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { RedTeamFinding } from "@/lib/stores/workspace-types";

import "@/lib/actions/tools/ai-red-team";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

function finding(
  p: Partial<RedTeamFinding> &
    Pick<RedTeamFinding, "id" | "attackVector" | "successful" | "severity">
): RedTeamFinding {
  return { loggedAt: "2026-01-01T00:00:00.000Z", ...p };
}

describe("tool.ai_red_team — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.ai_red_team.list_state")?.category).toBe("read");
    expect(registry.get("tool.ai_red_team.compute_exposure")?.category).toBe("read");
    expect(registry.get("tool.ai_red_team.log_finding")?.category).toBe("write");
    expect(registry.get("tool.ai_red_team.log_finding")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.ai_red_team.log_finding")?.requiresConfirmation).toBe(false);
    expect(registry.get("tool.ai_red_team.mark_resolved")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.ai_red_team.mark_resolved")?.requiresConfirmation).toBe(false);
    // compute_exposure is pure — no mcpHandler.
    expect(registry.get("tool.ai_red_team.compute_exposure")?.mcpHandler).toBeUndefined();
  });
});

describe("tool.ai_red_team.list_state", () => {
  beforeEach(() => useWorkspaceStore.setState({ redTeamFindings: [] }));

  it("is zeroed when empty", async () => {
    const r = (await registry.get("tool.ai_red_team.list_state")!.handler({}, ctx())) as {
      total: number;
      successRate: number;
      openCount: number;
    };
    expect(r.total).toBe(0);
    expect(r.successRate).toBe(0);
    expect(r.openCount).toBe(0);
  });

  it("breaks down severity, open/resolved, success rate, and retest-due", async () => {
    const u = useWorkspaceStore.getState().upsertRedTeamFinding;
    u(
      finding({
        id: "f1",
        attackVector: "prompt injection",
        successful: true,
        severity: "critical",
      })
    );
    u(finding({ id: "f2", attackVector: "jailbreak", successful: false, severity: "low" }));
    // resolved + successful — counts toward successful but NOT open/retest-due
    u(
      finding({
        id: "f3",
        attackVector: "data exfil",
        successful: true,
        severity: "high",
        resolvedAt: "2026-02-01T00:00:00.000Z",
      })
    );
    // open with a past retest date → due for retest
    u(
      finding({
        id: "f4",
        attackVector: "role play",
        successful: false,
        severity: "medium",
        retestDueAt: "2020-01-01T00:00:00.000Z",
      })
    );

    const r = (await registry.get("tool.ai_red_team.list_state")!.handler({}, ctx())) as {
      total: number;
      bySeverity: Record<string, number>;
      openCount: number;
      resolvedCount: number;
      successfulCount: number;
      successRate: number;
      dueForRetestCount: number;
    };
    expect(r.total).toBe(4);
    expect(r.bySeverity.critical).toBe(1);
    expect(r.bySeverity.high).toBe(1);
    expect(r.openCount).toBe(3); // f1, f2, f4
    expect(r.resolvedCount).toBe(1); // f3
    expect(r.successfulCount).toBe(2); // f1, f3
    expect(r.successRate).toBe(0.5); // 2 / 4
    expect(r.dueForRetestCount).toBe(1); // f4 only (f3 resolved)
  });
});

describe("tool.ai_red_team.compute_exposure", () => {
  it("counts only open AND successful, weighted by severity", async () => {
    const r = (await registry.get("tool.ai_red_team.compute_exposure")!.handler(
      {
        items: [
          { severity: "critical", successful: true }, // +15
          { severity: "high", successful: true, resolvedAt: "2026-01-01" }, // resolved → 0
          { severity: "high", successful: false }, // defended → 0
          { severity: "medium", successful: true }, // +3
        ],
      },
      ctx()
    )) as { exposureScore: number };
    expect(r.exposureScore).toBe(18);
  });

  it("is zero for an empty batch", async () => {
    const r = (await registry
      .get("tool.ai_red_team.compute_exposure")!
      .handler({ items: [] }, ctx())) as { exposureScore: number };
    expect(r.exposureScore).toBe(0);
  });
});

describe("tool.ai_red_team.log_finding", () => {
  beforeEach(() => useWorkspaceStore.setState({ redTeamFindings: [] }));

  it("appends a finding with auto id + default loggedAt", async () => {
    const r = (await registry
      .get("tool.ai_red_team.log_finding")!
      .handler(
        { attackVector: "prompt injection", successful: true, severity: "high" },
        ctx()
      )) as { added: boolean; id: string };
    expect(r.added).toBe(true);
    const stored = useWorkspaceStore.getState().redTeamFindings ?? [];
    expect(stored).toHaveLength(1);
    expect(stored[0].attackVector).toBe("prompt injection");
    expect(stored[0].loggedAt).toBeTruthy();
  });
});

describe("tool.ai_red_team.mark_resolved", () => {
  beforeEach(() =>
    useWorkspaceStore.setState({
      redTeamFindings: [
        finding({ id: "f1", attackVector: "prompt injection", successful: true, severity: "high" }),
      ],
    })
  );

  it("stamps resolvedAt + mitigation", async () => {
    const r = (await registry
      .get("tool.ai_red_team.mark_resolved")!
      .handler({ id: "f1", mitigation: "added output filter" }, ctx())) as { updated: boolean };
    expect(r.updated).toBe(true);
    const stored = (useWorkspaceStore.getState().redTeamFindings ?? [])[0];
    expect(stored.resolvedAt).toBeTruthy();
    expect(stored.mitigation).toBe("added output filter");
  });

  it("returns updated:false for an unknown id", async () => {
    const r = (await registry
      .get("tool.ai_red_team.mark_resolved")!
      .handler({ id: "nope", mitigation: "x" }, ctx())) as { updated: boolean };
    expect(r.updated).toBe(false);
  });
});
