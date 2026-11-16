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
 * Amr's own words, with "Try again" or "Go on" when the notice calls for one;
 * the chat's status line (chat/chat-status) says what Amr is doing while he
 * answers. Under the latest reply, once its turn is done, its end
 * (chat/reply-end, loaded with the first message, so the chat's first paint
 * doesn't carry it): Copy reply, the same Try again (while the turn ran no
 * change and a message is left; it says it spends one) and up to two
 * follow-ups. An empty chat shows a narration line and up to three starters for
 * the page the visitor is on (chat/chat-empty, words in
 * lib/agent/visitor-starters); a starter fills the message box and never
 * sends, so it spends nothing. The composer is the one both chats share
 * (chat/chat-composer), with the visitor's limit on a message's length, a
 * counter near it, and the allowance in its status row. Its mic asks first
 * (VisitorDictate): browser dictation may send the audio to the browser's
 * maker, so the first press shows the voice notice (./voice-notice, loaded
 * only then), and only "Use voice" starts it.
 *
 * Nothing here reads the messages themselves, only plain values a streamed
 * chunk leaves as they were, so a chunk re-renders the strip alone, never
 * this view or its composer.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
} from "react";
import { usePathname } from "next/navigation";
import { BookOpen, Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAgentStore, type VisitorQuota } from "@/lib/agent/store";
import type { ChatMessage } from "@/lib/agent/types";
import { resolvePageTool, toolIdForPath } from "@/lib/agent/page-tool";
import { VISITOR_EMPTY, visitorStarters } from "@/lib/agent/visitor-starters";
import { inLiveVisitorRoom, subscribeLiveVisitorRoom } from "@/lib/realtime/live-visitor-room";
import { isVipHidden } from "@/lib/tools/catalog";
import { useVipHint } from "@/lib/vip/use-vip-hint";
import { VISITOR_LIMITS } from "@/lib/visitor-ai/contract";
import { formatPeakTime, peakWindow } from "@/lib/visitor-ai/peak";
import { cn } from "@/lib/utils";
import { hasVoiceConsent, storeVoiceConsent } from "@/lib/agent/mascot/voice-consent";
import { ChatComposer, type ComposerMicProps } from "../chat/chat-composer";
import { ChatProvider } from "../chat/chat-context";
import { DictateButton } from "../chat/dictate-button";
import { ChatEmpty } from "../chat/chat-empty";
import { ThinkingItemView } from "../chat/chat-items";
import { ChatNotice } from "../chat/chat-notice";
import { ChatStrip, useAwaitingReply } from "../chat/chat-strip";
import type { ReplyEndProps } from "../chat/reply-end";
import { COMPACT_HIDDEN } from "./panel-context";
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

let LoadedReplyEnd: ComponentType<ReplyEndProps> | null = null;
let replyEndLoad: Promise<void> | null = null;
const replyEndListeners = new Set<() => void>();

function subscribeReplyEnd(listener: () => void): () => void {
  replyEndListeners.add(listener);
  return () => {
    replyEndListeners.delete(listener);
  };
}

const loadedReplyEnd = () => LoadedReplyEnd;

/**
 * The end of a reply (chat/reply-end: Copy reply, Try again, the follow-ups
 * and their rules), loaded as the first message goes out: nothing needs it
 * before a reply, so the chat's first paint doesn't carry it. Never in a
 * turn's way: it is small and loads beside the runtime, so it is nearly
 * always in before the reply it ends, and a reply that settles first gets it
 * as it arrives. If it fails to load, a reply has no end until the next
 * message tries again.
 */
function loadReplyEnd(): void {
  replyEndLoad ??= import("../chat/reply-end").then(
    (m) => {
      LoadedReplyEnd = m.ReplyEnd;
      replyEndListeners.forEach((listener) => listener());
    },
    () => {
      replyEndLoad = null;
    }
  );
}

/**
 * The end of a visitor's reply, once it has loaded (nothing before); only it
 * draws again as it arrives. Stable, so the strip keeps it.
 */
function VisitorReplyEnd(props: ReplyEndProps) {
  const End = useSyncExternalStore(subscribeReplyEnd, loadedReplyEnd, () => null);
  return End ? <End {...props} /> : null;
}

/** A visitor's messages left now: today's, or fewer in busy hours. Null before the route has said. */
function messagesLeft(quota: VisitorQuota | null): number | null {
  if (!quota) return null;
  return quota.peak && quota.peakRemaining !== null
    ? Math.min(quota.remaining, quota.peakRemaining)
    : quota.remaining;
}

/** Said when the voice notice can't load: dictation didn't start. */
export const VOICE_NOTICE_LOAD_ERROR = "Voice couldn't load. Check your connection and try again.";

let voiceNotice: Promise<typeof import("./voice-notice")> | null = null;

/** The voice notice, loaded on the first press of the mic that needs it. */
function loadVoiceNotice() {
  voiceNotice ??= import("./voice-notice").catch((err: unknown) => {
    // A failed chunk load may succeed on the next press.
    voiceNotice = null;
    throw err;
  });
  return voiceNotice;
}

/** A new key for each notice shown, so a press while one shows brings it focus again. */
let noticeShown = 0;

/**
 * The visitor's mic: the owner's DictateButton, asking first. Browser
 * dictation may send the audio to the browser's maker, so until this browser
 * said "Use voice" (lib/agent/mascot/voice-consent), a press shows the voice
 * notice under the box's row (./voice-notice, loaded only then) and starts
 * nothing. The notice takes focus as it shows, unless the visitor moved focus
 * or typed while it loaded (a slow connection): then it shows and leaves their
 * place alone, and the mic's next press brings it focus. Either choice hands
 * focus back to the mic; "Use voice" remembers the yes and starts dictation.
 */
function VisitorDictate(props: ComposerMicProps) {
  const { show, onNote, draft } = props;
  const ask = (start: () => void, mic: HTMLButtonElement) => {
    if (hasVoiceConsent()) return start();
    const doc = mic.ownerDocument;
    const focusAtPress = doc.activeElement;
    const draftAtPress = draft();
    loadVoiceNotice().then(
      ({ VoiceNotice }) => {
        const now = doc.activeElement;
        // The visitor moved on while it loaded (focus elsewhere, or typing): leave their place alone.
        const takeFocus =
          draft() === draftAtPress &&
          (!now || now === doc.body || now === mic || now === focusAtPress);
        show(
          <VoiceNotice
            key={++noticeShown}
            takeFocus={takeFocus}
            onChoose={(yes) => {
              show(null);
              mic.focus();
              if (!yes) return;
              storeVoiceConsent();
              start();
            }}
          />
        );
      },
      () => onNote(VOICE_NOTICE_LOAD_ERROR, "error")
    );
  };
  return <DictateButton {...props} ask={ask} />;
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
  /** Back to the tool finder. */
  onOfflineGuide: () => void;
  /**
   * The message box takes focus as the chat opens, even on a touch screen:
   * the visitor said yes on the consent card with no question waiting, so
   * typing is what they came to do.
   */
  takeFocus?: boolean;
}

/** Keep what the visitor typed but hasn't sent (drafts.visitor). */
const setDraft = (text: string) => useAgentStore.getState().setDraft("visitor", text);

export default function VisitorAgentPanel({
  initialQuestion,
  onOfflineGuide,
  takeFocus = false,
}: VisitorAgentPanelProps) {
  const streaming = useAgentStore((s) => s.streaming);
  const quota = useAgentStore((s) => s.visitorQuota);
  // A turn this chat or an earlier one started, its runtime still loading.
  const loading = useSyncExternalStore(subscribeStartingTurn, turnStarting, () => false);
  const pathname = usePathname();
  const now = useNow(CLOCK_TICK_MS);
  // In a visitor live room Amr gets no tools; the footer says so.
  const inLiveRoom = useSyncExternalStore(subscribeLiveVisitorRoom, inLiveVisitorRoom, () => false);
  const empty = useAgentStore((s) => s.messages.length === 0);
  const vip = useVipHint();
  // The page's tool when the visitor may see it (the menus' rule: a lock
  // panel or a tool not out yet goes unnamed): the empty chat's starters and
  // the composer's "On {tool}" name it.
  const tool = useMemo(() => {
    const found = resolvePageTool(toolIdForPath(pathname));
    return found && !isVipHidden(found, vip) ? found : null;
  }, [pathname, vip]);
  const starters = useMemo(() => visitorStarters(tool, inLiveRoom), [tool, inLiveRoom]);
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
    loadReplyEnd();
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
   * Send a message: the box's draft (`fromBox`: the composer has emptied the
   * box, and ran a chat command such as /dance itself, so it never reached
   * the AI), or the question the chat opened with, which leaves a draft alone.
   */
  const send = async (raw: string, fromBox: boolean) => {
    const text = raw.trim().slice(0, VISITOR_LIMITS.userChars);
    // Busy first, so a draft is never wiped while another turn starts.
    if (!text || startingTurn || useAgentStore.getState().streaming) return;
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
  // One Try again, for the notice's button and the one under the latest
  // reply. The runtime that ran the turn knows (it holds the registry).
  const retry = {
    canRetry: (messages: ChatMessage[]) => loadedRuntime?.canRetryLastTurn(messages) ?? false,
    onTryAgain: tryAgain,
  };
  // Under the reply it says what it spends; with no message left, it isn't offered.
  const left = messagesLeft(quota);

  // The message box (the composer) is where the panel's focus owner puts
  // focus when the chat opens, and again when it comes back from under the
  // Scenes view, on a fine pointer only: on a phone the keyboard would cover
  // the answer to a question already sent. Leaving the
  // chat stops nothing, so there is nothing else to tidy up when it unmounts.

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
  // The thinking balloon, until the reply's first words or steps arrive (or
  // between tool rounds). The log follows itself (chat-frame).
  const awaiting = useAwaitingReply(busy);
  const peak = peakNote(quota, now);

  // The composer's row: the frame keeps it shrink-0 (the form its direct
  // child) and makes room beside it for docked Amr.
  const footer = (
    <ChatComposer
      busy={busy}
      // A turn still loading its runtime has nothing to stop yet.
      canStop={streaming}
      onSend={(_text, raw) => void send(raw, true)}
      onStop={() => loadedRuntime?.abortInFlight()}
      maxLength={VISITOR_LIMITS.userChars}
      tool={tool?.name}
      takeFocus={takeFocus}
      mic={VisitorDictate}
      // In the status row, never live; it waits while the panel is compact.
      status={
        <span data-testid="visitor-ai-quota">
          {quota
            ? `${quota.remaining} of ${quota.limit} left today`
            : `${VISITOR_AI_DAILY_MESSAGES} AI uses a day`}
          {inLiveRoom ? " · Not saved" : " · Amr asks before changing anything · Not saved"}
        </span>
      }
    >
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
    </ChatComposer>
  );

  return (
    // The panel can be as short as 160 px (a landscape phone). The frame (the
    // log's direct parent) keeps the log's floor and the footer's height, so
    // in a short panel it scrolls and the composer and buttons stay in reach.
    // In a tall panel nothing overflows there: the log takes the rest and
    // scrolls inside itself. Compact (a phone's keyboard up) the log's floor
    // drops to 3rem.
    <ChatProvider profile="visitor">
      <ChatStrip
        busy={busy}
        footer={footer}
        className="px-3 py-2"
        replyEnd={VisitorReplyEnd}
        retry={left === 0 ? undefined : { ...retry, left }}
      >
        {empty && !busy && (
          <ChatEmpty line={VISITOR_EMPTY.line} short={VISITOR_EMPTY.short} starters={starters} />
        )}
        {awaiting && <ThinkingItemView />}
        <ChatNotice ready={!busy} {...retry} onGoOn={goOn} />
      </ChatStrip>
    </ChatProvider>
  );
}
