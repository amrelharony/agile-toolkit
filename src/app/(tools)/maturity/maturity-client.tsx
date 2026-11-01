"use client";

import dynamic from "next/dynamic";
import { useMemo, useRef, useState } from "react";
import { Award, ClipboardList, History, Trash2, TrendingUp } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ActionRow } from "@/components/shared/action-row";
import { AdvancedAnalysis } from "@/components/shared/advanced-analysis";
import { BlurInput } from "@/components/shared/blur-fields";
import { ChartCard, ChartFigure } from "@/components/shared/chart-card";
import { DayInput } from "@/components/shared/day-input";
import { EmptyState } from "@/components/shared/empty-state";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { ResetButton } from "@/components/shared/reset-button";
import { SectionCard } from "@/components/shared/section-card";
import { IconButton } from "@/components/ui/icon-button";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { SendToMenu } from "@/components/handoff/send-to-menu";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ExampleNotice, LoadExampleButton } from "@/components/tool-frame/example-data";
import { generateMaturityPrompts } from "@/lib/ai-prompts/maturity";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { MATURITY_ACTIONS } from "@/lib/history/event-actions";
import { MATURITY_DIMENSIONS, type MaturityTone } from "@/lib/constants/maturity-model";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  HandoffLink,
  MaturityAssessment,
  MaturityAssessmentEntry,
  RetroBoard,
  Workspace,
} from "@/lib/stores/workspace-types";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { todayIso } from "@/lib/sprints/series";
import { undoable } from "@/lib/utils/undoable";
import { formatDate } from "@/lib/utils/formatters";
import { cn } from "@/lib/utils";
import {
  MATURITY_ID,
  TARGET_LEVELS,
  assessedAtError,
  assessmentDeltas,
  emptyMaturity,
  isLegacyDraft,
  latestAssessment,
  levelOf,
  maturityVerdict,
  newAssessment,
  normalizeMaturity,
  previousAssessment,
  restoreAssessment,
  roadmapCards,
  roadmapFor,
  roadmapTitle,
  savedAssessments,
  scoredCount,
  summarizeEntry,
  targetOf,
  withAssessment,
  withAssessmentPatch,
  withoutAssessment,
} from "@/lib/maturity/assessment";
import { AssessmentForm, type SaveValues } from "./assessment-form";
import {
  TREND_MIN_ASSESSMENTS,
  radarPoints,
  radarText,
  trendPoints,
  trendSlopeText,
  trendText,
} from "./chart-text";
import { buildExample, type MaturityExample } from "./example";
import { maturityToMarkdown } from "./markdown";
import { useMaturityLevelSync } from "./use-maturity-level";

export const TOOL_ID = "maturity";

// Recharts loads with the charts, not the page. The fixed-height boxes hold
// the space while they load.
const MaturityRadarChart = dynamic(() => import("./charts").then((m) => m.MaturityRadarChart), {
  ssr: false,
});
const MaturityTrendChart = dynamic(() => import("./charts").then((m) => m.MaturityTrendChart), {
  ssr: false,
});

const NO_BOARDS: RetroBoard[] = [];

/** A level's colour as theme tokens (never a hex), with the level named beside it. */
const TONE_CLASS: Record<MaturityTone, string> = {
  danger: "border-danger/40 bg-danger/10 text-danger",
  warning: "border-warning/40 bg-warning/10 text-warning",
  info: "border-info/40 bg-info/10 text-info",
  success: "border-success/40 bg-success/10 text-success",
  accent: "border-accent/40 bg-accent/10 text-accent",
};

/** A change to the assessment doc. */
type DocUpdate = (doc: MaturityAssessment) => MaturityAssessment;

/** Writes to the workspace: the stored doc, normalised, the agent's tool.maturity.* reads. */
function writeStore(update: DocUpdate) {
  const { maturityAssessments, upsertMaturityAssessment } = useWorkspaceStore.getState();
  const current = normalizeMaturity((maturityAssessments ?? []).find((d) => d.id === MATURITY_ID));
  upsertMaturityAssessment({ ...update(current), id: MATURITY_ID });
}

/** The retro cards sent from a roadmap step, as hand-off links (derived, never stored). */
const linksFor = (boards: readonly RetroBoard[] | undefined, key: string): HandoffLink[] =>
  roadmapCards(boards, key).map((c) => ({
    route: "retro-action" as const,
    targetId: c.id,
    at: "",
  }));

export function MaturityClient() {
  return (
    <ToolPageWrapper
      toolId={TOOL_ID}
      title="Agile Maturity Assessment"
      description="Score your team across 8 Agile dimensions, save each assessment with its day, and follow the trend and the next steps to your target level."
      category="Team Health & Maturity"
    >
      <MaturityTool />
    </ToolPageWrapper>
  );
}

/**
 * The maturity assessment: a draft scored dimension by dimension (Not
 * scored until picked), saved as a dated assessment; the latest one sets
 * the team's level, and the history gives a trend. Unassessed teams have
 * no level at all. The example lives in this page's memory only and never
 * touches the team's level.
 */
export function MaturityTool() {
  const hydrated = useWorkspaceHydrated();
  const stored = useWorkspaceStore((s) =>
    (s.maturityAssessments ?? []).find((d) => d.id === MATURITY_ID)
  );
  const boards = useWorkspaceStore((s) => s.retroBoards) ?? NO_BOARDS;
  const { log } = useHistoryLogger(TOOL_ID);
  const announce = useAnnounce();
  const [today] = useState(() => todayIso());
  // The example lives here only: nothing in it reaches the workspace.
  const [example, setExample] = useState<MaturityExample | null>(null);
  const preview = example !== null;
  useMaturityLevelSync(stored, hydrated);

  const doc = useMemo(() => example?.doc ?? normalizeMaturity(stored), [example, stored]);
  const saved = savedAssessments(doc);
  const latest = latestAssessment(doc);
  const previous = previousAssessment(doc);
  const summary = latest ? summarizeEntry(latest) : null;
  const target = targetOf(doc);
  const roadmap = roadmapFor(latest, target);
  const deltas = assessmentDeltas(previous, latest);
  const verdict = maturityVerdict(doc);
  const legacy = !preview && isLegacyDraft(stored);
  const resetBefore = useRef<{ doc?: MaturityAssessment } | null>(null);

  // Fixed for the render an edit starts in, so its Undo goes back to the
  // same place even if the example is loaded or cleared in between.
  const write = (update: DocUpdate) => {
    if (!preview) return writeStore(update);
    setExample((ex) => ex && { doc: update(ex.doc) });
  };
  const record: typeof log = preview ? () => undefined : log;

  /* ── The draft ───────────────────────────────────────────────────── */

  const setScore = (dimensionId: string, level: number | null) => {
    write((d) => {
      const scores = { ...d.scores };
      if (level === null) delete scores[dimensionId];
      else scores[dimensionId] = level;
      return { ...d, scores };
    });
    record(MATURITY_ACTIONS.RATING_CHANGED, { dimension: dimensionId, level });
    const name = MATURITY_DIMENSIONS.find((d) => d.id === dimensionId)?.name ?? dimensionId;
    announce(level === null ? `${name}: not scored` : `${name}: level ${level}`);
  };

  const startFromLast = () => {
    if (!latest) return;
    const before = doc.scores;
    const scores = { ...latest.scores };
    undoable({
      label: "Copied the last assessment into the draft",
      apply: () => write((d) => ({ ...d, scores })),
      revert: () => write((d) => ({ ...d, scores: before })),
    });
    announce("Copied the last assessment into the draft");
  };

  const save = (values: SaveValues) => {
    const entry = newAssessment(
      { ...values, targetLevel: target },
      preview ? `example-maturity-${crypto.randomUUID()}` : `maturity_${crypto.randomUUID()}`
    );
    const draft = doc.scores;
    const label = `Saved the assessment of ${formatDate(entry.assessedAt)}`;
    undoable({
      label,
      apply: () => {
        write((d) => withAssessment(d, entry));
        record(MATURITY_ACTIONS.ASSESSMENT_SAVED, {
          assessmentId: entry.id,
          assessedAt: entry.assessedAt,
          percentage: summarizeEntry(entry).percentage,
        });
      },
      revert: () =>
        write((d) => ({ ...(withoutAssessment(d, entry.id)?.doc ?? d), scores: draft })),
    });
    announce(label);
  };

  /* ── Saved assessments ───────────────────────────────────────────── */

  // DayInput has refused a bad day inline before this runs.
  const redate = (entry: MaturityAssessmentEntry, day: string) => {
    write((d) => withAssessmentPatch(d, entry.id, { assessedAt: day }) ?? d);
    announce(`Moved the assessment to ${formatDate(day)}`);
  };

  const renote = (entry: MaturityAssessmentEntry, note: string) =>
    write((d) => withAssessmentPatch(d, entry.id, { note }) ?? d);

  const remove = (entry: MaturityAssessmentEntry) => {
    let index = -1;
    const label = `Deleted the assessment of ${formatDate(entry.assessedAt)}`;
    undoable({
      label,
      apply: () =>
        write((d) => {
          const out = withoutAssessment(d, entry.id);
          if (!out) return d;
          index = out.index;
          return out.doc;
        }),
      revert: () => write((d) => restoreAssessment(d, entry, index)),
    });
    announce(label);
  };

  const setTarget = (level: number) => {
    write((d) => ({ ...d, targetLevel: level }));
    announce(`Target level ${level}`);
  };

  /* ── Reset and the example ───────────────────────────────────────── */

  const reset = () => {
    const { maturityAssessments, upsertMaturityAssessment } = useWorkspaceStore.getState();
    resetBefore.current = { doc: (maturityAssessments ?? []).find((d) => d.id === MATURITY_ID) };
    upsertMaturityAssessment(emptyMaturity());
    log(MATURITY_ACTIONS.MATURITY_RESET, {});
    announce("Reset the maturity assessment");
  };
  // The level follows the doc back (useMaturityLevelSync).
  const undoReset = () => {
    const before = resetBefore.current?.doc;
    if (before) useWorkspaceStore.getState().upsertMaturityAssessment(before);
  };

  const loadExample = () => setExample(buildExample());
  const clearExample = () => setExample(null);

  /* ── Exports, charts and prompts ─────────────────────────────────── */

  const markdown = maturityToMarkdown(doc, preview ? NO_BOARDS : boards);
  const csvData = {
    headers: ["Date", "Overall %", "Level", ...MATURITY_DIMENSIONS.map((d) => d.name), "Note"],
    rows: saved.map((e) => {
      const s = summarizeEntry(e);
      return [
        s.assessedAt,
        s.percentage,
        `${s.level} ${s.label}`,
        ...MATURITY_DIMENSIONS.map((d) => levelOf(e.scores[d.id]) ?? ""),
        s.note ?? "",
      ];
    }),
  };
  const trend = trendText(saved);
  const slope = trendSlopeText(saved);
  const radar = latest ? radarText(latest, previous, target) : null;

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
      })
    )
  );
  // The prompt reads the doc as the page does: the latest saved assessment,
  // else the draft as "Not assessed yet" (never a 0% or a level 1). The
  // button shows once anything is scored.
  const promptConfig = useMemo(() => {
    const prompts = generateMaturityPrompts({ doc }, workspace);
    return prompts.length > 0 ? { toolName: "Agile Maturity Assessment", prompts } : null;
  }, [doc, workspace]);

  if (!hydrated) {
    return (
      <p
        role="status"
        className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-sub"
      >
        Loading the maturity assessment…
      </p>
    );
  }

  const nothingYet = saved.length === 0 && scoredCount(doc.scores) === 0;
  const storedHasData =
    !!stored && ((stored.history?.length ?? 0) > 0 || scoredCount(stored.scores) > 0);

  return (
    <div className="space-y-6">
      {preview && (
        <div>
          <ExampleNotice onClear={clearExample} />
          <p className="-mt-2 text-xs text-sub">
            Example: a team&apos;s last three assessments. Nothing in it is saved or sent, and your
            team&apos;s level stays as it is.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          {summary ? (
            <div
              className={cn(
                "flex items-center gap-2 rounded-lg border px-4 py-2",
                TONE_CLASS[summary.tone]
              )}
            >
              <Award className="h-5 w-5" aria-hidden="true" />
              <span className="font-data text-fluid-h3 font-bold">{summary.percentage}%</span>
              <span className="text-sm text-text">{`Level ${summary.level} · ${summary.label}`}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm text-sub">
              <Award className="h-5 w-5" aria-hidden="true" />
              Not assessed
            </div>
          )}
        </div>
        <ActionRow>
          {promptConfig && <AiPromptGenerator config={promptConfig} />}
          <ExportButton
            filename="agile-maturity-assessment"
            markdown={markdown}
            clipboardText={markdown}
            csvData={csvData}
          />
          {!preview && (
            <ResetButton
              title="Reset the maturity assessment?"
              description="The draft and every saved assessment go, and the team becomes unassessed."
              confirmLabel="Reset assessment"
              doneLabel="Reset the maturity assessment"
              disabled={!storedHasData}
              onReset={reset}
              onUndo={undoReset}
            />
          )}
        </ActionRow>
      </div>

      <p className="text-sm font-medium text-text">{verdict}</p>

      {nothingYet && !preview && (
        <EmptyState icon={ClipboardList} action={<LoadExampleButton onLoad={loadExample} />}>
          Not assessed yet. Score the eight dimensions together below, then save the assessment with
          the day you took it. Each saved assessment adds a point to the trend.
        </EmptyState>
      )}

      {latest && radar && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <ChartCard
            title={`Latest assessment · ${formatDate(latest.assessedAt)}`}
            height={360}
            summary={radar.summary}
            table={radar.table}
          >
            <MaturityRadarChart data={radarPoints(latest, previous, target)} />
          </ChartCard>

          <SectionCard title="Trend" icon={TrendingUp} titleSize="lg">
            {saved.length >= TREND_MIN_ASSESSMENTS ? (
              <ChartFigure
                label="Overall maturity per assessment"
                summary={trend.summary}
                table={trend.table}
                plotClassName="h-[220px]"
              >
                <MaturityTrendChart data={trendPoints(saved)} />
              </ChartFigure>
            ) : (
              <NotEnoughData
                have={saved.length}
                need={TREND_MIN_ASSESSMENTS}
                unit={["assessment", "assessments"]}
                action="Save"
                what="the trend"
              />
            )}
            {deltas.length > 0 && previous && (
              <div className="mt-4">
                <h3 className="text-sm font-semibold text-text">
                  Since {formatDate(previous.assessedAt)}
                </h3>
                <ul className="mt-1 space-y-0.5 text-sm text-sub">
                  {deltas.map((d) => (
                    <li key={d.dimensionId}>
                      {d.name}: {d.from} → {d.to}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {saved.length >= TREND_MIN_ASSESSMENTS && (
              <AdvancedAnalysis className="mt-4">
                {slope ? (
                  <p className="text-sm text-sub">{slope}</p>
                ) : (
                  <NotEnoughData
                    have={saved.length}
                    need="trend"
                    unit={["assessment", "assessments"]}
                    action="Save"
                    what="the direction of travel"
                  />
                )}
              </AdvancedAnalysis>
            )}
          </SectionCard>
        </div>
      )}

      {latest && (
        <SectionCard
          title="Improvement roadmap"
          icon={TrendingUp}
          titleSize="lg"
          actions={
            <ToggleGroup
              label="Target level"
              size="sm"
              options={TARGET_LEVELS.map((l) => ({ value: l, label: `Target ${l}` }))}
              value={target}
              onValueChange={setTarget}
            />
          }
        >
          {roadmap.length === 0 ? (
            <p className="py-4 text-center text-sm text-sub">
              Every dimension is at level {target} or above. Raise the target to keep improving.
            </p>
          ) : (
            <ul className="space-y-3">
              {roadmap.map((step) => {
                const links = preview ? [] : linksFor(boards, step.key);
                return (
                  <li
                    key={step.key}
                    className="flex flex-col gap-2 rounded-lg border border-border bg-card-hover p-4 sm:flex-row sm:items-start"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="text-sm font-medium text-text">
                        {step.name}{" "}
                        <span className="font-normal text-sub">
                          Level {step.current} → {step.toLevel} ({step.toLabel})
                          {step.toLevel < target && `, target ${target}`}
                        </span>
                      </p>
                      <p className="text-sm leading-relaxed text-sub">{step.description}</p>
                    </div>
                    <SendToMenu
                      routes={["retro-action"]}
                      disabled={preview}
                      item={{
                        title: roadmapTitle(step),
                        description: step.description,
                        sourceRef: { tool: "maturity", id: step.key, doc: MATURITY_ID },
                      }}
                      sentTo={links}
                      getLinks={() => linksFor(useWorkspaceStore.getState().retroBoards, step.key)}
                      onLinksChange={() => {
                        // The link is the retro card's sourceRef: nothing to store here.
                      }}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
      )}

      {saved.length > 0 && (
        <SectionCard title={`Assessments (${saved.length})`} icon={History} titleSize="lg">
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {[...saved].reverse().map((e) => {
              const s = summarizeEntry(e);
              const when = formatDate(s.assessedAt);
              return (
                <li
                  key={e.id}
                  className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center"
                >
                  <DayInput
                    label={`Day of the assessment of ${when}`}
                    value={s.assessedAt}
                    max={today}
                    validate={(day) => assessedAtError(day, today)}
                    onCommit={(day) => redate(e, day)}
                    inputClassName="h-8 w-40"
                  />
                  <span className={cn("rounded border px-2 py-0.5 text-sm", TONE_CLASS[s.tone])}>
                    {s.percentage}% · Level {s.level} {s.label}
                  </span>
                  <BlurInput
                    value={e.note ?? ""}
                    onCommit={(v) => renote(e, v)}
                    placeholder="Note (optional)"
                    aria-label={`Note on the assessment of ${when}`}
                    className="h-8 min-w-0 flex-1"
                  />
                  <IconButton
                    label={`Delete the assessment of ${when}`}
                    icon={<Trash2 className="h-3.5 w-3.5" />}
                    className="h-8 w-8 text-sub hover:text-danger"
                    onClick={() => remove(e)}
                  />
                </li>
              );
            })}
          </ul>
        </SectionCard>
      )}

      <SectionCard
        title={saved.length > 0 ? "Score a new assessment" : "Score the assessment"}
        icon={ClipboardList}
        titleSize="lg"
      >
        {legacy && (
          <p
            role="status"
            className="mb-4 rounded-lg border border-info/30 bg-info/10 px-4 py-2.5 text-sm text-text"
          >
            These are your earlier scores, from before assessments were dated. Save them with the
            day they were taken to count them.
          </p>
        )}
        <AssessmentForm
          scores={doc.scores}
          today={today}
          onScore={setScore}
          onSave={save}
          onStartFromLast={latest ? startFromLast : undefined}
          title={saved.length > 0 ? "New assessment" : "Draft"}
        />
      </SectionCard>
    </div>
  );
}
