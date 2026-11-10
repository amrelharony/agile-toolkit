"use client";

/**
 * What the mascot's panel shows a signed-out visitor when visitor AI is on.
 *
 * Three steps, offline first:
 *  - guide: the offline tool finder (VisitorGuide), as before, plus "Ask Amr
 *    about '…'" and "Chat with Amr". Opening the panel sends nothing.
 *  - consent: the first time, a card says where messages go
 *    (VisitorAiConsent). Nothing is sent before "Agree and ask".
 *  - chat: Amr's AI (visitor-agent-panel), a separate chunk loaded only now;
 *    the agent runtime behind it loads on the first message.
 *
 * When the visitor route says there's no more AI for now (visitorFallback),
 * the panel goes back to the guide with a note saying which limit was reached
 * (visitorFallbackNote). It does the same when the chat's chunk can't load
 * (offline, or a tab left open across a deploy), and asking again tries the
 * import again. And it does the same when the loaded chat fails while it is
 * drawn.
 *
 * Focus follows the step: the consent card and the chat's message box take it
 * themselves, and a return to the guide puts it on the note, or on the guide
 * when there is no note. A panel that opens on the guide moves no focus (one
 * opened again mid-chat opens on the chat). A note is read out once: by taking
 * focus, or through the announcer when the guide was already showing and no
 * focus moves.
 *
 * This module stays light: it ships in every page with the mascot.
 */

import { Suspense, lazy, useEffect, useRef, useState, type LazyExoticComponent } from "react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ErrorBoundary } from "@/components/layout/error-boundary";
import { useAgentStore, type VisitorQuota } from "@/lib/agent/store";
import type { VisitorErrorCode } from "@/lib/visitor-ai/contract";
import { formatPeakTime } from "@/lib/visitor-ai/peak";
import { VisitorGuide } from "./visitor-guide";
import { VisitorAiConsent, hasVisitorAiConsent } from "./visitor-ai-consent";

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
export const VISITOR_FALLBACK_NOTE =
  "Amr has answered all he can for now. Here's the offline guide.";

/** Shown over the guide when the chat's code couldn't load. */
export const VISITOR_CHAT_LOAD_NOTE =
  "Amr's chat couldn't load. Check your connection, or reload the page. Here's the offline guide.";

/** Shown over the guide when the chat loaded and then failed while it was drawn. */
export const VISITOR_CHAT_ERROR_NOTE =
  "Amr's chat ran into a problem. Reload the page to try again. Here's the offline guide.";

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
      return "You've used all of today's messages with Amr. Here's the offline guide until tomorrow.";
    case "visitor_peak_limit":
      return `You've used all your messages for these busy hours. Here's the offline guide${until || " until they end"}.`;
    case "site_limit":
      return "Amr has answered all he can for today. Here's the offline guide until tomorrow.";
    case "site_peak_limit":
      return `Amr has answered all he can for these busy hours. Here's the offline guide${until || " until they end"}.`;
    case "site_busy":
      return "Amr is too busy to answer right now. Here's the offline guide; try asking him again later.";
    case "disabled":
      return "Amr's AI is switched off right now. Here's the offline guide.";
    case "meter_unavailable":
      return "Amr can't check today's message count right now. Here's the offline guide; try asking him again in a few minutes.";
    default:
      return VISITOR_FALLBACK_NOTE;
  }
}

type Mode = "guide" | "consent" | "chat";

/** Reopening the panel mid-chat goes straight back to the chat. */
function initialMode(): Mode {
  const s = useAgentStore.getState();
  const midChat = s.chatProfile === "visitor" && s.messages.length > 0 && !s.visitorFallback;
  return midChat && hasVisitorAiConsent() ? "chat" : "guide";
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
  // The question to send when the chat opens ("" opens it empty).
  const [question, setQuestion] = useState("");
  // The loader this panel started with, kept for its whole life.
  const [load] = useState(() => loadChat);
  // Why the chat last went back to the guide by itself: its code couldn't
  // load, or it failed while it was drawn. Null after a fresh try.
  const [failure, setFailure] = useState<"load" | "error" | null>(null);
  const fallback = useAgentStore((s) => s.visitorFallback);
  const quota = useAgentStore((s) => s.visitorQuota);
  const announce = useAnnounce();
  const guideRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLParagraphElement>(null);

  // A "no more AI for now" refusal: back to the offline guide. Coming from
  // another step, its note takes focus (below), and a screen reader reads it
  // then. It is announced only when the guide is already showing, so it is
  // never said twice. An old one still showing when the panel opens is not
  // said again.
  const lastFallback = useRef(fallback);
  const lastMode = useRef(mode);
  useEffect(() => {
    const was = lastFallback.current;
    lastFallback.current = fallback;
    if (!fallback) return;
    setMode("guide");
    if (was !== fallback && lastMode.current === "guide") {
      announce(visitorFallbackNote(fallback, quota));
    }
  }, [fallback, quota, announce]);

  // Back on the guide from another step: focus goes to the note when there is
  // one, or else to the guide itself. Never when the panel opens.
  useEffect(() => {
    const was = lastMode.current;
    lastMode.current = mode;
    if (mode !== "guide" || was === "guide") return;
    (noteRef.current ?? guideRef.current)?.focus();
  }, [mode]);

  // The chat couldn't be shown: back to the offline guide, with a note. The
  // note takes focus, so it is not announced as well.
  const chatFailed = (kind: "load" | "error") => {
    setQuestion("");
    setFailure(kind);
    setMode("guide");
  };

  const askAmr = (query: string) => {
    setQuestion(query.trim());
    // Asking again is a fresh try: the route answers again if it can, and the
    // chat's code loads again if it didn't.
    setFailure(null);
    useAgentStore.getState().setVisitorFallback(null);
    setMode(hasVisitorAiConsent() ? "chat" : "consent");
  };

  if (mode === "consent") {
    return (
      <VisitorAiConsent
        question={question}
        onAgree={() => setMode("chat")}
        onDecline={() => setMode("guide")}
      />
    );
  }
  if (mode === "chat") {
    // Asked for on each render of this step. The chat is imported when it
    // first renders (only in the browser: the panel starts closed, and on the
    // guide), and one whose import failed is replaced, so asking again
    // imports the chunk again.
    const Chat = chatFor(load);
    return (
      // A failure stops here, not at the app shell's error boundary, which
      // would replace the page the visitor is on.
      <ErrorBoundary
        name="Visitor chat"
        fallback={() => (
          <ChatFailed onFailed={() => chatFailed(failedChats.has(Chat) ? "load" : "error")} />
        )}
      >
        <Suspense fallback={<div className="min-h-0 flex-1" aria-busy="true" />}>
          <Chat
            initialQuestion={question}
            onOfflineGuide={() => {
              setQuestion("");
              setMode("guide");
            }}
          />
        </Suspense>
      </ErrorBoundary>
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
    <VisitorGuide
      onNavigate={onNavigate}
      onAskAmr={askAmr}
      guideRef={guideRef}
      // The note sits inside the guide's scroll area. Above it, in a panel as
      // short as 160 px, it left the guide a strip too low to use.
      note={
        note && (
          // Not a live region: it is read once, when it takes focus or is
          // announced (tabIndex -1: focusable from code only).
          <p
            ref={noteRef}
            tabIndex={-1}
            className="shrink-0 rounded-md border border-border bg-card px-3 py-2 text-sm text-text focus:outline-none"
          >
            {note}
          </p>
        )
      }
    />
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
