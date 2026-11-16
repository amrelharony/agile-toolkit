/**
 * The empty chat (src/components/agent/chat/chat-empty.tsx) and its starters
 * (chat/suggestion-chips.tsx): a narration line in the third person and up
 * to three starters, held while the owner's resume check runs, cut to one
 * line and one starter in the 160 px panel. A starter fills the message box,
 * caret at the end, and never sends. No line or starter either chat can show
 * (lib/agent/owner-starters, lib/agent/visitor-starters) is in the first
 * person.
 */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRef, type FormEvent } from "react";
import type { ChatMessage, ConversationMeta } from "@/lib/agent/types";

// The owner's chat, for its resume check: Supabase and the agent client are
// stand-ins, and the thread list answers when the test says so.
const h = vi.hoisted(() => ({
  answerList: (() => {}) as (list: unknown[]) => void,
  messages: [] as unknown[],
  sendUserMessage: vi.fn(async () => {}),
}));
vi.mock("@/lib/agent/persist", () => ({
  listConversations: vi.fn(
    () =>
      new Promise((resolve) => {
        h.answerList = resolve;
      })
  ),
  loadMessages: vi.fn(async () => h.messages),
  createConversation: vi.fn(async () => null),
  deleteConversation: vi.fn(async () => {}),
  renameConversation: vi.fn(async () => {}),
  conversationTitle: (t: string) => t,
}));
vi.mock("@/lib/agent/client", () => ({
  sendUserMessage: h.sendUserMessage,
  abortInFlight: vi.fn(),
  generateTitle: vi.fn(async () => null),
  retryLastTurn: vi.fn(async () => true),
  goOn: vi.fn(async () => true),
  canRetryLastTurn: () => false,
}));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuth: () => ({ user: { id: "owner-1" } }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/retro/board-1" }));

import { AgentConversation } from "@/components/agent/agent-conversation";
import { PICKED_UP } from "@/components/agent/chat/chat-items";
import { ChatProvider } from "@/components/agent/chat/chat-context";
import { ChatEmpty, MAX_STARTERS } from "@/components/agent/chat/chat-empty";
import { filledDraft } from "@/components/agent/chat/suggestion-chips";
import { tools } from "@/lib/constants/tools";
import { OWNER_EMPTY, ownerStarters } from "@/lib/agent/owner-starters";
import { useAgentStore, type ChatProfile } from "@/lib/agent/store";
import { VISITOR_EMPTY, visitorStarters } from "@/lib/agent/visitor-starters";

const FIRST_PERSON = /\b(I|I'm|I'll|I've|I'd|me|my|mine|myself)\b/i;
const DASHES = /[–—]/;

const STARTERS = [
  "What can you do in Retro Board?",
  "Create a sprint called Sprint 47 starting today for 2 weeks",
  "Plan the next sprint at 30 points capacity",
  "A fourth that never shows",
];

/** The log's height in px, as the stubbed layout reports it (0: not laid out). */
let logHeight = 0;
/** The ResizeObservers made, so a test can say the log was resized. */
let observers: Array<() => void> = [];

class FakeResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    observers.push(() => callback([], this as unknown as ResizeObserver));
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

function resizeLog(px: number) {
  act(() => {
    logHeight = px;
    observers.forEach((notify) => notify());
  });
}

/** A chat around the empty state: the log, and a message box fed from the store's draft. */
function Chat({
  profile = "owner",
  held,
  starters = STARTERS,
  onSubmit = () => {},
}: {
  profile?: ChatProfile;
  held?: boolean;
  starters?: readonly string[];
  onSubmit?: (e: FormEvent) => void;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  const draft = useAgentStore((s) => s.drafts[profile]);
  return (
    <ChatProvider profile={profile} composerRef={box}>
      <div role="log" aria-label="Conversation">
        <ChatEmpty
          line={OWNER_EMPTY.line}
          short={OWNER_EMPTY.short}
          starters={starters}
          held={held}
        />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(e);
        }}
      >
        <textarea
          ref={box}
          aria-label="Message"
          value={draft}
          onChange={(e) => useAgentStore.getState().setDraft(profile, e.target.value)}
        />
        <button type="submit">Send</button>
      </form>
    </ChatProvider>
  );
}

const starterButtons = () =>
  within(screen.getByRole("list", { name: "Ways to start" })).getAllByRole("button");
const box = () => screen.getByLabelText("Message") as HTMLTextAreaElement;

function stubCoarsePointer(coarse: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: coarse && query === "(pointer: coarse)",
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

beforeEach(() => {
  logHeight = 0;
  observers = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(function (this: Element) {
    return this.getAttribute("role") === "log" ? logHeight : 0;
  });
  useAgentStore.getState().reset();
  useAgentStore.setState({ drafts: { owner: "", visitor: "" } });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useAgentStore.getState().reset();
  useAgentStore.setState({ drafts: { owner: "", visitor: "" } });
});

describe("the empty chat", () => {
  it("says what Amr can do in a narration caption, then up to three starters", () => {
    logHeight = 400;
    render(<Chat />);
    const caption = screen.getByText(OWNER_EMPTY.line);
    expect(caption.closest(".comic-caption")).toHaveAttribute("data-voice", "narration");
    // Narration, not Amr's words: no balloon and no speaker.
    expect(document.querySelector(".balloon, [data-speaker]")).toBeNull();
    expect(starterButtons().map((b) => b.textContent)).toEqual(STARTERS.slice(0, MAX_STARTERS));
  });

  it("draws the starters as wrapping, rounded-md buttons, 44 px on a touch screen", () => {
    render(<Chat />);
    for (const button of starterButtons()) {
      expect(button).toHaveAttribute("type", "button");
      expect(button).toHaveClass("rounded-md", "pointer-coarse:min-h-11", "whitespace-normal");
      expect(button).not.toHaveClass("rounded-full", "uppercase");
      // A long one wraps: no fixed height, with a mouse either.
      expect(button).toHaveClass("h-auto", "md-fine:h-auto");
      expect(button).not.toHaveClass("md-fine:h-8");
    }
  });

  it("cuts to one line and one starter in the 160 px panel, and opens out as the log grows", () => {
    // The 160 px panel's log sits at its 6rem floor.
    logHeight = 96;
    render(<Chat />);
    expect(screen.getByText(OWNER_EMPTY.short)).toBeInTheDocument();
    expect(screen.queryByText(OWNER_EMPTY.line)).toBeNull();
    expect(starterButtons().map((b) => b.textContent)).toEqual([STARTERS[0]]);
    expect(document.querySelector("[data-chat-empty]")).toHaveAttribute("data-short");

    resizeLog(480);
    expect(screen.getByText(OWNER_EMPTY.line)).toBeInTheDocument();
    expect(starterButtons()).toHaveLength(MAX_STARTERS);
    expect(document.querySelector("[data-chat-empty]")).not.toHaveAttribute("data-short");

    // A phone's keyboard up leaves the log a few lines: short again.
    resizeLog(120);
    expect(starterButtons()).toHaveLength(1);
  });

  it("shows it all when the log isn't laid out at all", () => {
    logHeight = 0;
    render(<Chat />);
    expect(screen.getByText(OWNER_EMPTY.line)).toBeInTheDocument();
    expect(starterButtons()).toHaveLength(MAX_STARTERS);
  });

  it("holds the line and the starters until the resume check settles", () => {
    logHeight = 400;
    const { rerender } = render(<Chat held />);
    expect(screen.queryByText(OWNER_EMPTY.line)).toBeNull();
    expect(screen.queryByRole("list", { name: "Ways to start" })).toBeNull();
    expect(screen.queryAllByRole("button", { name: STARTERS[0] })).toEqual([]);

    rerender(<Chat held={false} />);
    expect(screen.getByText(OWNER_EMPTY.line)).toBeInTheDocument();
    expect(starterButtons()).toHaveLength(MAX_STARTERS);
  });
});

describe("a starter", () => {
  it("fills the message box, with focus there and the caret at the end, and never sends", () => {
    const onSubmit = vi.fn();
    render(<Chat onSubmit={onSubmit} />);
    fireEvent.click(starterButtons()[1]);

    expect(box()).toHaveValue(STARTERS[1]);
    expect(useAgentStore.getState().drafts.owner).toBe(STARTERS[1]);
    expect(box()).toHaveFocus();
    expect(box().selectionStart).toBe(STARTERS[1].length);
    expect(box().selectionEnd).toBe(STARTERS[1].length);
    expect(onSubmit).not.toHaveBeenCalled();
    // Still there to pick another: it took nothing away.
    expect(starterButtons()).toHaveLength(MAX_STARTERS);
  });

  it("goes after what the reader typed, and swaps another starter's words", () => {
    render(<Chat />);
    fireEvent.change(box(), { target: { value: "About the board:  " } });
    fireEvent.click(starterButtons()[0]);
    const both = `About the board:\n\n${STARTERS[0]}`;
    expect(box()).toHaveValue(both);
    expect(box().selectionStart).toBe(both.length);

    fireEvent.change(box(), { target: { value: STARTERS[0] } });
    fireEvent.click(starterButtons()[2]);
    expect(box()).toHaveValue(STARTERS[2]);
  });

  it("fills the visitor's own draft in a visitor's chat", () => {
    render(<Chat profile="visitor" />);
    fireEvent.click(starterButtons()[0]);
    expect(useAgentStore.getState().drafts).toEqual({ owner: "", visitor: STARTERS[0] });
  });

  it("leaves focus be after a tap on a touch screen, and still hands it over after a key press", () => {
    stubCoarsePointer(true);
    render(<Chat />);
    const [first, second] = starterButtons();
    first.focus();
    fireEvent.click(first, { detail: 1 });
    expect(box()).toHaveValue(STARTERS[0]);
    expect(box()).not.toHaveFocus();

    // Enter or Space on the button: a click with detail 0.
    fireEvent.click(second, { detail: 0 });
    expect(box()).toHaveValue(STARTERS[1]);
    expect(box()).toHaveFocus();
  });

  it("works out the box's words: alone over nothing or a starter, else after the typing", () => {
    expect(filledDraft("", "Hi?", ["Hi?", "Yo?"])).toBe("Hi?");
    expect(filledDraft("  \n", "Hi?", ["Hi?"])).toBe("Hi?");
    expect(filledDraft(" Yo? ", "Hi?", ["Hi?", "Yo?"])).toBe("Hi?");
    expect(filledDraft("Mine\n", "Hi?", ["Hi?"])).toBe("Mine\n\nHi?");
  });
});

describe("the words of both chats' empty state", () => {
  /** Every starter the owner's and a visitor's chat can show, on any page. */
  function everyStarter(): string[] {
    const pages = [undefined, null, ...tools];
    return [
      ...pages.flatMap((tool) => ownerStarters(tool)),
      ...pages.flatMap((tool) =>
        [visitorStarters(tool, false), visitorStarters(tool, true)].flat()
      ),
    ];
  }

  it("never speaks in the first person, nor uses a dash, in a line or a starter", () => {
    const lines = [OWNER_EMPTY.line, OWNER_EMPTY.short, VISITOR_EMPTY.line, VISITOR_EMPTY.short];
    for (const words of [...lines, ...everyStarter()]) {
      expect(words, words).not.toMatch(FIRST_PERSON);
      expect(words, words).not.toMatch(DASHES);
    }
  });

  it("tells the lines in the third person, naming Amr", () => {
    for (const words of [OWNER_EMPTY.line, OWNER_EMPTY.short, VISITOR_EMPTY.line]) {
      expect(words).toMatch(/\bAmr\b/);
    }
  });

  it("gives each page at most three starters, the page's tool first", () => {
    const retro = tools.find((t) => t.id === "retro")!;
    expect(ownerStarters(retro)[0]).toBe("What can you do in Retro Board?");
    expect(ownerStarters(null)).toHaveLength(3);
    expect(ownerStarters(null)).not.toContainEqual(expect.stringContaining("What can you do"));
    expect(visitorStarters(retro, false)).toEqual([
      "How does Retro Board work?",
      "Add a card “flaky CI” to this retro",
      "What makes a good retro?",
    ]);
    for (const starters of [ownerStarters(retro), visitorStarters(null, false)]) {
      expect(starters.length).toBeLessThanOrEqual(MAX_STARTERS);
      expect(new Set(starters).size).toBe(starters.length);
    }
  });

  it("offers a visitor a change to try only on the retro, and never in a live room", () => {
    const changes = (starters: string[]) => starters.filter((s) => /^Add\b/.test(s));
    expect(changes(visitorStarters(null, false))).toEqual([]);
    const poker = tools.find((t) => t.id !== "retro")!;
    expect(changes(visitorStarters(poker, false))).toEqual([]);
    const retro = tools.find((t) => t.id === "retro")!;
    expect(changes(visitorStarters(retro, true))).toEqual([]);
    expect(visitorStarters(retro, true)[0]).toBe("How does Retro Board work?");
  });
});

describe("the owner's empty chat", () => {
  const meta: ConversationMeta = {
    id: "c1",
    title: "Sprint plan",
    toolId: null,
    createdAt: "2026-11-16T08:00:00Z",
    updatedAt: "2026-11-16T08:00:00Z",
    lastMessageAt: "2026-11-16T08:01:00Z",
  };
  const said = (id: string, role: "user" | "assistant", text: string): ChatMessage => ({
    id,
    role,
    content: [{ type: "text", text }],
    createdAt: new Date().toISOString(),
  });

  it("waits for the resume check, picks the thread up with a scene caption, and starts afresh with the page's starters", async () => {
    logHeight = 400;
    h.messages = [said("u1", "user", "Plan the sprint"), said("a1", "assistant", "Planned.")];
    render(<AgentConversation />);
    // Looking for a thread to resume: no line, no starters that a thread would replace.
    expect(screen.queryByText(OWNER_EMPTY.line)).toBeNull();
    expect(screen.queryByRole("list", { name: "Ways to start" })).toBeNull();

    await act(async () => h.answerList([meta]));
    expect(await screen.findByText("Planned.")).toBeInTheDocument();
    const scenes = Array.from(document.querySelectorAll('[data-chat-item="scene"]'));
    expect(scenes.map((s) => s.textContent)).toEqual(["Today", PICKED_UP]);
    expect(screen.queryByRole("list", { name: "Ways to start" })).toBeNull();

    // New chat: the check is long settled, so the starters show at once,
    // in the third person and led by this page's tool (a sub-page counts).
    act(() => useAgentStore.getState().reset());
    expect(screen.getByText(OWNER_EMPTY.line)).toBeInTheDocument();
    expect(document.querySelector('[data-chat-item="scene"]')).toBeNull();
    expect(starterButtons().map((b) => b.textContent)).toEqual(
      ownerStarters(tools.find((t) => t.id === "retro"))
    );
    expect(starterButtons()[0]).toHaveTextContent("What can you do in Retro Board?");

    fireEvent.click(starterButtons()[0]);
    expect(box()).toHaveValue("What can you do in Retro Board?");
    expect(box()).toHaveFocus();
    expect(box().selectionStart).toBe(box().value.length);
    expect(h.sendUserMessage).not.toHaveBeenCalled();
  });
});
