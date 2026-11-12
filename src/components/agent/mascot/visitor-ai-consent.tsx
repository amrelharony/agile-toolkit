"use client";

/**
 * The consent card a visitor sees before their first message to Amr's AI
 * (visitor AI). Nothing is sent until they agree; their choice is remembered
 * in this browser only, under a versioned key, so a change to what the card
 * says can ask again. The same agreement covers the tools' Ask Amr buttons
 * (components/ai/ai-consent-compact.tsx asks for it on a tool page).
 *
 * Light on purpose: it ships with the page, beside the offline guide, so it
 * imports nothing of the agent runtime.
 */

import { useEffect, useRef } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VISITOR_AI_CONSENT_TEXT, VISITOR_AI_DAILY_MESSAGES } from "@/lib/site/disclosures";
import { storeVisitorAiConsent } from "@/lib/visitor-ai/consent";

// The key, its version and the storage helpers live in lib/visitor-ai/consent.ts,
// which the tools' compact card uses too; re-exported here for the panel and
// the tests.
export {
  VISITOR_AI_CONSENT_KEY,
  VISITOR_AI_CONSENT_VERSION,
  hasVisitorAiConsent,
  storeVisitorAiConsent,
} from "@/lib/visitor-ai/consent";

// What the visitor agrees to, one point per line, and the daily allowance the
// card names. The wording is lib/site/disclosures.ts's, which the privacy page
// quotes too; re-exported here for the panel and the tests.
export { VISITOR_AI_CONSENT_TEXT, VISITOR_AI_DAILY_MESSAGES };

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
  // Focus moves to the card when it appears: the card, not "Agree and ask",
  // so a screen reader reads what it says before the buttons.
  const cardRef = useRef<HTMLElement>(null);
  useEffect(() => {
    cardRef.current?.focus();
  }, []);

  return (
    <div className="flex h-full flex-col overflow-y-auto px-4 py-3">
      <section
        ref={cardRef}
        tabIndex={-1}
        aria-labelledby="amr-ai-consent-title"
        className="rounded-lg border border-border bg-card px-3 py-3 focus:outline-none"
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
