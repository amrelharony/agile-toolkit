"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useAgentStore } from "@/lib/agent/store";
import { useAuth } from "@/lib/auth/auth-provider";
import { sendUserMessage, abortInFlight, generateTitle } from "@/lib/agent/client";
import {
  createConversation,
  listConversations,
  loadMessages,
  renameConversation,
  conversationTitle,
} from "@/lib/agent/persist";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "./confirm-action";
import { Markdown } from "./markdown";
import { useVoiceInput } from "@/lib/agent/mascot/use-voice-input";
import { handleMascotCommand } from "./mascot/engine/customization/commands";
import { Send, Wrench, AlertTriangle, Mic, Square } from "lucide-react";
import type { ChatMessage } from "@/lib/agent/types";

/** Resume the most recent thread at most once per page load (not on every
 *  panel reopen — that would override an intentional "New chat"). */
let resumedThisLoad = false;

/** Conversations created this page-load that are awaiting a model-generated
 *  title (resumed threads are never re-titled). */
const freshConvos = new Set<string>();

/**
 * Active conversation view: message list + composer + confirmation card.
 *
 * The conversation is created in Supabase on the first message and every
 * message is persisted (via the client orchestrator's conversationId path), so
 * the thread survives reload; the most recent thread auto-resumes on open. The
 * conversation list (switch / rename / delete) lives in ConversationList.
 */
export function AgentConversation() {
  const { user } = useAuth();
  const messages = useAgentStore((s) => s.messages);
  const streaming = useAgentStore((s) => s.streaming);
  const error = useAgentStore((s) => s.error);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  // Voice dictation fills the composer; the user reviews + sends.
  const voice = useVoiceInput((text) => setInput(text));

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, streaming]);

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
    const text = input.trim();
    if (!text || streaming || !user) return;
    // Mascot commands (/mascot-hat, /mascot-aura, /dance) run locally, not the agent.
    if (handleMascotCommand(text)) {
      setInput("");
      return;
    }
    setInput("");
    const toolId = inferToolId(pathname);
    // Ensure a persisted conversation exists so the thread survives reload.
    let convId = useAgentStore.getState().activeConversationId;
    if (!convId) {
      const meta = await createConversation({ title: conversationTitle(text), toolId });
      if (meta) {
        useAgentStore.getState().setActiveConversation(meta, useAgentStore.getState().messages);
        convId = meta.id;
        freshConvos.add(meta.id); // upgrade to a model-generated title after turn 1
      }
    }
    void sendUserMessage(text, { userId: user.id, toolId, conversationId: convId ?? undefined });
  };

  // Show a "thinking" row while a turn is streaming but the assistant hasn't
  // produced visible content yet (just sent, between tool rounds, or pre-token).
  const last = messages[messages.length - 1];
  const awaiting = streaming && (!last || last.role !== "assistant" || last.content.length === 0);

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-1 py-2 space-y-3">
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
          <div className="flex items-center gap-2 px-1 text-xs text-sub" aria-live="polite">
            <span className="inline-flex gap-1" aria-hidden="true">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent" />
            </span>
            ElharonyClaw is thinking…
          </div>
        )}
        <ConfirmAction />
        {error && (
          <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 rounded-md px-3 py-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
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
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void onSend();
              }
            }}
            placeholder="Ask the agent…"
            rows={2}
            className="flex-1 resize-none rounded-md border border-border bg-[var(--card)] px-3 py-2 text-sm text-text placeholder:text-sub focus:outline-none focus:ring-1 focus:ring-accent"
            disabled={streaming}
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
        <p className="text-[10px] text-sub mt-1.5">
          Enter to send · Shift+Enter for newline · Write actions ask for confirmation
        </p>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "tool") {
    return (
      <div className="text-xs text-sub bg-card/50 rounded-md p-2 border border-border/60">
        {message.content.map((c, i) =>
          c.type === "tool_result" ? (
            <div key={i} className="flex gap-2 items-start">
              <Wrench
                className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${c.is_error ? "text-destructive" : "text-accent"}`}
                aria-hidden="true"
              />
              <span className="font-mono break-all">
                {typeof c.content === "string"
                  ? c.content.slice(0, 400)
                  : JSON.stringify(c.content).slice(0, 400)}
              </span>
            </div>
          ) : null
        )}
      </div>
    );
  }

  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
          isUser ? "bg-accent/20 text-text" : "bg-card border border-border text-text"
        }`}
      >
        {message.content.map((c, i) => {
          if (c.type === "text") {
            // Agent replies are markdown; user messages are shown verbatim.
            return isUser ? (
              <p key={i} className="whitespace-pre-wrap break-words">
                {c.text}
              </p>
            ) : (
              <Markdown key={i} source={c.text} />
            );
          }
          if (c.type === "tool_use") {
            return (
              <div key={i} className="mt-2 text-xs flex items-start gap-2">
                <Wrench className="w-3.5 h-3.5 mt-0.5 shrink-0 text-accent" aria-hidden="true" />
                <span className="font-mono break-all">
                  {c.name}({JSON.stringify(c.input).slice(0, 120)})
                </span>
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}

function inferToolId(pathname: string | null): string | null {
  if (!pathname) return null;
  // /planning-poker → "planning-poker"; / → null
  const m = pathname.match(/^\/([a-z0-9-]+)(?:\/|$)/);
  return m ? m[1] : null;
}
