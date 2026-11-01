/**
 * tool.risk_register.* action coverage (squad S5, Wave 2).
 *
 * Risk register is a CRUD-backed tool with one pure compute helper —
 * the test shape combines the calc-tool pattern (pure formula assertions
 * for compute_risk_score) and the decision-CRUD pattern (lifecycle +
 * summary assertions for the rest). Covered:
 *
 *   1. all 4 actions registered with the right category split
 *   2. write actions all expose an mcpHandler (server-side path)
 *   3. compute_risk_score returns the documented score AND level for
 *      each band boundary (low / medium / high / critical), and is
 *      mcpHandler-less (pure compute identical server and client)
 *   4. list_state returns initialised buckets when empty AND
 *      aggregates byStatus + byLevel + topRisks across mixed seeds
 *   5. set_status updates an existing risk, no-ops on same status,
 *      returns {updated:false, reason:"not-found"} for unknown ids,
 *      gates "closed" and "accepted" behind ctx.confirm, and stamps
 *      resolvedAt on the closed transition
 *   6. set_mitigation writes the plan + auto-transitions open →
 *      mitigating (but NOT from other statuses), persists the optional
 *      mitigationDueAt only when provided, and returns {transitioned}
 *      so the agent can detect the status flip
 *
 * The registry is a process-wide singleton; we import the side-effect
 * registration module once and don't unregister, matching production's
 * one-time module load.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Risk } from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";

// Side-effect import — registers the actions on the singleton.
import "@/lib/actions/tools/risk-register";

const EXPECTED_ACTIONS = [
  "tool.risk_register.compute_risk_score",
  "tool.risk_register.list_state",
  "tool.risk_register.set_status",
  "tool.risk_register.set_mitigation",
] as const;

function ctx() {
  // Lightweight context for handler tests. Browser-path handlers don't
  // touch ctx.userId at all, but we supply a value so the type is happy.
  return {
    userId: "test-user",
    source: "agent" as const,
    squadProfileIds: [] as string[],
  };
}

/** Seed factory — a minimally-valid Risk with sensible defaults the
 *  tests can override per-case. `raisedAt` is in ISO yyyy-mm-dd form to
 *  match what the in-app emptyRisk() emits. */
function seed(overrides: Partial<Risk> = {}): Risk {
  return {
    id: overrides.id ?? "risk_seed",
    title: overrides.title ?? "Vendor API rate-limit risk",
    probability: overrides.probability ?? 3,
    impact: overrides.impact ?? 3,
    mitigation: overrides.mitigation,
    mitigationDueAt: overrides.mitigationDueAt,
    status: overrides.status ?? "open",
    raisedAt: overrides.raisedAt ?? "2026-01-15",
    resolvedAt: overrides.resolvedAt,
  };
}

describe("tool.risk_register — registration", () => {
  it("registers all 4 expected actions", () => {
    for (const id of EXPECTED_ACTIONS) {
      const a = registry.get(id);
      expect(a, `missing action: ${id}`).toBeDefined();
    }
  });

  it("compute_risk_score and list_state are category=read; mutators are category=write", () => {
    expect(registry.get("tool.risk_register.compute_risk_score")?.category).toBe("read");
    expect(registry.get("tool.risk_register.list_state")?.category).toBe("read");
    expect(registry.get("tool.risk_register.set_status")?.category).toBe("write");
    expect(registry.get("tool.risk_register.set_mitigation")?.category).toBe("write");
  });

  it("write actions all have an mcpHandler (server-side path)", () => {
    expect(registry.get("tool.risk_register.set_status")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.risk_register.set_mitigation")?.mcpHandler).toBeTypeOf("function");
  });

  it("list_state has an mcpHandler too (server-side read path)", () => {
    expect(registry.get("tool.risk_register.list_state")?.mcpHandler).toBeTypeOf("function");
  });

  it("compute_risk_score is pure — no mcpHandler needed (server == client)", () => {
    // Pure compute runs identically on either runtime; omitting the
    // mcpHandler is intentional. If this assertion ever fails, either
    // the helper grew a side effect (bad) or someone added a redundant
    // mcpHandler (drift risk — remove it).
    expect(registry.get("tool.risk_register.compute_risk_score")?.mcpHandler).toBeUndefined();
  });

  it("set_status is not statically confirmation-gated (in-handler confirm only)", () => {
    // The dynamic confirm gate fires only on closed/accepted transitions
    // (see file header rationale); the static flag stays false so the
    // agent UI doesn't gate the routine open ↔ mitigating moves.
    expect(registry.get("tool.risk_register.set_status")?.requiresConfirmation).toBe(false);
  });

  it("set_mitigation is not confirmation-gated (additive, easy to undo)", () => {
    expect(registry.get("tool.risk_register.set_mitigation")?.requiresConfirmation).toBe(false);
  });
});

describe("tool.risk_register.compute_risk_score — pure formula", () => {
  const action = () => registry.get("tool.risk_register.compute_risk_score")!;

  it("computes probability × impact", async () => {
    const result = (await action().handler({ probability: 4, impact: 3 }, ctx())) as {
      score: number;
      level: string;
    };
    expect(result.score).toBe(12);
  });

  it("classifies score < 5 as 'low'", async () => {
    // 1×1=1, 2×2=4 — both below the 5 threshold.
    const r1 = (await action().handler({ probability: 1, impact: 1 }, ctx())) as {
      score: number;
      level: string;
    };
    expect(r1).toMatchObject({ score: 1, level: "low" });
    const r2 = (await action().handler({ probability: 2, impact: 2 }, ctx())) as {
      score: number;
      level: string;
    };
    expect(r2).toMatchObject({ score: 4, level: "low" });
  });

  it("classifies 5 ≤ score < 10 as 'medium'", async () => {
    // 5×1=5 sits exactly on the lower boundary; 3×3=9 sits at the
    // upper edge — both must be 'medium' (≥5 is the >= boundary).
    const r1 = (await action().handler({ probability: 5, impact: 1 }, ctx())) as {
      score: number;
      level: string;
    };
    expect(r1).toMatchObject({ score: 5, level: "medium" });
    const r2 = (await action().handler({ probability: 3, impact: 3 }, ctx())) as {
      score: number;
      level: string;
    };
    expect(r2).toMatchObject({ score: 9, level: "medium" });
  });

  it("classifies 10 ≤ score < 16 as 'high'", async () => {
    // 5×2=10 lower boundary; 5×3=15 upper edge.
    const r1 = (await action().handler({ probability: 5, impact: 2 }, ctx())) as {
      score: number;
      level: string;
    };
    expect(r1).toMatchObject({ score: 10, level: "high" });
    const r2 = (await action().handler({ probability: 5, impact: 3 }, ctx())) as {
      score: number;
      level: string;
    };
    expect(r2).toMatchObject({ score: 15, level: "high" });
  });

  it("classifies score ≥ 16 as 'critical'", async () => {
    // 4×4=16 lower boundary; 5×5=25 max possible.
    const r1 = (await action().handler({ probability: 4, impact: 4 }, ctx())) as {
      score: number;
      level: string;
    };
    expect(r1).toMatchObject({ score: 16, level: "critical" });
    const r2 = (await action().handler({ probability: 5, impact: 5 }, ctx())) as {
      score: number;
      level: string;
    };
    expect(r2).toMatchObject({ score: 25, level: "critical" });
  });

  it("rejects out-of-range probability/impact at the schema boundary", () => {
    // 6 is above the closed [1,5] band the Risk type defines. The Zod
    // schema must reject before the handler runs so the agent sees a
    // clear error instead of a silently-clamped score.
    const a = action();
    expect(() => a.paramsSchema.parse({ probability: 6, impact: 3 })).toThrow();
    expect(() => a.paramsSchema.parse({ probability: 0, impact: 3 })).toThrow();
    expect(() => a.paramsSchema.parse({ probability: 3, impact: 1.5 })).toThrow();
  });
});

describe("tool.risk_register.list_state — summary + topRisks", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ risks: [] });
  });

  it("returns zeroed buckets and empty arrays when the workspace is empty", async () => {
    const action = registry.get("tool.risk_register.list_state");
    const result = (await action!.handler({}, ctx())) as {
      total: number;
      byStatus: Record<Risk["status"], number>;
      byLevel: Record<string, number>;
      topRisks: Array<Risk & { score: number; level: string }>;
      items: Risk[];
    };
    expect(result.total).toBe(0);
    expect(result.items).toEqual([]);
    expect(result.topRisks).toEqual([]);
    // Every status/level bucket initialised — agent can index without
    // existence checks even on an empty workspace.
    expect(result.byStatus).toEqual({
      open: 0,
      mitigating: 0,
      closed: 0,
      accepted: 0,
    });
    expect(result.byLevel).toEqual({
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    });
  });

  it("aggregates byStatus across all four lifecycle states", async () => {
    const seeds: Risk[] = [
      seed({ id: "r1", status: "open" }),
      seed({ id: "r2", status: "open" }),
      seed({ id: "r3", status: "mitigating" }),
      seed({ id: "r4", status: "closed", resolvedAt: "2026-02-01" }),
      seed({ id: "r5", status: "accepted" }),
    ];
    for (const s of seeds) useWorkspaceStore.getState().upsertRisk(s);

    const action = registry.get("tool.risk_register.list_state");
    const result = (await action!.handler({}, ctx())) as {
      total: number;
      byStatus: Record<Risk["status"], number>;
    };
    expect(result.total).toBe(5);
    expect(result.byStatus).toEqual({
      open: 2,
      mitigating: 1,
      closed: 1,
      accepted: 1,
    });
  });

  it("aggregates byLevel across all four score bands", async () => {
    const seeds: Risk[] = [
      seed({ id: "r1", probability: 1, impact: 1 }), // score 1 → low
      seed({ id: "r2", probability: 2, impact: 2 }), // score 4 → low
      seed({ id: "r3", probability: 3, impact: 3 }), // score 9 → medium
      seed({ id: "r4", probability: 5, impact: 2 }), // score 10 → high
      seed({ id: "r5", probability: 5, impact: 3 }), // score 15 → high
      seed({ id: "r6", probability: 4, impact: 4 }), // score 16 → critical
      seed({ id: "r7", probability: 5, impact: 5 }), // score 25 → critical
    ];
    for (const s of seeds) useWorkspaceStore.getState().upsertRisk(s);

    const action = registry.get("tool.risk_register.list_state");
    const result = (await action!.handler({}, ctx())) as {
      byLevel: Record<string, number>;
    };
    expect(result.byLevel).toEqual({
      low: 2,
      medium: 1,
      high: 2,
      critical: 2,
    });
  });

  it("returns topRisks sorted descending by score, capped at 10", async () => {
    // Seed 12 risks so the cap is observable. Use a mix of scores so
    // we can verify the sort order (highest first).
    const seeds: Risk[] = Array.from({ length: 12 }, (_, i) =>
      // i=0..11 → score 1..12 by varying impact while probability fixed.
      // Cap at 5 per axis since the Risk literal union forbids >5.
      seed({
        id: `r${i + 1}`,
        probability: ((i % 5) + 1) as Risk["probability"],
        impact: ((i % 5) + 1) as Risk["impact"],
      })
    );
    for (const s of seeds) useWorkspaceStore.getState().upsertRisk(s);

    const action = registry.get("tool.risk_register.list_state");
    const result = (await action!.handler({}, ctx())) as {
      topRisks: Array<{ score: number }>;
    };
    expect(result.topRisks.length).toBeLessThanOrEqual(10);
    expect(result.topRisks.length).toBe(10);
    // Descending order: each successor ≤ predecessor.
    for (let i = 1; i < result.topRisks.length; i++) {
      expect(result.topRisks[i].score).toBeLessThanOrEqual(result.topRisks[i - 1].score);
    }
  });

  it("attaches score + level to each topRisks entry", async () => {
    useWorkspaceStore.getState().upsertRisk(seed({ id: "r1", probability: 4, impact: 4 }));

    const action = registry.get("tool.risk_register.list_state");
    const result = (await action!.handler({}, ctx())) as {
      topRisks: Array<{ id: string; score: number; level: string }>;
    };
    expect(result.topRisks).toHaveLength(1);
    expect(result.topRisks[0]).toMatchObject({ id: "r1", score: 16, level: "critical" });
  });
});

describe("tool.risk_register.set_status — lifecycle + terminal-state confirm", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      risks: [seed({ id: "r1", title: "DB failover risk", status: "open" })],
    });
  });

  it("transitions open → mitigating without prompting", async () => {
    const action = registry.get("tool.risk_register.set_status");
    let confirmCalls = 0;
    const result = (await action!.handler(
      { id: "r1", status: "mitigating" },
      {
        ...ctx(),
        confirm: async () => {
          confirmCalls++;
          return true;
        },
      }
    )) as { updated: boolean };
    expect(confirmCalls).toBe(0); // not a terminal transition
    expect(result.updated).toBe(true);
    expect((useWorkspaceStore.getState().risks ?? [])[0].status).toBe("mitigating");
  });

  it("returns updated=false (no-op) when status is unchanged", async () => {
    const action = registry.get("tool.risk_register.set_status");
    const result = (await action!.handler({ id: "r1", status: "open" }, ctx())) as {
      updated: boolean;
      reason?: string;
    };
    expect(result.updated).toBe(false);
    expect(result.reason).toBe("already-in-status");
  });

  it("returns updated=false with reason='not-found' for an unknown id", async () => {
    const action = registry.get("tool.risk_register.set_status");
    const result = (await action!.handler({ id: "nonexistent", status: "mitigating" }, ctx())) as {
      updated: boolean;
      reason?: string;
    };
    expect(result.updated).toBe(false);
    expect(result.reason).toBe("not-found");
  });

  it("prompts via ctx.confirm and proceeds on approval when transitioning to 'closed'", async () => {
    const action = registry.get("tool.risk_register.set_status");
    let confirmCalls = 0;
    const result = (await action!.handler(
      { id: "r1", status: "closed" },
      {
        ...ctx(),
        confirm: async (summary) => {
          confirmCalls++;
          // Summary should mention the title for human-readable approval.
          expect(summary).toMatch(/DB failover risk/);
          return true;
        },
      }
    )) as { updated: boolean };
    expect(confirmCalls).toBe(1);
    expect(result.updated).toBe(true);
    expect((useWorkspaceStore.getState().risks ?? [])[0].status).toBe("closed");
  });

  it("declines to transition to 'closed' when ctx.confirm denies", async () => {
    const action = registry.get("tool.risk_register.set_status");
    const result = (await action!.handler(
      { id: "r1", status: "closed" },
      { ...ctx(), confirm: async () => false }
    )) as { updated: boolean; reason?: string };
    expect(result.updated).toBe(false);
    expect(result.reason).toBe("declined");
    // Status must NOT have flipped.
    expect((useWorkspaceStore.getState().risks ?? [])[0].status).toBe("open");
  });

  it("prompts via ctx.confirm when transitioning to 'accepted'", async () => {
    const action = registry.get("tool.risk_register.set_status");
    let confirmCalls = 0;
    const result = (await action!.handler(
      { id: "r1", status: "accepted" },
      {
        ...ctx(),
        confirm: async () => {
          confirmCalls++;
          return true;
        },
      }
    )) as { updated: boolean };
    expect(confirmCalls).toBe(1);
    expect(result.updated).toBe(true);
    expect((useWorkspaceStore.getState().risks ?? [])[0].status).toBe("accepted");
  });

  it("stamps resolvedAt (yyyy-mm-dd) on the 'closed' transition when missing", async () => {
    const action = registry.get("tool.risk_register.set_status");
    await action!.handler({ id: "r1", status: "closed" }, { ...ctx(), confirm: async () => true });
    const stored = (useWorkspaceStore.getState().risks ?? [])[0];
    expect(stored.resolvedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // Phase 8: a reopen keeps resolvedAt (it counts only while closed), so a
  // re-close stamps the day it closed again rather than the first close's.
  it("re-closing a reopened risk stamps the new close day over the old one", async () => {
    useWorkspaceStore.setState({
      risks: [seed({ id: "r1", status: "open", resolvedAt: "2025-12-01" })],
    });
    const action = registry.get("tool.risk_register.set_status");
    await action!.handler({ id: "r1", status: "closed" }, { ...ctx(), confirm: async () => true });
    const stored = (useWorkspaceStore.getState().risks ?? [])[0];
    expect(stored.resolvedAt).toBe(todayLocalISO());
  });

  it("does NOT stamp resolvedAt on a non-'closed' terminal transition (accepted)", async () => {
    const action = registry.get("tool.risk_register.set_status");
    await action!.handler(
      { id: "r1", status: "accepted" },
      { ...ctx(), confirm: async () => true }
    );
    const stored = (useWorkspaceStore.getState().risks ?? [])[0];
    expect(stored.resolvedAt).toBeUndefined();
  });

  it("proceeds without prompting when ctx.confirm is absent (MCP-style call)", async () => {
    // The MCP path supplies no confirm; the handler must not throw or
    // block. The browser-path handler uses the same logic but here we
    // simulate the MCP shape by omitting confirm from ctx.
    const action = registry.get("tool.risk_register.set_status");
    const result = (await action!.handler(
      { id: "r1", status: "closed" },
      ctx() // no confirm
    )) as { updated: boolean };
    expect(result.updated).toBe(true);
    expect((useWorkspaceStore.getState().risks ?? [])[0].status).toBe("closed");
  });
});

describe("tool.risk_register.set_mitigation — plan + auto-transition", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      risks: [seed({ id: "r1", status: "open" })],
    });
  });

  it("writes the mitigation plan and auto-transitions open → mitigating", async () => {
    const action = registry.get("tool.risk_register.set_mitigation");
    const result = (await action!.handler(
      { id: "r1", mitigation: "Negotiate higher rate-limit tier with vendor" },
      ctx()
    )) as { updated: boolean; transitioned: boolean };
    expect(result.updated).toBe(true);
    expect(result.transitioned).toBe(true);
    const stored = (useWorkspaceStore.getState().risks ?? [])[0];
    expect(stored.mitigation).toBe("Negotiate higher rate-limit tier with vendor");
    expect(stored.status).toBe("mitigating");
  });

  it("does NOT transition when the risk is already 'mitigating'", async () => {
    useWorkspaceStore.setState({
      risks: [seed({ id: "r1", status: "mitigating" })],
    });
    const action = registry.get("tool.risk_register.set_mitigation");
    const result = (await action!.handler({ id: "r1", mitigation: "Updated plan" }, ctx())) as {
      updated: boolean;
      transitioned: boolean;
    };
    expect(result.updated).toBe(true);
    expect(result.transitioned).toBe(false);
    expect((useWorkspaceStore.getState().risks ?? [])[0].status).toBe("mitigating");
  });

  it("does NOT silently reopen a 'closed' risk that gets a new mitigation note", async () => {
    useWorkspaceStore.setState({
      risks: [seed({ id: "r1", status: "closed", resolvedAt: "2026-02-01" })],
    });
    const action = registry.get("tool.risk_register.set_mitigation");
    const result = (await action!.handler(
      { id: "r1", mitigation: "Post-mortem follow-up" },
      ctx()
    )) as { updated: boolean; transitioned: boolean };
    expect(result.updated).toBe(true);
    expect(result.transitioned).toBe(false);
    // Status must stay "closed" — set_mitigation should never quietly
    // resurrect a resolved risk.
    expect((useWorkspaceStore.getState().risks ?? [])[0].status).toBe("closed");
  });

  it("persists the optional mitigationDueAt when provided", async () => {
    const action = registry.get("tool.risk_register.set_mitigation");
    await action!.handler(
      { id: "r1", mitigation: "Mitigate before Q2", mitigationDueAt: "2026-06-30" },
      ctx()
    );
    const stored = (useWorkspaceStore.getState().risks ?? [])[0];
    expect(stored.mitigationDueAt).toBe("2026-06-30");
  });

  it("rejects a mitigationDueAt that isn't ISO yyyy-mm-dd at the schema boundary", () => {
    const action = registry.get("tool.risk_register.set_mitigation");
    expect(() =>
      action!.paramsSchema.parse({
        id: "r1",
        mitigation: "ok",
        mitigationDueAt: "not-a-date",
      })
    ).toThrow();
    expect(() =>
      action!.paramsSchema.parse({
        id: "r1",
        mitigation: "ok",
        mitigationDueAt: "06/30/2026",
      })
    ).toThrow();
  });

  it("returns updated=false for an unknown id (idempotent precheck-free)", async () => {
    const action = registry.get("tool.risk_register.set_mitigation");
    const result = (await action!.handler({ id: "nonexistent", mitigation: "Plan" }, ctx())) as {
      updated: boolean;
      transitioned: boolean;
    };
    expect(result.updated).toBe(false);
    expect(result.transitioned).toBe(false);
  });
});
