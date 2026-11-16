/**
 * The visitor chat's read-only footer (mascot/visitor-chat-footer, as
 * mascot/visitor-agent-panel wires it). Once no message can go out (a
 * refusal for now, or the allowance at none left) it takes the composer's
 * place and says why, while the chat stays readable: the log and Copy reply
 * stay, the follow-ups and Try again's spend under the reply go. It takes the
 * focus the box had. "Open the tool finder" hands the guide the question Amr
 * couldn't answer; Try again (only for a refusal a later try may get past)
 * says what it spends and gives the box back. The busy hours' limit ends on
 * the clock, as the hours do, and the day's with its Cairo day. A box the
 * footer gives back takes no focus by itself.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { VisitorQuota } from "@/lib/agent/store";
import type { ChatMessage } from "@/lib/agent/types";

const h = vi.hoisted(() => ({
  sendVisitorMessage: vi.fn<(text: string, opts: { toolId: string | null }) => Promise<void>>(),
  retryVisitorTurn: vi.fn<(opts: { toolId: string | null }) => Promise<boolean>>(async () => true),
  canRetryLastTurn: vi.fn<(messages: unknown[]) => boolean>(() => true),
  announce: vi.fn(),
}));

vi.mock("next/navigation", () => ({ usePathname: () => "/retro" }));
vi.mock("@/components/a11y/live-announcer", () => ({ useAnnounce: () => h.announce }));
vi.mock("@/lib/agent/visitor-runtime", () => ({
  sendVisitorMessage: h.sendVisitorMessage,
  abortInFlight: vi.fn(),
  retryVisitorTurn: h.retryVisitorTurn,
  visitorGoOn: vi.fn(async () => true),
  canRetryLastTurn: h.canRetryLastTurn,
}));

import VisitorAgentPanel from "@/components/agent/mascot/visitor-agent-panel";
import {
  ASK_AGAIN,
  BUSY_HOURS_OVER,
  OPEN_TOOL_FINDER,
  readOnlyNote,
  unansweredQuestion,
} from "@/components/agent/mascot/visitor-chat-footer";
import { FOLLOW_UPS_LABEL } from "@/components/agent/chat/reply-end";
import { useAgentStore } from "@/lib/agent/store";
import { VISITOR_AI_DAILY_MESSAGES } from "@/lib/site/disclosures";
import { VISITOR_FALLBACK_CODES } from "@/lib/visitor-ai/contract";
import { formatPeakTime } from "@/lib/visitor-ai/peak";

const AT = "2026-11-16T09:00:00Z";
const QUESTION = "How do I run a retro?";
const REPLY = "Open the board, then add a card.";
const FIRST_PERSON = /\b(I|me|my|mine|I'm|I've|I'll)\b/;

const quota = (remaining: number, more: Partial<VisitorQuota> = {}): VisitorQuota => ({
  remaining,
  limit: 25,
  peak: false,
  peakRemaining: null,
  peakLimit: null,
  peakEndsAt: null,
  ...more,
});

const user = (id: string, text: string): ChatMessage => ({
  id,
  role: "user",
  content: [{ type: "text", text }],
  createdAt: AT,
});
const assistant = (id: string, text: string): ChatMessage => ({
  id,
  role: "assistant",
  content: [{ type: "text", text }],
  createdAt: AT,
});

/** The turn the mocked runtime runs: the question, Amr's reply, the route's allowance. */
function answersWith(left: VisitorQuota) {
  h.sendVisitorMessage.mockImplementation(async (text) => {
    useAgentStore.setState({
      chatProfile: "visitor",
      messages: [user("u1", text), assistant("a1", REPLY)],
      visitorQuota: left,
    });
  });
}

/** Let effects, microtasks and timers queued by the last step run. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

const footer = () => document.querySelector<HTMLElement>("[data-visitor-read-only]");
const replyEnd = () => document.querySelector<HTMLElement>("[data-chat-reply-end]");

async function until(find: () => HTMLElement | null): Promise<HTMLElement> {
  await waitFor(() => expect(find()).not.toBeNull());
  return find()!;
}

const onOfflineGuide = vi.fn<(unanswered?: string) => void>();

const RealDate = Date;

/**
 * "Now" moved to `to`, still ticking: new Date() and Date.now() read the real
 * clock plus the offset, and a Date made from a value is a plain one.
 */
function shiftNow(to: Date) {
  const offset = to.getTime() - RealDate.now();
  class Shifted extends RealDate {
    constructor(...args: ConstructorParameters<typeof Date>) {
      super(...((args.length ? args : [RealDate.now() + offset]) as [number]));
    }
    static now() {
      return RealDate.now() + offset;
    }
  }
  globalThis.Date = Shifted as DateConstructor;
}

/**
 * The chat's minute ticks (its clock, useNow), caught as they are set so a
 * test can run them; every timer still runs on the real clock.
 */
function minuteTicks(): () => void {
  const ticks: Array<() => void> = [];
  const real = window.setInterval.bind(window);
  vi.spyOn(window, "setInterval").mockImplementation(((
    fn: TimerHandler,
    ms?: number,
    ...rest: unknown[]
  ) => {
    if (ms === 60_000 && typeof fn === "function") ticks.push(fn as () => void);
    return real(fn, ms, ...rest);
  }) as typeof window.setInterval);
  return () => act(() => ticks.forEach((tick) => tick()));
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

/** The chat, with one question asked and answered, the box holding focus. */
async function chatAsked(left: VisitorQuota, { takeFocus = false } = {}) {
  answersWith(left);
  render(
    <VisitorAgentPanel initialQuestion="" onOfflineGuide={onOfflineGuide} takeFocus={takeFocus} />
  );
  await settle();
  const box = screen.getByLabelText("Message");
  fireEvent.change(box, { target: { value: QUESTION } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await settle();
  await until(replyEnd);
  box.focus();
  return box;
}

beforeEach(() => {
  h.sendVisitorMessage.mockReset();
  h.retryVisitorTurn.mockClear();
  h.canRetryLastTurn.mockReset();
  h.canRetryLastTurn.mockReturnValue(true);
  h.announce.mockClear();
  onOfflineGuide.mockClear();
  useAgentStore.getState().reset();
  useAgentStore.setState({ chatProfile: "owner", visitorQuota: null });
  useAgentStore.getState().setDraft("visitor", "");
  if (typeof Element.prototype.scrollTo !== "function") Element.prototype.scrollTo = () => {};
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  globalThis.Date = RealDate;
  useAgentStore.getState().reset();
  useAgentStore.setState({ chatProfile: "owner", visitorQuota: null });
});

describe("the read-only footer", () => {
  it("takes the box's place once no message is left, and its focus, while the chat stays readable", async () => {
    await chatAsked(quota(3));
    // A message left: follow-ups and a Try again that says what it spends.
    expect(within(replyEnd()!).getByRole("list", { name: FOLLOW_UPS_LABEL })).toBeInTheDocument();
    expect(
      within(replyEnd()!).getByRole("button", { name: "Try again (uses 1 of your 3 left)" })
    ).toBeInTheDocument();

    act(() => useAgentStore.setState({ visitorQuota: quota(0) }));
    const shown = await until(footer);
    expect(screen.queryByLabelText("Message")).toBeNull();
    expect(shown).toHaveTextContent(
      "You've used all of today's messages with Amr. He can answer again tomorrow."
    );
    expect(shown.querySelector('[data-voice="narration"]')).not.toBeNull();
    expect(shown).toHaveFocus();
    expect(shown.closest("[data-chat-footer]")).not.toBeNull();
    // Nothing in it is live: focus reads it out.
    expect(shown.querySelector("[aria-live], [role='status'], [role='alert']")).toBeNull();
    expect(h.announce).not.toHaveBeenCalledWith(expect.stringContaining("used all"));

    // The chat reads on: the question, the reply and Copy reply stay; the
    // follow-ups and Try again's spend go (no box to fill, nothing to spend).
    const log = screen.getByRole("log", { name: "Conversation" });
    expect(log).toHaveTextContent(QUESTION);
    expect(log).toHaveTextContent(REPLY);
    const end = await until(replyEnd);
    expect(within(end).getByRole("button", { name: "Copy reply" })).toBeInTheDocument();
    expect(within(end).queryByRole("list", { name: FOLLOW_UPS_LABEL })).toBeNull();
    expect(within(end).queryByRole("button", { name: /Try again/ })).toBeNull();
    // Only the tool finder: no Try again for a limit.
    expect(
      within(shown)
        .getAllByRole("button")
        .map((b) => b.textContent)
    ).toEqual([OPEN_TOOL_FINDER]);
  });

  it("takes the box's place on a refusal, says it once, and offers the tool finder with the unanswered question", async () => {
    await chatAsked(quota(12));
    act(() => {
      const s = useAgentStore.getState();
      s.appendMessage(user("u2", "And the timer?"));
      s.setVisitorFallback("site_limit");
      s.setNotice({
        tone: "error",
        kind: "site_limit",
        text: "Amr has answered all he can for today.",
      });
    });
    const shown = await until(footer);
    expect(shown).toHaveTextContent(
      "Amr has answered all he can for today. He can answer again tomorrow."
    );
    // The refusal's own words are the footer's to say: no second caption in the log.
    expect(document.querySelector("[data-chat-notice]")).toBeNull();
    fireEvent.click(within(shown).getByRole("button", { name: OPEN_TOOL_FINDER }));
    expect(onOfflineGuide).toHaveBeenCalledWith("And the timer?");
  });

  it("offers Try again for a refusal a later try may get past, saying what it spends, with the box back for it", async () => {
    await chatAsked(quota(12));
    act(() => {
      useAgentStore.getState().appendMessage(user("u2", "And the timer?"));
      useAgentStore.getState().setVisitorFallback("site_busy");
    });
    const shown = await until(footer);
    expect(shown).toHaveTextContent(
      "Amr is too busy to answer right now. Try again in a few minutes."
    );
    fireEvent.click(
      within(shown).getByRole("button", { name: "Try again (uses 1 of your 12 left)" })
    );
    expect(useAgentStore.getState().visitorFallback).toBeNull();
    expect(footer()).toBeNull();
    // The box is back, with focus, and the question goes again.
    expect(screen.getByLabelText("Message")).toHaveFocus();
    await waitFor(() => expect(h.retryVisitorTurn).toHaveBeenCalledWith({ toolId: "retro" }));
  });

  it("gives the box back with Ask again, sending nothing, when trying again would repeat a change", async () => {
    await chatAsked(quota(12));
    h.canRetryLastTurn.mockReturnValue(false);
    act(() => useAgentStore.getState().setVisitorFallback("meter_unavailable"));
    const shown = await until(footer);
    fireEvent.click(within(shown).getByRole("button", { name: ASK_AGAIN }));
    expect(screen.getByLabelText("Message")).toHaveFocus();
    await settle();
    expect(h.retryVisitorTurn).not.toHaveBeenCalled();
  });

  it("keeps a question asked from the guide with none left in the box, unsent", async () => {
    useAgentStore.setState({
      chatProfile: "visitor",
      messages: [user("u1", QUESTION), assistant("a1", REPLY)],
      visitorQuota: quota(0),
    });
    render(<VisitorAgentPanel initialQuestion="sprint goal" onOfflineGuide={onOfflineGuide} />);
    await until(footer);
    await settle();
    expect(h.sendVisitorMessage).not.toHaveBeenCalled();
    expect(useAgentStore.getState().drafts.visitor).toBe("sprint goal");
  });

  it("goes as the busy hours end, with their limit, and says so", async () => {
    const ends = new Date(Date.now() + 1500);
    await chatAsked(
      quota(12, { peak: true, peakRemaining: 0, peakLimit: 5, peakEndsAt: ends.toISOString() })
    );
    const shown = await until(footer);
    expect(shown).toHaveTextContent(
      `You've used all your messages for these busy hours. Amr can answer again at ${formatPeakTime(ends)}.`
    );
    act(() => {
      useAgentStore.getState().setVisitorFallback("visitor_peak_limit");
      useAgentStore.getState().setNotice({
        tone: "error",
        kind: "visitor_peak_limit",
        text: "You've used all your messages for these busy hours.",
      });
    });
    await waitFor(() => expect(footer()).toBeNull(), { timeout: 5000 });
    const s = useAgentStore.getState();
    expect(s.visitorFallback).toBeNull();
    expect(s.notice).toBeNull();
    expect(s.visitorQuota).toMatchObject({ remaining: 12, peak: false, peakRemaining: null });
    expect(screen.getByLabelText("Message")).toBeInTheDocument();
    expect(h.announce).toHaveBeenCalledWith(BUSY_HOURS_OVER);
  });

  it("stays when the busy hours end with none of the day's messages left either, and says nothing", async () => {
    const ends = new Date(Date.now() + 1500);
    await chatAsked(
      quota(0, { peak: true, peakRemaining: 0, peakLimit: 5, peakEndsAt: ends.toISOString() })
    );
    act(() => useAgentStore.getState().setVisitorFallback("visitor_peak_limit"));
    await until(footer);
    await waitFor(() => expect(useAgentStore.getState().visitorQuota?.peak).toBe(false), {
      timeout: 5000,
    });
    // The busy hours' refusal goes with them; the day's limit holds the footer.
    expect(useAgentStore.getState().visitorFallback).toBeNull();
    expect(footer()).toHaveTextContent("You've used all of today's messages with Amr.");
    expect(screen.queryByLabelText("Message")).toBeNull();
    expect(h.announce).not.toHaveBeenCalledWith(BUSY_HOURS_OVER);
  });
});

describe("the day's limit and its Cairo day", () => {
  // Cairo is UTC+2 in November: 23:55 on Monday 16 November, then 00:05 on the 17th.
  const BEFORE_MIDNIGHT = new RealDate("2026-11-16T21:55:00Z");
  const AFTER_MIDNIGHT = new RealDate("2026-11-16T22:05:00Z");

  it("gives the box back on the first tick past Cairo midnight, the new day's allowance not known yet", async () => {
    const tick = minuteTicks();
    shiftNow(BEFORE_MIDNIGHT);
    await chatAsked(quota(0, { receivedAt: Date.now() }));
    await until(footer);
    // Still the same day: the footer stays.
    tick();
    expect(footer()).not.toBeNull();

    shiftNow(AFTER_MIDNIGHT);
    tick();
    await waitFor(() => expect(footer()).toBeNull());
    expect(screen.getByLabelText("Message")).toBeInTheDocument();
    expect(screen.getByTestId("visitor-ai-quota")).toHaveTextContent(
      `${VISITOR_AI_DAILY_MESSAGES} messages a day`
    );
    // Try again under the reply names no count from the day that is over.
    expect(
      within(await until(replyEnd)).getByRole("button", { name: "Try again (uses 1 message)" })
    ).toBeInTheDocument();
  });

  it("lets a refusal for the day go with it, and its notice", async () => {
    const tick = minuteTicks();
    shiftNow(BEFORE_MIDNIGHT);
    await chatAsked(quota(12, { receivedAt: Date.now() }));
    act(() => {
      const s = useAgentStore.getState();
      s.setVisitorFallback("visitor_limit");
      s.setNotice({
        tone: "error",
        kind: "visitor_limit",
        text: "You've used all of today's messages with Amr.",
      });
    });
    await until(footer);

    shiftNow(AFTER_MIDNIGHT);
    tick();
    await waitFor(() => expect(footer()).toBeNull());
    const s = useAgentStore.getState();
    expect(s.visitorFallback).toBeNull();
    expect(s.notice).toBeNull();
    expect(screen.getByLabelText("Message")).toBeInTheDocument();
  });

  it("sends a question asked from the guide once the day that ran out is over", async () => {
    answersWith(quota(24));
    useAgentStore.setState({
      chatProfile: "visitor",
      messages: [user("u1", QUESTION), assistant("a1", REPLY)],
      // None left, two days ago.
      visitorQuota: quota(0, { receivedAt: Date.now() - 2 * 24 * 60 * 60_000 }),
    });
    render(<VisitorAgentPanel initialQuestion="sprint goal" onOfflineGuide={onOfflineGuide} />);
    await waitFor(() =>
      expect(h.sendVisitorMessage).toHaveBeenCalledWith("sprint goal", { toolId: "retro" })
    );
    expect(useAgentStore.getState().drafts.visitor).toBe("");
  });
});

describe("the box the footer gives back", () => {
  it("takes no focus by itself, so no keyboard comes up on a timer: the consent card's yes was for the box the chat opened with", async () => {
    const box = await chatAsked(quota(12), { takeFocus: true });
    expect(box).toHaveFocus();
    act(() => useAgentStore.getState().setVisitorFallback("site_busy"));
    await until(footer);
    // On a phone, the refusal lets go on its own (as the busy hours' clock
    // lets theirs go): the box is back, unfocused.
    touchScreen();
    act(() => useAgentStore.getState().setVisitorFallback(null));
    await waitFor(() => expect(footer()).toBeNull());
    expect(screen.getByLabelText("Message")).not.toHaveFocus();
  });

  it("never takes focus as Try again gives it back after a tap on a touch screen", async () => {
    await chatAsked(quota(12), { takeFocus: true });
    act(() => {
      useAgentStore.getState().appendMessage(user("u2", "And the timer?"));
      useAgentStore.getState().setVisitorFallback("site_busy");
    });
    const shown = await until(footer);
    touchScreen();
    const focused: EventTarget[] = [];
    const record = (e: FocusEvent) => {
      if (e.target) focused.push(e.target);
    };
    document.addEventListener("focusin", record);
    try {
      fireEvent.click(
        within(shown).getByRole("button", { name: "Try again (uses 1 of your 12 left)" }),
        { detail: 1 }
      );
    } finally {
      document.removeEventListener("focusin", record);
    }
    // No keyboard: the box never had focus; the question asked again holds it.
    expect(focused).not.toContain(screen.getByLabelText("Message"));
    const asked = document.querySelectorAll<HTMLElement>('[data-chat-item="you"]');
    expect(asked[asked.length - 1]).toHaveFocus();
    await waitFor(() => expect(h.retryVisitorTurn).toHaveBeenCalled());
  });
});

describe("readOnlyNote", () => {
  const NOW = new Date("2026-11-09T08:00:00Z");

  it("says what ran out and when Amr can answer again, in narration", () => {
    const busy = quota(12, {
      peak: true,
      peakRemaining: 0,
      peakEndsAt: "2026-11-09T10:00:00Z",
    });
    const time = formatPeakTime(new Date("2026-11-09T10:00:00Z"));
    expect(readOnlyNote(null, busy, NOW)).toContain(`at ${time}`);
    expect(readOnlyNote("site_peak_limit", busy, NOW)).toContain(`at ${time}`);
    expect(readOnlyNote("visitor_peak_limit", null, NOW)).toContain("once they end");
    expect(readOnlyNote(null, quota(0), NOW)).toContain("tomorrow");
    const notes = Array.from(VISITOR_FALLBACK_CODES).map((c) => readOnlyNote(c, busy, NOW));
    expect(new Set(notes).size).toBe(notes.length);
    for (const note of [...notes, readOnlyNote(null, null, NOW)]) {
      expect(note).not.toMatch(FIRST_PERSON);
      expect(note).not.toMatch(/[–—]/);
      expect(note).not.toMatch(/tool finder/);
    }
  });
});

describe("unansweredQuestion", () => {
  it("is the latest question with no reply in words after it", () => {
    expect(unansweredQuestion([])).toBe("");
    expect(unansweredQuestion([user("u1", "retro"), assistant("a1", REPLY)])).toBe("");
    expect(
      unansweredQuestion([user("u1", "retro"), assistant("a1", REPLY), user("u2", "timer")])
    ).toBe("timer");
    const toolOnly: ChatMessage = {
      id: "a2",
      role: "assistant",
      content: [{ type: "tool_use", id: "c1", name: "tool_retro_read_state", input: {} }],
      createdAt: AT,
    };
    expect(unansweredQuestion([user("u1", "read the board"), toolOnly])).toBe("read the board");
  });
});
