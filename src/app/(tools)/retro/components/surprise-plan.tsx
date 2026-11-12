"use client";

/**
 * "Surprise me" on the format picker: a random plan for the next retro, a
 * format the team hasn't used in its last three retros plus an opening and
 * a closing from the Ice Breaker. Shuffle again for another; Ask Amr picks
 * the candidate that fits the sprint's facts best and says why (without AI,
 * the format the facts call for, with the reason). Nothing starts until the
 * Scrum Master presses Start this retro.
 */

import { useCallback, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Play, Shuffle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AiButton } from "@/components/ai";
import { surprisePlanTask } from "@/lib/ai/tasks/retro";
import type { AiSource } from "@/lib/ai/task-types";
import type { RetroFormat } from "@/lib/constants/retro-formats";
import {
  SURPRISE_AVOID_RECENT,
  surpriseCandidates,
  surpriseFormatInput,
  surprisePlan,
  withPlanFormat,
  type RetroActivity,
  type SurprisePlan,
} from "@/lib/retro/surprise";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { useSurpriseSprint } from "../use-surprise-facts";

export interface SurpriseStart {
  plan: SurprisePlan;
  /** Why the format fits, when Amr (or the fallback) said. */
  why?: string;
}

/**
 * "Ask Amr which fits this sprint": the candidates and the sprint's facts
 * to retro.surprise_plan, read only once a plan is on screen. A pick that
 * isn't one of the candidates is no pick: the fallback's stands instead.
 */
function SurpriseFitButton({
  plan,
  candidates,
  recentNames,
  sprintId,
  onPick,
}: {
  plan: SurprisePlan;
  candidates: readonly RetroFormat[];
  recentNames: readonly string[];
  sprintId?: string;
  onPick: (plan: SurprisePlan, why: string, source: AiSource) => void;
}) {
  const sprint = useSurpriseSprint(sprintId);
  const input = () => ({
    sprint,
    formats: candidates.slice(0, 30).map(surpriseFormatInput),
    recent: recentNames.slice(0, 3).map((n) => n.slice(0, 120)),
  });
  return (
    <AiButton
      task={surprisePlanTask}
      input={input}
      label="Ask Amr which fits this sprint"
      fallbackLabel="Pick for this sprint without AI"
      variant="outline"
      onResult={(data, meta) => {
        const picked = withPlanFormat(plan, candidates, data.formatId);
        if (picked) return onPick(picked, data.why, meta.source);
        const fallback = surprisePlanTask.fallback(input());
        const chosen = withPlanFormat(plan, candidates, fallback.formatId);
        if (chosen) onPick(chosen, fallback.why, "fallback");
      }}
    />
  );
}

function ActivityLine({ title, activity }: { title: string; activity: RetroActivity }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wider text-sub">{title}</dt>
      <dd className="text-sm text-text">
        <span className="font-medium">{activity.name}</span>{" "}
        <span className="text-xs text-sub">· {activity.minutes} min</span>
        <span className="block text-xs text-sub">{activity.line}</span>
      </dd>
    </div>
  );
}

export function SurprisePlanPanel({
  formats,
  recent,
  sprintId,
  onStart,
}: {
  /** Every format it may pick: the built-in ones and the team's saved ones. */
  formats: readonly RetroFormat[];
  /** The latest retros' formats, newest first. */
  recent: readonly string[];
  sprintId?: string;
  onStart: (start: SurpriseStart) => void;
}) {
  const announce = useAnnounce();
  const headingId = useId();
  const [plan, setPlan] = useState<SurprisePlan | null>(null);
  const [why, setWhy] = useState<{ text: string; source: AiSource } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const candidates = useMemo(() => surpriseCandidates(formats, recent), [formats, recent]);
  const recentNames = recent
    .map((id) => formats.find((f) => f.id === id)?.name)
    .filter((n): n is string => Boolean(n));

  const shuffle = useCallback(() => {
    const next = surprisePlan({ formats, recent, previous: plan });
    if (!next) return;
    setPlan(next);
    setWhy(null);
    announce(
      `Surprise: ${next.format.name}, opening with ${next.opening.name}, closing with ${next.closing.name}.`
    );
  }, [formats, recent, plan, announce]);

  const close = () => {
    setPlan(null);
    setWhy(null);
    triggerRef.current?.focus();
  };

  return (
    <div className="space-y-3">
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        onClick={shuffle}
        className="gap-1.5"
        aria-expanded={plan !== null}
      >
        <Shuffle className="h-4 w-4" aria-hidden="true" />
        {plan ? "Shuffle again" : "Surprise me"}
      </Button>
      {plan && (
        <section
          aria-labelledby={headingId}
          className="space-y-3 rounded-lg border border-accent/40 bg-card p-4"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 id={headingId} className="text-sm font-bold text-text">
                Surprise plan: {plan.format.name}
              </h3>
              <p className="text-xs text-sub">
                {plan.format.columns.map((c) => c.label).join(" · ")}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 shrink-0 p-0 text-sub"
              aria-label="Close the surprise plan"
              onClick={close}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
          {plan.format.description && <p className="text-sm text-sub">{plan.format.description}</p>}
          {recentNames.length > 0 && (
            <p className="text-xs text-sub">
              {candidates.some((c) => recent.includes(c.id))
                ? `Every format has been used lately, so any of them can come up.`
                : `Not one of your last ${Math.min(SURPRISE_AVOID_RECENT, recentNames.length)}: ${recentNames.join(", ")}.`}
            </p>
          )}
          <dl className="grid gap-3 sm:grid-cols-2">
            <ActivityLine title="Open with" activity={plan.opening} />
            <ActivityLine title="Close with" activity={plan.closing} />
          </dl>
          {why && (
            <p className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-text">
              <span className="block text-xs font-semibold text-sub">
                {why.source === "ai"
                  ? "Why it fits, from Amr"
                  : "Why it fits (suggested without AI)"}
              </span>
              {why.text}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              className="gap-1.5"
              onClick={() => onStart({ plan, ...(why ? { why: why.text } : {}) })}
            >
              <Play className="h-4 w-4" aria-hidden="true" />
              Start this retro
            </Button>
            {candidates.length > 1 && (
              <SurpriseFitButton
                plan={plan}
                candidates={candidates}
                recentNames={recentNames}
                sprintId={sprintId}
                onPick={(chosen, text, source) => {
                  setPlan(chosen);
                  setWhy({ text, source });
                  announce(`${chosen.format.name}. ${text}`);
                }}
              />
            )}
            <Link href="/icebreaker" className="text-xs font-medium text-accent hover:underline">
              The activities in Ice Breaker
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
