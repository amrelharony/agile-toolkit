/**
 * The chat's notice (src/components/agent/chat/chat-notice.tsx): the store's
 * note or error as a narration caption in the log, under the items, the
 * narrator's line about Amr and never his own words. Every kind the client
 * writes renders, in both chats, with the button its kind calls for (Go on,
 * or Try again only when the client allows it) and none in the first person.
 * Its buttons hand focus to the message box, caret at the end, except after
 * a tap on a touch screen, where the latest question's caption takes it, so
 * focus never falls to the page as the button goes. An error is drawn with
 * its danger line and no
 * role="alert": its one assertive announcement is the chat's announcer's.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { ChatProvider, useChat } from "@/components/agent/chat/chat-context";
import { ChatNotice, type ChatNoticeProps } from "@/components/agent/chat/chat-notice";
import { ChatStrip } from "@/components/agent/chat/chat-strip";
import {
  NOTICE_TEXT,
  VISITOR_ERROR_TEXT,
  endNoteFor,
  ownerRefusalNotice,
  roundLimitNotice,
  visitorRefusalNotice,
} from "@/lib/agent/client";
import { noticeAction } from "@/lib/agent/notice-actions";
import { useAgentStore, type AgentNotice, type ChatProfile } from "@/lib/agent/store";
import type { ChatMessage } from "@/lib/agent/types";
import { VISITOR_TIME_LIMIT_FINISH, type VisitorErrorCode } from "@/lib/visitor-ai/contract";

const FIRST_PERSON = /\b(I|I'm|I'll|I've|me|my)\b/i;
const DASHES = /[–—]/;
const AT = "2026-11-16T09:00:00Z";

const VISITOR_CODES = Object.keys(VISITOR_ERROR_TEXT) as VisitorErrorCode[];

/** Every kind a notice can be (client.ts ChatNoticeKind). */
const KINDS: readonly string[] = [
  "cut_off",
  "no_answer",
  "round_limit",
  "repeated_failure",
  "cant_do_here",
  "live_room",
  "stream_failed",
  "too_large",
  "signed_out",
  "key_refused",
  "usage_limit",
  "upstream_busy",
  "upstream_error",
  "timeout",
  "request_failed",
  "unreachable",
  "no_key",
  ...VISITOR_CODES,
];

/** Every notice the client writes, from its own builders and texts. */
function everyNotice(): AgentNotice[] {
  const ends = [
    { hasText: false, finishReason: "length", cut: false, visitor: false },
    { hasText: false, finishReason: VISITOR_TIME_LIMIT_FINISH, cut: false, visitor: true },
    { hasText: false, finishReason: null, cut: false, visitor: false },
    { hasText: true, finishReason: "length", cut: false, visitor: false },
    { hasText: true, finishReason: VISITOR_TIME_LIMIT_FINISH, cut: false, visitor: true },
    { hasText: true, finishReason: null, cut: true, visitor: false },
  ].flatMap((round) => endNoteFor(round) ?? []);
  const refusals = [400, 401, 403, 413, 429, 500, 504].flatMap((status) => [
    ownerRefusalNotice(status, false),
    ownerRefusalNotice(status, true),
    ownerRefusalNotice(status, false, "upstream"),
  ]);
  const visitor = [...VISITOR_CODES.map((code) => visitorRefusalNotice(code, 400))];
  visitor.push(visitorRefusalNotice(null, 502), visitorRefusalNotice(null, 400));
  const others: AgentNotice[] = [
    { tone: "error", kind: "stream_failed", text: NOTICE_TEXT.streamFailed },
    { tone: "error", kind: "no_key", text: NOTICE_TEXT.noKey },
    { tone: "error", kind: "unreachable", text: NOTICE_TEXT.unreachable },
    { tone: "note", kind: "repeated_failure", text: NOTICE_TEXT.repeatedFailure },
    { tone: "note", kind: "live_room", text: NOTICE_TEXT.liveRoom },
    { tone: "note", kind: "cant_do_here", text: NOTICE_TEXT.cantDoHere },
  ];
  const all = [...ends, roundLimitNotice(), ...refusals, ...visitor, ...others];
  const seen = new Set<string>();
  return all.filter((n) => {
    const key = `${n.tone}|${n.kind}|${n.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const store = () => useAgentStore.getState();

const CHAT: ChatMessage[] = [
  { id: "u1", role: "user", content: [{ type: "text", text: "Plan the sprint" }], createdAt: AT },
  {
    id: "a1",
    role: "assistant",
    content: [{ type: "text", text: "Start with the goal." }],
    createdAt: AT,
  },
];

/** A container's composer: its draft in the store. */
function Footer() {
  const { composerId, profile } = useChat();
  const draft = useAgentStore((s) => s.drafts[profile]);
  return (
    <textarea
      id={composerId}
      aria-label="Message"
      data-amr-composer=""
      value={draft}
      onChange={(e) => store().setDraft(profile, e.target.value)}
    />
  );
}

type Handlers = Pick<ChatNoticeProps, "onTryAgain" | "onGoOn">;

/** The chat as both containers draw it, with the notice under the strip's items. */
function Chat({
  profile = "owner",
  ready = true,
  canRetry = () => true,
  handlers,
}: {
  profile?: ChatProfile;
  ready?: boolean;
  canRetry?: ChatNoticeProps["canRetry"];
  handlers: Handlers;
}) {
  return (
    <ChatProvider profile={profile}>
      <ChatStrip footer={<Footer />}>
        <ChatNotice ready={ready} canRetry={canRetry} {...handlers} />
      </ChatStrip>
    </ChatProvider>
  );
}

const handlers = () => ({ onTryAgain: vi.fn(), onGoOn: vi.fn() });
const caption = () => document.querySelector<HTMLElement>("[data-chat-notice]");
const box = () => screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;

/** The page on a touch screen: (pointer: coarse) matches, nothing else does. */
function onTouchScreen() {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: query.includes("pointer: coarse"),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList
  );
}

/** Longer than the announcer's own wait (50 ms) before it fills a region. */
const quiet = () => act(() => new Promise<void>((done) => setTimeout(done, 80)));

beforeEach(() => {
  store().reset();
  useAgentStore.setState({ messages: CHAT });
});

afterEach(() => {
  vi.restoreAllMocks();
  store().reset();
});

describe("every notice", () => {
  const notices = everyNotice();

  it("covers every kind the client can write", () => {
    const kinds = new Set(notices.map((n) => n.kind));
    for (const kind of KINDS) expect(kinds, kind).toContain(kind);
  });

  for (const profile of ["owner", "visitor"] as const) {
    it(`renders as narration in the ${profile}'s chat, with the button its kind calls for and no first person`, () => {
      for (const notice of notices) {
        act(() => store().setNotice(notice));
        const view = render(<Chat profile={profile} handlers={handlers()} />);
        const line = caption();
        expect(line, notice.kind).not.toBeNull();
        expect(line).toHaveAttribute("data-voice", "narration");
        expect(line).toHaveAttribute("data-tone", notice.tone);
        expect(line).toHaveAttribute("data-notice-kind", notice.kind);
        expect(line).toHaveTextContent(notice.text);
        // Never his words: no balloon, no speaker, nothing live of its own.
        expect(line?.closest(".balloon, [data-speaker]")).toBeNull();
        expect(line?.querySelector('[role="alert"], [role="status"], [aria-live]')).toBeNull();
        expect(line).not.toHaveAttribute("role");
        // Every word it shows, its button's too: narration, in the third person.
        expect(line?.textContent).not.toMatch(FIRST_PERSON);
        expect(line?.textContent).not.toMatch(DASHES);
        const buttons = Array.from(line?.querySelectorAll("button") ?? []).map(
          (b) => b.textContent
        );
        const action = noticeAction(notice, profile);
        expect(buttons, `${profile} ${notice.kind}`).toEqual(
          action === "retry" ? ["Try again"] : action === "go_on" ? ["Go on"] : []
        );
        view.unmount();
      }
    });
  }

  it("is in the log, under the items, and gone when the store clears it", () => {
    act(() =>
      store().setNotice(
        endNoteFor({ hasText: true, finishReason: "length", cut: false, visitor: false })
      )
    );
    render(<Chat handlers={handlers()} />);
    const log = screen.getByRole("log", { name: "Conversation" });
    const line = caption()!;
    expect(log.contains(line)).toBe(true);
    const balloon = log.querySelector('[data-chat-item="balloon"]')!;
    expect(balloon.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    act(() => store().setNotice(null));
    expect(caption()).toBeNull();
  });
});

describe("its buttons", () => {
  const cutOff: AgentNotice = { tone: "note", kind: "cut_off", text: NOTICE_TEXT.cutShort };
  const failed: AgentNotice = {
    tone: "error",
    kind: "upstream_error",
    text: VISITOR_ERROR_TEXT.upstream_error,
  };

  it("Go on hands focus to the message box, caret after the draft, then sends", () => {
    const on = handlers();
    act(() => {
      store().setDraft("owner", "and then");
      store().setNotice(cutOff);
    });
    render(<Chat handlers={on} />);
    on.onGoOn.mockImplementation(() => {
      // Focus is in the box before the turn starts and the button goes.
      expect(document.activeElement).toBe(box());
    });
    fireEvent.click(screen.getByRole("button", { name: "Go on" }));
    expect(on.onGoOn).toHaveBeenCalledTimes(1);
    expect(on.onTryAgain).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(box());
    expect(box().selectionStart).toBe("and then".length);
    expect(box()).toHaveValue("and then");
  });

  it("Try again shows only when the client allows it, and hands focus to the message box", () => {
    const canRetry = vi.fn(() => false);
    const on = handlers();
    act(() => store().setNotice(failed));
    const view = render(<Chat handlers={on} canRetry={canRetry} />);
    expect(canRetry).toHaveBeenCalledWith(CHAT);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Go on" })).toBeNull();
    view.unmount();

    render(<Chat handlers={on} canRetry={() => true} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(on.onTryAgain).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(box());
  });

  it("offer nothing while a turn is under way, or none can start", () => {
    act(() => store().setNotice(cutOff));
    render(<Chat handlers={handlers()} ready={false} />);
    expect(caption()).toHaveTextContent(cutOff.text);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("hand focus to the latest question after a tap on a touch screen, never the box or the page; a key press still hands it to the box", () => {
    onTouchScreen();
    const on = handlers();
    // The turn each starts clears the notice, so the button really goes.
    on.onGoOn.mockImplementation(() => store().setNotice(null));
    on.onTryAgain.mockImplementation(() => store().setNotice(null));
    const asked = () =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-chat-item="you"]'));
    act(() => {
      useAgentStore.setState({
        messages: [
          ...CHAT,
          {
            id: "u2",
            role: "user",
            content: [{ type: "text", text: "And the goal?" }],
            createdAt: AT,
          },
        ],
      });
      store().setNotice(cutOff);
    });
    render(<Chat handlers={on} />);
    expect(asked()).toHaveLength(2);
    const latest = asked()[1];
    // Nothing in the log takes a tap's focus of its own.
    expect(latest).not.toHaveAttribute("tabindex");

    fireEvent.click(screen.getByRole("button", { name: "Go on" }), { detail: 1 });
    expect(on.onGoOn).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Go on" })).toBeNull();
    expect(document.activeElement).toBe(latest);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).not.toBe(box());
    // Focusable only while it holds that focus.
    expect(latest).toHaveAttribute("tabindex", "-1");
    act(() => latest.blur());
    expect(latest).not.toHaveAttribute("tabindex");

    act(() => store().setNotice(failed));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }), { detail: 1 });
    expect(on.onTryAgain).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(document.activeElement).toBe(latest);
    act(() => latest.blur());

    // A key press (detail 0) still hands focus to the box.
    act(() => store().setNotice(cutOff));
    fireEvent.click(screen.getByRole("button", { name: "Go on" }), { detail: 0 });
    expect(on.onGoOn).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(box());
  });
});

describe("an error", () => {
  const failed: AgentNotice = {
    tone: "error",
    kind: "stream_failed",
    text: NOTICE_TEXT.streamFailed,
  };

  it("adds no announcement of its own", async () => {
    render(
      <LiveAnnouncerProvider>
        <ChatProvider profile="owner">
          <ChatNotice ready canRetry={() => true} {...handlers()} />
        </ChatProvider>
      </LiveAnnouncerProvider>
    );
    act(() => store().setNotice(failed));
    await quiet();
    expect(caption()).toHaveAttribute("data-tone", "error");
    expect(screen.getByTestId("live-polite")).toBeEmptyDOMElement();
    expect(screen.getByTestId("live-assertive")).toBeEmptyDOMElement();
  });

  it("is said once, assertively, by the chat's announcer", async () => {
    render(
      <LiveAnnouncerProvider>
        <Chat handlers={handlers()} />
      </LiveAnnouncerProvider>
    );
    const assertive = screen.getByTestId("live-assertive");
    const heard: string[] = [];
    const observer = new MutationObserver(() => {
      if (assertive.textContent) heard.push(assertive.textContent);
    });
    observer.observe(assertive, { childList: true, characterData: true, subtree: true });
    act(() => store().setNotice(failed));
    await quiet();
    await quiet();
    observer.disconnect();
    expect(heard).toEqual([failed.text]);
    expect(screen.getByTestId("live-polite")).toBeEmptyDOMElement();
  });
});
