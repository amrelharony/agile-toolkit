/**
 * A visitor's turn still starting (Amr chat revamp, PR 3): the first message
 * loads the agent runtime, and the turn goes out once it has, even when the
 * chat closed meanwhile. A chat opened again during that load must see the
 * turn as busy, or its own question goes out too and the second turn aborts
 * the first one's request after it was sent (spending a visitor message, and
 * leaving the first question with no answer).
 *
 * The runtime import waits on a gate the test opens by hand. The chat keeps
 * the loaded runtime in module scope, so each test imports a fresh copy of
 * the chat and the store, with the runtime mocked again behind a new gate.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  gate: Promise.resolve(),
  open: () => {},
  sendVisitorMessage: vi.fn<(text: string, opts: { toolId: string | null }) => Promise<void>>(
    async () => {}
  ),
}));

vi.mock("next/navigation", () => ({ usePathname: () => "/retro" }));

/** The runtime, as a factory that loads once its gate opens. */
async function gatedRuntime() {
  await h.gate;
  return {
    sendVisitorMessage: h.sendVisitorMessage,
    abortInFlight: vi.fn(),
    retryVisitorTurn: vi.fn(async () => true),
    visitorGoOn: vi.fn(async () => true),
    canRetryLastTurn: vi.fn(() => false),
  };
}

type Chat = typeof import("@/components/agent/mascot/visitor-agent-panel").default;
type Store = typeof import("@/lib/agent/store").useAgentStore;

let VisitorAgentPanel: Chat;
let useAgentStore: Store;

/** Let effects, microtasks and timers queued by the last step run. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

beforeEach(async () => {
  h.sendVisitorMessage.mockClear();
  h.gate = new Promise<void>((resolve) => {
    h.open = resolve;
  });
  vi.resetModules();
  vi.doMock("@/lib/agent/visitor-runtime", gatedRuntime);
  VisitorAgentPanel = (await import("@/components/agent/mascot/visitor-agent-panel")).default;
  useAgentStore = (await import("@/lib/agent/store")).useAgentStore;
  useAgentStore.getState().reset();
  useAgentStore.setState({ chatProfile: "owner", visitorQuota: null });
  useAgentStore.getState().setDraft("visitor", "");
  if (typeof Element.prototype.scrollTo !== "function") Element.prototype.scrollTo = () => {};
});

afterEach(async () => {
  // A test that left the gate shut lets its turn finish here.
  h.open();
  await settle();
  useAgentStore.getState().reset();
  useAgentStore.getState().setDraft("visitor", "");
});

describe("a visitor's turn still starting when the chat opens again", () => {
  it("sends only the first question, and keeps a new one in the box", async () => {
    const first = render(<VisitorAgentPanel initialQuestion="retro" onOfflineGuide={() => {}} />);
    await settle();
    // The panel closes (or the visitor goes to the tool finder) mid-load.
    first.unmount();
    expect(h.sendVisitorMessage).not.toHaveBeenCalled();

    // The visitor asks something else from the guide while it still loads.
    render(<VisitorAgentPanel initialQuestion="sprint goal" onOfflineGuide={() => {}} />);
    await settle();
    // The chat reads as busy, not idle: Amr is thinking, and the box waits.
    expect(screen.getByText("Amr is thinking…")).toBeInTheDocument();
    expect(screen.getByLabelText("Message")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("Message")).toHaveValue("sprint goal");
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();

    await act(async () => h.open());
    await settle();
    expect(h.sendVisitorMessage).toHaveBeenCalledTimes(1);
    expect(h.sendVisitorMessage).toHaveBeenCalledWith("retro", { toolId: "retro" });
    expect(useAgentStore.getState().drafts.visitor).toBe("sprint goal");
    // The load is over: the chat is no longer busy, and Send asks the new question.
    expect(screen.getByLabelText("Message")).not.toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
  });

  it("sends the same question once, and leaves the box empty", async () => {
    const first = render(<VisitorAgentPanel initialQuestion="retro" onOfflineGuide={() => {}} />);
    await settle();
    first.unmount();

    // Tool finder, then the same "Ask Amr about ..." while it still loads.
    render(<VisitorAgentPanel initialQuestion="retro" onOfflineGuide={() => {}} />);
    await settle();
    expect(screen.getByLabelText("Message")).toHaveValue("");

    await act(async () => h.open());
    await settle();
    expect(h.sendVisitorMessage).toHaveBeenCalledTimes(1);
    expect(h.sendVisitorMessage).toHaveBeenCalledWith("retro", { toolId: "retro" });
    expect(useAgentStore.getState().drafts.visitor).toBe("");
  });

  it("leaves a draft typed in the new chat alone while the first turn starts", async () => {
    const first = render(<VisitorAgentPanel initialQuestion="retro" onOfflineGuide={() => {}} />);
    await settle();
    first.unmount();

    act(() => useAgentStore.getState().setDraft("visitor", "and how long"));
    render(<VisitorAgentPanel initialQuestion="" onOfflineGuide={() => {}} />);
    await settle();
    // Enter in the read-only box sends nothing and keeps the draft.
    const box = screen.getByLabelText("Message");
    fireEvent.keyDown(box, { key: "Enter" });
    await settle();
    expect(useAgentStore.getState().drafts.visitor).toBe("and how long");

    await act(async () => h.open());
    await settle();
    expect(h.sendVisitorMessage).toHaveBeenCalledTimes(1);
    expect(h.sendVisitorMessage).toHaveBeenCalledWith("retro", { toolId: "retro" });
    expect(useAgentStore.getState().drafts.visitor).toBe("and how long");
  });
});
