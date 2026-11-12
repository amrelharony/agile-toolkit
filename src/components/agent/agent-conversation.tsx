"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useAgentStore } from "@/lib/agent/store";
import { noticeAction } from "@/lib/agent/notice-actions";
import { toolIdForPath } from "@/lib/agent/page-tool";
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
  createConversation,
  deleteConversation,
  listConversations,
  loadMessages,
  renameConversation,
  conversationTitle,
} from "@/lib/agent/persist";
import { Button } from "@/components/ui/button";
import { Narration } from "./comic/comic-parts";
import { ConfirmAction } from "./confirm-action";
import { useChatVisible } from "./chat-visibility";
import { MessageBubble } from "./message-bubble";
import { useVoiceInput } from "@/lib/agent/mascot/use-voice-input";
import { handleMascotCommand } from "./mascot/engine/customization/commands";
import { Send, Mic, Square } from "lucide-react";
import type { ChatMessage, ConversationMeta } from "@/lib/agent/types";

/** Resume the most recent thread at most once per page load (not on every
 *  panel reopen — that would override an intentional "New chat"). */
let resumedThisLoad = false;

/** Conversations created this page-load that are awaiting a model-generated
 *  title (resumed threads are never re-titled). */
const freshConvos = new Set<string>();

/** Keep what the owner typed but hasn't sent (drafts.owner). */
const setDraft = (text: string) => useAgentStore.getState().setDraft("owner", text);

/**
 * Active conversation view: message list + composer + confirmation card.
 *
 * The conversation is created in Supabase on the first message and every
 * message is persisted (via the client orchestrator's conversationId path), so
 * the thread survives reload; the most recent thread auto-resumes on open. The
 * conversation list (switch / rename / delete) lives in ConversationList.
 *
 * Closing the panel unmounts this and stops nothing: the turn and what the
 * owner has typed but not sent (drafts.owner) live in the agent store. Notes
 * and errors show as a narration caption, with "Try again" or "Go on" when
 * the notice calls for one (lib/agent/notice-actions).
 */
export function AgentConversation() {
  const { user } = useAuth();
  const messages = useAgentStore((s) => s.messages);
  const streaming = useAgentStore((s) => s.streaming);
  const notice = useAgentStore((s) => s.notice);
  const input = useAgentStore((s) => s.drafts.owner);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  // A send waiting for its new conversation: a second one waits its turn.
  const sendingRef = useRef(false);
  const pathname = usePathname();
  // False while Amr's Scenes view covers the chat (mounted, hidden).
  const visible = useChatVisible();

  // Focus the composer when the panel opens (this component mounts on open), and
  // again when the chat comes back from under the Scenes view.
  useEffect(() => {
    if (visible) composerRef.current?.focus();
  }, [visible]);
  // Voice dictation fills the composer; the user reviews + sends.
  const voice = useVoiceInput((text) => setDraft(text));

  useEffect(() => {
    // A hidden log can't scroll: it catches up when it's in view again.
    if (!visible) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, streaming, visible]);

  // On the first open after a page load, resume the most recent conversation if
  // we're sitting on a blank draft. Guarded so it never clobbers an in-progress
  // thread or a deliberate New chat.
  useEffect(() => {
    if (resumedThisLoad) return;
    resumedThisLoad = true;
    const blank = () => {
      const s = useAgentStore.getState();
      return !s.activeConversationId && s.messages.length === 0;
    };
    if (!blank()) return;
    // No alive-guard abort here: React StrictMode (dev) mounts → unmounts →
    // mounts, so an abort-on-cleanup would kill the in-flight resume while the
    // flag blocks the retry. setActiveConversation targets a zustand store (not
    // local state), so completing after unmount is safe; the blank() re-checks
    // prevent clobbering a chat the user started while it loaded.
    void listConversations().then(async (list) => {
      if (list.length === 0 || !blank()) return;
      const msgs = await loadMessages(list[0].id);
      if (blank()) useAgentStore.getState().setActiveConversation(list[0], msgs);
    });
  }, []);

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
      }
    });
  }, [streaming]);

  const onSend = async () => {
    const raw = input;
    const text = raw.trim();
    if (!text || streaming || !user || sendingRef.current) return;
    setDraft("");
    // Mascot commands (/mascot-aura, /dance) run locally, not the agent.
    if (handleMascotCommand(text)) return;
    // The registry's id for this page's tool (a sub-page counts), or null.
    const toolId = toolIdForPath(pathname);
    // Ensure a persisted conversation exists so the thread survives reload.
    let convId = useAgentStore.getState().activeConversationId;
    if (!convId) {
      // The chat this conversation is made for, known by its last message
      // (none while it is empty).
      const holding = useAgentStore.getState().messages.at(-1)?.id;
      let meta: ConversationMeta | null = null;
      sendingRef.current = true;
      try {
        meta = await createConversation({ title: conversationTitle(text), toolId });
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
  // The notice's buttons go with it once the turn starts, so focus moves to
  // the message box first (read-only, never disabled, while Amr answers).
  const tryAgain = () => {
    const opts = turnOptions();
    if (!opts) return;
    composerRef.current?.focus();
    void retryLastTurn(opts);
  };
  const goOnNow = () => {
    const opts = turnOptions();
    if (!opts) return;
    composerRef.current?.focus();
    void goOn(opts);
  };

  // Show a "thinking" row while a turn is streaming but the assistant hasn't
  // produced visible content yet (just sent, between tool rounds, or pre-token).
  const last = messages[messages.length - 1];
  const awaiting = streaming && (!last || last.role !== "assistant" || last.content.length === 0);
  // Try again only when the last turn ran no change; nothing to press while Amr answers.
  const action = streaming || !user ? null : noticeAction(notice, "owner");
  const canRetry = action === "retry" && canRetryLastTurn(messages);

  return (
    <div className="flex flex-col h-full">
      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-label="Conversation"
        className="flex-1 overflow-y-auto px-1 py-2 space-y-3"
      >
        {messages.length === 0 && (
          <div className="text-sm text-sub py-12 text-center space-y-2">
            <p>Ask me to drive any tool: planning, retros, canvas, OKRs.</p>
            <p className="text-xs">Examples:</p>
            <ul className="text-xs space-y-1">
              <li>&quot;Create a sprint called Sprint 47 starting today for 2 weeks.&quot;</li>
              <li>&quot;Add a sticky to my active board saying &lsquo;flaky CI&rsquo;.&quot;</li>
              <li>&quot;Plan the next sprint at 30 points capacity.&quot;</li>
            </ul>
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {awaiting && (
          <div className="flex items-center gap-2 px-1 text-xs text-sub">
            <span className="inline-flex gap-1" aria-hidden="true">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent" />
            </span>
            Amr is thinking…
          </div>
        )}
        <ConfirmAction />
        {notice && (
          <Narration
            tone={notice.tone}
            data-notice-kind={notice.kind}
            actions={
              canRetry ? (
                <Button type="button" variant="outline" size="sm" onClick={tryAgain}>
                  Try again
                </Button>
              ) : action === "go_on" ? (
                <Button type="button" variant="outline" size="sm" onClick={goOnNow}>
                  Go on
                </Button>
              ) : null
            }
          >
            {notice.text}
          </Narration>
        )}
      </div>

      <div className="border-t border-border pt-3 mt-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onSend();
          }}
          className="flex gap-2 items-end"
        >
          <textarea
            ref={composerRef}
            value={input}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void onSend();
              }
            }}
            placeholder="Ask Amr…"
            rows={2}
            className="flex-1 resize-none rounded-md border border-border bg-[var(--card)] px-3 py-2 text-sm text-text placeholder:text-sub focus:outline-none focus:ring-1 focus:ring-accent"
            // Read-only while Amr answers, not disabled: a disabled box drops
            // its focus, and Try again and Go on hand focus to it.
            readOnly={streaming}
            aria-label="Message"
          />
          {voice.supported && (
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={streaming}
              onClick={() => (voice.listening ? voice.stop() : voice.start())}
              aria-label={voice.listening ? "Stop dictation" : "Dictate"}
              title={voice.listening ? "Stop" : "Speak"}
              className={voice.listening ? "animate-pulse border-accent text-accent" : ""}
            >
              <Mic className="w-4 h-4" aria-hidden="true" />
            </Button>
          )}
          {streaming ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => abortInFlight()}
              aria-label="Stop generating"
              title="Stop"
              className="border-destructive text-destructive hover:bg-destructive/10"
            >
              <Square className="w-4 h-4" aria-hidden="true" />
            </Button>
          ) : (
            <Button type="submit" disabled={!input.trim()} size="icon" aria-label="Send">
              <Send className="w-4 h-4" aria-hidden="true" />
            </Button>
          )}
        </form>
        {voice.error && <p className="mt-1.5 text-xs text-destructive">{voice.error}</p>}
        <p className="text-xs text-sub mt-1.5">
          {/* Key hints mean nothing on a touch screen; the safety note stays. */}
          <span className="pointer-coarse:hidden">Enter to send · Shift+Enter for newline · </span>
          Write actions ask for confirmation
        </p>
      </div>
    </div>
  );
}
