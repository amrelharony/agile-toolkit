"use client";

/**
 * The agreement a visitor gives before a tool's first Ask Amr: the same card
 * as the mascot panel's (visitor-ai-consent.tsx), compact enough for a tool
 * page. Same words (lib/site/disclosures.ts), same key and version
 * (lib/visitor-ai/consent.ts), so agreeing here also covers the chat, and the
 * other way round. Nothing is sent until the visitor presses Agree.
 */

import { useEffect, useId, useRef } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { VISITOR_AI_CONSENT_TEXT } from "@/lib/site/disclosures";
import { storeVisitorAiConsent } from "@/lib/visitor-ai/consent";

export function AiConsentCompact({
  onAgree,
  onDecline,
  className,
}: {
  /** Runs after the agreement is stored. */
  onAgree: () => void;
  onDecline: () => void;
  className?: string;
}) {
  const titleId = useId();
  // Focus moves to the card, so a screen reader reads it before the buttons.
  const cardRef = useRef<HTMLElement>(null);
  useEffect(() => {
    cardRef.current?.focus();
  }, []);

  return (
    <section
      ref={cardRef}
      tabIndex={-1}
      aria-labelledby={titleId}
      data-testid="ai-consent-compact"
      className={cn(
        "rounded-lg border border-border bg-card px-3 py-3 focus:outline-none",
        className
      )}
    >
      <p id={titleId} className="flex items-center gap-2 text-sm font-semibold text-text">
        <ShieldCheck className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
        Before Amr&apos;s AI helps here
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-text">
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
          Agree
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onDecline}>
          Not now
        </Button>
      </div>
    </section>
  );
}
