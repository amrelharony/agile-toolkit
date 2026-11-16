"use client";

/**
 * What the mascot's panel shows a signed-out visitor when visitor AI is on.
 *
 * Three steps, the tool finder first:
 *  - guide: the tool finder (VisitorGuide), with its one Ask button ("Chat
 *    with Amr", "Ask Amr about '…'", or "Back to chat" once a chat is under
 *    way). Opening the panel sends nothing.
 *  - consent: the first time, a card says where messages go
 *    (VisitorAiConsent). Nothing is sent before "Agree and ask" (or "Agree
 *    and chat" when nothing was asked).
 *  - chat: Amr's AI (visitor-agent-panel), a separate chunk loaded only now;
 *    the agent runtime behind it loads on the first message.
 * The panel header's subtitle names the step ("Find the right tool", "Before
 * you chat", "Chat · not saved"; PANEL_SUBTITLE), filled from here.
 *
 * The search travels with the visitor: "Not now" on the card, and going back
 * from the chat, open the guide on the question they took there. The chat's
 * own question was sent already, so while the search still holds it the Ask
 * button reads "Back to chat" and nothing is sent twice. A failure or a
 * refusal on the guide drops it (the note says what happened, and asking
 * again starts fresh), and so does Clear chat (the question is no longer in
 * the chat). From the chat's read-only footer, the guide opens on the
 * question Amr couldn't answer, which is then the one "Back to chat" keeps.
 *
 * When the visitor route says there's no more AI for now (visitorFallback),
 * a chat under way stays, read-only (fallbackWaits): the chat's footer says
 * which limit was reached and takes the composer's place, so the visitor can
 * still read it, and a reopened panel goes back to it. "Back to chat" from the
 * guide returns to it as it is, the refusal still there; only a new question
 * is a fresh try. With no chat to read, the panel goes back to the guide with
 * a note saying which limit was reached (visitorFallbackNote). It does the
 * same when the chat's chunk can't load (offline, or a tab left open across a
 * deploy), and asking again tries the import again. And it does the same
 * when the loaded chat fails while it is drawn. A note is a narration
 * caption: the narrator's line, never Amr's.
 *
 * Focus follows the step: the consent card takes it itself, the chat offers its
 * message box to the panel's focus owner (lib/agent/mascot/use-panel-focus),
 * which focuses it on a fine pointer only (but a yes on the consent card with
 * no question waiting means "let me type": the box takes focus then even on a
 * touch screen), and a return to the guide puts it
 * on the note, or on the guide when there is no note. A panel that opens on
 * the guide moves no focus here: the focus owner puts a keyboard open on Amr's
 * name plate (one opened again mid-chat opens on the chat). A note is read
 * out once: by taking focus, or through the announcer when the guide was
 * already showing and no focus moves.
 *
 * This module stays light: every visitor fetches it, in the visitor body's
 * chunk (visitor-body), which the mascot fetches ahead while the browser is idle.
 */

import { Suspense, lazy, useEffect, useRef, useState, type LazyExoticComponent } from "react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { Narration } from "@/components/agent/comic/comic-parts";
import { ErrorBoundary } from "@/components/layout/error-boundary";
import { useAgentStore, type VisitorQuota } from "@/lib/agent/store";
import type { VisitorErrorCode } from "@/lib/visitor-ai/contract";
import { formatPeakTime } from "@/lib/visitor-ai/peak";
import { VisitorGuide } from "./visitor-guide";
import { VisitorAiConsent, hasVisitorAiConsent } from "./visitor-ai-consent";
import { PANEL_SUBTITLE } from "./panel-chrome";
import { PanelSubtitle } from "./panel-fills";
import { PanelLoading } from "./panel-parts";

type ChatModule = typeof import("./visitor-agent-panel");
type LoadChat = () => Promise<ChatModule>;
type LazyChat = LazyExoticComponent<ChatModule["default"]>;

/** The visitor's chat: its own chunk, imported when the chat first opens. */
const importChat = (): Promise<ChatModule> => import("./visitor-agent-panel");

/**
 * One lazy chat per loader, shared by every VisitorPanel: once the chunk has
 * loaded, a panel opened again mid-chat shows the chat at once, with no empty
 * frame first.
 */
const chats = new WeakMap<LoadChat, LazyChat>();

/**
 * The lazy chats whose import failed. React.lazy keeps a rejection for good,
 * so a failed one is never drawn again: the next try gets a new one and
 * imports the chunk again. The failure is noted on the import itself, not by
 * a panel, because a panel closed while the chunk was loading never sees it.
 */
const failedChats = new WeakSet<LazyChat>();

function chatFor(load: LoadChat): LazyChat {
  const known = chats.get(load);
  if (known && !failedChats.has(known)) return known;
  const chat: LazyChat = lazy(async () => {
    try {
      return await load();
    } catch (err) {
      failedChats.add(chat);
      throw err;
    }
  });
  chats.set(load, chat);
  return chat;
}

/** Shown over the guide for a refusal without a note of its own below. */
export const VISITOR_FALLBACK_NOTE = "Amr has answered all he can for now. Here's the tool finder.";

/** Shown over the guide when the chat's code couldn't load. */
export const VISITOR_CHAT_LOAD_NOTE =
  "Amr's chat couldn't load. Check your connection, or reload the page. Here's the tool finder.";

/** Shown over the guide when the chat loaded and then failed while it was drawn. */
export const VISITOR_CHAT_ERROR_NOTE =
  "Amr's chat ran into a problem. Reload the page to try again. Here's the tool finder.";

/**
 * The note over the guide for the refusal that sent the visitor back to it:
 * which limit was reached, or why the AI is off, and for the busy-hours
 * limits when they end, in the visitor's own time (from the route's last
 * answer). Plain strings and Intl only, so the page stays light.
 */
export function visitorFallbackNote(
  code: VisitorErrorCode,
  quota: VisitorQuota | null,
  now: Date = new Date()
): string {
  const ends = quota?.peak && quota.peakEndsAt ? new Date(quota.peakEndsAt) : null;
  const until = ends && ends > now ? ` until ${formatPeakTime(ends)}` : "";
  switch (code) {
    case "visitor_limit":
      return "You've used all of today's messages with Amr. Here's the tool finder until tomorrow.";
    case "visitor_peak_limit":
      return `You've used all your messages for these busy hours. Here's the tool finder${until || " until they end"}.`;
    case "site_limit":
      return "Amr has answered all he can for today. Here's the tool finder until tomorrow.";
    case "site_peak_limit":
      return `Amr has answered all he can for these busy hours. Here's the tool finder${until || " until they end"}.`;
    case "site_busy":
      return "Amr is too busy to answer right now. Here's the tool finder; try asking him again later.";
    case "disabled":
      return "Amr's AI is switched off right now. Here's the tool finder.";
    case "meter_unavailable":
      return "Amr can't check today's message count right now. Here's the tool finder; try asking him again in a few minutes.";
    default:
      return VISITOR_FALLBACK_NOTE;
  }
}

type Mode = "guide" | "consent" | "chat";

/**
 * Whether a refusal (visitorFallback) waits in the chat: there is a visitor's
 * chat to read, so it stays, read-only (its footer says which limit was
 * reached and takes the composer's place), instead of the panel going back to
 * the tool finder.
 */
export function fallbackWaits(s = useAgentStore.getState()): boolean {
  return s.chatProfile === "visitor" && s.messages.length > 0;
}

/**
 * Reopening the panel mid-chat goes straight back to the chat, a refusal and
 * all (it waits there, read-only).
 */
export function initialMode(): Mode {
  return fallbackWaits() && hasVisitorAiConsent() ? "chat" : "guide";
}

export function VisitorPanel({
  onNavigate,
  loadChat = importChat,
}: {
  onNavigate?: () => void;
  /** Imports the chat. Tests pass their own. */
  loadChat?: () => Promise<ChatModule>;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  // The question to send when the chat opens ("" opens it empty, or goes back
  // to the chat under way). Kept after "Not now", so the guide opens on it.
  const [question, setQuestion] = useState("");
  // The chat opens from the consent card's yes with no question waiting: its
  // message box takes focus, even on a touch screen.
  const [typeNow, setTypeNow] = useState(false);
  // The question the chat under way opened with, sent already. The guide opens
  // on it after "Tool finder", and while its search still holds it, the Ask
  // button goes back to the chat instead of asking it again.
  const [sent, setSent] = useState("");
  // The loader this panel started with, kept for its whole life.
  const [load] = useState(() => loadChat);
  // Why the chat last went back to the guide by itself: its code couldn't
  // load, or it failed while it was drawn. Null after a fresh try.
  const [failure, setFailure] = useState<"load" | "error" | null>(null);
  const fallback = useAgentStore((s) => s.visitorFallback);
  const quota = useAgentStore((s) => s.visitorQuota);
  // A chat is under way (it lives in the store, not in the chat step), so the
  // guide's Ask button can take the visitor back to it.
  const chatUnderWay = useAgentStore((s) => s.chatProfile === "visitor" && s.messages.length > 0);
  const announce = useAnnounce();
  const guideRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLDivElement>(null);

  // A "no more AI for now" refusal. In a chat under way it waits there,
  // read-only: the chat's footer says it and takes the focus the composer
  // had. Otherwise back to the tool finder: coming from another step, its
  // note takes focus (below), and a screen reader reads it then. It is
  // announced only when the guide is already showing, so it is never said
  // twice. An old one still showing when the panel opens is not said again.
  const lastFallback = useRef(fallback);
  const lastMode = useRef(mode);
  useEffect(() => {
    const was = lastFallback.current;
    lastFallback.current = fallback;
    if (!fallback) return;
    if (lastMode.current === "chat" && fallbackWaits()) return;
    setMode("guide");
    if (was === fallback) return;
    // A refusal drops the question: the panel can't tell which message was
    // refused, so the guide opens empty and its Ask button goes back to the chat.
    setQuestion("");
    setSent("");
    if (lastMode.current === "guide") announce(visitorFallbackNote(fallback, quota));
  }, [fallback, quota, announce]);

  // Clear chat empties the chat under way: its opening question is no longer
  // in it, so the guide neither opens on it nor treats it as sent. A fresh
  // chat is unaffected: openChat() sets `sent` before the chat is under way.
  const lastUnderWay = useRef(chatUnderWay);
  useEffect(() => {
    const was = lastUnderWay.current;
    lastUnderWay.current = chatUnderWay;
    if (was && !chatUnderWay) {
      setSent("");
      setQuestion("");
    }
  }, [chatUnderWay]);

  // Back on the guide from another step: focus goes to the note when there is
  // one, or else to the guide itself. Never when the panel opens.
  useEffect(() => {
    const was = lastMode.current;
    lastMode.current = mode;
    if (mode !== "guide" || was === "guide") return;
    (noteRef.current ?? guideRef.current)?.focus();
  }, [mode]);

  // The chat couldn't be shown: back to the tool finder, with a note, and
  // without the question (it was never answered; asking again starts fresh).
  // The note takes focus, so it is not announced as well.
  const chatFailed = (kind: "load" | "error") => {
    setQuestion("");
    setSent("");
    setFailure(kind);
    setMode("guide");
  };

  // The chat opens. A question becomes the chat's own; opening it empty with
  // no chat under way starts afresh; going back to the chat keeps its own.
  const openChat = (ask: string, agreed = false) => {
    if (ask || !chatUnderWay) setSent(ask);
    setTypeNow(agreed && !ask);
    setMode("chat");
  };

  const askAmr = (query: string) => {
    const q = query.trim();
    // Back to the chat under way, with no question or with the one it opened
    // with: that one was sent already, so nothing is sent twice.
    const back = chatUnderWay && (q === "" || q === sent);
    const ask = back ? "" : q;
    setQuestion(ask);
    // Asking again is a fresh try: the route answers again if it can, and the
    // chat's code loads again if it didn't. Going back to the chat isn't: a
    // refusal waits there, read-only, as it was.
    setFailure(null);
    if (!back) useAgentStore.getState().setVisitorFallback(null);
    if (hasVisitorAiConsent()) openChat(ask);
    else setMode("consent");
  };

  // The panel header says which step this is.
  const subtitle = <PanelSubtitle>{PANEL_SUBTITLE[mode]}</PanelSubtitle>;

  if (mode === "consent") {
    return (
      <>
        {subtitle}
        <VisitorAiConsent
          question={question}
          onAgree={() => openChat(question, true)}
          // Back to the guide with the question still in its search.
          onDecline={() => setMode("guide")}
          onNavigate={onNavigate}
        />
      </>
    );
  }
  if (mode === "chat") {
    // Asked for on each render of this step. The chat is imported when it
    // first renders (only in the browser: the panel starts closed, and on the
    // guide), and one whose import failed is replaced, so asking again
    // imports the chunk again.
    const Chat = chatFor(load);
    return (
      <>
        {subtitle}
        {/* A failure stops here, not at the app shell's error boundary, which
            would replace the page the visitor is on. */}
        <ErrorBoundary
          name="Visitor chat"
          fallback={() => (
            <ChatFailed onFailed={() => chatFailed(failedChats.has(Chat) ? "load" : "error")} />
          )}
        >
          {/* While it loads, a pen scribbles in its place, named for screen readers. */}
          <Suspense fallback={<PanelLoading />}>
            <Chat
              initialQuestion={question}
              takeFocus={typeNow}
              // Back to the guide, its search on the question the chat opened
              // with (`sent`), or the one Amr couldn't answer (from the
              // read-only footer), which is the chat's own from then on; the
              // guide's "Back to chat" returns to this chat, which then has
              // nothing to send.
              onOfflineGuide={(unanswered) => {
                setQuestion("");
                if (unanswered) setSent(unanswered);
                setMode("guide");
              }}
            />
          </Suspense>
        </ErrorBoundary>
      </>
    );
  }
  const note =
    failure === "load"
      ? VISITOR_CHAT_LOAD_NOTE
      : failure === "error"
        ? VISITOR_CHAT_ERROR_NOTE
        : fallback
          ? visitorFallbackNote(fallback, quota)
          : null;
  return (
    <>
      {subtitle}
      <VisitorGuide
        onNavigate={onNavigate}
        onAskAmr={askAmr}
        guideRef={guideRef}
        initialQuery={question || sent}
        resumeChat={chatUnderWay}
        resumeQuery={sent}
        // The note sits inside the guide's scroll area. Above it, in a panel as
        // short as 160 px, it left the guide a strip too low to use.
        note={
          note && (
            // A narration caption, the narrator's line, in a box that takes
            // focus from code only (tabIndex -1). Not a live region: it is read
            // once, when it takes focus or is announced.
            <div ref={noteRef} tabIndex={-1} className="shrink-0 focus:outline-none">
              <Narration tone={failure ? "error" : "note"}>{note}</Narration>
            </div>
          )
        }
      />
    </>
  );
}

/** Reports the failure once it has rendered: going back sets the panel's state. */
function ChatFailed({ onFailed }: { onFailed: () => void }) {
  const reported = useRef(false);
  useEffect(() => {
    if (reported.current) return;
    reported.current = true;
    onFailed();
  }, [onFailed]);
  return null;
}
