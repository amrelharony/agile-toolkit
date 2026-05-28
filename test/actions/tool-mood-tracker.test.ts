/**
 * tool.mood_tracker.* coverage.
 *
 *   1. list_state (read) + record (write, mcpHandler, no confirm)
 *   2. average + 1–5 distribution + per-member averages, EXCLUDING
 *      isPlaceholder rows
 *   3. record appends a mood entry (auto id + date)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { MoodEntry } from "@/lib/stores/workspace-types";

import "@/lib/actions/tools/mood-tracker";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

function mood(p: Partial<MoodEntry> & Pick<MoodEntry, "id" | "memberId" | "score">): MoodEntry {
  return { date: "2026-01-01", ...p };
}

describe("tool.mood_tracker — registration", () => {
  it("list_state read; record write + mcpHandler + no confirm", () => {
    expect(registry.get("tool.mood_tracker.list_state")?.category).toBe("read");
    expect(registry.get("tool.mood_tracker.record")?.category).toBe("write");
    expect(registry.get("tool.mood_tracker.record")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.mood_tracker.record")?.requiresConfirmation).toBe(false);
  });
});

describe("tool.mood_tracker.list_state", () => {
  beforeEach(() => useWorkspaceStore.setState({ moodEntries: [] }));

  it("is zeroed when empty", async () => {
    const r = (await registry.get("tool.mood_tracker.list_state")!.handler({}, ctx())) as {
      total: number;
      average: number;
    };
    expect(r.total).toBe(0);
    expect(r.average).toBe(0);
  });

  it("averages + distributes, excluding placeholder rows", async () => {
    useWorkspaceStore.getState().upsertMoodEntry(mood({ id: "m1", memberId: "alice", score: 5 }));
    useWorkspaceStore.getState().upsertMoodEntry(mood({ id: "m2", memberId: "alice", score: 3 }));
    useWorkspaceStore.getState().upsertMoodEntry(mood({ id: "m3", memberId: "bob", score: 4 }));
    // placeholder — excluded from total/average/distribution
    useWorkspaceStore
      .getState()
      .upsertMoodEntry(mood({ id: "m4", memberId: "carol", score: 3, isPlaceholder: true }));

    const r = (await registry.get("tool.mood_tracker.list_state")!.handler({}, ctx())) as {
      total: number;
      average: number;
      distribution: Record<string, number>;
      byMember: { memberId: string; average: number; count: number }[];
    };
    expect(r.total).toBe(3); // placeholder excluded
    expect(r.average).toBe(4); // (5+3+4)/3
    expect(r.distribution["5"]).toBe(1);
    expect(r.distribution["3"]).toBe(1); // placeholder's 3 not counted
    expect(r.byMember.find((m) => m.memberId === "alice")!.average).toBe(4); // (5+3)/2
    expect(r.byMember.find((m) => m.memberId === "carol")).toBeUndefined();
  });
});

describe("tool.mood_tracker.record", () => {
  beforeEach(() => useWorkspaceStore.setState({ moodEntries: [] }));

  it("appends a mood entry with auto id + date", async () => {
    const r = (await registry
      .get("tool.mood_tracker.record")!
      .handler({ memberId: "alice", score: 5, note: "shipped!" }, ctx())) as {
      added: boolean;
      id: string;
    };
    expect(r.added).toBe(true);
    const stored = useWorkspaceStore.getState().moodEntries ?? [];
    expect(stored).toHaveLength(1);
    expect(stored[0].score).toBe(5);
    expect(stored[0].date).toBeTruthy();
  });
});
