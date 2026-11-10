"use client";

/**
 * A visitor's chat with Amr's AI (visitor AI), loaded on demand.
 *
 * VisitorPanel imports this chunk (React.lazy) only after the visitor
 * agreed to the consent card, and this chunk loads the agent runtime
 * (lib/agent/visitor-runtime: the action registry and the streaming client)
 * only on the first message, with a dynamic import.
 *
 * The chat lives in memory (useAgentStore) and is never saved. Closing the
 * panel, or going back to the offline guide, stops any answer in progress.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { AlertTriangle, BookOpen, Eraser, Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAgentStore, type VisitorQuota } from "@/lib/agent/store";
import { toolIdForPath } from "@/lib/agent/page-tool";
import { inLiveVisitorRoom, subscribeLiveVisitorRoom } from "@/lib/realtime/live-visitor-room";
import { VISITOR_LIMITS } from "@/lib/visitor-ai/contract";
import { formatPeakTime, peakWindow } from "@/lib/visitor-ai/peak";
import { ConfirmAction } from "../confirm-action";
import { MessageBubble } from "../message-bubble";
import { handleMascotCommand } from "./engine/customization/commands";
import { VISITOR_AI_DAILY_MESSAGES } from "./visitor-ai-consent";

/** The per-window allowance the busy-hours note names before the route reports one. */
const PEAK_MESSAGES = 25;
/** How often the busy-hours note re-checks the clock. */
const CLOCK_TICK_MS = 60_000;

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
  /** Back to the offline guide. */
  onOfflineGuide: () => void;
}

export default function VisitorAgentPanel({
  initialQuestion,
  onOfflineGuide,
}: VisitorAgentPanelProps) {
  const messages = useAgentStore((s) => s.messages);
  const streaming = useAgentStore((s) => s.streaming);
  const error = useAgentStore((s) => s.error);
  const quota = useAgentStore((s) => s.visitorQuota);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const pathname = usePathname();
  const now = useNow(CLOCK_TICK_MS);
  // In a visitor live room Amr gets no tools; the footer says so.
  const inLiveRoom = useSyncExternalStore(subscribeLiveVisitorRoom, inLiveVisitorRoom, () => false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const mountedRef = useRef(false);
  const sentInitialRef = useRef(false);
  const sendingRef = useRef(false);

  const send = async (raw: string) => {
    const text = raw.trim().slice(0, VISITOR_LIMITS.userChars);
    if (!text || sendingRef.current || useAgentStore.getState().streaming) return;
    // Mascot commands (/dance, /mascot-aura) run locally, never through the AI.
    if (handleMascotCommand(text)) {
      setInput("");
      return;
    }
    setInput("");
    sendingRef.current = true;
    setLoading(true);
    try {
      const runtime = await loadRuntime();
      if (!mountedRef.current) return;
      void runtime.sendVisitorMessage(text, { toolId: toolIdForPath(pathname) });
    } catch {
      useAgentStore
        .getState()
        .setError("Amr's chat couldn't load. Check your connection and try again.");
    } finally {
      sendingRef.current = false;
      setLoading(false);
    }
  };

  // Mounted; on unmount, stop any answer in progress. The stop waits a tick:
  // React's development double-mount runs this cleanup and the effect again
  // straight away, and that must not cancel the question sent on mount.
  useEffect(() => {
    mountedRef.current = true;
    composerRef.current?.focus();
    return () => {
      mountedRef.current = false;
      queueMicrotask(() => {
        if (!mountedRef.current) loadedRuntime?.abortInFlight();
      });
    };
  }, []);

  // The question the visitor asked from the guide or the consent card.
  useEffect(() => {
    if (sentInitialRef.current || !initialQuestion) return;
    sentInitialRef.current = true;
    void send(initialQuestion);
    // send reads the latest state itself; this runs once per panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion]);

  const busy = streaming || loading;
  useEffect(() => {
    const log = scrollRef.current;
    if (!log) return;
    log.scrollTo?.({ top: log.scrollHeight, behavior: "smooth" });
    // In a short panel the root scrolls too, and the message box's focus
    // leaves the log above the view: bring the log back when there is
    // something new in it. In a tall panel the log is in view, so this moves
    // nothing. An empty chat stays on the message box.
    if (messages.length > 0 || busy) log.scrollIntoView?.({ block: "nearest" });
  }, [messages.length, streaming, busy]);

  // "Thinking…" until the reply's first words arrive (or between tool rounds).
  const last = messages[messages.length - 1];
  const awaiting = busy && (!last || last.role !== "assistant" || last.content.length === 0);
  const peak = peakNote(quota, now);

  return (
    // The panel can be as short as 160 px (a landscape phone). The log keeps a
    // floor and the footer keeps its height, so in a short panel this root
    // scrolls and the composer and buttons stay in reach. In a tall panel
    // nothing overflows here: the log takes the rest and scrolls inside itself.
    <div className="flex h-full min-h-0 flex-col overflow-y-auto px-3 py-2">
      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-label="Conversation"
        className="min-h-[6rem] flex-1 space-y-3 overflow-y-auto px-1 py-2"
      >
        {messages.length === 0 && !busy && (
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
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {awaiting && (
          <div className="flex items-center gap-2 px-1 text-xs text-sub" role="status">
            <span className="inline-flex gap-1" aria-hidden="true">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent" />
            </span>
            Amr is thinking…
          </div>
        )}
        <ConfirmAction allowApproveAll={false} />
        {error && (
          <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
      </div>

      <div className="mt-2 shrink-0 border-t border-border pt-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
          className="flex items-end gap-2"
        >
          <textarea
            ref={composerRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
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
        <p className="mt-1.5 text-xs text-sub" data-testid="visitor-ai-quota">
          {quota
            ? `${quota.remaining} of ${quota.limit} left today`
            : `${VISITOR_AI_DAILY_MESSAGES} messages a day`}
          {inLiveRoom ? " · Not saved" : " · Amr asks before changing anything · Not saved"}
        </p>
        {peak && <p className="mt-1 text-xs text-sub">{peak}</p>}
        {inLiveRoom && (
          <p className="mt-1 text-xs text-sub" data-testid="visitor-ai-live-room">
            You&apos;re in a live room, so Amr only answers questions here: he won&apos;t read or
            change your tools.
          </p>
        )}
        <div className="mt-2 flex items-center justify-between gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onOfflineGuide}>
            <BookOpen aria-hidden="true" />
            Offline guide
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              loadedRuntime?.abortInFlight();
              useAgentStore.getState().reset();
            }}
          >
            <Eraser aria-hidden="true" />
            Clear chat
          </Button>
        </div>
      </div>
    </div>
  );
}
