/**
 * tool.dora_scorecard.* coverage (singleton doc).
 *
 *   1. registration — list_state and derive_sample read; add, update,
 *      remove write, each with an mcpHandler.
 *   2. add_sample + list_state — averages, latest by quarter, bands cited.
 *   3. add_sample's checks — quarter format, duplicates, quarters not started.
 *   4. update_sample / remove_sample — in place, checked, returned to add back.
 *   5. derive_sample — releases, the boards and incidents; examples left out.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { KANBAN_BOARD_ID, type DoraSample } from "@/lib/stores/workspace-types";
import { currentQuarterIndex, dashQuarter } from "@/lib/roadmap/quarters";

import "@/lib/actions/tools/dora-scorecard";

const DS_ID = "doraScorecard:current";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

const run = (id: string, params: unknown = {}) => registry.get(id)!.handler(params, ctx());

const sample = (quarter: string, deployFreqPerWeek: number, extra: Partial<DoraSample> = {}) => ({
  quarter,
  deployFreqPerWeek,
  leadTimeHours: 4,
  changeFailRate: 0.1,
  mttrHours: 2,
  ...extra,
});

const samples = () =>
  (useWorkspaceStore.getState().doraScorecards ?? []).find((d) => d.id === DS_ID)?.samples ?? [];

describe("tool.dora_scorecard — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.dora_scorecard.list_state")?.category).toBe("read");
    expect(registry.get("tool.dora_scorecard.derive_sample")?.category).toBe("read");
    for (const name of ["add_sample", "update_sample", "remove_sample"]) {
      const a = registry.get(`tool.dora_scorecard.${name}`);
      expect(a?.category, name).toBe("write");
      expect(a?.mcpHandler, name).toBeTypeOf("function");
      expect(a?.requiresConfirmation, name).toBe(false);
    }
  });
});

describe("tool.dora_scorecard.add_sample + list_state", () => {
  beforeEach(() => useWorkspaceStore.setState({ doraScorecards: [] }));

  it("is empty before any write", async () => {
    const r = (await run("tool.dora_scorecard.list_state")) as {
      exists: boolean;
      total: number;
      latest: unknown;
      averages: Record<string, number | null>;
      verdict: string;
    };
    expect(r.exists).toBe(false);
    expect(r.total).toBe(0);
    expect(r.latest).toBeNull();
    expect(r.averages.deployFreqPerWeek).toBeNull(); // not 0
    expect(r.verdict).toBe("No quarters logged yet.");
  });

  it("appends samples, averages the 4 keys and reads the latest by quarter", async () => {
    await run("tool.dora_scorecard.add_sample", sample("2026-Q2", 20, { leadTimeHours: 6 }));
    await run("tool.dora_scorecard.add_sample", sample("2026-Q1", 10, { leadTimeHours: 4 }));

    const docs = useWorkspaceStore.getState().doraScorecards ?? [];
    expect(docs[0].id).toBe(DS_ID);

    const r = (await run("tool.dora_scorecard.list_state")) as {
      total: number;
      latest: { quarter: string };
      averages: { deployFreqPerWeek: number; leadTimeHours: number };
      samples: { quarter: string }[];
      bands: Record<string, string | null>;
      bandsSource: { report: string; year: number };
    };
    expect(r.total).toBe(2);
    // The latest QUARTER, though 2026-Q1 was added last (the page's reading).
    expect(r.latest.quarter).toBe("2026-Q2");
    expect(r.samples.map((s) => s.quarter)).toEqual(["2026-Q1", "2026-Q2"]);
    expect(r.averages.deployFreqPerWeek).toBe(15); // (10+20)/2
    expect(r.averages.leadTimeHours).toBe(5); // (4+6)/2
    expect(r.bands).toEqual({
      deployFreqPerWeek: "Elite",
      leadTimeHours: "Elite",
      changeFailRate: "High",
      mttrHours: "High",
    });
    expect(r.bandsSource).toMatchObject({
      report: "Accelerate State of DevOps Report",
      year: 2023,
    });
  });

  it("refuses a malformed quarter, a duplicate and a quarter that hasn't started", async () => {
    const bad = registry
      .get("tool.dora_scorecard.add_sample")!
      .paramsSchema.safeParse(sample("Q1 2026", 1));
    expect(bad.success).toBe(false);
    expect(
      registry.get("tool.dora_scorecard.add_sample")!.paramsSchema.safeParse(sample("2026-Q10", 1))
        .success
    ).toBe(false);

    const first = (await run("tool.dora_scorecard.add_sample", sample("2026-Q1", 3))) as {
      id: string;
    };
    const dup = (await run("tool.dora_scorecard.add_sample", sample("2026-Q1", 9))) as {
      added: boolean;
      reason: string;
      id: string;
    };
    expect(dup).toMatchObject({ added: false, reason: "duplicate", id: first.id });

    const future = dashQuarter(currentQuarterIndex() + 1);
    const later = (await run("tool.dora_scorecard.add_sample", sample(future, 3))) as {
      added: boolean;
      reason: string;
    };
    expect(later).toMatchObject({ added: false, reason: "not_started" });
    expect(samples()).toHaveLength(1);
  });

  it("leaves example rows out of the summary", async () => {
    useWorkspaceStore.setState({
      doraScorecards: [
        {
          id: DS_ID,
          samples: [
            { id: "example-1", ...sample("2026-Q3", 50) },
            { id: "s1", ...sample("2026-Q1", 2) },
          ],
        },
      ],
    });
    const r = (await run("tool.dora_scorecard.list_state")) as {
      total: number;
      latest: { id: string };
      examplesLeftOut: number;
    };
    expect(r.total).toBe(1);
    expect(r.latest.id).toBe("s1");
    expect(r.examplesLeftOut).toBe(1);
  });
});

describe("tool.dora_scorecard.update_sample + remove_sample", () => {
  beforeEach(() =>
    useWorkspaceStore.setState({
      doraScorecards: [
        {
          id: DS_ID,
          samples: [
            { id: "a", ...sample("2026-Q1", 2), description: "Old" },
            { id: "b", ...sample("2026-Q2", 3) },
          ],
        },
      ],
    })
  );

  it("edits in place, keeps the id and stamps updatedAt", async () => {
    const r = (await run("tool.dora_scorecard.update_sample", {
      id: "a",
      patch: { mttrHours: 1.5, description: null },
    })) as { updated: boolean; sample: DoraSample };
    expect(r.updated).toBe(true);
    expect(samples()[0]).toMatchObject({ id: "a", quarter: "2026-Q1", mttrHours: 1.5 });
    expect(samples()[0].description).toBeUndefined();
    expect(samples()[0].updatedAt).toBeTruthy();
  });

  it("checks the patch: another sample's quarter is refused, nothing changes", async () => {
    const r = (await run("tool.dora_scorecard.update_sample", {
      id: "a",
      patch: { quarter: "2026-Q2" },
    })) as { updated: boolean; reason: string; errors: Record<string, string> };
    expect(r).toMatchObject({ updated: false, reason: "invalid" });
    expect(r.errors.quarter).toMatch(/already has a sample/);
    expect(samples()[0].quarter).toBe("2026-Q1");
    expect(
      (
        (await run("tool.dora_scorecard.update_sample", { id: "zz", patch: {} })) as {
          reason: string;
        }
      ).reason
    ).toBe("not_found");
  });

  it("removes a sample and returns it to add back", async () => {
    const r = (await run("tool.dora_scorecard.remove_sample", { id: "b" })) as {
      removed: boolean;
      sample: DoraSample;
    };
    expect(r).toMatchObject({ removed: true, sample: { id: "b", quarter: "2026-Q2" } });
    expect(samples().map((s) => s.id)).toEqual(["a"]);
    expect(await run("tool.dora_scorecard.remove_sample", { id: "b" })).toEqual({
      removed: false,
    });
  });
});

describe("tool.dora_scorecard.derive_sample", () => {
  beforeEach(() =>
    useWorkspaceStore.setState({
      doraScorecards: [],
      releaseReadinesses: [
        {
          id: "releaseReadiness:current",
          releases: [
            {
              id: "r1",
              name: "1.0",
              plannedDate: "2026-01-10",
              status: "shipped",
              shippedDate: "2026-01-10",
              gates: {},
            },
            {
              id: "r2",
              name: "1.1",
              plannedDate: "2026-02-10",
              status: "rolled_back",
              shippedDate: "2026-02-12",
              gates: {},
            },
            {
              id: "example-r",
              name: "Ex",
              plannedDate: "2026-02-10",
              status: "shipped",
              shippedDate: "2026-02-11",
              gates: {},
            },
          ],
        },
      ],
      stories: [
        {
          id: "s1",
          title: "A",
          status: "done",
          startedAt: "2026-01-05T10:00:00",
          doneAt: "2026-01-08T10:00:00",
        },
        {
          id: "s2",
          title: "B",
          status: "done",
          startedAt: "2026-01-06T10:00:00",
          doneAt: "2026-01-09T10:00:00",
        },
        {
          id: "s3",
          title: "C",
          status: "done",
          startedAt: "2026-02-01T10:00:00",
          doneAt: "2026-02-10T10:00:00",
        },
      ],
      kanbanBoards: [
        {
          id: KANBAN_BOARD_ID,
          cards: [],
          wipLimits: { backlog: 9, ready: 9, in_progress: 9, review: 9, done: 99 },
        },
      ],
      incidentCommanders: [
        {
          id: "incidentCommander:current",
          incidents: [
            {
              id: "i1",
              title: "Down",
              severity: "sev1",
              status: "resolved",
              openedAt: "2026-02-12T10:00:00",
              resolvedAt: "2026-02-12T13:00:00",
              timeline: [],
            },
          ],
        },
      ],
    })
  );

  it("works the quarter out from releases, the boards and incidents, and writes nothing", async () => {
    const r = (await run("tool.dora_scorecard.derive_sample", { quarter: "2026-Q1" })) as {
      derived: boolean;
      deployFreqPerWeek: number;
      changeFailRate: number;
      leadTimeHours: number;
      mttrHours: number;
      derivedFrom: Record<string, number>;
      logged: unknown;
    };
    expect(r.derived).toBe(true);
    // 2 ships (the example one left out) over the 13 weeks of Q1 (90 days).
    expect(r.deployFreqPerWeek).toBeCloseTo(2 / (90 / 7), 2);
    expect(r.changeFailRate).toBe(0.5);
    // s1, s2 ship on 01-10: 6 and 5 days; s3 on 02-12: 12 days. Median 6 days.
    expect(r.leadTimeHours).toBe(6 * 24);
    expect(r.mttrHours).toBe(3);
    expect(r.derivedFrom).toEqual({ releases: 2, rolledBack: 1, items: 3, incidents: 1 });
    expect(r.logged).toBeNull();
    expect(samples()).toEqual([]);
  });
});
