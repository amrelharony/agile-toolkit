/**
 * The owner's Approve-all chip (src/components/agent/chat/auto-approve-chip.tsx):
 * while Approve all holds, a narration caption under the panel's header says
 * "Not asking before changes", over the chat and History alike, with "Ask
 * before changes again", which turns it off and hands focus on before the
 * chip goes. Owner only: nothing a visitor's chat loads imports it.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// The panel fills the action registry; the chip doesn't need it.
vi.mock("@/lib/actions/register-all", () => ({}));
vi.mock("@/components/agent/agent-conversation", () => ({
  AgentConversation: () => (
    <div data-testid="agent-conversation">
      <textarea aria-label="Message" data-amr-composer="" />
    </div>
  ),
}));
vi.mock("@/components/agent/conversation-list", () => ({
  ConversationList: () => <div data-testid="conversation-list" />,
}));
vi.mock("@/components/agent/mascot/rate-limit-bar", () => ({
  RateLimitBar: () => <div data-testid="rate-limit-bar" />,
}));

import {
  ASKING_AGAIN,
  ASK_AGAIN,
  AutoApproveChip,
  NOT_ASKING,
} from "@/components/agent/chat/auto-approve-chip";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import OwnerAgentPanel from "@/components/agent/mascot/owner-agent-panel";
import { PanelHeader } from "@/components/agent/mascot/panel-header";
import { PANEL_SUBTITLE, PanelChrome } from "@/components/agent/mascot/panel-chrome";
import { useAgentStore } from "@/lib/agent/store";

/** The owner's panel in its shell: the header, and whether History shows. */
function Shell() {
  const [showHistory, setShowHistory] = useState(false);
  return (
    <LiveAnnouncerProvider>
      <div role="dialog" aria-label="Amr">
        <PanelChrome>
          <PanelHeader subtitle={PANEL_SUBTITLE.owner} onClose={() => {}} />
          <OwnerAgentPanel
            showHistory={showHistory}
            onToggleHistory={() => setShowHistory((v) => !v)}
            onCloseHistory={() => setShowHistory(false)}
          />
        </PanelChrome>
      </div>
    </LiveAnnouncerProvider>
  );
}

/** The page on a touch screen: (pointer: coarse) matches, nothing else does. */
const touchScreen = () =>
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: query.includes("pointer: coarse"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
      }) as unknown as MediaQueryList
  );

const chip = () => document.querySelector<HTMLElement>("[data-auto-approve]");
const askAgain = () => screen.getByRole("button", { name: ASK_AGAIN });
const box = () => screen.getByRole("textbox", { name: "Message" });
afterEach(() => {
  vi.restoreAllMocks();
  useAgentStore.getState().reset();
});

describe("the Approve-all chip", () => {
  it("shows nothing while Amr asks before changes", () => {
    render(<Shell />);
    expect(chip()).toBeNull();
    expect(screen.queryByText(NOT_ASKING)).toBeNull();
  });

  it("says Approve all is on, in a narration caption under the header, over the chat and History", () => {
    useAgentStore.getState().setAutoApprove(true);
    render(<Shell />);
    const caption = screen.getByText(NOT_ASKING).closest('[data-voice="narration"]');
    expect(caption).toHaveClass("comic-caption");
    expect(caption).toContainElement(askAgain());
    // Under the header, not in it, and before the chat.
    const header = document.querySelector("[data-panel-header]")!;
    expect(header).not.toContainElement(chip());
    expect(header.compareDocumentPosition(chip()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      chip()!.compareDocumentPosition(screen.getByTestId("agent-conversation")) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    // Not a live region, and never hidden in compact mode (it holds a control).
    expect(chip()!.closest("[aria-live]")).toBeNull();
    expect(chip()!.className).not.toMatch(/amr-compact/);
    // Sentence case, no pill.
    expect(chip()!.innerHTML).not.toMatch(/uppercase|rounded-full/);

    fireEvent.click(
      within(header as HTMLElement).getByRole("button", { name: "Conversation history" })
    );
    expect(screen.getByTestId("conversation-list")).toBeInTheDocument();
    expect(screen.getByText(NOT_ASKING)).toBeInTheDocument();
  });

  it("turns Approve all off, hands focus to the message box first, and says so", async () => {
    useAgentStore.getState().setAutoApprove(true);
    render(<Shell />);
    askAgain().focus();
    fireEvent.click(askAgain(), { detail: 1 });
    expect(useAgentStore.getState().autoApprove).toBe(false);
    expect(chip()).toBeNull();
    expect(box()).toHaveFocus();
    // The app's polite region, a moment later (it clears first, so the same words are said again).
    await waitFor(() => expect(screen.getByTestId("live-polite")).toHaveTextContent(ASKING_AGAIN));
  });

  it("does the same from the keyboard", () => {
    useAgentStore.getState().setAutoApprove(true);
    render(<Shell />);
    askAgain().focus();
    // A key press clicks with detail 0.
    fireEvent.click(askAgain(), { detail: 0 });
    expect(useAgentStore.getState().autoApprove).toBe(false);
    expect(box()).toHaveFocus();
  });

  it("leaves the message box alone after a tap on a touch screen, so no keyboard rises", () => {
    touchScreen();
    useAgentStore.getState().setAutoApprove(true);
    render(<Shell />);
    fireEvent.click(askAgain(), { detail: 1 });
    expect(useAgentStore.getState().autoApprove).toBe(false);
    expect(box()).not.toHaveFocus();
  });

  it("goes when the panel closes, since closing turns Approve all off", () => {
    useAgentStore.getState().setAutoApprove(true);
    render(<Shell />);
    expect(chip()).not.toBeNull();
    act(() => useAgentStore.getState().closeSheet());
    expect(chip()).toBeNull();
  });

  it("works outside a dialog too, finding the composer on the page", () => {
    useAgentStore.getState().setAutoApprove(true);
    render(
      <>
        <AutoApproveChip />
        <textarea aria-label="Message" data-amr-composer="" defaultValue="half typed" />
      </>
    );
    fireEvent.click(askAgain(), { detail: 1 });
    expect(box()).toHaveFocus();
    expect((box() as HTMLTextAreaElement).selectionStart).toBe("half typed".length);
  });
});

describe("the chip's bundle", () => {
  const src = path.resolve(__dirname, "../../src");
  /** Every source file under src that imports the chip. */
  function importers(dir: string, found: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) importers(full, found);
      else if (
        /\.tsx?$/.test(entry.name) &&
        /auto-approve-chip["']/.test(readFileSync(full, "utf8"))
      )
        found.push(path.relative(src, full).replace(/\\/g, "/"));
    }
    return found;
  }

  it("is imported by the owner's panel alone, so the chunk both chats share never carries it", () => {
    expect(importers(src)).toEqual(["components/agent/mascot/owner-agent-panel.tsx"]);
  });
});
