"use client";

/**
 * The chat's composer, one for both chats (the owner's agent-conversation, a
 * visitor's visitor-agent-panel; design 1.3 item 8): the message form, the
 * chat's status line (chat-status) and the lines under it, as the frame's
 * footer (chat-frame keeps it shrink-0, the form its first child).
 *
 *   box      editable while Amr answers, so the reader can draft the next
 *            message (or a correction while a card waits); only sending is
 *            blocked. The draft is the store's, per chat (drafts.owner,
 *            drafts.visitor), so it survives the panel closing. One row to
 *            start, growing with its text to min(6 lines, 35% of the visible
 *            box) (use-autosize), then scrolling. dir="auto" for Arabic.
 *            enterKeyHint "enter": on a touch screen the return key makes a
 *            new line and Send sends (lib/agent/composer-keys says what each
 *            press does, read with the pointer of the moment).
 *   button   one Send/Stop button, the same element both ways, so focus on
 *            it stays put as it swaps: "Send", or "Stop answer" while Amr
 *            answers. aria-disabled (never disabled, which would drop its
 *            focus) when it can't act: nothing typed, no one to send for, or
 *            nothing yet to stop (a visitor's turn still loading). It ignores
 *            a held key's repeats, and any press within SWAP_GUARD_MS of a
 *            swap, so a double press meant for Send never stops the answer it
 *            started, and one meant for Stop never sends the draft.
 *   mic      when the chat hands one in (`mic`): chat/dictate-button's
 *            DictateButton, the owner's as it is and a visitor's asking
 *            first (visitor-agent-panel's VisitorDictate). Below 360 px wide
 *            it moves to the box's leading side. What it shows under the
 *            row (a visitor's voice notice, through `show`) sits between the
 *            row and the status line.
 *   status   the status row: a note span, its only live part, polite ("Amr
 *            dances" after a chat command, "Listening…", "Cut to 2,000
 *            characters" after a long paste, a dictation error, "Reply
 *            copied" said from the log through the chat context's note),
 *            each note a new node, so the same words twice are said twice;
 *            then, never
 *            live, the characters left (a chat with a limit, once within
 *            COUNTER_FROM of it), "On {tool}" (the page's tool, whose context
 *            Amr gets) and the chat's own `status` (a visitor's allowance).
 *            The box's aria-describedby names the counter, and the app's
 *            announcer says it at ANNOUNCE_LEFT left and at none left only.
 *            Compact (a phone's keyboard up), the note and the counter stay;
 *            the rest waits.
 *   hint     the keys, on a fine pointer only (KEY_HINT), and the chat's own
 *            `footnote` after them.
 *
 * Sending. A chat command (/dance, dance, /play, /mascot-aura) runs here and
 * leaves its note, so it never reaches the AI. Anything else empties the box and
 * goes to `onSend` with the trimmed text and the box's text as it was (to put
 * back if the message can't go out). After a tap on Send on a touch screen
 * the box lets go of focus, so the keyboard goes down and the reply gets the
 * panel; from a key press, focus stays where it was; and with a mouse the box
 * keeps it, caret and all, since the button's mousedown is cancelled while
 * the box has focus (for Stop too), so typing goes on in the box.
 *
 * Focus. The box is the chat's first target when the panel opens, and again
 * when the chat comes back from under Amr's Scenes view (chat-visibility), on
 * a fine pointer only (panel-context useInitialFocus): a tap that opens the
 * panel never raises the keyboard. Where the tap itself means "type now" it takes
 * focus even on a touch screen: after New chat (focusComposerAfterNewChat)
 * and when the chat opens straight from the consent card's Yes with no
 * question waiting (`takeFocus`). The box carries the chat context's
 * composerId, which the context's focusComposer finds it by.
 *
 * Nothing here reads the messages, so a streamed chunk never draws it
 * (test/agent/chat-stream-renders.test.tsx).
 *
 * Runtime parts (the agent store), so this lives in chat/, which every-page
 * code may not reach (test/agent/bundle-boundary.test.ts).
 */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type ComponentType,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Send, Square } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { Button } from "@/components/ui/button";
import { composerKey } from "@/lib/agent/composer-keys";
import { useAgentStore } from "@/lib/agent/store";
import { cn } from "@/lib/utils";
import { useChatVisible } from "../chat-visibility";
import { handleMascotCommand } from "../mascot/engine/customization/chat-commands";
import { COMPACT_HIDDEN, useInitialFocus } from "../mascot/panel-context";
import { focusAtEnd, onTouchScreen, useChat } from "./chat-context";
import { ChatStatus } from "./chat-status";
import { useAutosize } from "./use-autosize";

/** The button's name while nothing is under way. */
export const SEND_LABEL = "Send";
/** Its name while Amr answers. */
export const STOP_LABEL = "Stop answer";
/** The keys, said on a fine pointer only (a touch screen's return key makes a new line). */
export const KEY_HINT = "Enter to send · Shift+Enter for a new line";
/** A press this soon after Send turned into Stop, or back, is taken for a double press and ignored. */
export const SWAP_GUARD_MS = 400;
/** The characters left show once this few are left. */
export const COUNTER_FROM = 200;
/** The announcer says the characters left once at this many, and once at none. */
export const ANNOUNCE_LEFT = 100;

const count = (n: number) => n.toLocaleString("en-US");

/** The counter's words. */
export const charactersLeft = (left: number) =>
  left <= 0 ? "No characters left" : `${count(left)} character${left === 1 ? "" : "s"} left`;

/** The note after text was cut to the box's limit. */
export const cutTo = (max: number) => `Cut to ${count(max)} characters`;

/** Between the status row's parts. */
const DOT = " · ";

/** What the chat's mic is given (chat/dictate-button). */
export interface ComposerMicProps {
  /** The box's text now: dictation adds after it. */
  draft(): string;
  /** Put this text in the box: cut to the box's limit, with a note when it is. */
  put(text: string): void;
  /** Show a note in the status row; null takes away one the mic showed. */
  onNote(note: string | null): void;
  /** Show this under the box's row (a visitor's voice notice); null takes it away. */
  show(node: ReactNode): void;
}

export interface ChatComposerProps {
  /** A turn is under way, or starting: the button is Stop, and nothing sends. */
  busy: boolean;
  /** The answer under way can be stopped now (a visitor's turn still loading can't). */
  canStop?: boolean;
  /** A message can go out at all (the owner is signed in). */
  ready?: boolean;
  /** Sends `text` (trimmed, not empty); `raw` is the box's text as it was, to put back. */
  onSend(text: string, raw: string): void;
  /** Stops the answer under way. */
  onStop(): void;
  /** The most characters a message may have; the counter and the cut note follow it. */
  maxLength?: number;
  /** The page's tool by name, whose context Amr gets ("On Retro Board"). */
  tool?: string | null;
  /** The chat's own part of the status row, never live (a visitor's allowance). */
  status?: ReactNode;
  /** The chat's own words after the key hint (the owner's safety note). */
  footnote?: ReactNode;
  /** The chat's mic (chat/dictate-button), when it has one. */
  mic?: ComponentType<ComposerMicProps>;
  /** Take focus as the chat opens, even on a touch screen: the reader asked to type. */
  takeFocus?: boolean;
  /** What the chat shows under the composer's lines (notes, its own buttons). */
  children?: ReactNode;
}

/** New chat's request for the box, if it came while no box was there to take it. */
let focusAskedAt = 0;
/** How long a request waits for a box to mount (New chat from History mounts one at once). */
const FOCUS_ASK_MS = 1000;
/** Focus the box that is showing now, if one is. */
let focusShownBox: (() => boolean) | null = null;

/**
 * New chat: the box takes focus, caret at the end, even on a touch screen,
 * where a tap on New chat means "type now". The box showing takes it at once;
 * from History, the box that mounts as the chat comes back takes it.
 */
export function focusComposerAfterNewChat(): void {
  if (focusShownBox?.()) return;
  focusAskedAt = Date.now();
}

/**
 * A note in the status row, whether the mic showed it (only then may the mic
 * take it away), and its number: the same words again (a second Copy reply,
 * dance twice) are a new node, which the live span says again.
 */
interface Note {
  text: string;
  mic: boolean;
  seq: number;
}

let noteSeq = 0;
/** A new note: numbered outside any state updater, so a double call stays pure. */
const noteOf = (text: string, mic = false): Note => ({ text, mic, seq: ++noteSeq });

/** The chat's composer: see the file comment. */
export function ChatComposer({
  busy,
  canStop = busy,
  ready = true,
  onSend,
  onStop,
  maxLength,
  tool,
  status,
  footnote,
  mic: Mic,
  takeFocus = false,
  children,
}: ChatComposerProps) {
  const { profile, composerId, takeNotes } = useChat();
  const draft = useAgentStore((s) => s.drafts[profile]);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const counterId = useId();
  const announce = useAnnounce();
  const [note, setNote] = useState<Note | null>(null);
  // False while Amr's Scenes view covers the chat (mounted, hidden).
  const visible = useChatVisible();
  // A control in the log says what it did here (Copy reply), while this shows.
  useEffect(() => takeNotes((text) => setNote(noteOf(text))), [takeNotes]);
  // What the mic shows under the row (a visitor's voice notice).
  const [micShows, setMicShows] = useState<ReactNode>(null);

  useAutosize(boxRef, draft);
  useInitialFocus(boxRef, visible);

  const setDraft = useCallback(
    (text: string) => useAgentStore.getState().setDraft(profile, text),
    [profile]
  );

  // The box asked for as the chat opens (takeFocus), or by New chat; and New
  // chat's way to the box while it shows. Before paint, so no frame shows
  // focus anywhere else.
  const takeOnMount = useRef(takeFocus);
  useLayoutEffect(() => {
    const take = () => focusAtEnd(boxRef.current);
    const asked = Date.now() - focusAskedAt < FOCUS_ASK_MS;
    focusAskedAt = 0;
    if (takeOnMount.current || asked) take();
    focusShownBox = take;
    return () => {
      if (focusShownBox === take) focusShownBox = null;
    };
  }, []);

  // When the button last swapped between Send and Stop (never on mount).
  const swappedAt = useRef(0);
  const wasBusy = useRef(busy);
  useLayoutEffect(() => {
    if (wasBusy.current === busy) return;
    wasBusy.current = busy;
    swappedAt.current = Date.now();
  }, [busy]);

  // The characters left, said at ANNOUNCE_LEFT and at none, as they are reached.
  const left = maxLength === undefined ? null : maxLength - draft.length;
  const leftBefore = useRef(left);
  useEffect(() => {
    const was = leftBefore.current;
    leftBefore.current = left;
    if (left === null || was === null) return;
    if (left <= 0 && was > 0) announce(charactersLeft(0));
    else if (left <= ANNOUNCE_LEFT && was > ANNOUNCE_LEFT) announce(charactersLeft(left));
  }, [left, announce]);

  const send = (fromTap: boolean) => {
    if (busy || !ready) return;
    const raw = useAgentStore.getState().drafts[profile];
    const text = raw.trim();
    if (!text) return;
    setDraft("");
    const command = handleMascotCommand(text);
    setNote(command && noteOf(command.note));
    if (!command) onSend(text, raw);
    // A tap on Send: the keyboard goes down, so the reply gets the panel.
    const box = boxRef.current;
    if (
      fromTap &&
      box &&
      box.ownerDocument.activeElement === box &&
      onTouchScreen(box.ownerDocument)
    )
      box.blur();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const action = composerKey(
      {
        key: e.key,
        isComposing: e.nativeEvent.isComposing,
        keyCode: e.keyCode,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        repeat: e.repeat,
      },
      onTouchScreen(e.currentTarget.ownerDocument) ? "coarse" : "fine"
    );
    // A held sending key's repeats are cancelled too: no second send, no blank lines.
    if (action !== "send" && action !== "ignore") return;
    e.preventDefault();
    if (action === "send") send(false);
  };

  // A paste longer than the room left is cut by the box itself: say so.
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (maxLength === undefined) return;
    const box = e.currentTarget;
    const room = maxLength - box.value.length + (box.selectionEnd - box.selectionStart);
    if (e.clipboardData.getData("text").length > room) setNote(noteOf(cutTo(maxLength)));
  };

  const canAct = busy ? canStop : ready && draft.trim() !== "";
  const press = (e: MouseEvent<HTMLButtonElement>) => {
    if (Date.now() - swappedAt.current < SWAP_GUARD_MS) return;
    if (!busy) send(e.detail > 0);
    else if (canStop) onStop();
  };

  // For the mic: stable, so its effects don't run again on every render.
  const micDraft = useCallback(() => useAgentStore.getState().drafts[profile], [profile]);
  const micPut = useCallback(
    (text: string) => {
      const cut = maxLength !== undefined && text.length > maxLength;
      setDraft(cut ? text.slice(0, maxLength) : text);
      if (cut) setNote(noteOf(cutTo(maxLength)));
    },
    [maxLength, setDraft]
  );
  const micNote = useCallback((text: string | null) => {
    const next = text ? noteOf(text, true) : null;
    setNote((shown) => next ?? (shown?.mic ? null : shown));
  }, []);

  const counter = left !== null && left <= COUNTER_FROM;
  const quiet = [tool ? `On ${tool}` : null, status].filter(Boolean);

  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(false);
        }}
        className="flex items-end gap-2"
      >
        <textarea
          ref={boxRef}
          id={composerId}
          data-amr-composer=""
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          maxLength={maxLength}
          rows={1}
          dir="auto"
          enterKeyHint="enter"
          placeholder="Ask Amr…"
          aria-label="Message"
          aria-describedby={counter ? counterId : undefined}
          className="min-w-0 flex-1 resize-none rounded-md border border-input bg-card px-3 py-2 text-base text-text placeholder:text-sub focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring pointer-fine:md:text-sm"
        />
        {Mic && (
          <span className="flex shrink-0 empty:hidden max-[359px]:order-first">
            <Mic draft={micDraft} put={micPut} onNote={micNote} show={setMicShows} />
          </span>
        )}
        <Button
          type="button"
          size="icon"
          variant={busy ? "outline" : "default"}
          aria-label={busy ? STOP_LABEL : SEND_LABEL}
          title={busy ? STOP_LABEL : SEND_LABEL}
          aria-disabled={canAct ? undefined : true}
          data-chat-send=""
          onKeyDown={(e) => {
            // A held Enter or Space presses once: its repeats click nothing.
            if (e.repeat && (e.key === "Enter" || e.key === " ")) e.preventDefault();
          }}
          onMouseDown={(e) => {
            // With a mouse, Chromium and Firefox move focus to a button on
            // mousedown: keep it in the box, caret and all (design 1.3 item 8).
            const box = boxRef.current;
            if (
              !e.button &&
              box &&
              box.ownerDocument.activeElement === box &&
              !onTouchScreen(box.ownerDocument)
            )
              e.preventDefault();
          }}
          onClick={press}
          className={cn(
            "shrink-0 aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
            busy &&
              "border-destructive text-destructive hover:border-destructive hover:bg-destructive/10 hover:text-destructive"
          )}
        >
          {busy ? <Square aria-hidden="true" /> : <Send aria-hidden="true" />}
        </Button>
      </form>
      {micShows}
      <ChatStatus busy={busy} />
      <p
        data-composer-status=""
        className={cn("text-xs text-sub", note || counter || quiet.length ? "mt-1.5" : "mt-0")}
      >
        <span aria-live="polite" data-composer-note="">
          {note && <span key={note.seq}>{note.text}</span>}
        </span>
        {counter && (
          <>
            {note && DOT}
            <span id={counterId} data-composer-left="">
              {charactersLeft(left)}
            </span>
          </>
        )}
        {quiet.length > 0 && (
          <span className={COMPACT_HIDDEN}>
            {(note || counter) && DOT}
            {quiet.map((part, i) => (
              <span key={i}>
                {i > 0 && DOT}
                {part}
              </span>
            ))}
          </span>
        )}
      </p>
      <p className={cn("mt-1 text-xs text-sub", COMPACT_HIDDEN)} data-composer-hint="">
        <span className="pointer-coarse:hidden">
          {KEY_HINT}
          {footnote && DOT}
        </span>
        {footnote}
      </p>
      {children}
    </>
  );
}
