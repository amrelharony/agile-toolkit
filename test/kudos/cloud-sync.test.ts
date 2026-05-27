import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  installKudosCloudSync,
  uninstallKudosCloudSync,
  __resetKudosCloudSync,
  __pendingKudosSyncSize,
} from "@/lib/kudos/cloud-sync";
import { emitSignal, __resetSignalBus } from "@/lib/signals/signal-bus";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Kudos } from "@/lib/stores/workspace-types";

function freshKudos(overrides: Partial<Kudos> = {}): Kudos {
  return {
    id: `kud_${Math.random().toString(36).slice(2, 14)}`,
    theme: "you-rock",
    toName: "Alice",
    fromName: "Bob",
    message: "shipped Phase 1 cleanly",
    sentAt: new Date().toISOString(),
    ...overrides,
  };
}

function wait(ms: number) {
  return new Promise<void>((res) => setTimeout(res, ms));
}

describe("kudos/cloud-sync", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    __resetSignalBus();
    __resetKudosCloudSync();
    useWorkspaceStore.setState({ kudos: [] });
    fetchSpy = vi.fn();
    // BroadcastChannel doesn't exist in jsdom — the module guards
    // against it, so we don't need to stub.
    vi.stubGlobal("fetch", fetchSpy);
    installKudosCloudSync();
  });

  afterEach(() => {
    uninstallKudosCloudSync();
    __resetKudosCloudSync();
    useWorkspaceStore.setState({ kudos: [] });
    vi.unstubAllGlobals();
  });

  it("POSTs to /api/kudos when kudos.sent fires for a row that lives in the workspace store", async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 200 });
    const k = freshKudos();
    useWorkspaceStore.setState({ kudos: [k] });
    emitSignal({
      kind: "kudos.sent",
      toolId: "kudos",
      at: new Date().toISOString(),
      payload: { id: k.id },
    });
    // The bus batches via rAF/microtask; the cloud-sync also triggers a
    // tick immediately. Give it a few ms to drain.
    await wait(50);
    expect(fetchSpy).toHaveBeenCalled();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/kudos");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string).id).toBe(k.id);
  });

  it("does not POST when the signal payload references an id missing from the store", async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 200 });
    emitSignal({
      kind: "kudos.sent",
      toolId: "kudos",
      at: new Date().toISOString(),
      payload: { id: "kud_missing" },
    });
    await wait(40);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("drops the row after a 4xx (non-429) response — payload unfixable by retry", async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 400 });
    const k = freshKudos();
    useWorkspaceStore.setState({ kudos: [k] });
    emitSignal({
      kind: "kudos.sent",
      toolId: "kudos",
      at: new Date().toISOString(),
      payload: { id: k.id },
    });
    await wait(50);
    expect(__pendingKudosSyncSize()).toBe(0);
  });

  it("keeps the row pending after a 5xx response so the next tick can retry", async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 503 });
    const k = freshKudos();
    useWorkspaceStore.setState({ kudos: [k] });
    emitSignal({
      kind: "kudos.sent",
      toolId: "kudos",
      at: new Date().toISOString(),
      payload: { id: k.id },
    });
    await wait(50);
    expect(__pendingKudosSyncSize()).toBe(1);
  });

  it("dedupes — a second kudos.sent for an already-pending id does not re-queue", async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 503 });
    const k = freshKudos();
    useWorkspaceStore.setState({ kudos: [k] });
    emitSignal({
      kind: "kudos.sent",
      toolId: "kudos",
      at: new Date().toISOString(),
      payload: { id: k.id },
    });
    await wait(30);
    emitSignal({
      kind: "kudos.sent",
      toolId: "kudos",
      at: new Date().toISOString(),
      payload: { id: k.id },
    });
    await wait(30);
    // Still exactly one pending row.
    expect(__pendingKudosSyncSize()).toBe(1);
  });
});
