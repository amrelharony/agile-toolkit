/**
 * Agent kudos posts fan out LIVE to connected humans — regression lock.
 *
 * An agent never touches the realtime broadcast room. Instead its post lands in
 * the workspace store (client: upsertKudos; MCP: serverUpsertEntity → the
 * owner's postgres_changes sync → onRemote → upsertKudos), and the SOURCE-
 * AGNOSTIC signal-bridge diffs the store and emits the same signals a human
 * post would:
 *   • kudos.sent     → drives the FlyingCardPortal animation (always)
 *   • kudos.received → drives the header beacon + sonification (when the new
 *                      kudo is addressed to the local viewer)
 *
 * This test drives the real tool.kudos.post_kudos handler (not a hand-built
 * row) through the installed bridge, so a future refactor that decouples agent
 * writes from the live-animation signals fails here.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import {
  installSignalBridge,
  uninstallSignalBridge,
  setLocalViewerProfileId,
} from "@/lib/signals/signal-bridge";
import { subscribeSignals, __resetSignalBus, type Signal } from "@/lib/signals/signal-bus";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

import "@/lib/actions/tools/kudos";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

const postKudos = (params: Record<string, unknown>) =>
  registry.get("tool.kudos.post_kudos")!.handler(params, ctx()) as Promise<{
    posted: boolean;
    id?: string;
    error?: string;
  }>;

/** The signal bus batches via rAF (→ microtask in jsdom); 16ms clears it. */
const waitForFlush = () => new Promise<void>((res) => setTimeout(res, 16));

describe("agent kudos post — live fan-out via the signal bridge", () => {
  let collected: Signal[];
  let unsubscribe: (() => void) | null = null;

  beforeEach(async () => {
    __resetSignalBus();
    useWorkspaceStore.setState({ kudos: [] });
    installSignalBridge();
    // The bridge captures the first store change as its `prev` baseline and
    // emits nothing for it; prime it so the first real post is seen as a diff.
    useWorkspaceStore.setState((s) => ({ ...s }));
    await waitForFlush();
    collected = [];
    unsubscribe = subscribeSignals(["kudos.sent", "kudos.received"], (s) => collected.push(s));
  });

  afterEach(() => {
    unsubscribe?.();
    uninstallSignalBridge();
    setLocalViewerProfileId(null);
    useWorkspaceStore.setState({ kudos: [] });
  });

  it("fires kudos.sent (flying card) AND kudos.received (beacon) for a post addressed to the viewer", async () => {
    setLocalViewerProfileId("alice-profile");
    const res = await postKudos({
      toName: "Alice",
      message: "owned the incident response",
      toProfileId: "alice-profile",
    });
    expect(res.posted).toBe(true);
    await waitForFlush();

    expect(collected.filter((s) => s.kind === "kudos.sent")).toHaveLength(1);
    expect(collected.filter((s) => s.kind === "kudos.received")).toHaveLength(1);
    // The kudo actually landed on the wall (what a connected client renders).
    expect((useWorkspaceStore.getState().kudos ?? []).some((k) => k.id === res.id)).toBe(true);
  });

  it("fires the flying card but not the recipient beacon for a workspace-wide post", async () => {
    // Owner viewing their own wall (no viewer profile id). An assistant-on-
    // your-behalf post (no fromProfileId, no toProfileId) animates (kudos.sent)
    // but must NOT trigger a "you received a kudo" beacon — that's reserved for
    // kudos actually addressed to a recipient, exactly as for human posts.
    setLocalViewerProfileId(null);
    const res = await postKudos({ toName: "The team", message: "great sprint, everyone" });
    expect(res.posted).toBe(true);
    await waitForFlush();

    expect(collected.filter((s) => s.kind === "kudos.sent")).toHaveLength(1);
    expect(collected.filter((s) => s.kind === "kudos.received")).toHaveLength(0);
  });
});
