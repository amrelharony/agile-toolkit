/**
 * tool.psych_safety.* coverage (singleton doc, S4 — Team Health & Maturity).
 *
 *   1. registration — list_state read; log_response/remove_response write.
 *   2. log_response x2 + list_state + remove_response — counts round-trip.
 *   3. teamScore — reversed-adjusted Edmondson math (q1/q3/q5 reversed).
 *   4. remove_response refuses an unknown id.
 *   5. anomaly — >0.5 drop between prior/recent halves (needs >= 4 responses).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PsychSafetyResponse } from "@/lib/stores/workspace-types";

import "@/lib/actions/tools/psych-safety";

const PS_ID = "psychSafety:current"; // MUST match PS_ID in psych-safety.ts.

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

/** All-equal score object for the 7 Edmondson questions. */
function scores(v: number): Record<string, number> {
  return { q1: v, q2: v, q3: v, q4: v, q5: v, q6: v, q7: v };
}

function seed(responses: PsychSafetyResponse[]) {
  useWorkspaceStore.setState({ psychSafetyLogs: [{ id: PS_ID, responses }] });
}

describe("tool.psych_safety — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.psych_safety.list_state")?.category).toBe("read");
    for (const verb of ["log_response", "remove_response"]) {
      expect(registry.get(`tool.psych_safety.${verb}`)?.category).toBe("write");
      expect(registry.get(`tool.psych_safety.${verb}`)?.mcpHandler).toBeTypeOf("function");
      expect(registry.get(`tool.psych_safety.${verb}`)?.requiresConfirmation).toBe(false);
    }
  });
});

describe("tool.psych_safety lifecycle", () => {
  beforeEach(() => useWorkspaceStore.setState({ psychSafetyLogs: [] }));

  it("logs responses, summarises counts, and removes by id", async () => {
    const a = (await registry
      .get("tool.psych_safety.log_response")!
      .handler({ scores: scores(4), respondent: "P1" }, ctx())) as {
      added: boolean;
      id: string;
    };
    expect(a.added).toBe(true);
    await registry.get("tool.psych_safety.log_response")!.handler({ scores: scores(3) }, ctx());

    const r1 = (await registry.get("tool.psych_safety.list_state")!.handler({}, ctx())) as {
      exists: boolean;
      totalResponses: number;
    };
    expect(r1.exists).toBe(true);
    expect(r1.totalResponses).toBe(2);

    const rm = (await registry
      .get("tool.psych_safety.remove_response")!
      .handler({ id: a.id }, ctx())) as { removed: boolean };
    expect(rm.removed).toBe(true);

    const r2 = (await registry.get("tool.psych_safety.list_state")!.handler({}, ctx())) as {
      totalResponses: number;
    };
    expect(r2.totalResponses).toBe(1);
  });

  it("computes reversed-adjusted teamScore + lowest question", async () => {
    // All raw = 5. q1/q3/q5 are reversed (6-5=1); q2/q4/q6/q7 stay 5.
    // reversed-adjusted = [1,5,1,5,1,5,5] -> mean 23/7.
    await registry.get("tool.psych_safety.log_response")!.handler({ scores: scores(5) }, ctx());
    const r = (await registry.get("tool.psych_safety.list_state")!.handler({}, ctx())) as {
      teamScore: number;
      benchmark: number;
      lowestQuestionId?: string;
    };
    expect(r.teamScore).toBeCloseTo(23 / 7, 5);
    expect(r.benchmark).toBe(4);
    expect(r.lowestQuestionId).toBe("q1"); // ties resolve to the first reversed q
  });

  it("remove_response refuses an unknown id", async () => {
    await registry.get("tool.psych_safety.log_response")!.handler({ scores: scores(3) }, ctx());
    const r = (await registry
      .get("tool.psych_safety.remove_response")!
      .handler({ id: "ghost" }, ctx())) as { removed: boolean };
    expect(r.removed).toBe(false);
  });

  it("flags a >0.5 drop between prior and recent halves", async () => {
    // Prior half (earliest ts) all-5 -> 23/7 ~= 3.29; recent half all-1 -> 19/7 ~= 2.71.
    seed([
      { id: "r1", ts: "2026-01-01T00:00:00.000Z", scores: scores(5) },
      { id: "r2", ts: "2026-01-02T00:00:00.000Z", scores: scores(5) },
      { id: "r3", ts: "2026-01-03T00:00:00.000Z", scores: scores(1) },
      { id: "r4", ts: "2026-01-04T00:00:00.000Z", scores: scores(1) },
    ]);
    const r = (await registry.get("tool.psych_safety.list_state")!.handler({}, ctx())) as {
      anomaly: boolean;
      delta?: number;
    };
    expect(r.anomaly).toBe(true);
    expect(r.delta).toBeCloseTo(19 / 7 - 23 / 7, 5);
  });
});
