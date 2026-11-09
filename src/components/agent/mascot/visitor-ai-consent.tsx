"use client";

/**
 * The consent card a visitor sees before their first message to Amr's AI
 * (visitor AI). Nothing is sent until they agree; their choice is remembered
 * in this browser only, under a versioned key, so a change to what the card
 * says can ask again.
 *
 * Light on purpose: it ships with the page, beside the offline guide, so it
 * imports nothing of the agent runtime.
 */

import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Where the visitor's agreement is kept (localStorage), and its version. */
export const VISITOR_AI_CONSENT_KEY = "agile-toolkit:amr-ai-consent";
export const VISITOR_AI_CONSENT_VERSION = "v1";

/** The daily allowance the card names (the server's config row is what counts). */
export const VISITOR_AI_DAILY_MESSAGES = 100;

/** What the visitor agrees to, one point per line. */
export const VISITOR_AI_CONSENT_TEXT: readonly string[] = [
  "When you chat with Amr's AI, your messages, the tool you're on, and anything Amr reads from your tools to answer are sent through this site and Amr's own AI server to Z.AI, the AI provider, to write a reply.",
  "The site keeps none of it. It keeps only a count of today's messages, under a code made from your IP address that changes every day and is deleted the next day.",
  "Amr asks before he changes anything in your tools.",
  "Don't share personal or confidential information.",
  `You get ${VISITOR_AI_DAILY_MESSAGES} messages a day (fewer during busy hours). The offline guide is always free.`,
];

/** Whether this browser already agreed to the current version of the card. */
export function hasVisitorAiConsent(): boolean {
  try {
    return window.localStorage.getItem(VISITOR_AI_CONSENT_KEY) === VISITOR_AI_CONSENT_VERSION;
  } catch {
    return false;
  }
}

/** Remember the agreement (best effort: a blocked storage just asks again next time). */
export function storeVisitorAiConsent(): void {
  try {
    window.localStorage.setItem(VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION);
  } catch {
    /* storage unavailable: the card shows again next time */
  }
}

export function VisitorAiConsent({
  question,
  onAgree,
  onDecline,
}: {
  /** What the visitor wants to ask, shown back to them (may be empty). */
  question: string;
  onAgree: () => void;
  onDecline: () => void;
}) {
  return (
    <div className="flex h-full flex-col overflow-y-auto px-4 py-3">
      <section
        aria-labelledby="amr-ai-consent-title"
        className="rounded-lg border border-border bg-card px-3 py-3"
      >
        <p
          id="amr-ai-consent-title"
          className="flex items-center gap-2 text-sm font-semibold text-text"
        >
          <ShieldCheck className="h-4 w-4 text-accent" aria-hidden="true" />
          Before you chat with Amr&apos;s AI
        </p>
        {question && (
          <p className="mt-2 text-sm text-sub">
            You asked: <span className="text-text">“{question}”</span>
          </p>
        )}
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-text">
          {VISITOR_AI_CONSENT_TEXT.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => {
              storeVisitorAiConsent();
              onAgree();
            }}
          >
            Agree and ask
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onDecline}>
            Not now
          </Button>
        </div>
      </section>
    </div>
  );
}
