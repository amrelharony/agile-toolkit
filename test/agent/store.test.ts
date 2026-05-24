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
