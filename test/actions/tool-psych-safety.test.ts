/**
 * tool.psych_safety.* coverage (singleton doc, S4 — Team Health & Maturity).
 *
 *   1. registration — list_state read; log_round/remove_round write, and the
 *      deprecated log_response/remove_response still registered.
 *   2. log_round + list_state + remove_round — counts round-trip.
 *   3. teamScore — reversed-adjusted Edmondson math (q1/q3/q5 reversed),
 *      results only from 5 responses.
 *   4. remove_round refuses an unknown id.
 *   5. anomaly — a statement falling by more than 0.5 between the latest two
 *      rounds (each from 5 responses), not halves of every answer ever given.
 *   6. the server handlers read and write the singleton under its kind.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverGetEntity: vi.fn(async () => null),
    serverUpsertEntity: vi.fn(async () => {}),
    serverListEntities: vi.fn(async () => []),
  };
});

import { registry } from "@/lib/actions/registry";
import * as serverStore from "@/lib/actions/server-store";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

import "@/lib/actions/tools/psych-safety";

const PS_ID = "psychSafety:current"; // PSYCH_SAFETY_ID

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

/** Every statement answered `point` (1-5) by `n` people. */
function counts(n: number, point: number): Record<string, number[]> {
  const row = [0, 0, 0, 0, 0];
  row[point - 1] = n;
  return Object.fromEntries(["q1", "q2", "q3", "q4", "q5", "q6", "q7"].map((q) => [q, [...row]]));
}

type State = {
  rounds: { id: string; teamScore: number | null; responses: number }[];
  teamScore: number | null;
  lowestQuestionId: string | null;
  delta: number | null;
  anomaly: boolean;
  totalResponses: number;
};

const list = async () =>
  (await registry.get("tool.psych_safety.list_state")!.handler({}, ctx())) as State;
const logRound = async (params: Record<string, unknown>) =>
  (await registry.get("tool.psych_safety.log_round")!.handler(params, ctx())) as {
    added: boolean;
    id: string;
  };

describe("tool.psych_safety — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.psych_safety.list_state")?.category).toBe("read");
    for (const verb of ["log_round", "remove_round", "log_response", "remove_response"]) {
      expect(registry.get(`tool.psych_safety.${verb}`)?.category).toBe("write");
      expect(registry.get(`tool.psych_safety.${verb}`)?.mcpHandler).toBeTypeOf("function");
      expect(registry.get(`tool.psych_safety.${verb}`)?.requiresConfirmation).toBe(false);
    }
  });
});

describe("tool.psych_safety lifecycle", () => {
  beforeEach(() => useWorkspaceStore.setState({ psychSafetyLogs: [], sprints: [] }));

  it("logs rounds, summarises them, and removes by id", async () => {
    const a = await logRound({ name: "September", date: "2026-09-15", counts: counts(5, 4) });
    const b = await logRound({ name: "October", date: "2026-10-15", counts: counts(6, 4) });
    expect(a.added && b.added).toBe(true);
    const r = await list();
    expect(r.rounds.map((x) => x.responses)).toEqual([5, 6]);
    expect(r.totalResponses).toBe(11);

    const removed = (await registry
      .get("tool.psych_safety.remove_round")!
      .handler({ id: a.id }, ctx())) as { removed: boolean };
    expect(removed.removed).toBe(true);
    expect((await list()).rounds.map((x) => x.id)).toEqual([b.id]);
  });

  it("computes the reversed-adjusted teamScore + lowest question, from 5 responses", async () => {
    // All 4s: reversed q1/q3/q5 score 2, the others 4 => (2*3 + 4*4) / 7.
    await logRound({ name: "R", date: "2026-10-01", counts: counts(5, 4) });
    const r = await list();
    expect(r.teamScore).toBeCloseTo(3.14, 2);
    expect(["q1", "q3", "q5"]).toContain(r.lowestQuestionId);
    // Fewer than 5 people: refused, nothing saved.
    expect(await logRound({ name: "Thin", counts: counts(4, 4) })).toMatchObject({ added: false });
    expect((await list()).rounds).toHaveLength(1);
  });

  it("refuses to remove an unknown round", async () => {
    const r = (await registry
      .get("tool.psych_safety.remove_round")!
      .handler({ id: "nope" }, ctx())) as { removed: boolean };
    expect(r.removed).toBe(false);
  });

  it("flags a statement falling by more than 0.5 between the latest two rounds", async () => {
    // Spring: everyone strongly agrees (5); now: everyone neutral (3).
    await logRound({ name: "Spring", date: "2026-04-01", counts: counts(5, 5) });
    await logRound({ name: "Now", date: "2026-10-01", counts: counts(5, 3) });
    const r = await list();
    expect(r.anomaly).toBe(true);
    expect(r.delta).not.toBeNull();
  });

  it("does not flag when the latest two rounds hold steady", async () => {
    await logRound({ name: "A", date: "2026-09-01", counts: counts(5, 4) });
    await logRound({ name: "B", date: "2026-10-01", counts: counts(7, 4) });
    const r = await list();
    expect(r.anomaly).toBe(false);
    expect(r.delta).toBeCloseTo(0, 5);
  });

  it("reads an older per-response list as one legacy round", async () => {
    const scores = { q1: 2, q2: 4, q3: 2, q4: 4, q5: 2, q6: 4, q7: 4 };
    useWorkspaceStore.setState({
      psychSafetyLogs: [
        {
          id: PS_ID,
          responses: [1, 2, 3, 4, 5].map((i) => ({
            id: `r${i}`,
            ts: `2026-09-0${i}T10:00:00.000Z`,
            scores,
            respondent: `Person ${i}`,
          })),
        },
      ],
    });
    const r = await list();
    expect(r.rounds).toHaveLength(1);
    expect(r.teamScore).toBe(4);
    expect(JSON.stringify(r)).not.toContain("Person");
  });
});

describe("tool.psych_safety on the server", () => {
  it("writes the singleton under workspace:psychSafety", async () => {
    const upsert = vi.mocked(serverStore.serverUpsertEntity);
    upsert.mockClear();
    const r = (await registry.get("tool.psych_safety.log_round")!.mcpHandler!(
      { name: "R", date: "2026-10-01", counts: counts(5, 4) },
      ctx()
    )) as {
      added: boolean;
    };
    expect(r.added).toBe(true);
    expect(upsert).toHaveBeenCalledWith(
      "u",
      "workspace:psychSafety",
      expect.objectContaining({ id: PS_ID, responses: [] })
    );
  });
});
