/**
 * The end of a visitor's reply (chat/reply-end) as the visitor's chat wires
 * it (mascot/visitor-agent-panel, Amr chat revamp PR 11). The chat's first
 * paint doesn't carry it: it loads with the first message, beside the
 * runtime, and never holds the turn up. A reply that settles before it is in
 * gets it as it arrives. Its Try again is the runtime's, the same one the
 * notice offers, and says what it spends: one of the messages left today, or
 * fewer in busy hours; with none left, it isn't offered.
 *
 * The chat keeps the runtime and the reply's end in module scope, so each
 * test imports a fresh copy of the chat and the store, the runtime mocked,
 * and the reply's end behind a gate the test may hold shut.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { VisitorQuota } from "@/lib/agent/store";
import type { ChatMessage } from "@/lib/agent/types";

const h = vi.hoisted(() => ({
  sendVisitorMessage: vi.fn<(text: string, opts: { toolId: string | null }) => Promise<void>>(),
  retryVisitorTurn: vi.fn<(opts: { toolId: string | null }) => Promise<boolean>>(async () => true),
  canRetryLastTurn: vi.fn<(messages: unknown[]) => boolean>(() => true),
  /** Holds chat/reply-end's module back until it opens. */
  endGate: Promise.resolve(),
  openEnd: () => {},
}));

vi.mock("next/navigation", () => ({ usePathname: () => "/retro" }));

type Chat = typeof import("@/components/agent/mascot/visitor-agent-panel").default;
type Store = typeof import("@/lib/agent/store").useAgentStore;

let VisitorAgentPanel: Chat;
let useAgentStore: Store;

const AT = "2026-11-16T09:00:00Z";
const REPLY = "Open the board, then add a card.";

const quota = (remaining: number, more: Partial<VisitorQuota> = {}): VisitorQuota => ({
  remaining,
  limit: 25,
  peak: false,
  peakRemaining: null,
  peakLimit: null,
  peakEndsAt: null,
  ...more,
});

/** The turn the mocked runtime runs: the question, Amr's reply, the route's allowance. */
function answersWith(left: VisitorQuota) {
  h.sendVisitorMessage.mockImplementation(async (text) => {
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", content: [{ type: "text", text }], createdAt: AT },
      { id: "a1", role: "assistant", content: [{ type: "text", text: REPLY }], createdAt: AT },
    ];
    useAgentStore.setState({ messages, visitorQuota: left });
  });
}

/** Let effects, microtasks and timers queued by the last step run. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

const replyEnd = () => document.querySelector<HTMLElement>("[data-chat-reply-end]");

/** Settle until the reply's end is drawn (its module loads on its own time). */
async function untilEnd(): Promise<HTMLElement> {
  for (let i = 0; i < 100 && !replyEnd(); i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  const end = replyEnd();
  expect(end, "the reply's end").not.toBeNull();
  return end!;
}

/**
 * Ask Amr from the message box, as a visitor types and presses Send, and
 * settle until it has gone out: the runtime, with the strip kit, loads on its
 * own time.
 */
async function ask(text: string) {
  const sent = h.sendVisitorMessage.mock.calls.length;
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await settle();
  for (let i = 0; i < 300 && h.sendVisitorMessage.mock.calls.length === sent; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  await settle();
}

beforeEach(async () => {
  h.sendVisitorMessage.mockReset();
  h.retryVisitorTurn.mockClear();
  h.canRetryLastTurn.mockClear();
  h.endGate = Promise.resolve();
  vi.resetModules();
  vi.doMock("@/lib/agent/visitor-runtime", () => ({
    sendVisitorMessage: h.sendVisitorMessage,
    abortInFlight: vi.fn(),
    retryVisitorTurn: h.retryVisitorTurn,
    visitorGoOn: vi.fn(async () => true),
    canRetryLastTurn: h.canRetryLastTurn,
  }));
  vi.doMock("@/components/agent/chat/reply-end", async (importOriginal) => {
    await h.endGate;
    return importOriginal();
  });
  VisitorAgentPanel = (await import("@/components/agent/mascot/visitor-agent-panel")).default;
  // The parts that draw messages, in this fresh module graph: a seeded chat
  // draws at once, as the runtime that writes messages would have brought them.
  await import("@/components/agent/chat/strip-kit");
  useAgentStore = (await import("@/lib/agent/store")).useAgentStore;
  useAgentStore.getState().reset();
  useAgentStore.setState({ visitorQuota: null });
  useAgentStore.getState().setDraft("visitor", "");
  if (typeof Element.prototype.scrollTo !== "function") Element.prototype.scrollTo = () => {};
});

afterEach(async () => {
  h.openEnd();
  await settle();
  useAgentStore.getState().reset();
  useAgentStore.getState().setDraft("visitor", "");
});

describe("the end of a visitor's reply", () => {
  it("loads with the first message, never holds the turn up, and is drawn as it arrives", async () => {
    h.endGate = new Promise<void>((resolve) => {
      h.openEnd = resolve;
    });
    answersWith(quota(12));
    render(<VisitorAgentPanel initialQuestion="" onOfflineGuide={() => {}} />);
    await settle();
    await ask("How do I run a retro?");
    // The turn went out and its reply settled while the end was still loading.
    expect(h.sendVisitorMessage).toHaveBeenCalledTimes(1);
    expect(screen.getByText(REPLY)).toBeInTheDocument();
    expect(replyEnd()).toBeNull();

    await act(async () => h.openEnd());
    const end = await untilEnd();
    // Right under the reply's balloon.
    expect(end.previousElementSibling).toHaveAttribute("data-message-id", "a1");
    expect(within(end).getByRole("button", { name: "Copy reply" })).toBeInTheDocument();
  });

  it("offers the runtime's Try again, saying what it spends, and none once no message is left", async () => {
    answersWith(quota(12));
    render(<VisitorAgentPanel initialQuestion="" onOfflineGuide={() => {}} />);
    await settle();
    await ask("How do I run a retro?");
    const end = await untilEnd();
    // The runtime that ran the turn says whether it may run again.
    expect(h.canRetryLastTurn).toHaveBeenCalled();
    fireEvent.click(
      within(end).getByRole("button", { name: "Try again (uses 1 of your 12 left)" })
    );
    await settle();
    expect(h.retryVisitorTurn).toHaveBeenCalledTimes(1);
    expect(h.retryVisitorTurn).toHaveBeenCalledWith({ toolId: "retro" });

    // Busy hours: the window's allowance, when it is the smaller.
    act(() =>
      useAgentStore.setState({ visitorQuota: quota(12, { peak: true, peakRemaining: 1 }) })
    );
    expect(
      within(await untilEnd()).getByRole("button", { name: "Try again (uses your last message)" })
    ).toBeInTheDocument();

    // None left: no Try again, though Copy stays.
    act(() => useAgentStore.setState({ visitorQuota: quota(0) }));
    const spent = await untilEnd();
    expect(within(spent).queryByRole("button", { name: /Try again/ })).toBeNull();
    expect(within(spent).getByRole("button", { name: "Copy reply" })).toBeInTheDocument();
  });

  it("offers no Try again after a turn the runtime says ran a change", async () => {
    h.canRetryLastTurn.mockImplementation(() => false);
    answersWith(quota(12));
    render(<VisitorAgentPanel initialQuestion="" onOfflineGuide={() => {}} />);
    await settle();
    await ask("Add flaky CI to the board");
    const end = await untilEnd();
    expect(within(end).queryByRole("button", { name: /Try again/ })).toBeNull();
    expect(within(end).getByRole("button", { name: "Copy reply" })).toBeInTheDocument();
  });
});
