"use client";

/**
 * Where an analysis ends: the root cause the team settled on, the
 * countermeasure it agreed (with a check of whether it worked), and the
 * countermeasure sent to Retro Actions so someone owns it. Also the link to
 * the post-mortem the analysis belongs to, both ways: the post-mortem's
 * page lists the analyses linked to it.
 *
 * Ask Amr suggests countermeasures once there is a root cause. They are
 * alternatives, so the person picks one (there is no "use all"): it fills
 * the countermeasure (with Undo) and focus moves to the countermeasure, to
 * read or adjust it. Example analyses can't be sent anywhere.
 */

import { useId, useState } from "react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import Link from "next/link";
import { ArrowRight, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BlurTextarea } from "@/components/shared/blur-fields";
import { AiButton, AiSuggestions } from "@/components/ai";
import { countermeasureTask } from "@/lib/ai/tasks/root-cause";
import type { AiSource } from "@/lib/ai/task-types";
import { liveLink, getHandoffRoute } from "@/lib/handoffs/registry";
import { TOOL_TEXT_MAX, type RootCauseAnalysis } from "@/lib/stores/workspace-types";
import { whyLines } from "@/lib/root-cause/model";
import { isExampleId } from "@/lib/utils/example-id";

export interface PostMortemOption {
  id: string;
  title: string;
  incidentDate?: string;
}

export interface OutcomeProps {
  analysis: RootCauseAnalysis;
  postMortems: readonly PostMortemOption[];
  onRootCause: (text: string) => void;
  /** `fromAi`: an accepted suggestion, saved with Undo. */
  onCountermeasure: (text: string, opts?: { fromAi?: boolean }) => void;
  onSend: () => void;
  onLinkPostMortem: (id: string | undefined) => void;
}

/** "Text\nCheck: …": what a countermeasure suggestion fills in. */
export function countermeasureText(c: { text: string; check: string }): string {
  return `${c.text.trim()}\nCheck: ${c.check.trim()}`.slice(0, TOOL_TEXT_MAX.text);
}

export function Outcome({
  analysis,
  postMortems,
  onRootCause,
  onCountermeasure,
  onSend,
  onLinkPostMortem,
}: OutcomeProps) {
  const ids = useId();
  const announce = useAnnounce();
  const example = isExampleId(analysis.id);
  const [suggested, setSuggested] = useState<{
    items: { text: string; check: string }[];
    source: AiSource;
  } | null>(null);
  const root = analysis.rootCause?.trim() ?? "";
  const counter = analysis.countermeasure?.trim() ?? "";
  const sent = liveLink(analysis.sentTo, "retro-action");
  const linked = analysis.postMortemId
    ? postMortems.find((p) => p.id === analysis.postMortemId)
    : undefined;

  return (
    <section aria-labelledby={`${ids}-heading`} className="space-y-3">
      <h3 id={`${ids}-heading`} className="text-sm font-semibold text-text">
        Root cause and countermeasure
      </h3>
      <div>
        <label htmlFor={`${ids}-root`} className="mb-1 block text-xs font-medium text-sub">
          Root cause
        </label>
        <BlurTextarea
          id={`${ids}-root`}
          rows={2}
          value={analysis.rootCause ?? ""}
          maxLength={TOOL_TEXT_MAX.text}
          placeholder="Mark a why or a cause above, or write it here"
          onCommit={onRootCause}
        />
      </div>
      <div>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <label htmlFor={`${ids}-counter`} className="text-xs font-medium text-sub">
            Countermeasure: what the team will change, and how it will know it worked
          </label>
          {!example && root && (
            <AiButton
              task={countermeasureTask}
              input={() => ({
                problem: [analysis.title, analysis.problem]
                  .filter((s) => s.trim())
                  .join(". ")
                  .slice(0, 1000),
                rootCause: root.slice(0, 1000),
                whys: whyLines(analysis.whys).map((w) => w.slice(0, 1000)),
                causes: analysis.causes.slice(0, 20).map((c) => c.text.slice(0, 300)),
              })}
              label="Ask Amr for countermeasures"
              fallbackLabel="Suggest without AI"
              onResult={(data, meta) => {
                setSuggested({ items: data.countermeasures, source: meta.source });
                const n = data.countermeasures.length;
                announce(
                  n === 0
                    ? "No countermeasure to suggest."
                    : `${n} possible ${n === 1 ? "countermeasure" : "countermeasures"} below. Pick the one that fits.`
                );
              }}
            />
          )}
        </div>
        <BlurTextarea
          id={`${ids}-counter`}
          rows={3}
          value={analysis.countermeasure ?? ""}
          maxLength={TOOL_TEXT_MAX.text}
          placeholder={
            root
              ? "Rehearse every migration on production-sized data…"
              : "Name the root cause first"
          }
          onCommit={(text) => onCountermeasure(text)}
        />
      </div>
      {suggested && suggested.items.length > 0 && (
        <AiSuggestions
          items={suggested.items}
          source={suggested.source}
          title="Possible countermeasures"
          acceptLabel="Use"
          pickOne
          render={(c) => ({ title: c.text, detail: `Check: ${c.check}` })}
          onAccept={(c) => {
            onCountermeasure(countermeasureText(c), { fromAi: true });
            setSuggested(null);
            // The list goes; focus lands on what was filled in.
            requestAnimationFrame(() => document.getElementById(`${ids}-counter`)?.focus());
          }}
          onDismiss={() => setSuggested(null)}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        {sent ? (
          <Link
            href={getHandoffRoute("retro-action").targetHref(sent.targetId)}
            className="inline-flex items-center gap-1 text-sm font-medium text-success hover:underline"
          >
            In Retro Actions · Open
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        ) : (
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            onClick={onSend}
            disabled={!counter || example}
            aria-describedby={`${ids}-send-note`}
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            Send to Retro Actions
          </Button>
        )}
        <p id={`${ids}-send-note`} className="text-xs text-sub">
          {example
            ? "Example analyses stay here: nothing is sent."
            : sent
              ? "Someone owns it there until it's done."
              : counter
                ? "It becomes an action on the current retro, for someone to own."
                : "Write the countermeasure first."}
        </p>
      </div>

      <div className="space-y-1">
        <label htmlFor={`${ids}-pm`} className="block text-xs font-medium text-sub">
          Post-mortem
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <select
            id={`${ids}-pm`}
            value={analysis.postMortemId ?? ""}
            disabled={example}
            onChange={(e) => onLinkPostMortem(e.target.value || undefined)}
            className="flex h-11 max-w-full rounded-md border border-input bg-background px-2 text-base text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-fine:md:h-9 pointer-fine:md:text-sm"
          >
            <option value="">Not linked</option>
            {analysis.postMortemId && !linked && (
              <option value={analysis.postMortemId}>A post-mortem that was deleted</option>
            )}
            {postMortems.map((p) => (
              <option key={p.id} value={p.id}>
                {p.incidentDate ? `${p.title} (${p.incidentDate})` : p.title}
              </option>
            ))}
          </select>
          {linked && (
            <Link
              href="/post-mortem"
              className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
            >
              Open the post-mortem
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          )}
        </div>
        {postMortems.length === 0 && !analysis.postMortemId && (
          <p className="text-xs text-sub">
            No post-mortem yet. Write one in Post-Mortem to link it.
          </p>
        )}
      </div>
    </section>
  );
}
