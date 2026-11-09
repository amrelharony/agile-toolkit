"use client";

/**
 * What the mascot's panel shows a signed-out visitor when visitor AI is on.
 *
 * Three steps, offline first:
 *  - guide: the offline tool finder (VisitorGuide), as before, plus "Ask Amr
 *    about '…'" and "Chat with Amr". Opening the panel sends nothing.
 *  - consent: the first time, a card says where messages go
 *    (VisitorAiConsent). Nothing is sent before "Agree and ask".
 *  - chat: Amr's AI (visitor-agent-panel), a separate chunk loaded only now;
 *    the agent runtime behind it loads on the first message.
 *
 * When the visitor route says there's no more AI for now (visitorFallback),
 * the panel goes back to the guide with a note saying which limit was reached
 * (visitorFallbackNote). This module stays light: it ships in every page with
 * the mascot.
 */

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useAgentStore, type VisitorQuota } from "@/lib/agent/store";
import type { VisitorErrorCode } from "@/lib/visitor-ai/contract";
import { formatPeakTime } from "@/lib/visitor-ai/peak";
import { VisitorGuide } from "./visitor-guide";
import { VisitorAiConsent, hasVisitorAiConsent } from "./visitor-ai-consent";

const VisitorAgentPanel = dynamic(() => import("./visitor-agent-panel"), {
  ssr: false,
  loading: () => <div className="min-h-0 flex-1" aria-busy="true" />,
});

/** Shown over the guide for a refusal without a note of its own below. */
export const VISITOR_FALLBACK_NOTE =
  "Amr has answered all he can for now. Here's the offline guide.";

/**
 * The note over the guide for the refusal that sent the visitor back to it:
 * which limit was reached, or why the AI is off, and for the busy-hours
 * limits when they end, in the visitor's own time (from the route's last
 * answer). Plain strings and Intl only, so the page stays light.
 */
export function visitorFallbackNote(
  code: VisitorErrorCode,
  quota: VisitorQuota | null,
  now: Date = new Date()
): string {
  const ends = quota?.peak && quota.peakEndsAt ? new Date(quota.peakEndsAt) : null;
  const until = ends && ends > now ? ` until ${formatPeakTime(ends)}` : "";
  switch (code) {
    case "visitor_limit":
      return "You've used all of today's messages with Amr. Here's the offline guide until tomorrow.";
    case "visitor_peak_limit":
      return `You've used all your messages for these busy hours. Here's the offline guide${until || " until they end"}.`;
    case "site_limit":
      return "Amr has answered all he can for today. Here's the offline guide until tomorrow.";
    case "site_peak_limit":
      return `Amr has answered all he can for these busy hours. Here's the offline guide${until || " until they end"}.`;
    case "site_busy":
      return "Amr is too busy to answer right now. Here's the offline guide; try asking him again later.";
    case "disabled":
      return "Amr's AI is switched off right now. Here's the offline guide.";
    case "meter_unavailable":
      return "Amr can't check today's message count right now. Here's the offline guide; try asking him again in a few minutes.";
    default:
      return VISITOR_FALLBACK_NOTE;
  }
}

type Mode = "guide" | "consent" | "chat";

/** Reopening the panel mid-chat goes straight back to the chat. */
function initialMode(): Mode {
  const s = useAgentStore.getState();
  const midChat = s.chatProfile === "visitor" && s.messages.length > 0 && !s.visitorFallback;
  return midChat && hasVisitorAiConsent() ? "chat" : "guide";
}

export function VisitorPanel({ onNavigate }: { onNavigate?: () => void }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  // The question to send when the chat opens ("" opens it empty).
  const [question, setQuestion] = useState("");
  const fallback = useAgentStore((s) => s.visitorFallback);
  const quota = useAgentStore((s) => s.visitorQuota);

  // A "no more AI for now" refusal: back to the offline guide.
  useEffect(() => {
    if (fallback) setMode("guide");
  }, [fallback]);

  const askAmr = (query: string) => {
    setQuestion(query.trim());
    // Asking again is a fresh try: the route answers again if it can.
    useAgentStore.getState().setVisitorFallback(null);
    setMode(hasVisitorAiConsent() ? "chat" : "consent");
  };

  if (mode === "consent") {
    return (
      <VisitorAiConsent
        question={question}
        onAgree={() => setMode("chat")}
        onDecline={() => setMode("guide")}
      />
    );
  }
  if (mode === "chat") {
    return (
      <VisitorAgentPanel
        initialQuestion={question}
        onOfflineGuide={() => {
          setQuestion("");
          setMode("guide");
        }}
      />
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      {fallback && (
        <p
          role="status"
          className="mx-4 mt-3 rounded-md border border-border bg-card px-3 py-2 text-sm text-text"
        >
          {visitorFallbackNote(fallback, quota)}
        </p>
      )}
      <div className="min-h-0 flex-1">
        <VisitorGuide onNavigate={onNavigate} onAskAmr={askAmr} />
      </div>
    </div>
  );
}
