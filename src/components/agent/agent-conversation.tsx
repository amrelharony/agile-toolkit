"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useAgentStore } from "@/lib/agent/store";
import { useAuth } from "@/lib/auth/auth-provider";
import { sendUserMessage } from "@/lib/agent/client";
import {
  createConversation,
  listConversations,
  loadMessages,
  conversationTitle,
} from "@/lib/agent/persist";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "./confirm-action";
import { useVoiceInput } from "@/lib/agent/mascot/use-voice-input";
import { handleMascotCommand } from "./mascot/engine/customization/commands";
import { Send, Wrench, AlertTriangle, Mic } from "lucide-react";
import type { ChatMessage } from "@/lib/agent/types";

/** Resume the most recent thread at most once per page load (not on every
 *  panel reopen — that would override an intentional "New chat"). */
let resumedThisLoad = false;

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
    let alive = true;
    void listConversations().then(async (list) => {
      if (!alive || list.length === 0 || !blank()) return;
      const msgs = await loadMessages(list[0].id);
      if (alive && blank()) useAgentStore.getState().setActiveConversation(list[0], msgs);
    });
    return () => {
      alive = false;
    };
  }, []);

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
      }
    }
    void sendUserMessage(text, { userId: user.id, toolId, conversationId: convId ?? undefined });
  };

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
          <Button type="submit" disabled={streaming || !input.trim()} size="icon" aria-label="Send">
            <Send className="w-4 h-4" aria-hidden="true" />
          </Button>
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
            return (
              <p key={i} className="whitespace-pre-wrap break-words">
                {c.text}
              </p>
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
