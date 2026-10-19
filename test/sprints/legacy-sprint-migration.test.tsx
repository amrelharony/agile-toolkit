/**
 * <LegacySprintMigration/>: runs the old-sprint move only when it is safe
 * (workspace loaded, auth settled, no open merge/discard question, the
 * owner's first cloud pull done), never loads the migration when there is
 * nothing to move, and reports pending/done for the sprint tools.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  auth: null as { status: string; user: { id: string } | null } | null,
  migrationLoaded: false,
  toastSuccess: vi.fn(),
}));

vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => h.auth }));

// The gate's own logic is tested in test/sync/owner-sync-gate.test.ts; here
// only its decision matters.
vi.mock("@/lib/sync/owner-sync-gate", async () => {
  const { create } = await import("zustand");
  const useOwnerSyncGateStore = create(() => ({ decision: "unchecked", promptOpen: false }));
  return {
    useOwnerSyncGateStore,
    useOwnerSyncGate: () => {
      const decision = useOwnerSyncGateStore((s) => s.decision);
      return h.auth?.status === "authenticated" && decision === "resolved";
    },
  };
});

vi.mock("@/lib/utils/toast", () => ({ toast: { success: h.toastSuccess } }));

vi.mock("@/lib/sprints/migrate-legacy", async (importOriginal) => {
  h.migrationLoaded = true;
  return await importOriginal();
});

import { LegacySprintMigration } from "@/components/sprints/legacy-sprint-migration";
import { LEGACY_SPRINT_KEYS } from "@/lib/sprints/legacy-keys";
import { useSprintMigrationStore } from "@/lib/sprints/migration-status";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { syncEngine } from "@/lib/sync/engine";
import { useOwnerSyncGateStore } from "@/lib/sync/owner-sync-gate";

const OWNER = { status: "authenticated", user: { id: "owner-1" } };
const VISITOR = { status: "anonymous", user: null };
const LOADING = { status: "loading", user: null };

const BURNDOWN = JSON.stringify({
  state: {
    config: { totalPoints: 30, sprintDays: 10, sprintStartDate: "2026-10-05" },
    entries: [
      { id: "default:day-0", day: 0, remaining: 30, scopeChange: false },
      { id: "u-1", day: 1, remaining: 27, scopeChange: false },
    ],
  },
  version: 0,
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const statuses: string[] = [];
let unsubscribe = () => {};

beforeAll(async () => {
  await useWorkspaceStore.persist.rehydrate();
});

beforeEach(() => {
  localStorage.clear();
  useWorkspaceStore.getState().resetWorkspace();
  useSprintMigrationStore.setState({ status: "idle" });
  useOwnerSyncGateStore.setState({ decision: "unchecked" });
  h.toastSuccess.mockReset();
  statuses.length = 0;
  unsubscribe = useSprintMigrationStore.subscribe((s) => statuses.push(s.status));
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  unsubscribe();
  vi.restoreAllMocks();
});

/** Let effects, the dynamic import and the migration settle. */
async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

describe("<LegacySprintMigration/>", () => {
  // First, so the migration module hasn't been imported by another test.
  it("with no old keys does nothing and never loads the migration", async () => {
    h.auth = VISITOR;
    render(<LegacySprintMigration />);
    await flush();
    expect(h.migrationLoaded).toBe(false);
    expect(statuses).toEqual([]);
    expect(useSprintMigrationStore.getState().status).toBe("idle");
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("runs locally for a visitor: pending, then done, with one toast", async () => {
    h.auth = VISITOR;
    localStorage.setItem(LEGACY_SPRINT_KEYS.burndown, BURNDOWN);
    const whenReady = vi.spyOn(syncEngine, "whenReady");
    render(<LegacySprintMigration />);
    await waitFor(() => expect(useSprintMigrationStore.getState().status).toBe("done"));
    expect(statuses[0]).toBe("pending");
    expect(whenReady).not.toHaveBeenCalled();
    expect(localStorage.getItem(LEGACY_SPRINT_KEYS.burndown)).toBeNull();
    expect(useWorkspaceStore.getState().sprints.map((s) => s.name)).toEqual([
      "Sprint of 5 Oct 2026",
    ]);
    expect(h.toastSuccess).toHaveBeenCalledTimes(1);
    expect(h.toastSuccess).toHaveBeenCalledWith("Moved 1 sprint from Burndown into shared sprints");
  });

  it("an open merge/discard question blocks the run; the owner's then waits for the pull", async () => {
    h.auth = OWNER;
    useOwnerSyncGateStore.setState({ decision: "pending" });
    localStorage.setItem(LEGACY_SPRINT_KEYS.burndown, BURNDOWN);
    const ready = deferred();
    const whenReady = vi.spyOn(syncEngine, "whenReady").mockReturnValue(ready.promise);

    render(<LegacySprintMigration />);
    await flush();
    // Blocked: nothing moved, and the tools aren't told to wait on it.
    expect(localStorage.getItem(LEGACY_SPRINT_KEYS.burndown)).not.toBeNull();
    expect(useSprintMigrationStore.getState().status).toBe("idle");
    expect(whenReady).not.toHaveBeenCalled();

    // Merged: the gate opens, and the move waits for the first cloud pull.
    act(() => useOwnerSyncGateStore.setState({ decision: "resolved" }));
    await flush();
    expect(whenReady).toHaveBeenCalledTimes(1);
    expect(useSprintMigrationStore.getState().status).toBe("pending");
    expect(localStorage.getItem(LEGACY_SPRINT_KEYS.burndown)).not.toBeNull();
    expect(useWorkspaceStore.getState().sprints).toEqual([]);

    await act(async () => ready.resolve());
    await waitFor(() => expect(useSprintMigrationStore.getState().status).toBe("done"));
    expect(localStorage.getItem(LEGACY_SPRINT_KEYS.burndown)).toBeNull();
    expect(useWorkspaceStore.getState().sprints).toHaveLength(1);
    expect(h.toastSuccess).toHaveBeenCalledTimes(1);
  });

  it("never runs while discarding", async () => {
    h.auth = OWNER;
    useOwnerSyncGateStore.setState({ decision: "discarding" });
    localStorage.setItem(LEGACY_SPRINT_KEYS.burndown, BURNDOWN);
    render(<LegacySprintMigration />);
    await flush();
    expect(localStorage.getItem(LEGACY_SPRINT_KEYS.burndown)).not.toBeNull();
    expect(useSprintMigrationStore.getState().status).toBe("idle");
  });

  it("waits for auth to settle, then runs", async () => {
    h.auth = LOADING;
    localStorage.setItem(LEGACY_SPRINT_KEYS.burndown, BURNDOWN);
    const view = render(<LegacySprintMigration />);
    await flush();
    expect(useSprintMigrationStore.getState().status).toBe("pending");
    expect(localStorage.getItem(LEGACY_SPRINT_KEYS.burndown)).not.toBeNull();

    h.auth = VISITOR;
    view.rerender(<LegacySprintMigration />);
    await waitFor(() => expect(useSprintMigrationStore.getState().status).toBe("done"));
    expect(localStorage.getItem(LEGACY_SPRINT_KEYS.burndown)).toBeNull();
  });

  it("does nothing outside AuthProvider (can't tell the owner from a visitor)", async () => {
    h.auth = null;
    localStorage.setItem(LEGACY_SPRINT_KEYS.burndown, BURNDOWN);
    render(<LegacySprintMigration />);
    await flush();
    expect(localStorage.getItem(LEGACY_SPRINT_KEYS.burndown)).not.toBeNull();
    expect(statuses).toEqual([]);
  });
});
