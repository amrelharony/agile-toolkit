import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

/**
 * The app-wide legacy mount moves the RACI tool's old local store into the
 * workspace without anyone opening the RACI page: once it is safe to write,
 * never over a workspace matrix, and a second run finds nothing to do.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn() })
);
const migrationMode = vi.hoisted(() => ({ value: "local" as string }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/lib/data/use-legacy-migration-mode", () => ({
  useLegacyMigrationMode: (found: boolean) => (found ? migrationMode.value : "off"),
}));
vi.mock("@/lib/auth/auth-provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/auth-provider")>()),
  useAuthOptional: () => ({ user: null }),
}));

import { LegacyToolMigrations } from "@/components/data/legacy-tool-migrations";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { RACI_ID, RACI_LEGACY_KEY } from "@/lib/raci/model";
import type { RaciMatrix } from "@/lib/stores/workspace-types";

/** The old zustand persist blob: the default roles and activities, with `cells` assigned. */
const legacy = (cells: Record<string, Record<string, string>>) =>
  JSON.stringify({
    state: {
      roles: ["Product Owner", "Scrum Master", "Dev Team"].map((name, i) => ({
        id: `default:role-${i}`,
        name,
      })),
      activities: ["Backlog Refinement", "Sprint Planning", "Daily Standup"].map((name, i) => ({
        id: `default:act-${i}`,
        name,
      })),
      matrix: cells,
    },
    version: 0,
  });

const stored = () => useWorkspaceStore.getState().raciMatrices?.find((d) => d.id === RACI_ID);

beforeEach(() => {
  useWorkspaceStore.getState().resetWorkspace();
  window.localStorage.clear();
  toastSpy.success.mockClear();
  migrationMode.value = "local";
});

afterEach(() => window.localStorage.clear());

describe("LegacyToolMigrations: the old RACI store", () => {
  it("moves it into the workspace, backs it up and says so", async () => {
    window.localStorage.setItem(
      RACI_LEGACY_KEY,
      legacy({ "default:act-1": { "default:role-2": "R" } })
    );
    render(<LegacyToolMigrations />);
    await waitFor(() =>
      expect(stored()?.cells).toEqual({ "default:act-1": { "default:role-2": ["R"] } })
    );
    expect(window.localStorage.getItem(RACI_LEGACY_KEY)).toBe(null);
    expect(window.localStorage.getItem(`${RACI_LEGACY_KEY}:migrated`)).not.toBe(null);
    expect(toastSpy.success).toHaveBeenCalledWith(
      "Moved the RACI matrix saved in this browser into your workspace."
    );
  });

  it("never writes over a workspace matrix, and stays quiet", async () => {
    const existing: RaciMatrix = {
      id: RACI_ID,
      roles: [{ id: "r1", name: "Ana" }],
      activities: [{ id: "a1", name: "Release" }],
      cells: { a1: { r1: ["A"] } },
    };
    useWorkspaceStore.setState({ raciMatrices: [existing] });
    window.localStorage.setItem(
      RACI_LEGACY_KEY,
      legacy({ "default:act-0": { "default:role-0": "A" } })
    );
    render(<LegacyToolMigrations />);
    await waitFor(() => expect(window.localStorage.getItem(RACI_LEGACY_KEY)).toBe(null));
    expect(stored()).toEqual(existing);
    expect(toastSpy.success).not.toHaveBeenCalled();
  });

  it("waits until it is safe to write", async () => {
    migrationMode.value = "wait";
    window.localStorage.setItem(
      RACI_LEGACY_KEY,
      legacy({ "default:act-0": { "default:role-0": "A" } })
    );
    render(<LegacyToolMigrations />);
    await new Promise((r) => setTimeout(r, 20));
    expect(stored()).toBeUndefined();
    expect(window.localStorage.getItem(RACI_LEGACY_KEY)).not.toBe(null);
  });
});
