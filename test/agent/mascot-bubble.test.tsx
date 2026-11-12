/**
 * What Amr says beside himself: one short line at a time, sometimes with an
 * answer or two, in a balloon whose tail points at him; what the narrator says
 * there while his panel is shut and a turn runs; and his one offer to feel the
 * phone.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MascotBubble } from "@/components/agent/mascot/mascot-bubble";
import {
  MOTION_INVITE_ID,
  inviteMotion,
  shouldInviteMotion,
} from "@/components/agent/mascot/motion-invite";
import { BUBBLE_MS, bubbleMs, useBubbleStore } from "@/lib/agent/mascot/bubble";
import { MOTION_INVITE } from "@/lib/agent/mascot/lines";
import {
  AMR_ANSWERING,
  AMR_WAITING_FOR_OK,
  outsideNarration,
  outsidePhase,
  workingIn,
  type TurnView,
} from "@/lib/agent/mascot/outside-narration";
import { useMascotStore, type MascotCorner } from "@/lib/agent/mascot/store";
import { useAgentStore } from "@/lib/agent/store";
import { toolLabel } from "@/lib/agent/tool-label";
import type { ChatMessage, PendingToolUse } from "@/lib/agent/types";
import { PHONE_MEDIA_QUERY } from "@/lib/layout/breakpoints";
import { useMomentStore } from "@/lib/notify/moment-scheduler";

function stubMedia(matching: (query: string) => boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: matching(query),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

/** No turn, the panel shut, the owner's chat. */
const QUIET_CHAT = {
  open: false,
  chatProfile: "owner",
  streaming: false,
  pendingToolUse: null,
  messages: [],
} as const;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  useBubbleStore.setState({ current: null });
  useMascotStore.getState().reset();
  useMomentStore.setState({ current: null });
  useAgentStore.setState({ ...QUIET_CHAT, messages: [] });
  stubMedia(() => false);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  useBubbleStore.setState({ current: null });
  useMascotStore.getState().reset();
  useMomentStore.setState({ current: null });
  useAgentStore.setState({ ...QUIET_CHAT, messages: [] });
});

const bubble = () => document.querySelector<HTMLElement>("[data-amr-bubble]");
const region = () => document.querySelector<HTMLElement>("[data-amr-bubble-region]")!;
const status = () => screen.getByRole("status");

/** First person: a narration line never speaks as Amr. */
const FIRST_PERSON = /\b(I|I'm|I'll|I've|I'd|me|my|mine)\b/;

/** Put him at a corner as the assistant does: where he's drawn, and how far up. */
function placeAt(corner: MascotCorner, lift = 0) {
  act(() =>
    useMascotStore.getState().setPlacement(
      {
        side: corner.endsWith("Left") ? "left" : "right",
        edge: corner.startsWith("top") ? "top" : "bottom",
      },
      lift
    )
  );
}

function message(role: ChatMessage["role"], content: ChatMessage["content"]): ChatMessage {
  return { id: `${role}-${content.length}`, role, content, createdAt: "2026-11-12T10:00:00Z" };
}

const ASKED = message("user", [{ type: "text", text: "Add a card" }]);
const CALLING = message("assistant", [
  { type: "tool_use", id: "t1", name: "tool_retro_add_card", input: { text: "flaky CI" } },
]);

const PENDING: PendingToolUse = {
  toolUseId: "t1",
  actionId: "tool_retro_add_card",
  resolvedActionId: "tool.retro.add_card",
  input: { text: "flaky CI" },
  prompt: {
    verb: "Add card",
    title: "Retro Board",
    question: "Add a card to Retro Board?",
    detail: "",
    destructive: false,
  },
  resolve: () => {},
};

/** The owner's turn runs with the panel shut; tool-label loads for the bubble. */
async function turnRuns(state: Partial<ReturnType<typeof useAgentStore.getState>>) {
  act(() => useAgentStore.setState({ chatProfile: "owner", streaming: true, ...state }));
  await act(async () => {
    await vi.dynamicImportSettled();
  });
}

describe("<MascotBubble />", () => {
  it("says a line beside him, then lets it go", () => {
    render(<MascotBubble />);
    expect(status()).toBeEmptyDOMElement();
    act(() => useBubbleStore.getState().show({ id: "hi", text: "Welcome back" }));
    expect(status()).toHaveTextContent("Welcome back");
    act(() => {
      vi.advanceTimersByTime(BUBBLE_MS + 10);
    });
    expect(bubble()).toBeNull();
    expect(status()).toBeEmptyDOMElement();
  });

  it("keeps a line while it's held, then lets it go", () => {
    const onIgnore = vi.fn();
    render(<MascotBubble />);
    act(() => useBubbleStore.getState().show({ id: "hi", text: "Welcome back", onIgnore }));
    fireEvent.pointerEnter(bubble()!);
    act(() => {
      vi.advanceTimersByTime(BUBBLE_MS * 3);
    });
    expect(bubble()).not.toBeNull();
    fireEvent.pointerLeave(bubble()!);
    act(() => {
      vi.advanceTimersByTime(BUBBLE_MS + 10);
    });
    expect(bubble()).toBeNull();
    expect(onIgnore).toHaveBeenCalledTimes(1);
  });

  it("waits for a question's answer with no clock, until his panel opens", () => {
    const onIgnore = vi.fn();
    expect(bubbleMs({ actions: [{ label: "Yes", run: () => {} }] })).toBeNull();
    expect(bubbleMs({})).toBe(BUBBLE_MS);
    render(<MascotBubble />);
    act(() =>
      useBubbleStore.getState().show({
        id: "q",
        text: "Need a hand?",
        actions: [{ label: "Yes", run: () => {} }],
        onIgnore,
      })
    );
    act(() => {
      vi.advanceTimersByTime(BUBBLE_MS * 30);
    });
    expect(bubble()).not.toBeNull();
    expect(onIgnore).not.toHaveBeenCalled();
    // The panel holds the same choice: the question goes, unanswered, and doesn't come back.
    act(() => useAgentStore.setState({ open: true }));
    expect(bubble()).toBeNull();
    expect(onIgnore).toHaveBeenCalledTimes(1);
    act(() => useAgentStore.setState({ open: false }));
    expect(bubble()).toBeNull();
    expect(useBubbleStore.getState().current).toBeNull();
  });

  it("runs the answer from the tap itself, and that isn't being ignored", () => {
    const run = vi.fn();
    const onIgnore = vi.fn();
    render(<MascotBubble />);
    act(() =>
      useBubbleStore.getState().show({
        id: "q",
        text: "Need a hand?",
        actions: [
          { label: "Yes", run },
          { label: "No thanks", run: () => {} },
        ],
        onIgnore,
      })
    );
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(bubble()).toBeNull();
    expect(onIgnore).not.toHaveBeenCalled();
  });

  it("lets a line with no answers be tapped", () => {
    const onTap = vi.fn();
    render(<MascotBubble />);
    act(() => useBubbleStore.getState().show({ id: "help", text: "Need a hand?", onTap }));
    const tap = screen.getByRole("button", { name: "Need a hand?" });
    // The whole balloon is the tap, outside the live line.
    expect(bubble()).toContainElement(tap);
    expect(status()).not.toContainElement(tap);
    fireEvent.click(tap);
    expect(onTap).toHaveBeenCalledTimes(1);
    expect(bubble()).toBeNull();
  });

  it("waits its turn behind a moment chip and his open panel, its clock too", () => {
    render(<MascotBubble />);
    act(() => useMomentStore.setState({ current: { id: "m" } as never }));
    act(() => useBubbleStore.getState().show({ id: "hi", text: "Welcome back" }));
    expect(bubble()).toBeNull();
    act(() => {
      vi.advanceTimersByTime(BUBBLE_MS * 3);
    });
    act(() => useMomentStore.setState({ current: null }));
    expect(bubble()).not.toBeNull();
    act(() => useAgentStore.setState({ open: true }));
    expect(bubble()).toBeNull();
    act(() => useAgentStore.setState({ open: false }));
    expect(bubble()).not.toBeNull();
  });

  it("waits while a page field has a phone's keyboard, its clock and the narration too, losing nothing", async () => {
    const view = render(<MascotBubble waiting />);
    act(() => useBubbleStore.getState().show({ id: "hi", text: "Welcome back" }));
    expect(bubble()).toBeNull();
    expect(status()).toBeEmptyDOMElement();
    act(() => {
      vi.advanceTimersByTime(BUBBLE_MS * 3);
    });
    // The field lets go: the line shows, its clock starting now.
    view.rerender(<MascotBubble waiting={false} />);
    expect(status()).toHaveTextContent("Welcome back");
    act(() => {
      vi.advanceTimersByTime(BUBBLE_MS - 100);
    });
    expect(status()).toHaveTextContent("Welcome back");
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(bubble()).toBeNull();

    // A turn running with the panel shut: its narration waits as well.
    view.rerender(<MascotBubble waiting />);
    await turnRuns({ messages: [ASKED] });
    expect(bubble()).toBeNull();
    expect(status()).toBeEmptyDOMElement();
    view.rerender(<MascotBubble waiting={false} />);
    expect(status()).toHaveTextContent(AMR_ANSWERING);
  });

  it("is held still during a page change, empty or not, and the hold isn't live", () => {
    // globals.css names it only while a view transition runs (html[data-vt]).
    render(<MascotBubble />);
    expect(region()).toHaveAttribute("data-vt-hold", "amr-bubble");
    act(() => useBubbleStore.getState().show({ id: "hi", text: "Welcome back" }));
    expect(region()).toHaveAttribute("data-vt-hold", "amr-bubble");
    expect(document.querySelectorAll("[data-vt-hold]")).toHaveLength(1);
    // The status line is inside the held region; the region itself says nothing.
    expect(region()).toContainElement(status());
    expect(region()).not.toHaveAttribute("role");
    expect(region()).not.toHaveAttribute("aria-live");
  });

  it("keeps only the words in the live line: the answers sit beside it", () => {
    render(<MascotBubble />);
    const live = status();
    act(() =>
      useBubbleStore.getState().show({
        id: "q",
        text: "Need a hand?",
        actions: [
          { label: "Yes", run: () => {} },
          { label: "No thanks", run: () => {} },
        ],
      })
    );
    // The same element as before the line came: a live region is read only when it was already there.
    expect(status()).toBe(live);
    expect(live).toHaveTextContent(/^Need a hand\?$/);
    expect(live.childElementCount).toBe(0);
    expect(within(live).queryAllByRole("button")).toHaveLength(0);
    const answers = screen.getAllByRole("button");
    expect(answers.map((b) => b.textContent)).toEqual(["Yes", "No thanks"]);
    for (const b of answers) {
      expect(bubble()).toContainElement(b);
      expect(b.closest("[aria-live]")).toBeNull();
    }
  });

  it("replaces the line showing with a new one, which counts as ignoring the old", () => {
    const onIgnore = vi.fn();
    render(<MascotBubble />);
    act(() => useBubbleStore.getState().show({ id: "a", text: "One", onIgnore }));
    act(() => useBubbleStore.getState().show({ id: "b", text: "Two" }));
    expect(status()).toHaveTextContent("Two");
    expect(onIgnore).toHaveBeenCalledTimes(1);
  });
});

describe("his balloon's tail", () => {
  const CORNERS: MascotCorner[] = ["topLeft", "topRight", "bottomLeft", "bottomRight"];

  it.each(CORNERS)("points at him from the inside of his corner (%s)", (corner) => {
    render(<MascotBubble />);
    placeAt(corner);
    act(() => useBubbleStore.getState().show({ id: "hi", text: "Welcome back" }));
    const b = bubble()!;
    expect(b).toHaveClass("balloon");
    // Level with him, so the tail is on the edge facing him, counted from his screen edge.
    expect(b).toHaveAttribute("data-tail", corner.endsWith("Left") ? "left" : "right");
    expect(b).toHaveAttribute("data-tail-from", corner.startsWith("top") ? "top" : "bottom");
  });

  it.each(CORNERS)("points down at him, or up, on a phone (%s)", (corner) => {
    stubMedia((q) => q === PHONE_MEDIA_QUERY);
    render(<MascotBubble />);
    placeAt(corner);
    act(() => useBubbleStore.getState().show({ id: "hi", text: "Welcome back" }));
    const b = bubble()!;
    // Just past his band, so the tail points at him from the end on his side.
    expect(b).toHaveAttribute("data-tail", corner.startsWith("top") ? "up" : "down");
    expect(b).toHaveAttribute("data-tail-from", corner.endsWith("Left") ? "left" : "right");
  });

  it("follows him where he's drawn and as far as he's stepped up, not his chosen corner", () => {
    render(<MascotBubble />);
    act(() => useMascotStore.getState().setCorner("bottomRight"));
    act(() => useBubbleStore.getState().show({ id: "hi", text: "Welcome back" }));
    expect(region().style.right).toBe("156px");
    expect(region().style.bottom).toBe("24px");

    // Stepped aside to the other side and 48 px up: the bubble and its tail go too.
    placeAt("bottomLeft", 48);
    expect(region().style.left).toBe("156px");
    expect(region().style.right).toBe("");
    expect(region().style.bottom).toBe("72px");
    expect(bubble()).toHaveAttribute("data-tail", "left");

    // At the top he steps down from the header.
    placeAt("topLeft", 48);
    expect(region().style.top).toMatch(/var\(--header-h(?:,\s*56px)?\)/);
    expect(region().style.top).toContain("72px");
    expect(region().style.bottom).toBe("");
  });

  it("hides while he is carried: it would point at the spot he left", () => {
    // At his usual corner, bottom right: the tail on the balloon's right edge.
    render(<MascotBubble />);
    act(() => useBubbleStore.getState().show({ id: "hi", text: "Welcome back" }));
    expect(bubble()).toHaveAttribute("data-tail", "right");
    expect(bubble()).toHaveAttribute("data-tail-from", "bottom");

    act(() => useMascotStore.getState().setDrag(120));
    expect(bubble()).toHaveAttribute("data-tail", "none");
    expect(bubble()).not.toHaveAttribute("data-tail-from");
    expect(bubble()).toHaveClass("balloon");
    expect(status()).toHaveTextContent("Welcome back");

    // Dropped: it points at him again.
    act(() => useMascotStore.getState().setDrag(null));
    expect(bubble()).toHaveAttribute("data-tail", "right");
    expect(bubble()).toHaveAttribute("data-tail-from", "bottom");
  });

  it("follows a flip and a lift on a phone too", () => {
    stubMedia((q) => q === PHONE_MEDIA_QUERY);
    render(<MascotBubble />);
    act(() => useBubbleStore.getState().show({ id: "hi", text: "Welcome back" }));
    expect(region().style.right).toBe("16px");
    expect(region().style.bottom).toContain("8px");

    placeAt("bottomLeft", 144);
    expect(region().style.left).toBe("16px");
    expect(region().style.right).toBe("");
    expect(region().style.bottom).toContain("--amr-band-bottom");
    expect(region().style.bottom).toContain("152px");
    expect(bubble()).toHaveAttribute("data-tail", "down");
    expect(bubble()).toHaveAttribute("data-tail-from", "left");
  });
});

describe("narration while his panel is shut", () => {
  it("names the tool a turn is working in, in a caption with no tail", async () => {
    render(<MascotBubble />);
    await turnRuns({ messages: [ASKED, CALLING] });
    expect(status()).toHaveTextContent(/^Amr is working in Retro Board…$/);
    const caption = bubble()!;
    expect(caption).toHaveAttribute("data-amr-bubble", "narration");
    expect(caption).toHaveAttribute("data-voice", "narration");
    expect(caption).toHaveClass("comic-caption");
    expect(caption).not.toHaveClass("balloon");
    expect(caption).not.toHaveAttribute("data-tail");
    expect(caption).not.toHaveAttribute("data-tail-from");
    expect(status().textContent).not.toMatch(FIRST_PERSON);
    // Nothing to act on while he works.
    expect(screen.queryByRole("button")).toBeNull();

    // Between the calls and the words: still answering.
    act(() =>
      useAgentStore.setState({
        messages: [
          ASKED,
          CALLING,
          message("tool", [{ type: "tool_result", tool_use_id: "t1", content: "ok" }]),
        ],
      })
    );
    expect(status()).toHaveTextContent(AMR_ANSWERING);

    // The turn over, the narrator has nothing to say.
    act(() => useAgentStore.setState({ streaming: false }));
    expect(bubble()).toBeNull();
    expect(status()).toBeEmptyDOMElement();
  });

  it("says Amr is waiting for the OK, and Open brings the panel back to the card", async () => {
    render(<MascotBubble />);
    await turnRuns({ messages: [ASKED, CALLING], pendingToolUse: PENDING });
    expect(status()).toHaveTextContent(/^Amr is waiting for your OK$/);
    expect(bubble()).not.toHaveAttribute("data-tail");
    const open = screen.getByRole("button", { name: "Open" });
    // Open is beside the live line, and says what it opens for.
    expect(status()).not.toContainElement(open);
    expect(open).toHaveAccessibleDescription(AMR_WAITING_FOR_OK);
    fireEvent.click(open, { detail: 1 });
    expect(useAgentStore.getState().open).toBe(true);
    expect(useAgentStore.getState().openedVia).toBe("pointer");
    // The panel tells it from here.
    expect(bubble()).toBeNull();
  });

  it("opens the panel for a key on Open as a keyboard open", async () => {
    render(<MascotBubble />);
    await turnRuns({ pendingToolUse: PENDING });
    fireEvent.click(screen.getByRole("button", { name: "Open" }), { detail: 0 });
    expect(useAgentStore.getState().openedVia).toBe("keyboard");
  });

  it("comes before his own line, which waits with its clock stopped", async () => {
    render(<MascotBubble />);
    await turnRuns({ messages: [ASKED] });
    act(() => useBubbleStore.getState().show({ id: "hi", text: "Welcome back" }));
    expect(status()).toHaveTextContent(AMR_ANSWERING);
    act(() => {
      vi.advanceTimersByTime(BUBBLE_MS * 3);
    });
    act(() => useAgentStore.setState({ streaming: false }));
    expect(status()).toHaveTextContent("Welcome back");
    expect(bubble()).toHaveClass("balloon");
  });

  it("waits behind a moment chip, and says nothing with the panel open", async () => {
    render(<MascotBubble />);
    act(() => useMomentStore.setState({ current: { id: "m" } as never }));
    await turnRuns({ messages: [ASKED] });
    expect(bubble()).toBeNull();
    act(() => useMomentStore.setState({ current: null }));
    expect(status()).toHaveTextContent(AMR_ANSWERING);

    act(() => useAgentStore.setState({ open: true }));
    expect(bubble()).toBeNull();
    // Shut again, on a visitor's chat: the narrator tells it just the same.
    act(() => useAgentStore.setState({ open: false, chatProfile: "visitor" }));
    expect(status()).toHaveTextContent(AMR_ANSWERING);
  });

  it("tells a visitor's turn too, which outlives the panel as an owner's does", async () => {
    render(<MascotBubble />);
    await turnRuns({ chatProfile: "visitor", messages: [ASKED, CALLING] });
    expect(status()).toHaveTextContent(/^Amr is working in Retro Board…$/);
    expect(bubble()).toHaveAttribute("data-voice", "narration");
    expect(bubble()).not.toHaveAttribute("data-tail");

    // His own line waits behind it, its clock stopped, until the turn is over.
    act(() => useBubbleStore.getState().show({ id: "hi", text: "Welcome back" }));
    expect(status()).toHaveTextContent(/^Amr is working in Retro Board…$/);
    act(() => {
      vi.advanceTimersByTime(BUBBLE_MS * 3);
    });
    act(() => useAgentStore.setState({ messages: [ASKED] }));
    expect(status()).toHaveTextContent(AMR_ANSWERING);
    act(() => useAgentStore.setState({ streaming: false }));
    expect(status()).toHaveTextContent("Welcome back");
    expect(bubble()).toHaveClass("balloon");
  });
});

describe("the narration's lines", () => {
  const turn = (s: Partial<TurnView>): TurnView => ({ ...QUIET_CHAT, messages: [], ...s });

  it("reads the phase from the turn, one string per phase", () => {
    expect(outsidePhase(turn({}))).toBeNull();
    expect(outsidePhase(turn({ streaming: true }))).toBe("answering");
    expect(outsidePhase(turn({ streaming: true, messages: [ASKED, CALLING] }))).toBe(
      "tool:tool_retro_add_card"
    );
    expect(outsidePhase(turn({ pendingToolUse: PENDING }))).toBe("waiting");
    expect(outsidePhase(turn({ streaming: true, open: true }))).toBeNull();
    // A visitor's turn outlives the panel too.
    expect(outsidePhase(turn({ streaming: true, chatProfile: "visitor" }))).toBe("answering");
    expect(outsidePhase(turn({ pendingToolUse: PENDING, chatProfile: "visitor" }))).toBe("waiting");
    expect(outsidePhase(turn({ streaming: true, chatProfile: "visitor", open: true }))).toBeNull();
    // A tool's result is in: the call is no longer out.
    const answered = message("tool", [{ type: "tool_result", tool_use_id: "t1", content: "ok" }]);
    expect(outsidePhase(turn({ streaming: true, messages: [ASKED, CALLING, answered] }))).toBe(
      "answering"
    );
  });

  it("names a tool once tool-label is in, and never a raw name", () => {
    expect(outsideNarration("tool:tool_retro_add_card", null)).toBeNull();
    expect(outsideNarration("tool:tool_retro_add_card", toolLabel)).toBe(
      "Amr is working in Retro Board…"
    );
    expect(outsideNarration("tool:workspace_team_member_create", toolLabel)).toBe(
      "Amr is working in your workspace…"
    );
    expect(workingIn({ tool: "Tool", verb: "" })).toBe("Amr is working…");
    expect(outsideNarration(null, toolLabel)).toBeNull();
  });

  it("speaks of Amr in the third person, never as him", () => {
    const lines = [
      AMR_WAITING_FOR_OK,
      AMR_ANSWERING,
      outsideNarration("tool:tool_retro_add_card", toolLabel),
      outsideNarration("tool:intent_plan_sprint", toolLabel),
      workingIn({ tool: "Tool", verb: "" }),
    ];
    for (const line of lines) {
      expect(line).toMatch(/^Amr is /);
      expect(line).not.toMatch(FIRST_PERSON);
    }
  });
});

describe("his offer to feel the phone", () => {
  let ask: ReturnType<typeof vi.fn>;

  /** A phone that asks before it sends motion (as iOS does). */
  function askingPhone(answer: "granted" | "denied" = "granted") {
    ask = vi.fn(async () => answer);
    stubMedia((q) => q.includes("pointer: coarse"));
    vi.stubGlobal(
      "DeviceOrientationEvent",
      class {
        static requestPermission = ask;
      }
    );
    useMascotStore.getState().setReady(true);
  }

  it("is made once, on a phone that needs asking", () => {
    askingPhone();
    expect(shouldInviteMotion()).toBe(true);
    expect(inviteMotion()).toBe(true);
    expect(useBubbleStore.getState().current).toMatchObject({
      id: MOTION_INVITE_ID,
      text: MOTION_INVITE.text,
    });
    expect(ask).not.toHaveBeenCalled(); // only a tap may raise the browser's prompt
    // Left alone or answered, he doesn't ask again: not now, not on another visit.
    useBubbleStore.getState().dismiss();
    expect(inviteMotion()).toBe(false);
    useMascotStore.getState().reset();
    useMascotStore.getState().hydrateAppearance();
    useMascotStore.getState().setReady(true);
    expect(useMascotStore.getState().motionAsked).toBe(true);
    expect(inviteMotion()).toBe(false);
  });

  it("isn't made where motion needs no asking, on a desktop, or under reduced motion", () => {
    // No prompt to raise: he feels the phone from the start.
    stubMedia((q) => q.includes("pointer: coarse"));
    vi.stubGlobal("DeviceOrientationEvent", class {});
    useMascotStore.getState().setReady(true);
    expect(shouldInviteMotion()).toBe(false);

    askingPhone();
    stubMedia(() => false); // a mouse
    expect(shouldInviteMotion()).toBe(false);

    stubMedia(() => true); // coarse, and reduced motion too
    expect(shouldInviteMotion()).toBe(false);

    askingPhone();
    useMascotStore.getState().setFeelPhone(false); // already answered in the panel
    expect(shouldInviteMotion()).toBe(false);
  });

  it("raises the browser's prompt on Allow and keeps the answer", async () => {
    askingPhone("granted");
    render(<MascotBubble />);
    act(() => void inviteMotion());
    fireEvent.click(screen.getByRole("button", { name: MOTION_INVITE.allow }));
    expect(ask).toHaveBeenCalledTimes(1);
    expect(bubble()).toBeNull();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(useMascotStore.getState().feelPhone).toBe(true);
    expect(useMascotStore.getState().reactionQueue).toEqual(["startle"]);
    expect(JSON.parse(localStorage.getItem("mascot_appearance")!)).toMatchObject({
      feelPhone: true,
      motionAsked: true,
    });
  });

  it("takes No thanks for an answer", () => {
    askingPhone();
    render(<MascotBubble />);
    act(() => void inviteMotion());
    fireEvent.click(screen.getByRole("button", { name: MOTION_INVITE.decline }));
    expect(ask).not.toHaveBeenCalled();
    expect(useMascotStore.getState().feelPhone).toBe(false);
    expect(bubble()).toBeNull();
  });

  it("keeps a refusal at the browser's prompt as a no", async () => {
    askingPhone("denied");
    render(<MascotBubble />);
    act(() => void inviteMotion());
    fireEvent.click(screen.getByRole("button", { name: MOTION_INVITE.allow }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(useMascotStore.getState().feelPhone).toBe(false);
    expect(useMascotStore.getState().reactionQueue).toEqual([]);
  });
});
