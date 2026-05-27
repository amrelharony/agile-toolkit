import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  installSignalBridge,
  uninstallSignalBridge,
  setLocalViewerProfileId,
} from "@/lib/signals/signal-bridge";
import { subscribeSignals, __resetSignalBus, type Signal } from "@/lib/signals/signal-bus";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Kudos } from "@/lib/stores/workspace-types";

function freshKudos(overrides: Partial<Kudos> = {}): Kudos {
  return {
    id: `kud_${Math.random().toString(36).slice(2, 14)}`,
    theme: "thank-you",
    toName: "Alice",
    fromName: "Bob",
    message: "kept the build green all sprint",
    sentAt: new Date().toISOString(),
    ...overrides,
  };
}

function waitForFlush() {
  // The signal bus batches via rAF; in jsdom this falls through to a
  // microtask. Promise.resolve() exits the current microtask queue.
  return new Promise<void>((res) => setTimeout(res, 16));
}

describe("signal-bridge — kudos emissions", () => {
  let collected: Signal[];
  let unsubscribe: (() => void) | null = null;

  beforeEach(async () => {
    __resetSignalBus();
    useWorkspaceStore.setState({ kudos: [] });
    installSignalBridge();
    // The bridge captures the first store change as its `prev` snapshot
    // and emits nothing for it. Prime it with a no-op setState so the
    // test body's first real upsertKudos is observed as a diff, not the
    // baseline. Without this every test would have to discard the first
    // observation.
    useWorkspaceStore.setState((s) => ({ ...s }));
    await waitForFlush();
    collected = [];
    unsubscribe = subscribeSignals(["kudos.sent", "kudos.received", "kudos.reaction.added"], (s) =>
      collected.push(s)
    );
  });

  afterEach(() => {
    unsubscribe?.();
    uninstallSignalBridge();
    setLocalViewerProfileId(null);
    useWorkspaceStore.setState({ kudos: [] });
  });

  it("emits kudos.sent on every add", async () => {
    setLocalViewerProfileId("not-the-recipient");
    useWorkspaceStore.getState().upsertKudos(freshKudos({ toProfileId: "alice-profile" }));
    await waitForFlush();
    const sent = collected.filter((s) => s.kind === "kudos.sent");
    expect(sent.length).toBe(1);
  });

  it("emits kudos.received only when viewer's profile id matches toProfileId", async () => {
    setLocalViewerProfileId("alice-profile");
    useWorkspaceStore.getState().upsertKudos(freshKudos({ toProfileId: "alice-profile" }));
    useWorkspaceStore.getState().upsertKudos(freshKudos({ toProfileId: "carol-profile" }));
    await waitForFlush();
    const received = collected.filter((s) => s.kind === "kudos.received");
    expect(received.length).toBe(1);
  });

  it("owner-mode receives only guest-authored workspace-wide kudos, not own sends", async () => {
    setLocalViewerProfileId(null);
    // Owner-authored (no fromProfileId), workspace-wide (no
    // toProfileId) — must NOT count as received, otherwise the owner
    // double-counts every send as both sent and received and unlocks
    // `receiver-10` from their own outbox.
    useWorkspaceStore.getState().upsertKudos(freshKudos({}));
    // Guest-authored (fromProfileId set), workspace-wide (no
    // toProfileId) — SHOULD count as received: a guest sent it and
    // the owner is the wall.
    useWorkspaceStore.getState().upsertKudos(freshKudos({ fromProfileId: "guest-1" }));
    // Guest-authored AND addressed to a specific OTHER profile —
    // not for the owner, must not count as received either.
    useWorkspaceStore
      .getState()
      .upsertKudos(freshKudos({ fromProfileId: "guest-1", toProfileId: "alice-profile" }));
    await waitForFlush();
    const received = collected.filter((s) => s.kind === "kudos.received");
    expect(received.length).toBe(1);
  });

  it("guest viewer does not fire kudos.received on their own outbox", async () => {
    setLocalViewerProfileId("guest-self");
    // Self-send, addressed to self (rare but possible via free-text
    // recipient picker resolving to own profile) — must not count as
    // received. The guard is fromProfileId !== viewer.
    useWorkspaceStore
      .getState()
      .upsertKudos(freshKudos({ toProfileId: "guest-self", fromProfileId: "guest-self" }));
    // Genuine inbound from another guest — should fire received.
    useWorkspaceStore
      .getState()
      .upsertKudos(freshKudos({ toProfileId: "guest-self", fromProfileId: "guest-other" }));
    await waitForFlush();
    const received = collected.filter((s) => s.kind === "kudos.received");
    expect(received.length).toBe(1);
  });

  it("emits kudos.reaction.added when reactions array grows", async () => {
    setLocalViewerProfileId(null);
    const k = freshKudos({});
    useWorkspaceStore.getState().upsertKudos(k);
    await waitForFlush();
    collected.length = 0;
    // Replace by upserting the SAME id with an extra reaction.
    useWorkspaceStore.getState().upsertKudos({
      ...k,
      reactions: [{ emoji: "🎉", byProfileId: "p1", at: new Date().toISOString() }],
    });
    await waitForFlush();
    const reactions = collected.filter((s) => s.kind === "kudos.reaction.added");
    expect(reactions.length).toBe(1);
  });

  it("does not re-emit kudos.sent when the same id is upserted again with no changes", async () => {
    setLocalViewerProfileId(null);
    const k = freshKudos({});
    useWorkspaceStore.getState().upsertKudos(k);
    await waitForFlush();
    collected.length = 0;
    // Same id, structurally identical upsert.
    useWorkspaceStore.getState().upsertKudos({ ...k });
    await waitForFlush();
    expect(collected.filter((s) => s.kind === "kudos.sent").length).toBe(0);
  });
});
