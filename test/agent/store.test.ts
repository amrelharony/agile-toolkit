import { describe, expect, it, vi, beforeEach } from "vitest";
import { useAgentStore } from "@/lib/agent/store";
import type { PendingToolUse } from "@/lib/agent/types";

/**
 * Regression: the agent loop awaits a pending tool's `resolve(boolean)`
 * (set by `makeConfirmHandler`) before it can continue. If the UI nulls
 * out `pendingToolUse` without calling that resolver, the loop hangs.
 *
 * The store guarantees a deny-by-default settlement on every code path
 * that clears or replaces a pending entry.
 */
function makePending(): PendingToolUse & { _resolved: boolean | null } {
  const stub: PendingToolUse & { _resolved: boolean | null } = {
    toolUseId: "tu_1",
    actionId: "ws.story.add",
    resolvedActionId: "workspace.stories.add",
    input: {},
    summary: "Add story",
    _resolved: null,
    resolve: vi.fn((approved: boolean) => {
      stub._resolved = approved;
    }),
  };
  return stub;
}

describe("useAgentStore – pending tool resolution", () => {
  beforeEach(() => {
    useAgentStore.getState().reset();
  });

  it("closeSheet settles a pending confirmation as denied", () => {
    const pending = makePending();
    useAgentStore.getState().setPendingToolUse(pending);
    useAgentStore.getState().closeSheet();
    expect(pending.resolve).toHaveBeenCalledWith(false);
    expect(pending._resolved).toBe(false);
    expect(useAgentStore.getState().pendingToolUse).toBeNull();
  });

  it("setActiveConversation settles a pending confirmation as denied", () => {
    const pending = makePending();
    useAgentStore.getState().setPendingToolUse(pending);
    useAgentStore.getState().setActiveConversation(null, []);
    expect(pending.resolve).toHaveBeenCalledWith(false);
    expect(useAgentStore.getState().pendingToolUse).toBeNull();
  });

  it("setPendingToolUse(null) settles the old pending as denied", () => {
    const pending = makePending();
    useAgentStore.getState().setPendingToolUse(pending);
    useAgentStore.getState().setPendingToolUse(null);
    expect(pending.resolve).toHaveBeenCalledWith(false);
  });

  it("replacing one pending with another settles the old one", () => {
    const first = makePending();
    const second = makePending();
    useAgentStore.getState().setPendingToolUse(first);
    useAgentStore.getState().setPendingToolUse(second);
    expect(first.resolve).toHaveBeenCalledWith(false);
    expect(second.resolve).not.toHaveBeenCalled();
    expect(useAgentStore.getState().pendingToolUse).toBe(second);
  });

  it("reset settles a pending confirmation as denied", () => {
    const pending = makePending();
    useAgentStore.getState().setPendingToolUse(pending);
    useAgentStore.getState().reset();
    expect(pending.resolve).toHaveBeenCalledWith(false);
  });

  it("idempotent setPendingToolUse(same object) does NOT resolve", () => {
    const pending = makePending();
    useAgentStore.getState().setPendingToolUse(pending);
    useAgentStore.getState().setPendingToolUse(pending);
    expect(pending.resolve).not.toHaveBeenCalled();
  });
});

/**
 * Tapping Amr and Ctrl/Cmd+J close the panel through toggleSheet, so its
 * closing branch must do everything closeSheet does: clear "Approve all"
 * and deny a card that is still waiting (audit toggle-keeps-autoapprove).
 */
describe("useAgentStore – toggleSheet", () => {
  beforeEach(() => {
    useAgentStore.getState().reset();
  });

  it("toggling closed resets autoApprove and denies a pending card", () => {
    const pending = makePending();
    useAgentStore.getState().openSheet();
    useAgentStore.getState().setAutoApprove(true);
    useAgentStore.getState().setPendingToolUse(pending);

    useAgentStore.getState().toggleSheet();

    const s = useAgentStore.getState();
    expect(s.open).toBe(false);
    expect(s.autoApprove).toBe(false);
    expect(s.pendingToolUse).toBeNull();
    expect(pending.resolve).toHaveBeenCalledTimes(1);
    expect(pending.resolve).toHaveBeenCalledWith(false);
    expect(pending._resolved).toBe(false);
  });

  it("toggling closed goes through closeSheet", () => {
    useAgentStore.getState().openSheet();
    const original = useAgentStore.getState().closeSheet;
    const closeSheet = vi.fn(original);
    useAgentStore.setState({ closeSheet });
    try {
      useAgentStore.getState().toggleSheet();
      expect(closeSheet).toHaveBeenCalledTimes(1);
      expect(useAgentStore.getState().open).toBe(false);
    } finally {
      // zustand copies state on every set, so put the real action back
      // explicitly rather than relying on a spy restore.
      useAgentStore.setState({ closeSheet: original });
    }
  });

  it("toggling open just opens and leaves the rest alone", () => {
    const pending = makePending();
    useAgentStore.getState().setAutoApprove(true);
    useAgentStore.getState().setPendingToolUse(pending);
    expect(useAgentStore.getState().open).toBe(false);

    useAgentStore.getState().toggleSheet();

    const s = useAgentStore.getState();
    expect(s.open).toBe(true);
    expect(s.autoApprove).toBe(true);
    expect(s.pendingToolUse).toBe(pending);
    expect(pending.resolve).not.toHaveBeenCalled();
  });
});
