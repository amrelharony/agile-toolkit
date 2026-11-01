import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Kudos } from "@/lib/stores/workspace-types";
import {
  installSignalBridge,
  setLocalViewerProfileId,
  uninstallSignalBridge,
} from "@/lib/signals/signal-bridge";
import {
  __resetSignalBus,
  emitSignal,
  subscribeSignals,
  type Signal,
} from "@/lib/signals/signal-bus";
import {
  __pendingKudosSyncSize,
  __resetKudosCloudSync,
  installKudosCloudSync,
  uninstallKudosCloudSync,
} from "@/lib/kudos/cloud-sync";
import { __resetKudosBackfill, runKudosBackfillIfNeeded } from "@/lib/kudos/backfill";

/**
 * Kudos' "Load an example" puts `example-` kudos in the workspace store for
 * a first look. None of the kudos plumbing may treat them as sent: no
 * kudos.sent signal (so no XP, sound or beacon), no POST to the kudos table
 * from cloud sync or the login backfill, and nothing in the room (neither
 * the host's snapshot nor a send).
 */

const room = vi.hoisted(() => ({ broadcast: vi.fn(), members: [] as { key: string }[] }));
vi.mock("@/lib/realtime/use-room", () => ({
  useRoom: () => ({
    isConnected: true,
    isLocalOnly: false,
    userId: "host",
    members: room.members,
    broadcast: room.broadcast,
    subscribeToEvent: () => () => undefined,
  }),
}));

import { useKudosRoom } from "@/app/(tools)/kudos/use-kudos-room";

let seq = 0;
const kudos = (over: Partial<Kudos> = {}): Kudos => ({
  id: `kud_${(seq++).toString().padStart(10, "0")}`,
  theme: "thank-you",
  toName: "Sam",
  fromName: "Mia",
  message: "Thanks for the review",
  sentAt: new Date().toISOString(),
  ...over,
});
const example = (key: string) => kudos({ id: `example-kudos-${key}` });

const wait = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

beforeAll(async () => {
  // workspace-store lazy-imports the sync registry; wait for it here.
  await import("@/lib/sync/register");
});

beforeEach(() => {
  seq = 0;
  useWorkspaceStore.setState({ kudos: [] });
});

describe("signal bridge", () => {
  let collected: Signal[] = [];
  let off: (() => void) | null = null;

  beforeEach(async () => {
    __resetSignalBus();
    installSignalBridge();
    // The first change is the bridge's baseline.
    useWorkspaceStore.setState((s) => ({ ...s }));
    await wait(16);
    collected = [];
    off = subscribeSignals(["kudos.sent", "kudos.received", "kudos.reaction.added"], (s) =>
      collected.push(s)
    );
  });

  afterEach(() => {
    off?.();
    uninstallSignalBridge();
    setLocalViewerProfileId(null);
  });

  it("signals a real kudos, and never an example one", async () => {
    const { upsertKudos } = useWorkspaceStore.getState();
    upsertKudos(example("1"));
    upsertKudos({ ...example("2"), fromProfileId: "guest-1" });
    await wait(16);
    expect(collected).toEqual([]);
    upsertKudos(kudos());
    await wait(16);
    expect(collected.filter((s) => s.kind === "kudos.sent")).toHaveLength(1);
  });

  it("signals no reaction on an example kudos", async () => {
    const row = example("3");
    useWorkspaceStore.getState().upsertKudos(row);
    await wait(16);
    useWorkspaceStore
      .getState()
      .upsertKudos({ ...row, reactions: [{ emoji: "🎉", byProfileId: "p1", at: row.sentAt }] });
    await wait(16);
    expect(collected).toEqual([]);
  });
});

describe("cloud sync", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    __resetSignalBus();
    __resetKudosCloudSync();
    fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchSpy);
    installKudosCloudSync();
  });

  afterEach(() => {
    uninstallKudosCloudSync();
    __resetKudosCloudSync();
    vi.unstubAllGlobals();
  });

  it("never queues an example kudos, even on a direct kudos.sent", async () => {
    const row = example("4");
    useWorkspaceStore.setState({ kudos: [row] });
    emitSignal({ kind: "kudos.sent", toolId: "kudos", at: row.sentAt, payload: { id: row.id } });
    await wait(40);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(__pendingKudosSyncSize()).toBe(0);
  });
});

describe("login backfill", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    __resetKudosBackfill();
    fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    __resetKudosBackfill();
    vi.unstubAllGlobals();
  });

  it("posts the team's kudos and leaves the example out", async () => {
    const real = kudos();
    useWorkspaceStore.setState({ kudos: [example("5"), real, example("6")] });
    await runKudosBackfillIfNeeded();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string).id).toBe(real.id);
  });
});

describe("kudos room", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    room.broadcast.mockReset();
    // The host and one peer: the snapshot has someone to reach.
    room.members = [{ key: "host" }, { key: "peer" }];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const host = () =>
    renderHook(() =>
      useKudosRoom({
        isHost: true,
        roomKey: "room-key-0123456789",
        persistence: "workspace",
        role: "editor",
      })
    );

  it("leaves example kudos out of the host's snapshot", () => {
    const real = kudos();
    useWorkspaceStore.setState({ kudos: [example("7"), real] });
    host();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(room.broadcast).toHaveBeenCalledTimes(1);
    const [event, payload] = room.broadcast.mock.calls[0];
    expect(event).toBe("kudos:snapshot");
    expect((payload as { kudos: Kudos[] }).kudos.map((k) => k.id)).toEqual([real.id]);
  });

  it("sends no snapshot of an example-only wall", () => {
    useWorkspaceStore.setState({ kudos: [example("8"), example("9")] });
    host();
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(room.broadcast).not.toHaveBeenCalled();
  });

  it("keeps an example kudos local when one reaches sendKudos", () => {
    const { result } = host();
    act(() => result.current.sendKudos(example("10")));
    expect(useWorkspaceStore.getState().kudos?.map((k) => k.id)).toEqual(["example-kudos-10"]);
    expect(room.broadcast).not.toHaveBeenCalled();
    act(() => result.current.sendKudos(kudos()));
    expect(room.broadcast).toHaveBeenCalledWith("kudos:created", expect.anything());
  });
});
