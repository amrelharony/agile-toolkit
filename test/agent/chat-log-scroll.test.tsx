/**
 * The chat log's scroll-follow and its frame (src/components/agent/chat/
 * use-stick-to-bottom.ts, chat-log.tsx, chat-frame.tsx): the log follows a
 * growing reply only while the reader is at its end; a resize re-pins a
 * following log and is never taken for the reader going up; reading further
 * up, nothing moves it; the Latest button takes it back and hands focus to
 * the composer (after a tap on a touch screen, where that would raise the
 * keyboard, to the newest item instead); scrolls wait for one frame and are
 * instant under reduced
 * motion; a short panel brings the log back with root.scrollTo, never
 * scrollIntoView; a chat hidden under Amr's Scenes view writes nothing and
 * follows from its end once it shows again; and the focus safety net catches
 * a control taken away.
 *
 * jsdom has no layout and no ResizeObserver, so each scroller gets a stubbed
 * size and scroll position (clamped as a browser clamps it), and a fake
 * ResizeObserver fires when a test changes a size.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { useRef, type ReactNode } from "react";
import { ChatVisibleContext } from "@/components/agent/chat-visibility";
// The parts that draw messages (the owner's chat and a visitor's runtime bring them).
import "@/components/agent/chat/strip-kit";
import { ChatProvider } from "@/components/agent/chat/chat-context";
import { ChatFrame } from "@/components/agent/chat/chat-frame";
import { STICK_THRESHOLD, nearestTop } from "@/components/agent/chat/use-stick-to-bottom";
import { COMPACT_LOG, DOCK_FOOTER_IN_PX3 } from "@/components/agent/mascot/panel-context";
import { chatView } from "@/lib/agent/chat-view";
import type { ChatMessage } from "@/lib/agent/types";

const AT = "2026-11-12T09:00:00Z";

const you = (id: string, text: string): ChatMessage => ({
  id,
  role: "user",
  content: [{ type: "text", text }],
  createdAt: AT,
});
const amr = (id: string, text: string): ChatMessage => ({
  id,
  role: "assistant",
  content: [{ type: "text", text }],
  createdAt: AT,
});

const CHAT: ChatMessage[] = [
  you("u1", "How do I run a retro?"),
  amr("a1", "Start with what went well. Then ask what to change."),
  you("u2", "And after that?"),
  amr("a2", "Pick one action and give it an owner."),
];

// ── A fake ResizeObserver ───────────────────────────────────────────────

class FakeResizeObserver {
  static live = new Set<FakeResizeObserver>();
  readonly targets = new Set<Element>();
  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.live.add(this);
  }
  observe(target: Element) {
    this.targets.add(target);
  }
  unobserve(target: Element) {
    this.targets.delete(target);
  }
  disconnect() {
    this.targets.clear();
    FakeResizeObserver.live.delete(this);
  }
  /** Every observer hears that its targets changed size. */
  static fire() {
    for (const ro of Array.from(FakeResizeObserver.live)) {
      const entries = Array.from(ro.targets, (target) => ({ target }) as ResizeObserverEntry);
      ro.callback(entries, ro as unknown as ResizeObserver);
    }
  }
}

// ── Layout stubs ────────────────────────────────────────────────────────

interface Layout {
  /** The scroller's own scrollTo, which moves it (clamped, as a browser does). */
  scrollTo: Mock<(opts: ScrollToOptions) => void>;
  /** Where it is scrolled to. */
  top(): number;
  /** The farthest it can scroll. */
  end(): number;
  /** The reader scrolls it to `top`: a scroll event follows. */
  readTo(top: number): void;
  /**
   * Its content or its own box changes size: the browser clamps the scroll
   * position to the new end, the ResizeObserver hears of it, and a scroll
   * event follows when the position moved.
   */
  resize(size: { height?: number; client?: number }): void;
}

function layout(el: HTMLElement, size: { height: number; client: number; top?: number }): Layout {
  const box = { height: size.height, client: size.client, top: size.top ?? 0 };
  const end = () => Math.max(0, box.height - box.client);
  const clamp = (top: number) => Math.min(Math.max(0, top), end());
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => box.height });
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => box.client });
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => box.top,
    set: (top: number) => {
      box.top = clamp(top);
    },
  });
  const scrollTo = vi.fn((opts: ScrollToOptions) => {
    box.top = clamp(opts.top ?? box.top);
  });
  Object.defineProperty(el, "scrollTo", { configurable: true, value: scrollTo });
  return {
    scrollTo,
    top: () => box.top,
    end,
    readTo(top) {
      box.top = clamp(top);
      fireEvent.scroll(el);
    },
    resize({ height, client }) {
      const before = box.top;
      if (height !== undefined) box.height = height;
      if (client !== undefined) box.client = client;
      box.top = clamp(box.top);
      act(() => FakeResizeObserver.fire());
      if (box.top !== before) fireEvent.scroll(el);
    },
  };
}

/** Two animation frames: the hook's one write has run. */
const frames = () =>
  act(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );

// ── The chat ────────────────────────────────────────────────────────────

const DRAFT = "half typed";

function Chat({
  messages,
  busy = false,
  extra,
}: {
  messages: readonly ChatMessage[];
  busy?: boolean;
  extra?: ReactNode;
}) {
  const composerRef = useRef<HTMLTextAreaElement>(null);
  return (
    <ChatProvider profile="owner" composerRef={composerRef}>
      <ChatFrame
        items={chatView(messages)}
        busy={busy}
        className="px-3 py-2"
        footer={
          <form>
            <textarea ref={composerRef} aria-label="Message" defaultValue={DRAFT} />
          </form>
        }
      >
        {extra}
      </ChatFrame>
    </ChatProvider>
  );
}

const theLog = () => screen.getByRole("log", { name: "Conversation" });
const latest = () => screen.queryByRole("button", { name: "Latest" });
const composer = () => screen.getByLabelText("Message") as HTMLTextAreaElement;

/** The page on a touch screen: (pointer: coarse) matches, nothing else does. */
const touchScreen = () =>
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: query.includes("pointer: coarse"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList
  );

/** A chat whose log is 1000 px of content in a 200 px view, settled at its end. */
async function settled(messages: readonly ChatMessage[] = CHAT) {
  const view = render(<Chat messages={messages} />);
  const log = layout(theLog(), { height: 1000, client: 200 });
  await frames();
  return { ...view, log };
}

let scrollIntoView: Mock;
let realResizeObserver: typeof globalThis.ResizeObserver | undefined;

beforeEach(() => {
  realResizeObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
  // jsdom has none: a spy that every test checks is never called.
  scrollIntoView = vi.fn();
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    writable: true,
    value: scrollIntoView,
  });
});

afterEach(() => {
  // Nothing in the chat ever scrolls every scroller around it.
  expect(scrollIntoView).not.toHaveBeenCalled();
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  if (realResizeObserver) globalThis.ResizeObserver = realResizeObserver;
  else delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  FakeResizeObserver.live.clear();
  vi.restoreAllMocks();
});

describe("the frame", () => {
  it("is the log's direct parent: one column that scrolls in a short panel, the footer keeping its height", () => {
    render(<Chat messages={CHAT} />);
    const log = theLog();
    // Nothing in the log is live: the chat speaks once per settled turn.
    expect(log).toHaveAttribute("aria-live", "off");
    expect(log).toHaveAttribute("data-amr-scroll");
    expect(log).toHaveClass("min-h-[6rem]", "flex-1", "overflow-y-auto", "overscroll-contain");
    expect(log.className).toContain(COMPACT_LOG);

    const frame = log.parentElement!;
    expect(frame).toHaveAttribute("data-chat-frame");
    expect(frame).toHaveAttribute("data-amr-scroll");
    expect(frame).toHaveClass("h-full", "min-h-0", "flex-col", "overflow-y-auto", "px-3", "py-2");

    // The composer form's parent is the shrink-0 footer, with room for docked Amr.
    const footer = composer().closest("form")!.parentElement!;
    expect(footer).toHaveClass("shrink-0");
    expect(footer.className).toContain(DOCK_FOOTER_IN_PX3);
    expect(footer.parentElement).toBe(frame);
    // The strip is in the log: Amr's balloons and the reader's captions.
    expect(log.querySelectorAll('[data-chat-item="balloon"]')).toHaveLength(2);
    expect(log.querySelectorAll('[data-chat-item="you"]')).toHaveLength(2);
  });

  it("draws what the chat shows after the items inside the log, after them", () => {
    render(<Chat messages={CHAT} extra={<p data-testid="after">Amr is thinking…</p>} />);
    const after = screen.getByTestId("after");
    expect(theLog()).toContainElement(after);
    const items = theLog().querySelectorAll("[data-chat-item]");
    expect(items[items.length - 1].compareDocumentPosition(after)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it("starts at the end of the log, with no Latest button", async () => {
    const { log } = await settled();
    expect(log.top()).toBe(800);
    expect(log.scrollTo).toHaveBeenLastCalledWith({ top: 800, behavior: "instant" });
    expect(latest()).toBeNull();
  });

  it("is a keyboard stop of its own, ringed inside its edge, that nothing focuses by itself", async () => {
    // A visitor's chat once the messages have run out ends on the refused
    // question: no reply end, nothing in the strip to Tab to. The keys can
    // still reach the log and scroll it (axe scrollable-region-focusable).
    const { log } = await settled([...CHAT, you("u3", "Who picks the cards?")]);
    const el = theLog();
    expect(el).toHaveAttribute("tabindex", "0");
    expect(el.querySelector("button, a[href], [tabindex='0']")).toBeNull();
    expect(el).not.toHaveFocus();
    // Inside its edge, high contrast's !important outline-offset included, so
    // the frame's scrolling never cuts the ring off.
    expect(el).toHaveClass("focus-visible:!outline-offset-[-3px]");
    expect(el.className).not.toMatch(/outline-none/);
    // ... and over the strip: the log is its own stack with its content at
    // the bottom of it, so a balloon scrolled under an edge (balloons are
    // positioned) never paints over the line.
    expect(el).toHaveClass("isolate");
    expect(el.querySelector("[data-chat-content]")).toHaveClass("relative", "-z-10");
    // Focused, the keys that go up still count as the reader leaving the end.
    act(() => el.focus());
    expect(el).toHaveFocus();
    fireEvent.keyDown(el, { key: "PageUp" });
    log.readTo(500);
    await frames();
    expect(log.top()).toBe(500);
    expect(latest()).toBeInTheDocument();
  });
});

describe("following the log", () => {
  it("stays at the end when the content grows or the log gets shorter", async () => {
    const { log } = await settled();

    // A reply streams in: the content grows.
    log.resize({ height: 1300 });
    await frames();
    expect(log.top()).toBe(1100);

    // A phone's keyboard comes up: the log itself gets shorter.
    log.resize({ client: 120 });
    await frames();
    expect(log.top()).toBe(1180);
    expect(log.scrollTo).toHaveBeenLastCalledWith({ top: 1180, behavior: "instant" });

    // The content shrinks (a thinking line goes): the browser pulls the
    // position back, which is not the reader going up.
    log.resize({ height: 900 });
    await frames();
    expect(log.top()).toBe(780);
    log.resize({ height: 1500 });
    await frames();
    expect(log.top()).toBe(1380);
    // It never counted a resize as scrolling up.
    expect(latest()).toBeNull();
  });

  it("moves the log once a frame, however many changes arrive in it", async () => {
    const { log, rerender } = await settled();
    log.scrollTo.mockClear();
    log.resize({ height: 1100 });
    log.resize({ height: 1200 });
    log.resize({ client: 150 });
    rerender(<Chat messages={[...CHAT, amr("a3", "One more thing.")]} />);
    log.resize({ height: 1260 });
    expect(log.scrollTo).not.toHaveBeenCalled();
    await frames();
    expect(log.scrollTo).toHaveBeenCalledTimes(1);
    expect(log.scrollTo).toHaveBeenCalledWith({ top: 1110, behavior: "instant" });
  });

  it("follows again when the reader comes back down to within the threshold of the end", async () => {
    const { log } = await settled();
    log.readTo(400);
    expect(latest()).toBeInTheDocument();
    log.readTo(800 - STICK_THRESHOLD + 8);
    expect(latest()).toBeNull();
    log.resize({ height: 1200 });
    await frames();
    expect(log.top()).toBe(1000);
  });

  it("follows on renders when there is no ResizeObserver", async () => {
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    const { log, rerender } = await settled();
    expect(log.top()).toBe(800);
    // The content grows with no observer to hear it: nothing moves yet.
    log.resize({ height: 1300 });
    await frames();
    expect(log.top()).toBe(800);
    // The render that draws the new message pins.
    rerender(<Chat messages={[...CHAT, amr("a3", "One more thing.")]} />);
    await frames();
    expect(log.top()).toBe(1100);
  });
});

describe("reading further up", () => {
  it("is never yanked back down by new words, new items or a turn ending", async () => {
    const { log, rerender } = await settled();
    log.readTo(500);
    expect(latest()).toBeInTheDocument();
    log.scrollTo.mockClear();

    log.resize({ height: 1400 });
    rerender(<Chat messages={[...CHAT, amr("a3", "And keep it small.")]} busy />);
    log.resize({ height: 1500 });
    await frames();
    rerender(<Chat messages={[...CHAT, amr("a3", "And keep it small.")]} />);
    await frames();

    expect(log.top()).toBe(500);
    expect(log.scrollTo).not.toHaveBeenCalled();
    expect(latest()).toBeInTheDocument();
  });

  it("takes even a small step up, against the content growing, as the reader's", async () => {
    const { log } = await settled();
    // The content grew and, before the pin, the reader went up a little.
    log.resize({ height: 1100 });
    log.readTo(790);
    await frames();
    expect(log.top()).toBe(790);
    expect(latest()).toBeInTheDocument();
  });

  it.each([
    ["a wheel up", (el: HTMLElement) => fireEvent.wheel(el, { deltaY: -40 })],
    ["Page Up", (el: HTMLElement) => fireEvent.keyDown(el, { key: "PageUp" })],
    [
      "a finger pulling down",
      (el: HTMLElement) => {
        fireEvent.touchStart(el, { touches: [{ clientY: 100 }] });
        fireEvent.touchMove(el, { touches: [{ clientY: 130 }] });
      },
    ],
  ])("leaves following on %s, before the scroll it causes", async (_, intent) => {
    const { log } = await settled();
    intent(theLog());
    // Words arrive before the browser has moved the log: no pin cuts it short.
    log.resize({ height: 1300 });
    await frames();
    expect(log.top()).toBe(800);
    expect(latest()).toBeInTheDocument();
  });

  it("keeps following when the intent goes to a field or a scroller of its own", async () => {
    render(
      <Chat
        messages={CHAT}
        extra={
          <>
            <pre data-testid="inner">long code</pre>
            <input aria-label="Rename" />
          </>
        }
      />
    );
    const log = layout(theLog(), { height: 1000, client: 200 });
    await frames();
    const inner = screen.getByTestId("inner");
    inner.scrollTop = 20;
    fireEvent.wheel(inner, { deltaY: -40 });
    fireEvent.keyDown(screen.getByLabelText("Rename"), { key: "ArrowUp" });
    // A finger pulling up scrolls the log down: still following.
    fireEvent.touchStart(theLog(), { touches: [{ clientY: 130 }] });
    fireEvent.touchMove(theLog(), { touches: [{ clientY: 100 }] });
    log.resize({ height: 1300 });
    await frames();
    expect(log.top()).toBe(1100);
    expect(latest()).toBeNull();
  });
});

describe("the Latest button", () => {
  it("sits in the flow between the log and the composer's footer", async () => {
    const { log } = await settled();
    log.readTo(300);
    const button = latest()!;
    expect(button).toHaveAttribute("aria-controls", theLog().id);
    const row = button.parentElement!;
    expect(row.previousElementSibling).toBe(theLog());
    expect(row.nextElementSibling).toBe(composer().closest("form")!.parentElement);
    // In the flow, never laid over the log or docked Amr.
    expect(row.className).not.toMatch(/\b(?:absolute|fixed|sticky)\b/);
    expect(row).toHaveClass("shrink-0");
  });

  it("scrolls to the end and moves focus to the composer, caret at the end", async () => {
    const { log } = await settled();
    log.readTo(300);
    log.scrollTo.mockClear();

    // A mouse click (a fine pointer).
    fireEvent.click(latest()!, { detail: 1 });
    // Focus moved before the button went.
    expect(composer()).toHaveFocus();
    expect(composer().selectionStart).toBe(DRAFT.length);
    expect(composer().selectionEnd).toBe(DRAFT.length);
    expect(latest()).toBeNull();

    // The scroll waits for the frame, and glides.
    expect(log.scrollTo).not.toHaveBeenCalled();
    await frames();
    expect(log.scrollTo).toHaveBeenCalledWith({ top: 800, behavior: "smooth" });

    // Following again.
    log.resize({ height: 1200 });
    await frames();
    expect(log.top()).toBe(1000);
  });

  it("hands focus to the newest item after a tap on a touch screen, so no keyboard rises over it and focus never falls to the page", async () => {
    touchScreen();
    const { log } = await settled();
    log.readTo(300);
    log.scrollTo.mockClear();

    const button = latest()!;
    button.focus();
    fireEvent.click(button, { detail: 1 });
    expect(latest()).toBeNull();
    // The newest item in the log, focusable from code just while it holds focus.
    const items = theLog().querySelectorAll<HTMLElement>("[data-chat-item]");
    const newest = items[items.length - 1];
    expect(newest).toHaveFocus();
    expect(newest).toHaveAttribute("tabindex", "-1");
    expect(composer()).not.toHaveFocus();
    await act(async () => {});
    expect(newest).toHaveFocus();
    expect(document.activeElement).not.toBe(document.body);

    // The log still goes to its end.
    await frames();
    expect(log.scrollTo).toHaveBeenCalledWith({ top: 800, behavior: "smooth" });
    expect(log.top()).toBe(log.end());

    // A tap elsewhere takes focus on: the item is not a tab stop after it.
    composer().focus();
    expect(newest).not.toHaveAttribute("tabindex");
  });

  it("never hands a tap's focus to a wordless balloon: thinking, or a reply not yet begun", async () => {
    touchScreen();
    const view = render(
      <Chat
        messages={CHAT}
        busy
        extra={
          <>
            <div data-chat-item="balloon" data-held="" aria-hidden="true" />
            <div data-chat-item="thinking" aria-hidden="true" />
          </>
        }
      />
    );
    const log = layout(theLog(), { height: 1000, client: 200 });
    await frames();
    log.readTo(300);
    fireEvent.click(latest()!, { detail: 1 });
    const shown = theLog().querySelectorAll<HTMLElement>(
      '[data-chat-item]:not([data-chat-item="thinking"]):not([data-held])'
    );
    expect(shown[shown.length - 1]).toHaveAttribute("data-message-id", "a2");
    expect(shown[shown.length - 1]).toHaveFocus();
    view.unmount();
  });

  it("still hands focus to the composer from a key press on a touch screen", async () => {
    touchScreen();
    const { log } = await settled();
    log.readTo(300);

    // Enter or Space on the button: a click with no pointer behind it.
    fireEvent.click(latest()!, { detail: 0 });
    expect(composer()).toHaveFocus();
    expect(composer().selectionStart).toBe(DRAFT.length);
    expect(latest()).toBeNull();
  });

  it("keeps gliding as its row goes and the log grows: pins re-aim the glide until it lands, then jump again", async () => {
    const { log } = await settled();
    log.readTo(300);
    // A browser's glide takes frames: its first scrollTo only starts it.
    const browserScrollTo = log.scrollTo.getMockImplementation()!;
    log.scrollTo.mockImplementation((opts) => {
      if (opts.behavior === "smooth") theLog().scrollTop = 350;
      else browserScrollTo(opts);
    });
    log.scrollTo.mockClear();

    fireEvent.click(latest()!);
    await frames();
    expect(log.scrollTo.mock.calls).toEqual([[{ top: 800, behavior: "smooth" }]]);

    // The Latest row going away makes the log 44 px taller in that frame.
    log.resize({ client: 244 });
    await frames();
    // No instant pin cuts the glide short: it is re-aimed at the new end.
    expect(log.scrollTo.mock.calls).toEqual([
      [{ top: 800, behavior: "smooth" }],
      [{ top: 756, behavior: "smooth" }],
    ]);
    // A resize that leaves the end where the glide is headed writes nothing.
    log.resize({});
    await frames();
    expect(log.scrollTo).toHaveBeenCalledTimes(2);

    // The glide lands; growth after that pins at once again.
    log.readTo(756);
    log.resize({ height: 1200 });
    await frames();
    expect(log.scrollTo).toHaveBeenCalledTimes(3);
    expect(log.scrollTo).toHaveBeenLastCalledWith({ top: 956, behavior: "instant" });
    expect(log.top()).toBe(956);
  });

  it("jumps instead of gliding under reduced motion", async () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({
          matches: query.includes("prefers-reduced-motion: reduce"),
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList
    );
    const { log } = await settled();
    log.readTo(300);
    fireEvent.click(latest()!);
    await frames();
    expect(log.scrollTo).toHaveBeenLastCalledWith({ top: 800, behavior: "instant" });
    expect(log.scrollTo.mock.calls.some(([opts]) => opts.behavior === "smooth")).toBe(false);
  });
});

describe("back to the end without the button", () => {
  it("follows again when the reader sends a message of their own", async () => {
    const { log, rerender } = await settled();
    log.readTo(300);
    expect(latest()).toBeInTheDocument();
    rerender(<Chat messages={[...CHAT, you("u3", "Thanks, one more?")]} />);
    log.resize({ height: 1100 });
    await frames();
    expect(log.top()).toBe(900);
    expect(latest()).toBeNull();
  });

  it("follows from the end when a different chat opens", async () => {
    const { log, rerender } = await settled();
    log.readTo(300);
    rerender(
      <Chat
        messages={[
          amr("b1", "Welcome back."),
          you("v1", "Where were we?"),
          amr("b2", "Sprint planning."),
        ]}
      />
    );
    await frames();
    expect(log.top()).toBe(800);
    expect(latest()).toBeNull();
  });
});

describe("hidden under Amr's Scenes view", () => {
  /** The chat as Amr's panel holds it: mounted, and told whether it is in view. */
  const under = (visible: boolean) => (
    <ChatVisibleContext.Provider value={visible}>
      <Chat messages={CHAT} />
    </ChatVisibleContext.Provider>
  );

  it("writes nothing while hidden, then follows from the newest line once it shows again", async () => {
    const { rerender } = render(under(true));
    const log = layout(theLog(), { height: 1000, client: 200 });
    await frames();
    expect(log.top()).toBe(800);

    // A hidden log can't scroll: a reply growing under the scenes moves nothing.
    rerender(under(false));
    log.scrollTo.mockClear();
    log.resize({ height: 1300 });
    await frames();
    expect(log.scrollTo).not.toHaveBeenCalled();
    expect(log.top()).toBe(800);

    rerender(under(true));
    await frames();
    expect(log.scrollTo).toHaveBeenLastCalledWith({ top: 1100, behavior: "instant" });
    expect(log.top()).toBe(1100);
  });

  it("comes back at the newest line even when the reader had read further up", async () => {
    const { rerender } = render(under(true));
    const log = layout(theLog(), { height: 1000, client: 200 });
    await frames();
    log.readTo(300);
    expect(latest()).toBeInTheDocument();

    rerender(under(false));
    await frames();
    rerender(under(true));
    await frames();
    expect(log.top()).toBe(800);
    expect(latest()).toBeNull();
  });
});

describe("a short panel", () => {
  /**
   * The frame (the chat's root) scrolled to its composer, 240 px down 400 px
   * of column in a 160 px view: the log, 8 px from the column's top, is
   * above the view.
   */
  function shortPanel() {
    const log = theLog();
    const root = log.parentElement!;
    const rootLayout = layout(root, { height: 400, client: 160, top: 240 });
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 0, y: 100, width: 320, height: 160 })
    );
    vi.spyOn(log, "getBoundingClientRect").mockImplementation(() =>
      DOMRect.fromRect({ x: 0, y: 100 + 8 - rootLayout.top(), width: 320, height: 96 })
    );
    return rootLayout;
  }

  it("brings the log back into the root's view with root.scrollTo when something new arrives", async () => {
    const { rerender } = await settled();
    const root = shortPanel();
    rerender(<Chat messages={[...CHAT, you("u3", "Next?")]} />);
    await frames();
    // Only as far as needed: the log's top at the view's top.
    expect(root.scrollTo).toHaveBeenCalledWith({ top: 8, behavior: "instant" });
    expect(root.top()).toBe(8);

    // In view now: a turn starting moves nothing.
    root.scrollTo.mockClear();
    rerender(<Chat messages={[...CHAT, you("u3", "Next?")]} busy />);
    await frames();
    expect(root.scrollTo).not.toHaveBeenCalled();
  });

  it("brings the log back into the root's view when the chat shows again from under the scenes", async () => {
    const under = (visible: boolean) => (
      <ChatVisibleContext.Provider value={visible}>
        <Chat messages={CHAT} />
      </ChatVisibleContext.Provider>
    );
    // Opened under the scenes: nothing is written while it is hidden.
    const { rerender } = render(under(false));
    const log = layout(theLog(), { height: 1000, client: 200 });
    const root = shortPanel();
    await frames();
    expect(log.scrollTo).not.toHaveBeenCalled();
    expect(root.scrollTo).not.toHaveBeenCalled();

    rerender(under(true));
    await frames();
    expect(log.top()).toBe(800);
    expect(root.scrollTo).toHaveBeenCalledWith({ top: 8, behavior: "instant" });
  });

  it("leaves an empty chat on its composer, and a reader reading above where they are", async () => {
    const view = render(<Chat messages={[]} />);
    layout(theLog(), { height: 96, client: 96 });
    const root = shortPanel();
    await frames();
    expect(root.scrollTo).not.toHaveBeenCalled();
    view.unmount();

    const { log, rerender } = await settled();
    const root2 = shortPanel();
    log.readTo(300);
    rerender(<Chat messages={[...CHAT, amr("a3", "More.")]} />);
    await frames();
    expect(root2.scrollTo).not.toHaveBeenCalled();
  });
});

describe("the focus safety net", () => {
  it("hands focus to the composer when what had it is taken away", async () => {
    const { rerender } = render(
      <Chat messages={CHAT} extra={<button type="button">Try again</button>} />
    );
    screen.getByRole("button", { name: "Try again" }).focus();
    rerender(<Chat messages={CHAT} />);
    await act(async () => {});
    expect(composer()).toHaveFocus();
    expect(composer().selectionStart).toBe(DRAFT.length);
  });

  it("leaves focus where the removal left it on a touch screen, so no keyboard rises from a tap", async () => {
    touchScreen();
    const { rerender } = render(
      <Chat messages={CHAT} extra={<button type="button">Not now</button>} />
    );
    // A tapped Approve or Deny takes focus (Android), then its card goes.
    screen.getByRole("button", { name: "Not now" }).focus();
    rerender(<Chat messages={CHAT} />);
    await act(async () => {});
    expect(composer()).not.toHaveFocus();
    expect(document.activeElement).toBe(document.body);
  });

  it("never pulls back focus the reader moved themselves", async () => {
    const { rerender } = render(
      <>
        <button type="button">Outside</button>
        <Chat messages={CHAT} extra={<button type="button">Try again</button>} />
      </>
    );
    // Focus moved on to something outside the chat, then the control went.
    screen.getByRole("button", { name: "Try again" }).focus();
    screen.getByRole("button", { name: "Outside" }).focus();
    rerender(
      <>
        <button type="button">Outside</button>
        <Chat messages={CHAT} />
      </>
    );
    await act(async () => {});
    expect(screen.getByRole("button", { name: "Outside" })).toHaveFocus();

    // A click on something that takes no focus leaves it on nothing; the
    // control going after that is no reason to take it.
    rerender(
      <>
        <button type="button">Outside</button>
        <Chat messages={CHAT} extra={<button type="button">Go on</button>} />
      </>
    );
    const goOn = screen.getByRole("button", { name: "Go on" });
    goOn.focus();
    act(() => goOn.blur());
    await act(async () => {});
    rerender(
      <>
        <button type="button">Outside</button>
        <Chat messages={CHAT} />
      </>
    );
    await act(async () => {});
    expect(document.activeElement).toBe(document.body);
  });
});

describe("nearestTop", () => {
  it("moves a scroller's view only as far as a part needs", () => {
    // In view, or covering the whole view: nothing.
    expect(nearestTop(100, 200, 150, 50)).toBeNull();
    expect(nearestTop(100, 200, 50, 400)).toBeNull();
    // Above the view: its top leads.
    expect(nearestTop(240, 160, 8, 96)).toBe(8);
    // Below the view: its end at the view's end.
    expect(nearestTop(0, 160, 200, 96)).toBe(136);
    // Taller than the view and below it: its top leads.
    expect(nearestTop(0, 160, 200, 300)).toBe(200);
  });
});
