"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { useAgentStore } from "@/lib/agent/store";
import { OWNER_EMPTY, ownerStarters } from "@/lib/agent/owner-starters";
import { resolvePageTool, toolIdForPath } from "@/lib/agent/page-tool";
import { useAuth } from "@/lib/auth/auth-provider";
import {
  sendUserMessage,
  abortInFlight,
  canRetryLastTurn,
  generateTitle,
  goOn,
  retryLastTurn,
  type StreamOptions,
} from "@/lib/agent/client";
import {
  appendMessages,
  createConversation,
  deleteConversation,
  listConversations,
  loadMessages,
  renameConversation,
  conversationTitle,
} from "@/lib/agent/persist";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { Narration } from "./comic/comic-parts";
import { ChatComposer } from "./chat/chat-composer";
import { ChatProvider } from "./chat/chat-context";
import { ChatEmpty } from "./chat/chat-empty";
import { ThinkingItemView } from "./chat/chat-items";
import { ChatNotice } from "./chat/chat-notice";
import { ChatStrip, useAwaitingReply } from "./chat/chat-strip";
import { DictateButton } from "./chat/dictate-button";
import { PickUpChip } from "./chat/pick-up-chip";
import { ReplyEnd } from "./chat/reply-end";
import { StepDetails } from "./chat/step-details";
import type { ChatMessage, ConversationMeta } from "@/lib/agent/types";

/** A thread whose last message is this recent is picked up as the chat opens. */
export const RESUME_WITHIN_MS = 2 * 60 * 60 * 1000;

/**
 * The thread's last message is under RESUME_WITHIN_MS old at `now`, so the
 * chat may pick it up on its own. An older one (or one with no time to go
 * by) is offered instead (chat/pick-up-chip): its topic, and its whole
 * history, would ride along into a new question.
 */
export function resumable(meta: ConversationMeta, now: number = Date.now()): boolean {
  const at = Date.parse(meta.lastMessageAt || meta.updatedAt);
  return Number.isFinite(at) && now - at < RESUME_WITHIN_MS;
}

/**
 * The look for a thread to resume: once per page load (not on every panel
 * reopen, which would override an intentional "New chat"). `check` is "idle"
 * until the first open starts it, "checking" while it runs, "done" once it
 * has settled, whatever it found. The empty chat waits for "done", so its
 * starters never flash up before a thread loads over them. `pickUp` is the
 * latest thread when it was too old to resume: the empty chat offers it
 * until it is opened or the chat starts on something else.
 */
let resume: { check: "idle" | "checking" | "done"; pickUp: ConversationMeta | null } = {
  check: "idle",
  pickUp: null,
};
const resumeListeners = new Set<() => void>();

function setResume(next: Partial<typeof resume>) {
  resume = { ...resume, ...next };
  resumeListeners.forEach((listener) => listener());
}

function subscribeResume(listener: () => void): () => void {
  resumeListeners.add(listener);
  return () => {
    resumeListeners.delete(listener);
  };
}

const resumeSettled = () => resume.check === "done";
const offeredThread = () => resume.pickUp;
const stopOffering = () => setResume({ pickUp: null });

/** Conversations created this page-load that are awaiting a model-generated
 *  title (resumed threads are never re-titled). */
const freshConvos = new Set<string>();

/** Keep what the owner typed but hasn't sent (drafts.owner). */
const setDraft = (text: string) => useAgentStore.getState().setDraft("owner", text);

/** The caption's name while the chat has no saved conversation. */
export const NOT_SAVED_LABEL = "Not saved yet.";
/** Its words: why, what it means, and what happens next. */
export const NOT_SAVED =
  "Amr couldn't reach your chat history, so this chat isn't kept after a reload. Your next message tries again.";

/** A message's words, joined. */
const wordsOf = (m: ChatMessage | undefined) =>
  (m?.content ?? [])
    .map((c) => (c.type === "text" ? c.text : ""))
    .join(" ")
    .trim();

/**
 * A message that may be saved: any but an assistant's with nothing the wire
 * would take (no words and no complete call), which the client never saves
 * either (client.ts isWireValidAssistant), so a reload never replays one.
 */
const savable = (m: ChatMessage) =>
  m.role !== "assistant" ||
  m.content.some(
    (c) =>
      (c.type === "text" && c.text.length > 0) ||
      (c.type === "tool_use" &&
        !(c.input && "_partial" in c.input && Object.keys(c.input).length === 1))
  );

/**
 * Active conversation view: the comic strip (chat/chat-strip: Amr's balloons,
 * the owner's captions, one caption per run of tool steps, with Details (the
 * raw arguments and result), which only this chat hands the strip, and the
 * confirmation card under the step it asks about, with Approve all) and the
 * composer both chats share (chat/chat-composer), with the owner's mic
 * (chat/dictate-button), which only this chat hands it.
 *
 * The conversation is created in Supabase on the first message and every
 * message is persisted (via the client orchestrator's conversationId path), so
 * the thread survives reload. On the first open after a page load the most
 * recent thread is picked up when its last message is under two hours old
 * (RESUME_WITHIN_MS), and the strip marks where (a scene caption); an older
 * one is offered in the empty chat instead, as 'Pick up “{title}”'
 * (chat/pick-up-chip), which opens it. The conversation list (switch /
 * rename / delete) lives in ConversationList.
 * When the conversation can't be made, the chat goes on unsaved and says so
 * in a narration caption ("Not saved yet.", once by the announcer too); the
 * next message tries again, and once a conversation is made, what was said
 * before it is saved into it first (appendMessages), so the thread is whole.
 *
 * An empty chat shows a narration line about Amr, in the third person, and up
 * to three starters for the page the owner is on (chat/chat-empty, words in
 * lib/agent/owner-starters), once the resume check has settled; a starter
 * fills the message box and never sends.
 *
 * Closing the panel unmounts this and stops nothing: the turn and what the
 * owner has typed but not sent (drafts.owner) live in the agent store. Notes
 * and errors show as a narration caption under the strip (chat/chat-notice),
 * with "Try again" or "Go on" when the notice calls for one; the chat's
 * status line (chat/chat-status) says what Amr is doing while he answers.
 * Under the latest reply, once its turn is done, its end (chat/reply-end):
 * Copy reply, the same Try again (while the turn ran no change) and up to
 * two follow-ups. This chat imports it; a visitor's loads it later.
 *
 * Nothing here reads the messages themselves, only plain values a streamed
 * chunk leaves as they were, so a chunk re-renders the strip alone
 * (chat-strip), never this view or its composer.
 */
export function AgentConversation() {
  const { user } = useAuth();
  const streaming = useAgentStore((s) => s.streaming);
  const empty = useAgentStore((s) => s.messages.length === 0);
  // Messages with no conversation to keep them: the chat isn't saved.
  const unsaved = useAgentStore((s) => s.activeConversationId === null && s.messages.length > 0);
  const announce = useAnnounce();
  // The thinking balloon, until the reply's first words or steps arrive.
  const awaiting = useAwaitingReply(streaming);
  // A send waiting for its new conversation: a second one waits its turn.
  const sendingRef = useRef(false);
  const pathname = usePathname();
  // The empty chat waits for the resume check; its starters follow the page.
  const settled = useSyncExternalStore(subscribeResume, resumeSettled, () => false);
  // An older thread, offered while the chat is fresh (no thread, nothing said).
  const offered = useSyncExternalStore(subscribeResume, offeredThread, () => null);
  const fresh = useAgentStore((s) => s.activeConversationId === null && s.messages.length === 0);
  const tool = useMemo(() => resolvePageTool(toolIdForPath(pathname)), [pathname]);
  const starters = useMemo(() => ownerStarters(tool), [tool]);

  // On the first open after a page load, resume the most recent conversation if
  // we're sitting on a blank draft and it is recent; an older one is offered.
  // Guarded so it never clobbers an in-progress thread or a deliberate New chat.
  useEffect(() => {
    if (resume.check !== "idle") return;
    const blank = () => {
      const s = useAgentStore.getState();
      return !s.activeConversationId && s.messages.length === 0;
    };
    if (!blank()) {
      setResume({ check: "done" });
      return;
    }
    setResume({ check: "checking" });
    // No alive-guard abort here: React StrictMode (dev) mounts → unmounts →
    // mounts, so an abort-on-cleanup would kill the in-flight resume while the
    // flag blocks the retry. setActiveConversation targets a zustand store (not
    // local state), so completing after unmount is safe; the blank() re-checks
    // prevent clobbering a chat the user started while it loaded.
    void listConversations()
      .then(async ({ data: list }) => {
        const latest = list[0];
        if (!latest || !blank()) return;
        // Too old to pick up on its own: the empty chat offers it.
        if (!resumable(latest)) {
          setResume({ pickUp: latest });
          return;
        }
        // A thread that couldn't be read stays shut, never opened empty.
        const msgs = await loadMessages(latest.id);
        if (msgs.ok && blank()) useAgentStore.getState().setActiveConversation(latest, msgs.data);
      })
      // Settled either way: a failed look leaves the chat empty, its starters shown.
      .finally(() => setResume({ check: "done" }));
  }, []);

  // The chat started on something else (a message, a thread from History):
  // the older thread is no longer offered, not even after a New chat.
  useEffect(() => {
    if (!fresh && resume.pickUp) stopOffering();
  }, [fresh]);

  // Said once as the chat becomes unsaved (not again as the panel reopens on it).
  const wasUnsaved = useRef(unsaved);
  useEffect(() => {
    if (unsaved && !wasUnsaved.current) announce(`${NOT_SAVED_LABEL} ${NOT_SAVED}`);
    wasUnsaved.current = unsaved;
  }, [unsaved, announce]);

  // After a freshly-created conversation's first turn settles, upgrade its
  // first-message title to a concise model-generated one (best-effort, unmetered;
  // resumed threads are never in freshConvos so they're left alone).
  useEffect(() => {
    if (streaming) return;
    const s = useAgentStore.getState();
    const cid = s.activeConversationId;
    if (!cid || !freshConvos.has(cid)) return;
    if (!s.messages.some((m) => m.role === "assistant")) return;
    freshConvos.delete(cid);
    const textOf = (role: ChatMessage["role"]) =>
      (s.messages.find((m) => m.role === role)?.content ?? [])
        .map((c) => (c.type === "text" ? c.text : ""))
        .join(" ")
        .trim();
    const userText = textOf("user");
    if (!userText) return;
    void generateTitle(userText, textOf("assistant")).then((title) => {
      if (title && useAgentStore.getState().activeConversationId === cid) {
        void renameConversation(cid, title);
        // The panel header names the open thread: the new title, as saved.
        useAgentStore.getState().retitleConversation(cid, conversationTitle(title));
      }
    });
  }, [streaming]);

  // The composer has emptied the box, and ran a chat command (/dance) itself.
  const onSend = async (text: string, raw: string) => {
    if (!user) return;
    if (sendingRef.current) {
      // The last message is still making its thread: this one stays in the box.
      if (!useAgentStore.getState().drafts.owner) setDraft(raw);
      return;
    }
    // The registry's id for this page's tool (a sub-page counts), or null.
    const toolId = toolIdForPath(pathname);
    // Ensure a persisted conversation exists so the thread survives reload.
    let convId = useAgentStore.getState().activeConversationId;
    if (!convId) {
      // The chat this conversation is made for, known by its last message
      // (none while it is empty), and what was said in it before: nothing in
      // a fresh chat, all of it in one that couldn't be saved yet.
      const before = useAgentStore.getState().messages;
      const holding = before.at(-1)?.id;
      let meta: ConversationMeta | null = null;
      sendingRef.current = true;
      try {
        // Named for the chat's first question, which may be an earlier one.
        const first = wordsOf(before.find((m) => m.role === "user")) || text;
        meta = await createConversation({ title: conversationTitle(first), toolId });
      } finally {
        sendingRef.current = false;
      }
      const store = useAgentStore.getState();
      // Attached, never swapped in: the chat keeps its messages, and nothing
      // of a turn is stopped (setActiveConversation would count a switch).
      const sameChat = meta
        ? store.attachConversation(meta, holding)
        : store.activeConversationId === null &&
          (holding === undefined || store.messages.some((m) => m.id === holding));
      if (!sameChat) {
        // New chat, or another thread opened, while it was being made: the
        // question isn't for the chat now showing. It goes back in the box,
        // unless something new is there, and the empty thread goes.
        if (meta) void deleteConversation(meta.id);
        if (!store.drafts.owner) setDraft(raw);
        return;
      }
      if (meta) {
        convId = meta.id;
        freshConvos.add(meta.id); // upgrade to a model-generated title after turn 1
        // Back-fill: what the chat said while it couldn't be saved, up to the
        // message it was made for, is saved into it too. Each message keeps
        // its own time, so a reload shows them in order, this one last.
        const upTo = holding === undefined ? -1 : store.messages.findIndex((m) => m.id === holding);
        const earlier = store.messages.slice(0, upTo + 1).filter(savable);
        if (earlier.length > 0) void appendMessages(meta.id, earlier);
      }
    }
    void sendUserMessage(text, { userId: user.id, toolId, conversationId: convId ?? undefined });
  };

  /** What Try again and Go on run with: this page's tool and the open thread. */
  const turnOptions = (): StreamOptions | null =>
    user
      ? {
          userId: user.id,
          toolId: toolIdForPath(pathname),
          conversationId: useAgentStore.getState().activeConversationId ?? undefined,
        }
      : null;
  // The notice hands focus to the message box before these run (read-only,
  // never disabled, while Amr answers).
  const tryAgain = () => {
    const opts = turnOptions();
    if (opts) void retryLastTurn(opts);
  };
  const goOnNow = () => {
    const opts = turnOptions();
    if (opts) void goOn(opts);
  };
  // One Try again, for the notice's button and the one under the latest reply.
  const retry = { canRetry: canRetryLastTurn, onTryAgain: tryAgain };

  // The composer's row: the frame keeps it shrink-0 (the form its direct
  // child) and makes room beside it for docked Amr. The composer is where the
  // panel's focus owner puts focus when it opens (this mounts on open), and
  // again when the chat comes back from under the Scenes view, on a fine
  // pointer only: a tap on a phone doesn't raise the keyboard.
  const footer = (
    <ChatComposer
      busy={streaming}
      ready={!!user}
      onSend={(text, raw) => void onSend(text, raw)}
      onStop={abortInFlight}
      tool={tool?.name}
      mic={DictateButton}
      // True: every delete, remove, reset, clear or archive asks
      // (lib/agent/execute-tool isDestructiveAction), even after Approve all.
      footnote="Amr asks before deleting or resetting anything"
    />
  );

  return (
    // The frame is the log's direct parent: min-h-0, so in a short panel (a
    // phone's keyboard up) it shrinks to the room it has and scrolls, the
    // footer staying in reach. Its padding is inside that scroller, which
    // clips at its padding box: the composer's and Send's focus rings (High
    // contrast's reach 5 px out) stay clear of its edges.
    <ChatProvider profile="owner" stepDetails={StepDetails}>
      <ChatStrip
        busy={streaming}
        footer={footer}
        className="px-3 py-2"
        replyEnd={ReplyEnd}
        retry={user ? retry : undefined}
      >
        {empty && (
          <ChatEmpty
            line={OWNER_EMPTY.line}
            short={OWNER_EMPTY.short}
            starters={starters}
            held={!settled}
          />
        )}
        {fresh && settled && offered && <PickUpChip thread={offered} onDone={stopOffering} />}
        {awaiting && <ThinkingItemView />}
        {unsaved && (
          <Narration label={NOT_SAVED_LABEL} data-chat-unsaved="">
            {NOT_SAVED}
          </Narration>
        )}
        <ChatNotice ready={!streaming && !!user} {...retry} onGoOn={goOnNow} />
      </ChatStrip>
    </ChatProvider>
  );
}
