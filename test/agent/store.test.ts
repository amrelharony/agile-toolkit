import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { useAgentStore, type TurnAbort } from "@/lib/agent/store";
import type { ChatMessage, ConversationMeta, PendingToolUse } from "@/lib/agent/types";

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
    prompt: {
      verb: "Add story",
      title: "Workspace",
      question: "Add a story to your workspace?",
      detail: "",
      destructive: false,
    },
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
 * How the panel was opened, for its focus owner (use-panel-focus): a key
 * (Enter or Space on Amr or the header's opener, Ctrl/Cmd+J) or a pointer.
 * Code that opens it without saying leaves it unknown.
 */
describe("useAgentStore – openedVia", () => {
  beforeEach(() => {
    useAgentStore.getState().closeSheet();
  });

  afterEach(() => {
    useAgentStore.getState().closeSheet();
  });

  it("is unknown while the panel is closed", () => {
    expect(useAgentStore.getState()).toMatchObject({ open: false, openedVia: null });
  });

  it.each(["keyboard", "pointer"] as const)("records a %s open", (via) => {
    useAgentStore.getState().openSheet({ via });
    expect(useAgentStore.getState()).toMatchObject({ open: true, openedVia: via });
  });

  it("stays unknown when code opens the panel without saying how", () => {
    useAgentStore.getState().openSheet();
    expect(useAgentStore.getState()).toMatchObject({ open: true, openedVia: null });
    // An empty options object says nothing either.
    useAgentStore.getState().closeSheet();
    useAgentStore.getState().openSheet({});
    expect(useAgentStore.getState()).toMatchObject({ open: true, openedVia: null });
  });

  it("follows the newest open request while the panel is already open", () => {
    useAgentStore.getState().openSheet({ via: "pointer" });
    useAgentStore.getState().openSheet({ via: "keyboard" });
    expect(useAgentStore.getState()).toMatchObject({ open: true, openedVia: "keyboard" });
  });

  it("toggleSheet opens with the way in it is given", () => {
    useAgentStore.getState().toggleSheet({ via: "keyboard" });
    expect(useAgentStore.getState()).toMatchObject({ open: true, openedVia: "keyboard" });
    useAgentStore.getState().toggleSheet();
    useAgentStore.getState().toggleSheet({ via: "pointer" });
    expect(useAgentStore.getState()).toMatchObject({ open: true, openedVia: "pointer" });
  });

  it("is forgotten by every close path", () => {
    useAgentStore.getState().openSheet({ via: "keyboard" });
    useAgentStore.getState().closeSheet();
    expect(useAgentStore.getState()).toMatchObject({ open: false, openedVia: null });

    useAgentStore.getState().openSheet({ via: "keyboard" });
    // A toggle's closing branch, with a way in it has no use for.
    useAgentStore.getState().toggleSheet({ via: "pointer" });
    expect(useAgentStore.getState()).toMatchObject({ open: false, openedVia: null });
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

  it("toggling open goes through openSheet, with the way in", () => {
    const original = useAgentStore.getState().openSheet;
    const openSheet = vi.fn(original);
    useAgentStore.setState({ openSheet });
    try {
      useAgentStore.getState().toggleSheet({ via: "keyboard" });
      expect(openSheet).toHaveBeenCalledTimes(1);
      expect(openSheet).toHaveBeenCalledWith({ via: "keyboard" });
      expect(useAgentStore.getState()).toMatchObject({ open: true, openedVia: "keyboard" });
    } finally {
      useAgentStore.setState({ openSheet: original });
      useAgentStore.getState().closeSheet();
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

const meta = (id: string): ConversationMeta => ({
  id,
  title: `Thread ${id}`,
  toolId: null,
  createdAt: "2026-11-12T08:00:00Z",
  updatedAt: "2026-11-12T08:00:00Z",
  lastMessageAt: "2026-11-12T08:00:00Z",
});

const msg = (id: string, role: ChatMessage["role"] = "assistant"): ChatMessage => ({
  id,
  role,
  content: [{ type: "text", text: `text of ${id}` }],
  createdAt: "2026-11-12T08:00:00Z",
});

/** A clean store: no chat, no hook, both drafts empty, the owner's profile. */
function fresh(): void {
  useAgentStore.getState().setAbortTurn(null);
  useAgentStore.getState().reset();
  useAgentStore.setState({
    open: false,
    chatProfile: "owner",
    drafts: { owner: "", visitor: "" },
    notice: null,
    error: null,
  });
}

/** Register a stand-in for the live turn's abort, as the client does. */
function liveTurn() {
  const abort = vi.fn<TurnAbort>();
  useAgentStore.getState().setAbortTurn(abort);
  return abort;
}

describe("useAgentStore – the reply the live turn writes to", () => {
  beforeEach(fresh);

  it("points at the message it is given and lets go when streaming ends", () => {
    const s = useAgentStore.getState();
    s.setStreaming(true);
    s.appendMessage(msg("a1"));
    s.setStreamingMessageId("a1");
    expect(useAgentStore.getState().streamingMessageId).toBe("a1");

    s.setStreaming(false);
    expect(useAgentStore.getState().streamingMessageId).toBeNull();
  });

  it("is cleared when its message is removed, and kept when another one goes", () => {
    const s = useAgentStore.getState();
    s.appendMessage(msg("u1", "user"));
    s.appendMessage(msg("a1"));
    s.setStreamingMessageId("a1");

    s.removeMessage("u1");
    expect(useAgentStore.getState().streamingMessageId).toBe("a1");
    s.removeMessage("a1");
    expect(useAgentStore.getState().streamingMessageId).toBeNull();
  });

  it("is cleared by New chat and by opening another thread", () => {
    const s = useAgentStore.getState();
    s.setActiveConversation(meta("c1"), [msg("a1")]);
    s.setStreamingMessageId("a1");
    s.reset();
    expect(useAgentStore.getState().streamingMessageId).toBeNull();

    s.setActiveConversation(meta("c1"), [msg("a1")]);
    s.setStreamingMessageId("a1");
    s.setActiveConversation(meta("c2"), [msg("a1")]);
    expect(useAgentStore.getState().streamingMessageId).toBeNull();
  });

  it("survives the same thread reloaded while that message is still in it", () => {
    const s = useAgentStore.getState();
    s.setActiveConversation(meta("c1"), [msg("u1", "user"), msg("a1")]);
    s.setStreamingMessageId("a1");

    s.setActiveConversation(meta("c1"), [msg("u1", "user"), msg("a1")]);
    expect(useAgentStore.getState().streamingMessageId).toBe("a1");
    s.setActiveConversation(meta("c1"), [msg("u1", "user")]);
    expect(useAgentStore.getState().streamingMessageId).toBeNull();
  });
});

describe("useAgentStore – notices", () => {
  beforeEach(fresh);

  it("an error notice mirrors its text into error", () => {
    useAgentStore
      .getState()
      .setNotice({ tone: "error", kind: "server", text: "Amr can't reach it." });
    const s = useAgentStore.getState();
    expect(s.notice).toEqual({ tone: "error", kind: "server", text: "Amr can't reach it." });
    expect(s.error).toBe("Amr can't reach it.");
  });

  it("a note never sets error, and replaces an error shown before it", () => {
    const s = useAgentStore.getState();
    s.setNotice({ tone: "error", kind: "server", text: "Amr can't reach it." });
    s.setNotice({ tone: "note", kind: "cut", text: "The answer was cut short." });
    expect(useAgentStore.getState().notice?.tone).toBe("note");
    expect(useAgentStore.getState().error).toBeNull();
  });

  it("setNotice(null) clears both", () => {
    const s = useAgentStore.getState();
    s.setNotice({ tone: "error", kind: "server", text: "Amr can't reach it." });
    s.setNotice(null);
    expect(useAgentStore.getState().notice).toBeNull();
    expect(useAgentStore.getState().error).toBeNull();
  });

  it("setError still sets error, as an error notice, and null clears both", () => {
    const s = useAgentStore.getState();
    s.setError("Something broke.");
    expect(useAgentStore.getState().error).toBe("Something broke.");
    expect(useAgentStore.getState().notice).toEqual({
      tone: "error",
      kind: "error",
      text: "Something broke.",
    });
    s.setNotice({ tone: "note", kind: "cut", text: "The answer was cut short." });
    s.setError(null);
    expect(useAgentStore.getState().notice).toBeNull();
    expect(useAgentStore.getState().error).toBeNull();
  });

  it("New chat and opening a thread clear the notice", () => {
    const s = useAgentStore.getState();
    s.setNotice({ tone: "note", kind: "cut", text: "The answer was cut short." });
    s.reset();
    expect(useAgentStore.getState().notice).toBeNull();

    s.setNotice({ tone: "error", kind: "server", text: "Amr can't reach it." });
    s.setActiveConversation(meta("c1"), []);
    expect(useAgentStore.getState().notice).toBeNull();
    expect(useAgentStore.getState().error).toBeNull();
  });
});

describe("useAgentStore – drafts", () => {
  beforeEach(fresh);

  it("keeps one draft per profile", () => {
    const s = useAgentStore.getState();
    s.setDraft("owner", "add a card saying flaky CI");
    s.setDraft("visitor", "how do I run a retro?");
    expect(useAgentStore.getState().drafts).toEqual({
      owner: "add a card saying flaky CI",
      visitor: "how do I run a retro?",
    });
  });

  it("an unchanged draft doesn't wake subscribers", () => {
    useAgentStore.getState().setDraft("owner", "same");
    const listener = vi.fn();
    const unsubscribe = useAgentStore.subscribe(listener);
    try {
      useAgentStore.getState().setDraft("owner", "same");
      expect(listener).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it("survives closing and reopening the panel, a look at History and a profile change", () => {
    const s = useAgentStore.getState();
    s.openSheet();
    s.setDraft("owner", "half a thought");
    s.closeSheet();
    s.toggleSheet();
    s.toggleSheet();
    s.openSheet();
    s.setActiveConversation(meta("c1"), [msg("a1")]);
    s.setActiveConversation(null, []);
    s.setChatProfile("visitor");
    s.setChatProfile("owner");
    expect(useAgentStore.getState().drafts.owner).toBe("half a thought");
  });

  it("New chat empties only the open profile's draft", () => {
    const s = useAgentStore.getState();
    s.setDraft("owner", "owner text");
    s.setDraft("visitor", "visitor text");
    s.reset();
    expect(useAgentStore.getState().drafts).toEqual({ owner: "", visitor: "visitor text" });
  });
});

describe("useAgentStore – stopping the live turn", () => {
  beforeEach(fresh);
  afterEach(() => useAgentStore.getState().setAbortTurn(null));

  it("Stop calls the turn's abort once, with 'stop', and denies a waiting card", () => {
    const abort = liveTurn();
    const pending = makePending();
    useAgentStore.getState().setPendingToolUse(pending);

    useAgentStore.getState().abortTurn("stop");
    useAgentStore.getState().abortTurn("stop");

    expect(abort).toHaveBeenCalledTimes(1);
    expect(abort).toHaveBeenCalledWith("stop");
    expect(pending.resolve).toHaveBeenCalledWith(false);
    expect(useAgentStore.getState().pendingToolUse).toBeNull();
    expect(useAgentStore.getState().abortHook).toBeNull();
  });

  it("New chat and sign-out (both reset) stop the turn before the chat empties", () => {
    const s = useAgentStore.getState();
    s.setActiveConversation(meta("c1"), [msg("u1", "user")]);
    let seen: string | null = "never ran";
    const abort = vi.fn<TurnAbort>(() => {
      seen = useAgentStore.getState().activeConversationId;
    });
    s.setAbortTurn(abort);
    s.setStreaming(true);

    s.reset();

    expect(abort).toHaveBeenCalledTimes(1);
    expect(abort).toHaveBeenCalledWith("reset");
    expect(seen).toBe("c1");
    expect(useAgentStore.getState().streaming).toBe(false);

    // A second reset (the sign-out path after New chat) has nothing left to stop.
    s.reset();
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it("opening another thread stops the turn; reloading the same one doesn't", () => {
    const s = useAgentStore.getState();
    s.setActiveConversation(meta("c1"), [msg("u1", "user")]);
    const abort = liveTurn();
    s.setStreaming(true);

    s.setActiveConversation(meta("c1"), [msg("u1", "user")]);
    expect(abort).not.toHaveBeenCalled();
    expect(useAgentStore.getState().streaming).toBe(true);

    s.setActiveConversation(meta("c2"), []);
    expect(abort).toHaveBeenCalledTimes(1);
    expect(abort).toHaveBeenCalledWith("thread");
    expect(useAgentStore.getState().streaming).toBe(false);
  });

  it("opening a thread from a fresh draft stops the draft's turn", () => {
    const abort = liveTurn();
    useAgentStore.getState().setActiveConversation(meta("c1"), []);
    expect(abort).toHaveBeenCalledWith("thread");
  });

  it("a profile change stops the turn, turns Approve all off and denies a waiting card", () => {
    const s = useAgentStore.getState();
    const abort = liveTurn();
    const pending = makePending();
    s.setAutoApprove(true);
    s.setPendingToolUse(pending);

    s.setChatProfile("visitor");

    const after = useAgentStore.getState();
    expect(abort).toHaveBeenCalledTimes(1);
    expect(abort).toHaveBeenCalledWith("profile");
    expect(after.chatProfile).toBe("visitor");
    expect(after.autoApprove).toBe(false);
    expect(after.pendingToolUse).toBeNull();
    expect(pending.resolve).toHaveBeenCalledWith(false);
  });

  it("setting the same profile again (every send does) changes nothing", () => {
    const s = useAgentStore.getState();
    const abort = liveTurn();
    const pending = makePending();
    s.setAutoApprove(true);
    s.setPendingToolUse(pending);
    s.setStreaming(true);

    s.setChatProfile("owner");

    const after = useAgentStore.getState();
    expect(abort).not.toHaveBeenCalled();
    expect(after.autoApprove).toBe(true);
    expect(after.pendingToolUse).toBe(pending);
    expect(after.streaming).toBe(true);
    expect(pending.resolve).not.toHaveBeenCalled();
  });

  it("closing the panel never stops the turn, by any close path", () => {
    const s = useAgentStore.getState();
    const abort = liveTurn();
    s.setStreaming(true);
    s.appendMessage(msg("a1"));
    s.setStreamingMessageId("a1");

    s.openSheet();
    s.closeSheet();
    s.openSheet();
    s.toggleSheet();

    const after = useAgentStore.getState();
    expect(abort).not.toHaveBeenCalled();
    expect(after.abortHook).toBe(abort);
    expect(after.streaming).toBe(true);
    expect(after.streamingMessageId).toBe("a1");
    expect(after.messages.map((m) => m.id)).toEqual(["a1"]);
  });

  it("a turn tidying up drops only its own abort", () => {
    const s = useAgentStore.getState();
    const first = liveTurn();
    const second = liveTurn();

    s.clearAbortTurn(first);
    expect(useAgentStore.getState().abortHook).toBe(second);
    s.clearAbortTurn(second);
    expect(useAgentStore.getState().abortHook).toBeNull();
  });

  it("an abort that throws doesn't stop New chat from finishing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const s = useAgentStore.getState();
      s.appendMessage(msg("u1", "user"));
      s.setAbortTurn(() => {
        throw new Error("boom");
      });
      s.reset();
      expect(useAgentStore.getState().messages).toEqual([]);
      expect(useAgentStore.getState().abortHook).toBeNull();
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("useAgentStore – attachConversation", () => {
  beforeEach(fresh);
  afterEach(() => useAgentStore.getState().setAbortTurn(null));

  it("gives the live chat its new conversation and leaves everything else as it was", () => {
    const s = useAgentStore.getState();
    const abort = liveTurn();
    const pending = makePending();
    s.appendMessage(msg("u1", "user"));
    s.appendMessage(msg("a1"));
    s.setStreaming(true);
    s.setStreamingMessageId("a1");
    s.setPendingToolUse(pending);
    s.setNotice({ tone: "note", kind: "cut", text: "The answer was cut short." });
    const before = useAgentStore.getState().messages;

    expect(s.attachConversation(meta("c1"), "u1")).toBe(true);

    const after = useAgentStore.getState();
    expect(after.activeConversationId).toBe("c1");
    expect(after.activeMeta).toEqual(meta("c1"));
    expect(after.messages).toBe(before);
    expect(after.streaming).toBe(true);
    expect(after.streamingMessageId).toBe("a1");
    expect(after.pendingToolUse).toBe(pending);
    expect(after.notice?.kind).toBe("cut");
    expect(abort).not.toHaveBeenCalled();
    expect(pending.resolve).not.toHaveBeenCalled();
  });

  it("updates the open thread's details in place", () => {
    const s = useAgentStore.getState();
    s.setActiveConversation(meta("c1"), [msg("a1")]);
    const renamed = { ...meta("c1"), title: "Flaky CI" };
    expect(s.attachConversation(renamed)).toBe(true);
    expect(useAgentStore.getState().activeMeta?.title).toBe("Flaky CI");
  });

  it("won't attach while another thread is open", () => {
    const s = useAgentStore.getState();
    s.setActiveConversation(meta("c2"), [msg("a2")]);
    expect(s.attachConversation(meta("c1"))).toBe(false);
    expect(useAgentStore.getState().activeConversationId).toBe("c2");
  });

  it("won't attach once the chat no longer holds the message it was made for", () => {
    const s = useAgentStore.getState();
    s.appendMessage(msg("u1", "user"));
    s.reset();
    expect(s.attachConversation(meta("c1"), "u1")).toBe(false);
    expect(useAgentStore.getState().activeConversationId).toBeNull();
  });
});

describe("useAgentStore – retitleConversation", () => {
  beforeEach(fresh);

  it("renames the open thread in place, keeping its messages and the live turn", () => {
    const s = useAgentStore.getState();
    s.setActiveConversation(meta("c1"), [msg("a1")]);
    s.setStreaming(true);
    const before = useAgentStore.getState();

    s.retitleConversation("c1", "Flaky CI");

    const after = useAgentStore.getState();
    expect(after.activeMeta).toEqual({ ...meta("c1"), title: "Flaky CI" });
    expect(after.activeConversationId).toBe("c1");
    expect(after.messages).toBe(before.messages);
    expect(after.streaming).toBe(true);
  });

  it("changes nothing for another thread, no thread, or the same title", () => {
    const s = useAgentStore.getState();
    s.retitleConversation("c1", "Flaky CI");
    expect(useAgentStore.getState().activeMeta).toBeNull();

    s.setActiveConversation(meta("c1"), []);
    const open = useAgentStore.getState().activeMeta;
    s.retitleConversation("c2", "Flaky CI");
    expect(useAgentStore.getState().activeMeta).toBe(open);
    s.retitleConversation("c1", open!.title);
    expect(useAgentStore.getState().activeMeta).toBe(open);
  });
});
