"use client";

import { useMemo, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { AiButton } from "@/components/ai";
import { Button } from "@/components/ui/button";
import { useFlash } from "@/hooks/use-flash";
import {
  asyncStandupDigestTask,
  cleanDigestOutput,
  digestInput,
  digestWithSummary,
  fitDigestInput,
  type DigestAiOutput,
} from "@/lib/ai/tasks/async-standup.lite";
import type { StandupPlaces } from "@/lib/standup/entries";
import type { StandupEntry } from "@/lib/stores/workspace-types";

/** Where a summary came from: the AI, or the page's own rules. */
export type SummarySource = "ai" | "rules";

/** What the button beside "Summarise with AI" sends (the approved privacy line, word for word). */
export const SUMMARY_PRIVACY_LINE = "Sends today's updates, with names, to the AI service.";

/**
 * "Summarise with AI" over today's digest: a headline, a short summary,
 * who to ask for what, the risks and the hand-overs, shown as plain text.
 * Nothing is saved; "Copy digest with summary" puts it in the digest after
 * its title. Without AI the page's own rules write it from the same facts.
 */
export function DigestSummary({
  entries,
  today,
  notYet,
  places,
  digest,
  onCopy,
  onSummarised,
}: {
  entries: readonly StandupEntry[];
  today: string;
  notYet: readonly string[];
  places?: StandupPlaces;
  digest: string;
  onCopy: (text: string) => Promise<boolean>;
  onSummarised?: (source: SummarySource) => void;
}) {
  const input = useMemo(
    () => fitDigestInput(digestInput({ entries, date: today, places, notPosted: notYet })),
    [entries, today, places, notYet]
  );
  const [summary, setSummary] = useState<(DigestAiOutput & { source: SummarySource }) | null>(null);
  const { flash, isFlashing } = useFlash();
  const copied = isFlashing();
  const boxRef = useRef<HTMLElement>(null);

  return (
    <section ref={boxRef} aria-labelledby="standup-summary" className="space-y-2">
      <h3 id="standup-summary" className="sr-only">
        Summary
      </h3>
      <div className="flex flex-wrap items-center gap-2">
        <AiButton
          task={asyncStandupDigestTask}
          label="Summarise with AI"
          fallbackLabel="Summarise"
          input={() => input}
          onResult={(data, meta) => {
            const source: SummarySource = meta.source === "ai" ? "ai" : "rules";
            // Asks and hand-overs only to the people and places given.
            setSummary({ ...cleanDigestOutput(input, data), source });
            onSummarised?.(source);
          }}
        />
        <span className="text-xs text-sub">{SUMMARY_PRIVACY_LINE}</span>
      </div>
      {summary && (
        <div className="space-y-2 rounded-md border border-border bg-card p-3" data-digest-summary>
          <p className="text-xs text-sub">
            {summary.source === "ai" ? "Written by AI" : "Built from the updates"}
          </p>
          <p role="status" className="break-words text-sm font-medium text-text">
            {summary.headline}
          </p>
          {summary.summary && (
            <p className="whitespace-pre-line break-words text-sm text-text">{summary.summary}</p>
          )}
          {summary.asks.length > 0 && (
            <ul aria-label="Asks" className="list-disc space-y-1 pl-5 text-sm text-text">
              {summary.asks.map((a, i) => (
                <li key={`ask-${i}`} className="break-words">
                  Ask {a.who}: {a.text}
                </li>
              ))}
            </ul>
          )}
          {summary.risks.length > 0 && (
            <ul aria-label="Risks" className="list-disc space-y-1 pl-5 text-sm text-warning">
              {summary.risks.map((r, i) => (
                <li key={`risk-${i}`} className="break-words">
                  {r}
                </li>
              ))}
            </ul>
          )}
          {summary.handoffs.length > 0 && (
            <ul aria-label="Hand-overs" className="list-disc space-y-1 pl-5 text-sm text-text">
              {summary.handoffs.map((h, i) => (
                <li key={`handoff-${i}`} className="break-words">
                  {h.from} → {h.to}: {h.text}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1"
              onClick={() =>
                void onCopy(digestWithSummary(digest, summary)).then((ok) => {
                  if (ok) flash("Digest copied with the summary");
                })
              }
            >
              {copied ? (
                <Check className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Copy className="h-4 w-4" aria-hidden="true" />
              )}
              {copied ? "Copied" : "Copy digest with summary"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                boxRef.current?.querySelector<HTMLElement>('[data-testid="ai-button"]')?.focus();
                setSummary(null);
              }}
            >
              Clear summary
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
