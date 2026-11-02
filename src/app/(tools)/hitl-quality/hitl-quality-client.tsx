"use client";

import { useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useShallow } from "zustand/react/shallow";
import { Users, Plus, Trash2, Beaker, Sparkles } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SectionCard } from "@/components/shared/section-card";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ExportButton } from "@/components/shared/export-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { HitlReview, Workspace } from "@/lib/stores/workspace-types";
import { generateHitlPrompts } from "@/lib/ai-prompts/hitl-quality";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { HITL_ACTIONS } from "@/lib/history/event-actions";
import { useActiveLlm } from "@/lib/llm/use-active-llm";
import { themed } from "@/lib/utils/theme-color";

// Lazy-load — keep adapter chunks out of the eager bundle for users who
// only manually log reviewer ratings.
const AiRunPanel = dynamic(() => import("@/components/shared/ai-run-panel"), {
  ssr: false,
  loading: () => (
    <div className="text-xs text-sub p-2 border border-border rounded">Loading panel…</div>
  ),
});

// Recharts loads with the trend chart, not the page.
const HitlMeanRatingChart = dynamic(() => import("./charts").then((m) => m.HitlMeanRatingChart), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full animate-pulse rounded-lg bg-muted/30" aria-hidden="true" />
  ),
});

export function HitlQualityClient() {
  const list = useWorkspaceStore((s) => s.hitlReviews ?? []);
  const upsert = useWorkspaceStore((s) => s.upsertHitlReview);
  const removeOne = useWorkspaceStore((s) => s.removeHitlReview);
  const { log } = useHistoryLogger("hitl-quality");
  const exportRef = useRef<HTMLDivElement>(null);

  const [feature, setFeature] = useState("");
  const [reviewer, setReviewer] = useState("");
  const [rating, setRating] = useState<HitlReview["rating"]>(3);
  const [agreed, setAgreed] = useState(true);
  const [reason, setReason] = useState("");

  // --- BYOK generate-first-pass state ---
  // Lets reviewers run a candidate prompt through their active provider
  // and read the streamed output before deciding the rating they'll log
  // below. Deliberately separate state from the review form — the BYOK
  // prompt is observational scaffolding, not part of the persisted row.
  const llm = useActiveLlm();
  const [livePrompt, setLivePrompt] = useState("");

  function add() {
    // Require at least one identifying field — feature, reviewer, or reason.
    // Otherwise the table fills up with rows showing only "anon" + rating,
    // which is rarely useful and impossible to associate back to context.
    if (!feature.trim() && !reviewer.trim() && !reason.trim()) return;
    // Defensive bound on rating in case the casted Select value somehow
    // landed outside 1..5 (e.g. a corrupt persisted draft that bypassed the
    // dropdown).
    const safeRating = (
      Number.isFinite(rating) && rating >= 1 && rating <= 5 ? rating : 3
    ) as HitlReview["rating"];
    const item: HitlReview = {
      id: crypto.randomUUID(),
      feature: feature.trim() || undefined,
      reviewer: reviewer.trim() || undefined,
      rating: safeRating,
      agreedWithModel: agreed,
      reason: reason.trim().slice(0, 4000) || undefined,
      loggedAt: new Date().toISOString(),
    };
    upsert(item);
    log(HITL_ACTIONS.REVIEW_LOGGED, { rating: safeRating, agreed });
    // BUG-T3-hitl-quality-2: reset every draft field, not just reason.
    // Carrying stale feature/reviewer/rating/agreed into the next log
    // silently attaches them to the wrong row.
    setReason("");
    setFeature("");
    setReviewer("");
    setRating(3);
    setAgreed(true);
  }

  function remove(id: string) {
    removeOne(id);
    log(HITL_ACTIONS.REVIEW_REMOVED, { id });
  }

  // Drop entries with malformed ratings before averaging — a hand-edited
  // localStorage payload could have a rating outside 1..5, which would
  // skew the mean indefinitely. Same for trend math below.
  // BUG-RD3-hitl-quality-1: `Number.isFinite` alone passes a rating of
  // 6 (or 0, or -3) since those are finite numbers. The chart's Y axis
  // is `domain={[1, 5]}` so an out-of-range mean clips off the chart
  // silently — the user sees a flat line at the top/bottom of the
  // axis with no hint that real data is being hidden. Bound the
  // rating to the documented 1..5 scale at the filter step.
  const validList = useMemo(
    () =>
      list.filter(
        (x) =>
          Number.isFinite(x.rating) &&
          x.rating >= 1 &&
          x.rating <= 5 &&
          typeof x.loggedAt === "string"
      ),
    [list]
  );
  const meanRating =
    validList.length === 0 ? 0 : validList.reduce((s, x) => s + x.rating, 0) / validList.length;
  const agreementRate =
    validList.length === 0
      ? 0
      : Math.round((validList.filter((x) => x.agreedWithModel).length / validList.length) * 100);

  // Per-day rolling
  const trendData = useMemo(() => {
    const byDay: Record<string, { date: string; mean: number; n: number; sum: number }> = {};
    for (const x of validList) {
      // `loggedAt.slice` throws on non-strings; we already filtered above but
      // re-check defensively so the type narrows cleanly.
      const day = typeof x.loggedAt === "string" ? x.loggedAt.slice(0, 10) : "";
      if (!day) continue;
      if (!byDay[day]) byDay[day] = { date: day, mean: 0, n: 0, sum: 0 };
      byDay[day].n++;
      byDay[day].sum += x.rating;
    }
    return Object.values(byDay)
      .map((d) => ({ ...d, mean: d.n > 0 ? d.sum / d.n : 0 }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [validList]);

  const workspace = useWorkspaceStore(
    useShallow(
      (s): Workspace => ({
        teamMembers: s.teamMembers,
        sprints: s.sprints,
        stories: s.stories,
        impediments: s.impediments,
        risks: s.risks,
        okrs: s.okrs,
        decisions: s.decisions,
        techDebt: s.techDebt,
        maturityLevel: s.maturityLevel,
        teamName: s.teamName,
        hitlReviews: s.hitlReviews,
      })
    )
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "HITL Quality Tracker",
      // R5: pass validList — the prompt should only see well-formed entries.
      // Mixing in malformed entries previously surfaced inconsistent stats
      // between prompt and on-screen KPIs.
      prompts: generateHitlPrompts({ items: validList }, workspace),
    }),
    [validList, workspace]
  );

  const csvData = {
    headers: ["Date", "Feature", "Reviewer", "Rating", "Agreed with model", "Reason"],
    // R5: was `list.map(...)` calling `.slice` on a possibly non-string
    // `loggedAt` (corrupt persisted entry) → CSV export crashed. Use
    // validList AND coerce defensively.
    rows: validList.map((x) => [
      String(x.loggedAt ?? "").slice(0, 10),
      x.feature ?? "",
      x.reviewer ?? "",
      x.rating,
      x.agreedWithModel ? "yes" : "no",
      x.reason ?? "",
    ]),
  };

  return (
    <ToolPageWrapper
      toolId="hitl-quality"
      title="Human-in-the-Loop Quality Tracker"
      description="Capture reviewer ratings, how often reviewers agree with the model's output, and the mean rating over time."
    >
      <div ref={exportRef} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {/* BUG-T3-hitl-quality-1: report valid-vs-total so the KPI
              matches the data the mean/agreement are computed against. */}
          <KPI
            label="Reviews"
            value={
              validList.length === list.length
                ? String(list.length)
                : `${validList.length} / ${list.length}`
            }
          />
          <KPI label="Mean rating" value={meanRating.toFixed(2)} />
          {/* The share of reviews where the reviewer agreed with the model's
              output, not agreement between reviewers. */}
          <KPI
            label="Reviewer–model agreement"
            value={`${agreementRate}%`}
            tone={agreementRate > 80 ? "ok" : "default"}
          />
        </div>

        {/* BYOK generate-first-pass — reviewer pastes the prompt-under-test,
            sees the streamed model output, then uses the existing Log review
            form below to record their rating + agreement. The output is
            ephemeral; only the review row is persisted. */}
        <SectionCard title="Generate first pass (BYOK)" icon={Beaker}>
          <p className="text-xs text-sub mb-3">
            Run a candidate prompt through your active BYOK provider so the reviewer can see the
            model output before logging a rating below. The output isn&apos;t saved — only the
            review you log is.
          </p>
          {!llm.isReady ? (
            <div className="flex flex-col items-start gap-2 p-3 border border-dashed border-border rounded text-sub text-sm">
              <span className="inline-flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-accent" />
                No BYOK provider configured yet.
              </span>
              <Button size="sm" variant="outline" onClick={llm.openSettings} className="gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                Open AI settings
              </Button>
            </div>
          ) : (
            <>
              <Textarea
                value={livePrompt}
                onChange={(e) => setLivePrompt(e.target.value)}
                placeholder="The prompt the reviewer is grading…"
                aria-label="Prompt under review"
                rows={3}
                className="font-mono text-xs"
              />
              {/* Only mount the panel once a prompt is typed — the Run button
                  inside would otherwise sit disabled with empty input. */}
              {livePrompt.trim().length > 0 && (
                <div className="mt-3">
                  <AiRunPanel prompt={livePrompt} toolName="HITL first-pass" />
                </div>
              )}
            </>
          )}
        </SectionCard>

        <SectionCard title="Log review" icon={Plus}>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Input
              placeholder="Feature"
              aria-label="Feature"
              value={feature}
              onChange={(e) => setFeature(e.target.value)}
            />
            <Input
              placeholder="Reviewer"
              aria-label="Reviewer"
              value={reviewer}
              onChange={(e) => setReviewer(e.target.value)}
            />
            <select
              aria-label="Reviewer rating, 1 to 5"
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
              value={rating}
              onChange={(e) => setRating(parseInt(e.target.value, 10) as HitlReview["rating"])}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  Rating {n}/5
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm sm:col-span-3">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
              />
              <span>Reviewer agreed with the model output</span>
            </label>
          </div>
          <Textarea
            placeholder="Reason / notes (optional)"
            aria-label="Reason or notes (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="mt-2"
            rows={2}
          />
          <Button onClick={add} className="mt-3 gap-1">
            <Plus className="w-4 h-4" />
            Log
          </Button>
        </SectionCard>

        {trendData.length > 1 && (
          <SectionCard title="Mean rating over time" icon={Users}>
            <div className="-mx-2 h-56">
              <HitlMeanRatingChart data={trendData} />
            </div>
          </SectionCard>
        )}

        {list.length > 0 && (
          <SectionCard
            title={`Reviews (${list.length})`}
            icon={Users}
            actions={
              <>
                <AiPromptGenerator config={promptConfig} />
                <ExportButton
                  filename="hitl-reviews"
                  csvData={csvData}
                  jsonData={list}
                  targetRef={exportRef}
                />
              </>
            }
          >
            <ul className="space-y-1.5">
              {/* R11-fix: render `validList` instead of raw `list`. A
                  persisted entry with non-string `loggedAt` (older schema
                  or hand-edited localStorage) crashed `x.loggedAt.slice(0,10)`
                  here, killing the entire page. `validList` is already
                  type-narrowed at the top of the component. */}
              {[...validList]
                .sort((a, b) => new Date(b.loggedAt).getTime() - new Date(a.loggedAt).getTime())
                .slice(0, 50)
                .map((x) => (
                  <li
                    key={x.id}
                    className="flex items-center gap-2 border border-border bg-surface-deep rounded p-2 text-sm"
                  >
                    <span className="font-mono text-xs text-sub">{x.loggedAt.slice(0, 10)}</span>
                    <span
                      className="font-bold w-6 text-center"
                      style={{
                        color: themed(
                          x.rating >= 4 ? "#00ff88" : x.rating <= 2 ? "#ff6b6b" : "#ffaa00"
                        ),
                      }}
                    >
                      {x.rating}
                    </span>
                    {x.feature && <span className="text-text">{x.feature}</span>}
                    {x.reviewer && <span className="text-xs text-sub">— {x.reviewer}</span>}
                    <span
                      className={`text-xs ml-auto ${x.agreedWithModel ? "text-success" : "text-danger"}`}
                    >
                      {x.agreedWithModel ? "agreed" : "disagreed"}
                    </span>
                    <button
                      onClick={() => remove(x.id)}
                      aria-label="Remove review"
                      className="min-touch-coarse -m-1 p-1 text-sub hover:text-danger"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </li>
                ))}
            </ul>
          </SectionCard>
        )}
      </div>
    </ToolPageWrapper>
  );
}

function KPI({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "ok" | "danger";
}) {
  const colorClass =
    tone === "danger" ? "text-danger" : tone === "ok" ? "text-success" : "text-text";
  return (
    <div className="rounded-md border border-border bg-surface-deep p-3">
      <div className="text-xs text-sub uppercase tracking-wider">{label}</div>
      <div className={`text-xl font-semibold mt-1 font-data ${colorClass}`}>{value}</div>
    </div>
  );
}
