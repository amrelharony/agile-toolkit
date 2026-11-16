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
 * counter near it, and the allowance in its status row: one line, never live
 * (lib/visitor-ai/allowance: the day's messages, busy hours while they are
 * on, that Amr asks before a change, that nothing is saved), standing out
 * when only a few are left. Its mic asks first
 * (VisitorDictate): browser dictation may send the audio to the browser's
 * maker, so the first press shows the voice notice (./voice-notice, loaded
 * only then), and only "Use voice" starts it.
 *
 * Once no message can go out (a refusal for now, visitorFallback, or the
 * allowance at none left), the read-only footer (./visitor-chat-footer,
 * loaded with the first message) takes the composer's place and says why,
 * while the chat stays readable: its log and Copy reply stay, and the
 * follow-ups and Try again's spend under the latest reply go (there is no
 * box to fill and nothing to spend). The busy hours' smaller allowance, and
 * a refusal for it, end on the clock as the hours do, and the box comes back
 * (the footer keeps that clock: only a read-only chat waits on it). The
 * day's allowance, and a refusal for the day, end with the Cairo day the
 * meter counts by: on the chat's minute tick past it, the box comes back and
 * the next message asks the route for the new day's.
 *
 * Its header (panel-chrome's slots): a "Back to tool finder" chevron before
 * the name plate, and Clear chat among the view's icons while there is
 * something to clear. In a visitor live room, where Amr gets no tools, a
 * narration caption in the log says so (only questions there).
 *
 * Nothing here reads the messages themselves, only plain values a streamed
 * chunk leaves as they were, so a chunk re-renders the strip alone, never
 * this view or its composer.
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { ChevronLeft, Eraser } from "lucide-react";
import { useAgentStore } from "@/lib/agent/store";
import type { ChatMessage } from "@/lib/agent/types";
import { resolvePageTool, toolIdForPath } from "@/lib/agent/page-tool";
import { VISITOR_EMPTY, visitorStarters } from "@/lib/agent/visitor-starters";
import { inLiveVisitorRoom, subscribeLiveVisitorRoom } from "@/lib/realtime/live-visitor-room";
import { isVipHidden } from "@/lib/tools/catalog";
import { useVipHint } from "@/lib/vip/use-vip-hint";
import {
  allowanceLine,
  dayOver,
  lowOnMessages,
  messagesLeft,
  retryCost,
} from "@/lib/visitor-ai/allowance";
import { VISITOR_LIMITS } from "@/lib/visitor-ai/contract";
import { hasVoiceConsent, storeVoiceConsent } from "@/lib/agent/mascot/voice-consent";
import { ChatComposer, type ComposerMicProps } from "../chat/chat-composer";
import { ChatProvider } from "../chat/chat-context";
import { DictateButton } from "../chat/dictate-button";
import { ChatEmpty } from "../chat/chat-empty";
import { ThinkingItemView } from "../chat/chat-items";
import { ChatNotice } from "../chat/chat-notice";
import { ChatStrip, useAwaitingReply } from "../chat/chat-strip";
import type { ReplyEndProps } from "../chat/reply-end";
import type { ReadOnlyFooterProps } from "./visitor-chat-footer";
import { Narration } from "../comic/comic-parts";
import { PanelActions, PanelBack, PanelIconButton } from "./panel-chrome";

/** The busy-hours note, here since before it moved to lib/visitor-ai/allowance. */
export { peakNote } from "@/lib/visitor-ai/allowance";

/** How often the allowance line re-checks the clock (busy hours start and end). */
const CLOCK_TICK_MS = 60_000;
/** Said in the log while the visitor is in a live room, where Amr gets no tools. */
export const LIVE_ROOM_LINE =
  "You're in a live room, so Amr only answers questions here: he won't read or change your tools.";
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

/**
 * A part of the chat in a chunk of its own, which the chat's first paint
 * doesn't carry: `load` imports it once (a failed load tries again on the
 * next call), `prefetch` does so quietly, and `useLoaded` gives the module
 * once it is in (null before, and on the server), so a part is drawn as it
 * arrives.
 */
function lazyPart<T>(importer: () => Promise<T>) {
  let loaded: T | null = null;
  let loading: Promise<T> | null = null;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const current = () => loaded;
  const load = (): Promise<T> =>
    (loading ??= importer().then(
      (m) => {
        loaded = m;
        listeners.forEach((listener) => listener());
        return m;
      },
      (err: unknown) => {
        loading = null;
        throw err;
      }
    ));
  return {
    load,
    prefetch: () => void load().catch(() => {}),
    current,
    useLoaded: () => useSyncExternalStore(subscribe, current, () => null),
  };
}

/**
 * The end of a reply (chat/reply-end: Copy reply, Try again, the follow-ups
 * and their rules), loaded as the first message goes out: nothing needs it
 * before a reply. Never in a turn's way: it is small and loads beside the
 * runtime, so it is nearly always in before the reply it ends, and a reply
 * that settles first gets it as it arrives. If it fails to load, a reply has
 * no end until the next message tries again.
 */
const replyEndPart = lazyPart(() => import("../chat/reply-end"));

/** Clear chat with Undo (./visitor-clear-chat), loaded with the first message: nothing to clear before one. */
const clearPart = lazyPart(() => import("./visitor-clear-chat"));

/** The read-only footer (./visitor-chat-footer), loaded with the first message: no chat runs out before one. */
const footerPart = lazyPart(() => import("./visitor-chat-footer"));

/**
 * The end of a visitor's reply, once it has loaded (nothing before); only it
 * draws again as it arrives. Stable, so the strip keeps it.
 */
function VisitorReplyEnd(props: ReplyEndProps) {
  const End = replyEndPart.useLoaded()?.ReplyEnd;
  return End ? <End {...props} /> : null;
}

/** A read-only chat's reply end: Copy reply, and no follow-ups, which would fill a box that isn't there. */
function VisitorReplyEndReadOnly(props: ReplyEndProps) {
  return <VisitorReplyEnd {...props} followUps={false} />;
}

/** The read-only footer, once its chunk is in (asked for again here, should the first load have failed). */
function VisitorReadOnly(props: ReadOnlyFooterProps) {
  const Footer = footerPart.useLoaded()?.ReadOnlyFooter;
  useEffect(() => footerPart.prefetch(), []);
  return Footer ? <Footer {...props} /> : null;
}

/** Clear chat's "Chat cleared · Undo" in the log, once its chunk is in. */
function VisitorCleared() {
  const Caption = clearPart.useLoaded()?.ClearedCaption;
  return Caption ? <Caption /> : null;
}

/**
 * Clear chat: with Undo once its chunk is in (it loads with the first
 * message, so nearly always is). One that can't load still clears, as Clear
 * chat always did, through the store, which stops the answer under way first.
 */
function clearChat(): void {
  const loaded = clearPart.current();
  if (loaded) return loaded.clearVisitorChat();
  clearPart.load().then(
    (m) => m.clearVisitorChat(),
    () => useAgentStore.getState().reset()
  );
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

interface VisitorAgentPanelProps {
  /** Sent as soon as the chat opens ("" opens it empty). */
  initialQuestion: string;
  /**
   * Back to the tool finder; from the read-only footer, with the question Amr
   * couldn't answer, for the guide's search.
   */
  onOfflineGuide: (unanswered?: string) => void;
  /**
   * The message box takes focus as the chat opens, even on a touch screen:
   * the visitor said yes on the consent card with no question waiting, so
   * typing is what they came to do. Only the box the chat opens with: one the
   * read-only footer gives back later takes none by itself.
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
  // In a visitor live room Amr gets no tools; a caption in the log says so.
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
    replyEndPart.prefetch();
    clearPart.prefetch();
    footerPart.prefetch();
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
  // The messages left now: Try again says it spends one, and at none the chat is read-only.
  const left = messagesLeft(quota, now);

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
    // So does one asked with no message left (the read-only footer says so):
    // it would only be refused.
    const pending = startingTurn;
    const state = useAgentStore.getState();
    if (state.streaming || pending || messagesLeft(state.visitorQuota) === 0) {
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

  // No message can go out: a refusal for now, or none left. Never mid-turn,
  // so Stop stays in reach while Amr answers the last one.
  const fallback = useAgentStore((s) => s.visitorFallback);
  // A refusal for the day (the visitor's or the site's) ends with its Cairo
  // day, as none left does (messagesLeft): on the minute tick past midnight
  // the box comes back, and the next message asks the route for the new day.
  const dayLimitOver =
    (fallback === "visitor_limit" || fallback === "site_limit") && dayOver(quota, now);
  const readOnly = !busy && ((fallback !== null && !dayLimitOver) || left === 0);
  useEffect(() => {
    if (!dayLimitOver) return;
    const s = useAgentStore.getState();
    const refusal = s.visitorFallback;
    s.setVisitorFallback(null);
    if (s.notice?.kind === refusal) s.setNotice(null);
  }, [dayLimitOver]);
  // The box showed in this chat: a footer that takes its place takes its focus.
  const [boxShown, setBoxShown] = useState(!readOnly);
  useEffect(() => {
    if (!readOnly) setBoxShown(true);
  }, [readOnly]);
  // The consent card's yes asks for the box the chat opens with, once. A box
  // the read-only footer gives back later (the busy hours over, Try again,
  // Clear chat) takes no focus by itself: the footer's buttons and the Undo
  // caption hand focus on, and on a phone no keyboard comes up on a timer.
  const openingBox = useRef(takeFocus);
  useEffect(() => {
    openingBox.current = false;
  }, []);

  // The composer's row: the frame keeps it shrink-0 (the form its direct
  // child) and makes room beside it for docked Amr. Read-only, the footer
  // that says why stands there instead.
  const footer = readOnly ? (
    <VisitorReadOnly
      code={fallback}
      quota={quota}
      now={now}
      left={left}
      canRetry={retry.canRetry}
      onTryAgain={tryAgain}
      onToolFinder={onOfflineGuide}
      takeFocus={boxShown}
    />
  ) : (
    <ChatComposer
      busy={busy}
      // A turn still loading its runtime has nothing to stop yet.
      canStop={streaming}
      onSend={(_text, raw) => void send(raw, true)}
      onStop={() => loadedRuntime?.abortInFlight()}
      maxLength={VISITOR_LIMITS.userChars}
      tool={tool?.name}
      takeFocus={openingBox.current}
      mic={VisitorDictate}
      // In the status row, never live; it waits while the panel is compact.
      // With only a few left it stands out (weight and ink), and is never announced.
      status={
        <span
          data-testid="visitor-ai-quota"
          className={lowOnMessages(left) ? "font-medium text-text" : undefined}
        >
          {allowanceLine(quota, now, inLiveRoom)}
        </span>
      }
    />
  );

  return (
    // The panel can be as short as 160 px (a landscape phone). The frame (the
    // log's direct parent) keeps the log's floor and the footer's height, so
    // in a short panel it scrolls and the composer and buttons stay in reach.
    // In a tall panel nothing overflows there: the log takes the rest and
    // scrolls inside itself. Compact (a phone's keyboard up) the log's floor
    // drops to 3rem.
    <ChatProvider profile="visitor">
      <PanelBack>
        <PanelIconButton label="Back to tool finder" onClick={() => onOfflineGuide()}>
          <ChevronLeft aria-hidden="true" />
        </PanelIconButton>
      </PanelBack>
      {/* Something to clear: a message, or a turn under way. */}
      <PanelActions>
        {(!empty || busy) && (
          <PanelIconButton label="Clear chat" data-visitor-clear="" onClick={clearChat}>
            <Eraser aria-hidden="true" />
          </PanelIconButton>
        )}
      </PanelActions>
      <ChatStrip
        busy={busy}
        footer={footer}
        className="px-3 py-2"
        replyEnd={readOnly ? VisitorReplyEndReadOnly : VisitorReplyEnd}
        // Under the reply it says what it spends; with none to spend, it isn't offered.
        retry={readOnly || left === 0 ? undefined : { ...retry, cost: retryCost(left) }}
      >
        <VisitorCleared />
        {/* Once, at the log's end, while the room is open: narration, not Amr's words. */}
        {inLiveRoom && <Narration data-testid="visitor-ai-live-room">{LIVE_ROOM_LINE}</Narration>}
        {empty && !busy && !readOnly && (
          <ChatEmpty line={VISITOR_EMPTY.line} short={VISITOR_EMPTY.short} starters={starters} />
        )}
        {awaiting && <ThinkingItemView />}
        {/* A refusal's own words are the read-only footer's to say; read-only, a
            notice offers nothing (no message can go out). */}
        {!(readOnly && fallback) && (
          <ChatNotice ready={!busy && !readOnly} {...retry} onGoOn={goOn} />
        )}
      </ChatStrip>
    </ChatProvider>
  );
}
