"use client";

/**
 * One chat message: the visitor's or owner's own words verbatim, Amr's reply
 * as safe markdown, and his tool calls and their results as compact rows.
 * Shared by the owner's chat (agent-conversation) and the visitor's
 * (mascot/visitor-agent-panel).
 */

import { Wrench } from "lucide-react";
import { Markdown } from "./markdown";
import type { ChatMessage } from "@/lib/agent/types";

export function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "tool") {
    return (
      <div className="text-xs text-sub bg-card/50 rounded-md p-2 border border-border">
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
