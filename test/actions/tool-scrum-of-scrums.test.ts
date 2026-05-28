/**
 * tool.scrum_of_scrums.* action coverage.
 *
 * CRUD-backed ceremony tool (squad S3). SosEntry is a record-keeping
 * entity, so — like DACI — there's no pure formula to assert. We cover:
 *
 *   1. both actions registered with the right category split
 *   2. mark_resolved exposes an mcpHandler (server-side path)
 *   3. list_state returns initialised byKind/byStatus buckets even when
 *      empty AND aggregates across mixed seeds
 *   4. staleBlockers surfaces ONLY open blockers aged ≥3 days
 *   5. mark_resolved resolves an entry, is idempotent on an already-
 *      resolved row, and returns {updated:false} for an unknown id
 *
 * The registry is a process-wide singleton; we import the side-effect
 * registration module once and don't unregister.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { SosEntry } from "@/lib/stores/workspace-types";

// Side-effect import — registers the actions on the singleton.
import "@/lib/actions/tools/scrum-of-scrums";

const EXPECTED_ACTIONS = [
  "tool.scrum_of_scrums.list_state",
  "tool.scrum_of_scrums.mark_resolved",
] as const;

function ctx() {
  return {
    userId: "test-user",
    source: "agent" as const,
    squadProfileIds: [] as string[],
  };
}

/** Date string N whole days before today (UTC), YYYY-MM-DD. */
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

/** Build a fully-formed SosEntry. Required: id / meetingDate / team /
 *  kind / text / status / loggedAt. */
function seed(partial: Partial<SosEntry> & Pick<SosEntry, "id">): SosEntry {
  return {
    meetingDate: daysAgo(0),
    team: "Team A",
    kind: "update",
    text: "status update",
    status: "open",
    loggedAt: new Date().toISOString(),
    ...partial,
  };
}

describe("tool.scrum_of_scrums — registration", () => {
  it("registers both expected actions", () => {
    for (const id of EXPECTED_ACTIONS) {
      expect(registry.get(id), `missing action: ${id}`).toBeDefined();
    }
  });

  it("list_state is read; mark_resolved is write with an mcpHandler", () => {
    expect(registry.get("tool.scrum_of_scrums.list_state")?.category).toBe("read");
    expect(registry.get("tool.scrum_of_scrums.mark_resolved")?.category).toBe("write");
    expect(registry.get("tool.scrum_of_scrums.mark_resolved")?.mcpHandler).toBeTypeOf("function");
  });

  it("mark_resolved is requiresConfirmation=false (non-destructive)", () => {
    expect(registry.get("tool.scrum_of_scrums.mark_resolved")?.requiresConfirmation).toBe(false);
  });
});

describe("tool.scrum_of_scrums.list_state — summary", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ sosEntries: [] });
  });

  it("returns zeroed buckets and empty items when the workspace is empty", async () => {
    const action = registry.get("tool.scrum_of_scrums.list_state");
    const result = (await action!.handler({}, ctx())) as {
      total: number;
      byKind: Record<SosEntry["kind"], number>;
      byStatus: Record<SosEntry["status"], number>;
      staleBlockers: SosEntry[];
      items: SosEntry[];
    };
    expect(result.total).toBe(0);
    expect(result.items).toEqual([]);
    expect(result.staleBlockers).toEqual([]);
    expect(result.byKind).toEqual({ blocker: 0, dependency: 0, decision: 0, update: 0 });
    expect(result.byStatus).toEqual({ open: 0, resolved: 0 });
  });

  it("aggregates byKind / byStatus across mixed seeds", async () => {
    const seeds: SosEntry[] = [
      seed({ id: "s1", kind: "blocker", status: "open" }),
      seed({ id: "s2", kind: "blocker", status: "resolved" }),
      seed({ id: "s3", kind: "dependency", status: "open" }),
      seed({ id: "s4", kind: "decision", status: "open" }),
      seed({ id: "s5", kind: "update", status: "open" }),
    ];
    for (const s of seeds) useWorkspaceStore.getState().upsertSosEntry(s);

    const action = registry.get("tool.scrum_of_scrums.list_state");
    const result = (await action!.handler({}, ctx())) as {
      total: number;
      byKind: Record<SosEntry["kind"], number>;
      byStatus: Record<SosEntry["status"], number>;
    };
    expect(result.total).toBe(5);
    expect(result.byKind.blocker).toBe(2);
    expect(result.byKind.dependency).toBe(1);
    expect(result.byKind.decision).toBe(1);
    expect(result.byKind.update).toBe(1);
    expect(result.byStatus.open).toBe(4);
    expect(result.byStatus.resolved).toBe(1);
  });

  it("staleBlockers surfaces only OPEN blockers aged >= 3 days", async () => {
    useWorkspaceStore
      .getState()
      .upsertSosEntry(
        seed({ id: "stale", kind: "blocker", status: "open", meetingDate: daysAgo(5) })
      );
    // fresh open blocker (today) — not stale
    useWorkspaceStore
      .getState()
      .upsertSosEntry(
        seed({ id: "fresh", kind: "blocker", status: "open", meetingDate: daysAgo(0) })
      );
    // old but resolved — not stale
    useWorkspaceStore
      .getState()
      .upsertSosEntry(
        seed({ id: "done", kind: "blocker", status: "resolved", meetingDate: daysAgo(9) })
      );
    // old dependency (not a blocker) — not stale
    useWorkspaceStore
      .getState()
      .upsertSosEntry(
        seed({ id: "dep", kind: "dependency", status: "open", meetingDate: daysAgo(9) })
      );

    const action = registry.get("tool.scrum_of_scrums.list_state");
    const result = (await action!.handler({}, ctx())) as { staleBlockers: SosEntry[] };
    expect(result.staleBlockers.map((e) => e.id)).toEqual(["stale"]);
  });
});

describe("tool.scrum_of_scrums.mark_resolved", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ sosEntries: [] });
  });

  it("resolves an open entry, stamps resolvedAt, and returns {updated: true}", async () => {
    useWorkspaceStore
      .getState()
      .upsertSosEntry(seed({ id: "s1", kind: "blocker", status: "open" }));

    const action = registry.get("tool.scrum_of_scrums.mark_resolved");
    const result = (await action!.handler({ id: "s1" }, ctx())) as { updated: boolean };
    expect(result.updated).toBe(true);

    const stored = (useWorkspaceStore.getState().sosEntries ?? []).find((e) => e.id === "s1");
    expect(stored?.status).toBe("resolved");
    expect(stored?.resolvedAt).toBeTruthy();
  });

  it("honours an explicit resolvedAt", async () => {
    useWorkspaceStore.getState().upsertSosEntry(seed({ id: "s2", status: "open" }));

    const action = registry.get("tool.scrum_of_scrums.mark_resolved");
    await action!.handler({ id: "s2", resolvedAt: "2026-01-15" }, ctx());

    const stored = (useWorkspaceStore.getState().sosEntries ?? []).find((e) => e.id === "s2");
    expect(stored?.resolvedAt).toBe("2026-01-15");
  });

  it("is idempotent — re-resolving a resolved entry stays {updated: true} and no-ops", async () => {
    useWorkspaceStore
      .getState()
      .upsertSosEntry(seed({ id: "s3", status: "resolved", resolvedAt: "2026-01-01" }));

    const action = registry.get("tool.scrum_of_scrums.mark_resolved");
    const result = (await action!.handler({ id: "s3", resolvedAt: "2026-02-02" }, ctx())) as {
      updated: boolean;
    };
    expect(result.updated).toBe(true);
    // resolvedAt is NOT overwritten on an already-resolved row
    const stored = (useWorkspaceStore.getState().sosEntries ?? []).find((e) => e.id === "s3");
    expect(stored?.resolvedAt).toBe("2026-01-01");
  });

  it("returns {updated: false} for an unknown id (no throw)", async () => {
    const action = registry.get("tool.scrum_of_scrums.mark_resolved");
    const result = (await action!.handler({ id: "nope" }, ctx())) as { updated: boolean };
    expect(result.updated).toBe(false);
  });
});
