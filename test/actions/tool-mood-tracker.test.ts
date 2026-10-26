/**
 * tool.mood_tracker.* coverage.
 *
 *   1. list_state (read) + record / record_pulse / remove / remove_pulse
 *      (write, mcpHandler, no confirm)
 *   2. the window's average + 1–5 distribution + per-member averages,
 *      EXCLUDING isPlaceholder rows; null (never 0) when empty
 *   3. record upserts one check-in per member per day, on the roster, with
 *      a checked, local, never-future date
 *   4. the server handlers use the mood kinds
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverGetEntity: vi.fn(async () => null),
    serverUpsertEntity: vi.fn(async () => {}),
    serverListEntities: vi.fn(async () => []),
    serverDeleteEntity: vi.fn(async () => {}),
  };
});

import { registry } from "@/lib/actions/registry";
import * as serverStore from "@/lib/actions/server-store";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { MoodEntry } from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";
import { addDays } from "@/lib/impediments/model";

import "@/lib/actions/tools/mood-tracker";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

const today = todayLocalISO();
const yesterday = addDays(today, -1);

function mood(p: Partial<MoodEntry> & Pick<MoodEntry, "id" | "memberId" | "score">): MoodEntry {
  return { date: today, ...p };
}

const ROSTER = [
  { id: "alice", name: "Alice" },
  { id: "bob", name: "Bob" },
  { id: "carol", name: "Carol" },
];

describe("tool.mood_tracker — registration", () => {
  it("list_state read; the rest write + mcpHandler + no confirm", () => {
    expect(registry.get("tool.mood_tracker.list_state")?.category).toBe("read");
    for (const verb of ["record", "record_pulse", "remove", "remove_pulse"]) {
      expect(registry.get(`tool.mood_tracker.${verb}`)?.category).toBe("write");
      expect(registry.get(`tool.mood_tracker.${verb}`)?.mcpHandler).toBeTypeOf("function");
      expect(registry.get(`tool.mood_tracker.${verb}`)?.requiresConfirmation).toBe(false);
    }
  });
});

describe("tool.mood_tracker.list_state", () => {
  beforeEach(() =>
    useWorkspaceStore.setState({
      moodEntries: [],
      moodPulses: [],
      moodTrackerDocs: [],
      teamMembers: ROSTER,
    })
  );

  it("has no average when empty, never 0", async () => {
    const r = (await registry.get("tool.mood_tracker.list_state")!.handler({}, ctx())) as {
      total: number;
      average: number | null;
      mode: string;
      streak: unknown;
    };
    expect(r.total).toBe(0);
    expect(r.average).toBeNull();
    expect(r.mode).toBe("named");
    expect(r.streak).toBeNull();
  });

  it("averages + distributes, excluding placeholder rows", async () => {
    const s = useWorkspaceStore.getState();
    s.upsertMoodEntry(mood({ id: "m1", memberId: "alice", score: 5 }));
    s.upsertMoodEntry(mood({ id: "m2", memberId: "alice", score: 3, date: yesterday }));
    s.upsertMoodEntry(mood({ id: "m3", memberId: "bob", score: 4 }));
    // placeholder — excluded from total/average/distribution
    s.upsertMoodEntry(mood({ id: "m4", memberId: "carol", score: 3, isPlaceholder: true }));

    const r = (await registry.get("tool.mood_tracker.list_state")!.handler({}, ctx())) as {
      total: number;
      average: number;
      distribution: Record<string, number>;
      byMember: { memberId: string; name: string; average: number; count: number }[];
    };
    expect(r.total).toBe(3); // placeholder excluded
    expect(r.average).toBe(4); // (5+3+4)/3
    expect(r.distribution["5"]).toBe(1);
    expect(r.distribution["3"]).toBe(1); // placeholder's 3 not counted
    expect(r.byMember.find((m) => m.memberId === "alice")).toMatchObject({
      average: 4,
      name: "Alice",
    });
    expect(r.byMember.find((m) => m.memberId === "carol")).toBeUndefined();
  });

  it("counts pulses as check-ins, and lists no one in the anonymous mode", async () => {
    const s = useWorkspaceStore.getState();
    s.upsertMoodEntry(mood({ id: "m1", memberId: "alice", score: 5 }));
    s.upsertMoodPulse({
      id: "moodPulse_a",
      date: today,
      counts: { 1: 0, 2: 1, 3: 2, 4: 0, 5: 0 },
      source: "room",
      createdAt: `${today}T09:00:00.000Z`,
    });
    s.upsertMoodTrackerDoc({ id: "moodTracker:current", mode: "anonymous" });
    const r = (await registry.get("tool.mood_tracker.list_state")!.handler({ days: 7 }, ctx())) as {
      checkIns: number;
      anonymous: number;
      average: number;
      byMember: unknown[];
      window: { days: number };
    };
    expect(r).toMatchObject({
      checkIns: 4,
      anonymous: 3,
      average: 3.3,
      byMember: [],
      window: { days: 7 },
    });
  });
});

describe("tool.mood_tracker.record", () => {
  beforeEach(() =>
    useWorkspaceStore.setState({
      moodEntries: [],
      moodPulses: [],
      moodTrackerDocs: [],
      teamMembers: ROSTER,
    })
  );
  const record = async (params: Record<string, unknown>) =>
    (await registry.get("tool.mood_tracker.record")!.handler(params, ctx())) as {
      added: boolean;
      id?: string;
      replaced?: boolean;
      reason?: string;
    };

  it("adds a check-in with an id and today's local date, then replaces it for the same day", async () => {
    const r = await record({ memberId: "alice", score: 5, note: "shipped!" });
    expect(r).toMatchObject({ added: true, replaced: false });
    const again = await record({ memberId: "alice", score: 2 });
    expect(again).toMatchObject({ added: true, id: r.id, replaced: true });
    const stored = useWorkspaceStore.getState().moodEntries ?? [];
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ score: 2, date: today });
    expect(stored[0].id).toMatch(/^mood_/);
  });

  it("backfills a past day, stamping when it was logged, and refuses the rest", async () => {
    expect(await record({ memberId: "alice", score: 4, date: yesterday })).toMatchObject({
      added: true,
    });
    expect(useWorkspaceStore.getState().moodEntries?.[0].loggedAt).toBeTruthy();
    expect(await record({ memberId: "alice", score: 4, date: addDays(today, 1) })).toMatchObject({
      added: false,
    });
    expect(await record({ memberId: "alice", score: 4, date: "26/10/2026" })).toMatchObject({
      added: false,
    });
    expect(await record({ memberId: "nobody", score: 4 })).toMatchObject({
      added: false,
      reason: expect.stringContaining("roster"),
    });
  });

  it("refuses named check-ins in the anonymous mode", async () => {
    useWorkspaceStore
      .getState()
      .upsertMoodTrackerDoc({ id: "moodTracker:current", mode: "anonymous" });
    expect(await record({ memberId: "alice", score: 4 })).toMatchObject({
      added: false,
      reason: expect.stringContaining("record_pulse"),
    });
  });

  it("record_pulse needs 3 answers; remove and remove_pulse take them out", async () => {
    const pulse = async (counts: Record<string, number>) =>
      (await registry.get("tool.mood_tracker.record_pulse")!.handler({ counts }, ctx())) as {
        added: boolean;
        id?: string;
      };
    expect(await pulse({ 3: 2 })).toMatchObject({ added: false });
    const p = await pulse({ 2: 1, 4: 2 });
    expect(p).toMatchObject({ added: true });
    expect(useWorkspaceStore.getState().moodPulses?.[0]).toMatchObject({
      source: "facilitator",
      counts: { 1: 0, 2: 1, 3: 0, 4: 2, 5: 0 },
    });
    expect(
      await registry.get("tool.mood_tracker.remove_pulse")!.handler({ id: p.id }, ctx())
    ).toEqual({ removed: true });
    await record({ memberId: "bob", score: 3 });
    expect(
      await registry
        .get("tool.mood_tracker.remove")!
        .handler({ memberId: "bob", date: today }, ctx())
    ).toMatchObject({ removed: true });
    expect(useWorkspaceStore.getState().moodEntries).toEqual([]);
  });
});

describe("tool.mood_tracker on the server", () => {
  it("writes pulses and entries under their kinds, checking the roster", async () => {
    const upsert = vi.mocked(serverStore.serverUpsertEntity);
    const list = vi.mocked(serverStore.serverListEntities);
    upsert.mockClear();
    list.mockImplementation(
      async (_u, kind) => (kind === "workspace:teamMember" ? ROSTER : []) as never
    );
    await registry.get("tool.mood_tracker.record_pulse")!.mcpHandler!({ counts: { 4: 3 } }, ctx());
    expect(upsert).toHaveBeenCalledWith(
      "u",
      "workspace:moodPulse",
      expect.objectContaining({ date: today })
    );
    await registry.get("tool.mood_tracker.record")!.mcpHandler!(
      { memberId: "alice", score: 4 },
      ctx()
    );
    expect(upsert).toHaveBeenCalledWith(
      "u",
      "workspace:moodEntry",
      expect.objectContaining({ memberId: "alice" })
    );
    expect(
      await registry.get("tool.mood_tracker.record")!.mcpHandler!(
        { memberId: "zed", score: 4 },
        ctx()
      )
    ).toMatchObject({ added: false });
  });
});
