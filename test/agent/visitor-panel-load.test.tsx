import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  announce: vi.fn(),
  sendVisitorMessage: vi.fn(async () => {}),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/retro",
}));
// The visitor chat's runtime (registry + client), loaded on the first message.
vi.mock("@/lib/agent/visitor-runtime", () => ({
  sendVisitorMessage: h.sendVisitorMessage,
  abortInFlight: vi.fn(),
}));
vi.mock("@/components/a11y/live-announcer", () => ({
  useAnnounce: () => h.announce,
}));

import { VISITOR_AI_CONSENT_KEY } from "@/components/agent/mascot/visitor-ai-consent";
import {
  VISITOR_CHAT_ERROR_NOTE,
  VISITOR_CHAT_LOAD_NOTE,
  VisitorPanel,
} from "@/components/agent/mascot/visitor-panel";
import { ErrorBoundary } from "@/components/layout/error-boundary";
import { useAgentStore } from "@/lib/agent/store";

type ChatModule = typeof import("@/components/agent/mascot/visitor-agent-panel");

// React throws the caught error again while it renders, and jsdom prints it.
// This one is expected, so it is kept out of the test output.
const quiet = (event: ErrorEvent) => event.preventDefault();

describe("VisitorPanel: the chat's code can't load", () => {
  beforeEach(() => {
    h.announce.mockClear();
    h.sendVisitorMessage.mockClear();
    window.localStorage.setItem(VISITOR_AI_CONSENT_KEY, "v1");
    useAgentStore.getState().reset();
    useAgentStore.setState({ chatProfile: "owner", visitorQuota: null });
    // React and the error boundary both log the error they caught.
    vi.spyOn(console, "error").mockImplementation(() => {});
    window.addEventListener("error", quiet);
  });

  afterEach(() => {
    useAgentStore.getState().reset();
    useAgentStore.setState({ chatProfile: "owner", visitorQuota: null });
    window.localStorage.removeItem(VISITOR_AI_CONSENT_KEY);
    window.removeEventListener("error", quiet);
    vi.restoreAllMocks();
  });

  it("goes back to the guide with a note, and the next try imports the chat again", async () => {
    const loadChat = vi
      .fn<() => Promise<ChatModule>>()
      .mockRejectedValueOnce(new Error("Loading chunk 123 failed."))
      .mockImplementation(() => import("@/components/agent/mascot/visitor-agent-panel"));

    // The outer boundary stands in for the app shell's: it must not catch this.
    render(
      <ErrorBoundary name="App shell">
        <VisitorPanel loadChat={loadChat} />
      </ErrorBoundary>
    );
    // Nothing is imported before the visitor asks.
    expect(loadChat).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("What do you need to do?"), {
      target: { value: "retro" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask Amr about “retro”" }));

    const note = await screen.findByText(VISITOR_CHAT_LOAD_NOTE);
    expect(loadChat).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("mascot-visitor-guide")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).toBeNull();
    expect(screen.queryByLabelText("Message")).toBeNull();
    // Focus is on the note, which is how a screen reader hears it: the
    // announcer does not say it a second time. The focus moves in an effect,
    // just after the note is drawn.
    await waitFor(() => expect(note).toHaveFocus());
    expect(h.announce).not.toHaveBeenCalled();
    expect(note).not.toHaveAttribute("role");

    // A second try: the note goes, the import runs again and the chat opens.
    fireEvent.click(screen.getByRole("button", { name: "Chat with Amr" }));
    expect(screen.queryByText(VISITOR_CHAT_LOAD_NOTE)).toBeNull();
    expect(await screen.findByLabelText("Message")).toBeInTheDocument();
    expect(loadChat).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Something went wrong")).toBeNull();
    // The question that failed was dropped, not sent late.
    expect(h.sendVisitorMessage).not.toHaveBeenCalled();
    expect(h.announce).not.toHaveBeenCalled();
  });

  it("a panel closed while the chat was loading does not leave the failure to the next one", async () => {
    let failLoad: (err: Error) => void = () => {};
    const loadChat = vi
      .fn<() => Promise<ChatModule>>()
      .mockImplementationOnce(
        () =>
          new Promise<ChatModule>((_resolve, reject) => {
            failLoad = reject;
          })
      )
      .mockImplementation(() => import("@/components/agent/mascot/visitor-agent-panel"));

    const first = render(<VisitorPanel loadChat={loadChat} />);
    fireEvent.click(screen.getByRole("button", { name: "Chat with Amr" }));
    await waitFor(() => expect(loadChat).toHaveBeenCalledTimes(1));
    // Closed while the chunk is on its way. Then the import fails, with no
    // panel there to see it.
    first.unmount();
    await act(async () => {
      failLoad(new Error("Loading chunk 123 failed."));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // The next panel's first try imports again and opens the chat.
    render(<VisitorPanel loadChat={loadChat} />);
    fireEvent.click(screen.getByRole("button", { name: "Chat with Amr" }));
    expect(await screen.findByLabelText("Message")).toBeInTheDocument();
    expect(loadChat).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(VISITOR_CHAT_LOAD_NOTE)).toBeNull();
  });

  it("says so when the loaded chat fails while it is drawn, and keeps its code", async () => {
    const Broken = () => {
      throw new Error("boom");
    };
    const loadChat = vi.fn(async () => ({ default: Broken }) as unknown as ChatModule);

    render(
      <ErrorBoundary name="App shell">
        <VisitorPanel loadChat={loadChat} />
      </ErrorBoundary>
    );
    fireEvent.click(screen.getByRole("button", { name: "Chat with Amr" }));

    // Not the connection's fault, so the note doesn't blame it.
    const note = await screen.findByText(VISITOR_CHAT_ERROR_NOTE);
    await waitFor(() => expect(note).toHaveFocus());
    expect(screen.queryByText(VISITOR_CHAT_LOAD_NOTE)).toBeNull();
    expect(screen.getByTestId("mascot-visitor-guide")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).toBeNull();
    expect(loadChat).toHaveBeenCalledTimes(1);

    // Asking again draws the chat that loaded: nothing is imported twice.
    fireEvent.click(screen.getByRole("button", { name: "Chat with Amr" }));
    expect(await screen.findByText(VISITOR_CHAT_ERROR_NOTE)).toBeInTheDocument();
    expect(loadChat).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Something went wrong")).toBeNull();
  });
});
