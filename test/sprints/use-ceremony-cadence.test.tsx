/**
 * The ceremony cadence as a workspace document: the hook reads and writes the
 * one row agents see (normalised, the defaults until the team sets one), and
 * the old per-browser blob moves into that row once, staying behind as a
 * backup.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { CEREMONY_CADENCE_ID } from "@/lib/stores/workspace-types";
import { DEFAULT_CADENCE } from "@/lib/sprints/cadence";
import {
  CADENCE_KEY,
  migrateLegacyCadence,
  selectCadenceDoc,
  useCeremonyCadence,
} from "@/lib/sprints/use-ceremony-cadence";

/** The blob as the old hook saved it: hand-sorted nowhere, duplicates and all. */
const LEGACY = {
  ...DEFAULT_CADENCE,
  dailyTime: "08:45",
  dailyWeekdays: [5, 1, 1, 3],
  refinement: null,
};

const doc = () => selectCadenceDoc(useWorkspaceStore.getState());

beforeEach(async () => {
  window.localStorage.clear();
  useWorkspaceStore.getState().resetWorkspace();
  await useWorkspaceStore.persist.rehydrate();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("useCeremonyCadence", () => {
  it("runs on the defaults until the team sets a cadence, writing no document", () => {
    const { result } = renderHook(() => useCeremonyCadence());
    expect(result.current[0]).toEqual(DEFAULT_CADENCE);
    expect(doc()).toBeUndefined();
  });

  it("writes the document agents read, normalised, and every reader sees it", () => {
    const a = renderHook(() => useCeremonyCadence());
    const b = renderHook(() => useCeremonyCadence());
    act(() => a.result.current[1]({ dailyTime: "08:45", dailyWeekdays: [5, 1, 1] }));

    expect(doc()).toEqual({
      id: CEREMONY_CADENCE_ID,
      ...DEFAULT_CADENCE,
      dailyTime: "08:45",
      dailyWeekdays: [1, 5],
    });
    expect(b.result.current[0]).toMatchObject({ dailyTime: "08:45", dailyWeekdays: [1, 5] });

    // A later patch keeps what the first one set.
    act(() => b.result.current[1]({ refinement: null }));
    expect(doc()).toMatchObject({ dailyTime: "08:45", refinement: null });
    expect(a.result.current[0].refinement).toBeNull();
  });

  it("reads a document an agent wrote, normalising what it finds", () => {
    useWorkspaceStore.getState().upsertCeremonyCadence({
      id: CEREMONY_CADENCE_ID,
      ...DEFAULT_CADENCE,
      sprintLengthDays: 7,
      dailyWeekdays: [3, 1],
    });
    const { result } = renderHook(() => useCeremonyCadence());
    expect(result.current[0]).toMatchObject({ sprintLengthDays: 7, dailyWeekdays: [1, 3] });
  });
});

describe("the move from the per-browser blob", () => {
  it("creates the document from the blob once, and leaves the blob in place", () => {
    window.localStorage.setItem(CADENCE_KEY, JSON.stringify(LEGACY));

    const first = renderHook(() => useCeremonyCadence());
    expect(doc()).toEqual({
      id: CEREMONY_CADENCE_ID,
      ...DEFAULT_CADENCE,
      dailyTime: "08:45",
      dailyWeekdays: [1, 3, 5],
      refinement: null,
    });
    expect(first.result.current[0].dailyTime).toBe("08:45");
    expect(window.localStorage.getItem(CADENCE_KEY)).toBe(JSON.stringify(LEGACY));

    // Once: an edit after the move survives the next mount.
    act(() => first.result.current[1]({ dailyTime: "10:15" }));
    first.unmount();
    const second = renderHook(() => useCeremonyCadence());
    expect(second.result.current[0].dailyTime).toBe("10:15");
    expect(migrateLegacyCadence()).toBe(false);
  });

  it("never overwrites a document the workspace already holds", () => {
    useWorkspaceStore
      .getState()
      .upsertCeremonyCadence({ id: CEREMONY_CADENCE_ID, ...DEFAULT_CADENCE, dailyTime: "07:00" });
    window.localStorage.setItem(CADENCE_KEY, JSON.stringify(LEGACY));

    const { result } = renderHook(() => useCeremonyCadence());
    expect(result.current[0].dailyTime).toBe("07:00");
    expect(doc()?.dailyTime).toBe("07:00");
  });

  it("waits for the workspace to load", () => {
    window.localStorage.setItem(CADENCE_KEY, JSON.stringify(LEGACY));
    vi.spyOn(useWorkspaceStore.persist, "hasHydrated").mockReturnValue(false);
    expect(migrateLegacyCadence()).toBe(false);
    expect(doc()).toBeUndefined();
  });

  it("does nothing without a blob, or with one it cannot read", () => {
    expect(migrateLegacyCadence()).toBe(false);
    window.localStorage.setItem(CADENCE_KEY, "{not json");
    expect(migrateLegacyCadence()).toBe(false);
    window.localStorage.setItem(CADENCE_KEY, "42");
    expect(migrateLegacyCadence()).toBe(false);
    expect(doc()).toBeUndefined();
  });
});
