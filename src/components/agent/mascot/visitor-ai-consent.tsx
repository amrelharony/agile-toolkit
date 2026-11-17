"use client";

/**
 * The consent card a visitor sees before their first message to Amr's AI
 * (visitor AI). Nothing is sent until they agree; their choice is remembered
 * in this browser only, under a versioned key, so a change to what the card
 * says can ask again. The same agreement covers the tools' Ask Amr buttons
 * (components/ai/ai-consent-compact.tsx asks for it on a tool page).
 *
 * A column: the title, the visitor's question (in their own caption) and the
 * points scroll, and the buttons sit in a footer that never does, so "Agree"
 * and "Not now" stay in view in the shortest phone panel. The privacy page's
 * link closes the panel on its way (`onNavigate`).
 *
 * Light on purpose: it ships with the page, beside the tool finder, so it
 * imports nothing of the agent runtime (the comic parts are runtime-free).
 */

import { useEffect, useRef } from "react";
import { ShieldCheck } from "lucide-react";
import { YouCaption } from "@/components/agent/comic/comic-parts";
import { FormPrivacyNote } from "@/components/data/form-privacy-note";
import { Button } from "@/components/ui/button";
import { VISITOR_AI_CONSENT_TEXT, VISITOR_AI_DAILY_MESSAGES } from "@/lib/site/disclosures";
import { storeVisitorAiConsent } from "@/lib/visitor-ai/consent";
import { awaitDecision } from "@/lib/agent/mascot/companion";

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
  onNavigate,
}: {
  /** What the visitor wants to ask, shown back to them (may be empty). */
  question: string;
  onAgree: () => void;
  onDecline: () => void;
  /** The privacy link was followed: the panel closes as the page changes. */
  onNavigate?: () => void;
}) {
  // Focus moves to the card's scrolling text when it appears, not to "Agree
  // and ask": a screen reader reads what it says before the buttons, and the
  // arrow, Page and Space keys scroll the points (keys scroll the focused
  // element or a scroller around it, never one inside it).
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    cardRef.current?.focus();
  }, []);
  const asked = question.trim() !== "";
  // Two answers, Agree and Not now: Amr holds out the two options and waits for
  // the visitor's, for as long as the card is up (every way out unmounts it).
  useEffect(() => {
    awaitDecision("consent", true);
    return () => awaitDecision("consent", false);
  }, []);

  return (
    <section aria-labelledby="amr-ai-consent-title" className="flex h-full min-h-0 flex-col">
      <div
        ref={cardRef}
        tabIndex={-1}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-2 pt-3 focus:outline-none"
      >
        <div className="panel flex flex-col gap-3 px-3 py-3">
          {/* A card title, so it is lettered (DNA-SPEC section 5). */}
          <h3
            id="amr-ai-consent-title"
            className="flex items-center gap-2 font-display text-base font-semibold text-text"
          >
            <ShieldCheck className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
            Before you chat with Amr&apos;s AI
          </h3>
          {/* The visitor's own words, in their caption: sent once they agree. */}
          {asked && <YouCaption>{question}</YouCaption>}
          <ul className="list-disc space-y-1.5 ps-5 text-sm text-text">
            {VISITOR_AI_CONSENT_TEXT.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {/* The privacy page's link, in a sentence after the points (they
              already say what is sent and kept). Following it closes the panel. */}
          <FormPrivacyNote onNavigate={onNavigate} />
        </div>
      </div>
      {/* Never scrolls: both choices stay in view. Size "default" is 44 px on
          touch and on narrow screens. */}
      <div className="flex shrink-0 flex-wrap gap-2 border-t border-border px-4 py-3">
        <Button
          type="button"
          onClick={() => {
            storeVisitorAiConsent();
            onAgree();
          }}
        >
          {asked ? "Agree and ask" : "Agree and chat"}
        </Button>
        <Button type="button" variant="outline" onClick={onDecline}>
          Not now
        </Button>
      </div>
    </section>
  );
}
