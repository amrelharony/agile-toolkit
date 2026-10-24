/**
 * tool.release_readiness.* coverage (singleton doc, S8).
 *
 *   1. registration — list_state read; every write verb a write with an mcpHandler.
 *   2. add_release — needs a name and a planned day; starts in planning, 9 gates open.
 *   3. toggle_gate — flips a gate; unknown release/gate, shipped release and
 *      a deciding auto gate → {updated:false, reason}.
 *   4. ship_release — dated (backdatable, never the future), freezes gates;
 *      a second ship is refused.
 *   5. set_status — rolled_back only from shipped, with its day; reopening
 *      keeps the ship; remove_release.
 *   6. update_release and set_gates (left-out gates archived; custom gates toggle).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { RELEASE_GATE_IDS, type ReleaseReadiness } from "@/lib/stores/workspace-types";
import { RELEASE_DOC_ID } from "@/lib/releases/gates";
import { releaseStats } from "@/lib/releases/model";
import { addDays } from "@/lib/flow/days";
import { todayIso } from "@/lib/sprints/series";

import "@/lib/actions/tools/release-readiness";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

const TODAY = todayIso();
const on = (n: number) => addDays(TODAY, n) as string;

const run = <T>(verb: string, params: Record<string, unknown>) =>
  registry.get(`tool.release_readiness.${verb}`)!.handler(params, ctx()) as Promise<T>;

const add = (name: string, plannedDate = on(7)) =>
  run<{ added: boolean; id: string; reason?: string }>("add_release", { name, plannedDate });

type Listed = {
  exists: boolean;
  total: number;
  byStatus: Record<string, number>;
  gates: { id: string; label: string }[];
  archivedGates: { id: string }[];
  stats: ReturnType<typeof releaseStats>;
  releases: {
    id: string;
    status: string;
    shippedDate?: string;
    rolledBackAt?: string;
    gatesPassed: number;
    gatesTotal: number;
    allGatesPassed: boolean;
    gatesOpenAtShip?: number;
    gates: { id: string; passed: boolean; locked: boolean }[];
    previousShips: { shippedDate: string; rolledBackAt?: string }[];
  }[];
};
const list = () => run<Listed>("list_state", {});
const doc = () =>
  (useWorkspaceStore.getState().releaseReadinesses ?? []).find(
    (d) => d.id === RELEASE_DOC_ID
  ) as ReleaseReadiness;

describe("tool.release_readiness — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.release_readiness.list_state")?.category).toBe("read");
    for (const verb of [
      "add_release",
      "update_release",
      "toggle_gate",
      "ship_release",
      "set_status",
      "set_gates",
      "remove_release",
    ]) {
      expect(registry.get(`tool.release_readiness.${verb}`)?.category).toBe("write");
      expect(registry.get(`tool.release_readiness.${verb}`)?.mcpHandler).toBeTypeOf("function");
      expect(registry.get(`tool.release_readiness.${verb}`)?.requiresConfirmation).toBe(false);
    }
  });

  it("requires plannedDate as YYYY-MM-DD on add_release", () => {
    const schema = registry.get("tool.release_readiness.add_release")!.paramsSchema;
    expect(schema.safeParse({ name: "v1" }).success).toBe(false);
    expect(schema.safeParse({ name: "v1", plannedDate: "next week" }).success).toBe(false);
    expect(schema.safeParse({ name: "v1", plannedDate: "2026-02-30" }).success).toBe(false);
    expect(schema.safeParse({ name: "v1", plannedDate: "2026-11-05" }).success).toBe(true);
  });
});

describe("tool.release_readiness — gates, ship, status", () => {
  beforeEach(() =>
    useWorkspaceStore.setState({ releaseReadinesses: [], featureFlags: [], retroBoards: [] })
  );

  it("adds a release with all gates open, toggles, and ships with a snapshot", async () => {
    expect(await run("add_release", { name: "v0" })).toMatchObject({
      added: false,
      reason: "plannedDate is required, as YYYY-MM-DD.",
    });
    const a = await add("v2.0");
    expect(a.added).toBe(true);

    let r = await list();
    expect(r.exists).toBe(true);
    expect(r.total).toBe(1);
    expect(r.byStatus.planning).toBe(1);
    const rel = r.releases[0];
    expect(rel.gatesTotal).toBe(9);
    expect(rel.gatesPassed).toBe(0);
    expect(rel.allGatesPassed).toBe(false);

    // toggle one gate on
    const tg = await run<{ updated: boolean }>("toggle_gate", {
      releaseId: a.id,
      gate: "a11y_audit",
      passed: true,
    });
    expect(tg.updated).toBe(true);
    r = await list();
    expect(r.releases[0].gatesPassed).toBe(1);

    // unknown release / unknown gate → not updated
    expect(
      (
        await run<{ updated: boolean }>("toggle_gate", {
          releaseId: "nope",
          gate: "a11y_audit",
          passed: true,
        })
      ).updated
    ).toBe(false);
    expect(
      (
        await run<{ updated: boolean }>("toggle_gate", {
          releaseId: a.id,
          gate: "not_a_gate",
          passed: true,
        })
      ).updated
    ).toBe(false);

    // ship with 8 gates still open, backdated
    const shipped = await run<{ shipped: boolean; gatesOpenAtShip: number; shippedDate: string }>(
      "ship_release",
      { releaseId: a.id, shippedDate: on(-1) }
    );
    expect(shipped).toMatchObject({ shipped: true, gatesOpenAtShip: 8, shippedDate: on(-1) });
    r = await list();
    expect(r.releases[0]).toMatchObject({
      status: "shipped",
      gatesOpenAtShip: 8,
      shippedDate: on(-1),
    });
    expect(doc().releases[0].gateIds).toEqual(RELEASE_GATE_IDS);

    expect((await run<{ shipped: boolean }>("ship_release", { releaseId: "nope" })).shipped).toBe(
      false
    );
    // Shipped already: refused, and the ship day isn't re-stamped.
    expect(await run("ship_release", { releaseId: a.id })).toMatchObject({
      shipped: false,
      reason: "It has shipped already.",
    });
    expect(doc().releases[0].shippedDate).toBe(on(-1));
    // Its gates are frozen.
    expect(
      await run("toggle_gate", { releaseId: a.id, gate: "sre_review", passed: true })
    ).toMatchObject({ updated: false });

    // roll back on a day, then reopen for planning
    expect(
      await run("set_status", { releaseId: a.id, status: "rolled_back", rolledBackAt: on(-2) })
    ).toMatchObject({ updated: false, reason: "It can't be rolled back before it shipped." });
    const rb = await run<{ updated: boolean }>("set_status", {
      releaseId: a.id,
      status: "rolled_back",
    });
    expect(rb.updated).toBe(true);
    r = await list();
    expect(r.releases[0]).toMatchObject({ status: "rolled_back", rolledBackAt: TODAY });
    expect(r.stats).toMatchObject({ shipped: 1, rolledBack: 1 });

    expect(
      (await run<{ updated: boolean }>("set_status", { releaseId: a.id, status: "planning" }))
        .updated
    ).toBe(true);
    r = await list();
    expect(r.releases[0].status).toBe("planning");
    expect(r.releases[0].previousShips).toEqual([
      expect.objectContaining({ shippedDate: on(-1), rolledBackAt: TODAY }),
    ]);
    // The earlier ship still counts.
    expect(r.stats).toMatchObject({ shipped: 1, rolledBack: 1 });

    // remove
    const rm = await run<{ removed: boolean }>("remove_release", { releaseId: a.id });
    expect(rm.removed).toBe(true);
    r = await list();
    expect(r.total).toBe(0);
  });

  it("refuses a future ship day and a rollback from planning", async () => {
    const a = await add("v3");
    expect(await run("ship_release", { releaseId: a.id, shippedDate: on(1) })).toMatchObject({
      shipped: false,
      reason: "It can't ship in the future.",
    });
    expect(await run("set_status", { releaseId: a.id, status: "rolled_back" })).toMatchObject({
      updated: false,
      reason: "Only a shipped release can be rolled back.",
    });
    expect(await run("set_status", { releaseId: a.id, status: "planning" })).toMatchObject({
      updated: false,
    });
  });

  it("refuses to tick an auto gate its check decides, and lets it be ticked when the check can't tell", async () => {
    const a = await add("v4");
    expect(
      (
        await run<{ updated: boolean }>("toggle_gate", {
          releaseId: a.id,
          gate: "feature_flag_ready",
          passed: true,
        })
      ).updated
    ).toBe(true);
    useWorkspaceStore.setState({
      featureFlags: [
        {
          id: "f",
          name: "checkout_v2",
          status: "on",
          purpose: "rollout",
          createdAt: on(-3),
          releaseId: a.id,
        },
      ],
    });
    const refused = await run<{ updated: boolean; reason: string }>("toggle_gate", {
      releaseId: a.id,
      gate: "feature_flag_ready",
      passed: true,
    });
    expect(refused.updated).toBe(false);
    expect(refused.reason).toMatch(
      /checked automatically \(checkout_v2 has no owner and no removal date\)/
    );
    const r = await list();
    expect(r.releases[0].gates.find((g) => g.id === "feature_flag_ready")).toMatchObject({
      passed: false,
      locked: true,
    });
  });

  it("edits a release in place", async () => {
    const a = await add("v5");
    expect(
      await run("update_release", {
        releaseId: a.id,
        name: "v5.1",
        plannedDate: on(-3),
        description: "Hotfix",
      })
    ).toEqual({ updated: true });
    expect(doc().releases[0]).toMatchObject({
      id: a.id,
      name: "v5.1",
      plannedDate: on(-3),
      description: "Hotfix",
    });
    await run("update_release", { releaseId: a.id, description: "" });
    expect(doc().releases[0].description).toBeUndefined();
    expect(await run("update_release", { releaseId: "nope", name: "x" })).toMatchObject({
      updated: false,
    });
  });

  it("sets the team's gates, archiving the ones left out, and toggles a custom one", async () => {
    const a = await add("v6");
    const set = await run<{
      updated: boolean;
      gates: { id: string }[];
      archivedGates: { id: string }[];
    }>("set_gates", {
      gates: [
        { id: "rollback_tested", label: "Rollback tested" },
        { label: "Smoke test in staging" },
        { id: "dod_met", label: "Definition of Done met", auto: "dod" },
      ],
    });
    expect(set.updated).toBe(true);
    expect(set.gates.map((g) => g.id)).toEqual([
      "rollback_tested",
      "smoke_test_in_staging",
      "dod_met",
    ]);
    expect(set.archivedGates).toHaveLength(8);
    expect(
      (
        await run<{ updated: boolean }>("toggle_gate", {
          releaseId: a.id,
          gate: "smoke_test_in_staging",
          passed: true,
        })
      ).updated
    ).toBe(true);
    // An archived gate is no longer one of a planning release's gates.
    expect(
      (
        await run<{ updated: boolean }>("toggle_gate", {
          releaseId: a.id,
          gate: "sre_review",
          passed: true,
        })
      ).updated
    ).toBe(false);
    const r = await list();
    expect(r.releases[0]).toMatchObject({ gatesTotal: 3, gatesPassed: 1 });
    expect(await run("set_gates", { gates: [{ label: "Same" }, { label: "same" }] })).toMatchObject(
      { updated: false }
    );
  });

  it("reports the stats releaseStats computes for the same document", async () => {
    const a = await add("A", on(-5));
    const b = await add("B", on(-5));
    const c = await add("C", on(-5));
    await run("ship_release", { releaseId: a.id, shippedDate: on(-6) });
    await run("ship_release", { releaseId: b.id, shippedDate: on(-4) });
    await run("ship_release", { releaseId: c.id, shippedDate: on(-5) });
    await run("set_status", { releaseId: b.id, status: "rolled_back", rolledBackAt: on(-3) });
    const r = await list();
    const stats = releaseStats(doc());
    expect(r.stats).toMatchObject({
      shipped: stats.shipped,
      onTime: stats.onTime,
      pct: stats.pct,
      rolledBack: stats.rolledBack,
      avgGatesOpen: stats.avgGatesOpen,
    });
    expect(stats).toMatchObject({ shipped: 3, onTime: 2, rolledBack: 1 });
  });
});
