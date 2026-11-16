"use client";

/**
 * A visitor's chat with Amr's AI (visitor AI), loaded on demand.
 *
 * VisitorPanel imports this chunk (React.lazy) only after the visitor
 * agreed to the consent card, and this chunk loads the agent runtime
 * (lib/agent/visitor-runtime: the action registry and the streaming client)
 * only on the first message, with a dynamic import.
 *
 * The chat lives in memory (useAgentStore) and is never saved. Leaving it, by
 * closing the panel or going back to the tool finder, stops nothing: an
 * answer under way goes on in the store, and the chat shows it when it opens
 * again. A question still starting (the runtime loading) goes out all the
 * same, and a chat opened meanwhile waits for it, sending nothing over it.
 * Stop and Clear chat stop it. What the visitor has typed but not sent
 * stays in the store too (drafts.visitor), so it survives the same trips, and
 * a question asked from the guide while that answer is under way waits there.
 *
 * The chat is the comic strip (chat/chat-strip): Amr's balloons, the
 * visitor's captions and one caption per run of tool steps, in words only (a
 * visitor never sees JSON), with the confirm card under the step it asks
 * about (no Approve all for a visitor). Notes and errors show as a narration
 * caption under the strip (chat/chat-notice), the narrator's line and never
 * Amr's own words, with "Try again" or "Go on" when the notice calls for one.
 *
 * Nothing here reads the messages themselves, only plain values a streamed
 * chunk leaves as they were, so a chunk re-renders the strip alone, never
 * this view or its composer.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { BookOpen, Eraser, Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAgentStore, type VisitorQuota } from "@/lib/agent/store";
import { toolIdForPath } from "@/lib/agent/page-tool";
import { inLiveVisitorRoom, subscribeLiveVisitorRoom } from "@/lib/realtime/live-visitor-room";
import { VISITOR_LIMITS } from "@/lib/visitor-ai/contract";
import { formatPeakTime, peakWindow } from "@/lib/visitor-ai/peak";
import { cn } from "@/lib/utils";
import { useChatVisible } from "../chat-visibility";
import { ChatProvider } from "../chat/chat-context";
import { ThinkingItemView } from "../chat/chat-items";
import { ChatNotice } from "../chat/chat-notice";
import { ChatStrip, ThinkingStatus, useAwaitingReply } from "../chat/chat-strip";
import { handleMascotCommand } from "./engine/customization/commands";
import { COMPACT_HIDDEN, useInitialFocus } from "./panel-context";
import { VISITOR_AI_DAILY_MESSAGES } from "./visitor-ai-consent";

/** The per-window allowance the busy-hours note names before the route reports one. */
const PEAK_MESSAGES = 25;
/** How often the busy-hours note re-checks the clock. */
const CLOCK_TICK_MS = 60_000;
/** Said when the runtime can't load: nothing was sent. */
export const VISITOR_RUNTIME_LOAD_ERROR =
  "Amr's chat couldn't load. Check your connection and try again.";

type Runtime = typeof import("@/lib/agent/visitor-runtime");

let runtimePromise: Promise<Runtime> | null = null;
let loadedRuntime: Runtime | null = null;

/** The agent runtime, loaded once, on the first message. */
function loadRuntime(): Promise<Runtime> {
  if (!runtimePromise) {
    runtimePromise = import("@/lib/agent/visitor-runtime").then(
      (m) => {
        loadedRuntime = m;
        return m;
      },
      (err: unknown) => {
        // A failed chunk load may succeed on the next try.
        runtimePromise = null;
        throw err;
      }
    );
  }
  return runtimePromise;
}

/**
 * A turn still starting: the runtime is loading, and the turn goes out once it
 * has (its question reaches the store only then). It lives here, beside the
 * runtime, not in the chat: the turn outlives the chat, so a chat opened again
 * while it loads sees it as busy and starts nothing over it. `question` is the
 * message it will send, or null for Try again and Go on.
 */
let startingTurn: { question: string | null } | null = null;
const startingListeners = new Set<() => void>();

function setStartingTurn(next: { question: string | null } | null) {
  startingTurn = next;
  startingListeners.forEach((listener) => listener());
}

function subscribeStartingTurn(listener: () => void): () => void {
  startingListeners.add(listener);
  return () => {
    startingListeners.delete(listener);
  };
}

const turnStarting = () => startingTurn !== null;

/** The current time, refreshed every `ms`. */
function useNow(ms: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

/**
 * The busy-hours note, in the visitor's own time ("Busy hours until 12:00: 25
 * messages in this window"), or null outside Z.AI's peak window.
 *
 * The route's word wins once it has answered, either way: busy hours it
 * reports run until the end it gave; and "not busy hours" from it, given
 * during the window the clock expects, means the owner moved or emptied the
 * window (visitor_ai_config), so no note until the route says otherwise.
 * Before the route has answered in the current window, the clock (the default
 * window in lib/visitor-ai/peak) decides, naming the route's per-window limit
 * when it has sent one.
 */
export function peakNote(quota: VisitorQuota | null, now: Date): string | null {
  const reported = quota?.peak && quota.peakEndsAt ? new Date(quota.peakEndsAt) : null;
  if (quota && reported && reported > now) {
    const allowance =
      quota.peakRemaining != null && quota.peakLimit != null
        ? `${quota.peakRemaining} of ${quota.peakLimit} messages left in this window`
        : `${quota.peakLimit ?? PEAK_MESSAGES} messages in this window`;
    return `Busy hours until ${formatPeakTime(reported)}: ${allowance}`;
  }
  const win = peakWindow(now);
  if (!win.on || !win.endsAt) return null;
  if (quota && !quota.peak) {
    const then = peakWindow(quota.receivedAt === undefined ? now : new Date(quota.receivedAt));
    // Answered inside this same window: the route knows better than the clock.
    if (then.on && then.endsAt?.getTime() === win.endsAt.getTime()) return null;
  }
  return `Busy hours until ${formatPeakTime(win.endsAt)}: ${quota?.peakLimit ?? PEAK_MESSAGES} messages in this window`;
}

interface VisitorAgentPanelProps {
  /** Sent as soon as the chat opens ("" opens it empty). */
  initialQuestion: string;
  /** Back to the tool finder. */
  onOfflineGuide: () => void;
}

/** Keep what the visitor typed but hasn't sent (drafts.visitor). */
const setDraft = (text: string) => useAgentStore.getState().setDraft("visitor", text);

export default function VisitorAgentPanel({
  initialQuestion,
  onOfflineGuide,
}: VisitorAgentPanelProps) {
  const streaming = useAgentStore((s) => s.streaming);
  const quota = useAgentStore((s) => s.visitorQuota);
  const input = useAgentStore((s) => s.drafts.visitor);
  // A turn this chat or an earlier one started, its runtime still loading.
  const loading = useSyncExternalStore(subscribeStartingTurn, turnStarting, () => false);
  const pathname = usePathname();
  const now = useNow(CLOCK_TICK_MS);
  // In a visitor live room Amr gets no tools; the footer says so.
  const inLiveRoom = useSyncExternalStore(subscribeLiveVisitorRoom, inLiveVisitorRoom, () => false);
  // False while Amr's Scenes view covers the chat (mounted, hidden).
  const visible = useChatVisible();
  const empty = useAgentStore((s) => s.messages.length === 0);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const sentInitialRef = useRef(false);

  /**
   * Load the runtime (once) and start a turn with it. `typed` is the text the
   * visitor typed for it, put back in the box if the runtime can't load and
   * the box is still empty: nothing was sent. `question` is the message the
   * turn sends (null for Try again and Go on).
   */
  const startTurn = async (
    start: (runtime: Runtime) => unknown,
    typed: string | null,
    question: string | null
  ) => {
    // One turn at a time, across chats: a turn still starting counts as busy.
    if (startingTurn || useAgentStore.getState().streaming) return;
    setStartingTurn({ question });
    try {
      const runtime = await loadRuntime();
      // A turn outlives the chat: one asked as the panel closed still goes
      // out. It marks the store streaming before this returns, so the chat is
      // never idle between the two.
      void start(runtime);
    } catch {
      if (typed && !useAgentStore.getState().drafts.visitor) setDraft(typed);
      useAgentStore.getState().setError(VISITOR_RUNTIME_LOAD_ERROR);
    } finally {
      setStartingTurn(null);
    }
  };

  /**
   * Send a message: the box's draft (`fromBox`), which then empties, or the
   * question the chat opened with, which leaves a draft alone.
   */
  const send = async (raw: string, fromBox: boolean) => {
    const text = raw.trim().slice(0, VISITOR_LIMITS.userChars);
    // Busy first, so a draft is never wiped while another turn starts.
    if (!text || startingTurn || useAgentStore.getState().streaming) return;
    if (fromBox) setDraft("");
    // Mascot commands (/dance, /mascot-aura, /play) run locally, never through the AI.
    if (handleMascotCommand(text)) return;
    await startTurn(
      (runtime) => runtime.sendVisitorMessage(text, { toolId: toolIdForPath(pathname) }),
      fromBox ? raw : null,
      text
    );
  };

  // The notice hands focus to the message box before these run (read-only,
  // never disabled, while Amr answers).
  const tryAgain = () => {
    void startTurn(
      (runtime) => runtime.retryVisitorTurn({ toolId: toolIdForPath(pathname) }),
      null,
      null
    );
  };
  const goOn = () => {
    void startTurn(
      (runtime) => runtime.visitorGoOn({ toolId: toolIdForPath(pathname) }),
      null,
      null
    );
  };

  // The message box is where the panel's focus owner puts focus when the chat
  // opens, and again when it comes back from under the Scenes view, on a fine
  // pointer only: on a phone the keyboard would cover the answer to a question
  // already sent. Leaving the chat stops nothing, so there is nothing else to
  // tidy up when it unmounts.
  useInitialFocus(composerRef, visible);

  // The question the visitor asked from the guide or the consent card.
  useEffect(() => {
    if (sentInitialRef.current || !initialQuestion) return;
    sentInitialRef.current = true;
    // A turn that outlived the chat is still under way, or still starting (its
    // runtime loading): the new question waits in the box (nothing was sent,
    // nothing spent) instead of being dropped, after anything already typed
    // there. Send it once Amr is done. The very question still starting goes
    // out with that turn, so it doesn't wait in the box as well.
    const pending = startingTurn;
    if (useAgentStore.getState().streaming || pending) {
      const q = initialQuestion.trim().slice(0, VISITOR_LIMITS.userChars);
      const draft = useAgentStore.getState().drafts.visitor;
      if (q && q !== pending?.question && !draft.includes(q)) {
        setDraft(
          draft.trim() ? `${draft.trimEnd()}\n\n${q}`.slice(0, VISITOR_LIMITS.userChars) : q
        );
      }
      return;
    }
    void send(initialQuestion, false);
    // send reads the latest state itself; this runs once per panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion]);

  const busy = streaming || loading;
  // The thinking balloon and status, until the reply's first words or steps
  // arrive (or between tool rounds). The log follows itself (chat-frame).
  const awaiting = useAwaitingReply(busy);
  const peak = peakNote(quota, now);

  // The composer's row: the frame keeps it shrink-0 (the form its direct
  // child) and makes room beside it for docked Amr.
  const footer = (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input, true);
        }}
        className="flex items-end gap-2"
      >
        <textarea
          ref={composerRef}
          data-amr-composer=""
          value={input}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input, true);
            }
          }}
          maxLength={VISITOR_LIMITS.userChars}
          placeholder="Ask Amr…"
          rows={2}
          className="flex-1 resize-none rounded-md border border-border bg-[var(--card)] px-3 py-2 text-sm text-text placeholder:text-sub focus:outline-none focus:ring-1 focus:ring-accent"
          // Read-only while Amr answers, not disabled: a disabled box drops
          // the focus it took when the chat opened, and never gets it back.
          readOnly={busy}
          aria-label="Message"
        />
        {streaming ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => loadedRuntime?.abortInFlight()}
            aria-label="Stop generating"
            title="Stop"
            className="border-destructive text-destructive hover:bg-destructive/10"
          >
            <Square className="h-4 w-4" aria-hidden="true" />
          </Button>
        ) : (
          <Button type="submit" disabled={!input.trim() || busy} size="icon" aria-label="Send">
            <Send className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
      </form>
      <ThinkingStatus awaiting={awaiting} />
      {/* The status lines wait while the panel is compact. */}
      <p className={cn("mt-1.5 text-xs text-sub", COMPACT_HIDDEN)} data-testid="visitor-ai-quota">
        {quota
          ? `${quota.remaining} of ${quota.limit} left today`
          : `${VISITOR_AI_DAILY_MESSAGES} AI uses a day`}
        {inLiveRoom ? " · Not saved" : " · Amr asks before changing anything · Not saved"}
      </p>
      {peak && <p className={cn("mt-1 text-xs text-sub", COMPACT_HIDDEN)}>{peak}</p>}
      {inLiveRoom && (
        <p className="mt-1 text-xs text-sub" data-testid="visitor-ai-live-room">
          You&apos;re in a live room, so Amr only answers questions here: he won&apos;t read or
          change your tools.
        </p>
      )}
      <div className="mt-2 flex items-center justify-between gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onOfflineGuide}>
          <BookOpen aria-hidden="true" />
          Tool finder
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          // Through the store: reset stops the answer under way before the
          // chat empties, so none of it lands in the fresh one.
          onClick={() => useAgentStore.getState().reset()}
        >
          <Eraser aria-hidden="true" />
          Clear chat
        </Button>
      </div>
    </>
  );

  return (
    // The panel can be as short as 160 px (a landscape phone). The frame (the
    // log's direct parent) keeps the log's floor and the footer's height, so
    // in a short panel it scrolls and the composer and buttons stay in reach.
    // In a tall panel nothing overflows there: the log takes the rest and
    // scrolls inside itself. Compact (a phone's keyboard up) the log's floor
    // drops to 3rem.
    <ChatProvider profile="visitor" composerRef={composerRef}>
      <ChatStrip busy={busy} footer={footer} className="px-3 py-2">
        {empty && !busy && (
          <div className="space-y-2 py-10 text-center text-sm text-sub">
            <p>Ask Amr about agile, or about the tool you&apos;re on.</p>
            <ul className="space-y-1 text-xs">
              <li>&quot;How do I run a good retro?&quot;</li>
              <li>&quot;Which tool helps me prioritize a backlog?&quot;</li>
              {/* In a live room Amr changes nothing, so the third example is a question. */}
              {inLiveRoom ? (
                <li>&quot;What makes a good sprint goal?&quot;</li>
              ) : (
                <li>&quot;Add a card &lsquo;flaky CI&rsquo; to my retro.&quot;</li>
              )}
            </ul>
          </div>
        )}
        {awaiting && <ThinkingItemView />}
        <ChatNotice
          ready={!busy}
          // The runtime that ran the turn knows (it holds the registry).
          canRetry={(messages) => loadedRuntime?.canRetryLastTurn(messages) ?? false}
          onTryAgain={tryAgain}
          onGoOn={goOn}
        />
      </ChatStrip>
    </ChatProvider>
  );
}
