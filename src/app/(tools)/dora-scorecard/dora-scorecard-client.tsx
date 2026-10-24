"use client";

import { useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  AlertTriangle,
  BarChart3,
  Clock,
  Gauge,
  Plus,
  Rocket,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ActionRow } from "@/components/shared/action-row";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { StatCard } from "@/components/shared/stat-card";
import { SectionCard } from "@/components/shared/section-card";
import { ChartFigure } from "@/components/shared/chart-card";
import { EmptyState } from "@/components/shared/empty-state";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { ResetButton } from "@/components/shared/reset-button";
import { useAnnounce } from "@/components/a11y/live-announcer";
import {
  ExampleNotice,
  LoadExampleButton,
  hasExampleItems,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { useReturnFocus } from "@/hooks/use-return-focus";
import { generateDoraPrompts } from "@/lib/ai-prompts/dora-scorecard";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  KANBAN_BOARD_ID,
  type DoraDerivedFrom,
  type DoraSample,
} from "@/lib/stores/workspace-types";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { DORA_ACTIONS } from "@/lib/history/event-actions";
import { todayIso } from "@/lib/sprints/series";
import { removeWithUndo, undoable } from "@/lib/utils/undoable";
import { RELEASE_DOC_ID } from "@/lib/releases/gates";
import { cardItems, storyItems } from "@/lib/flow";
import { currentQuarterIndex, dashQuarter, quarterIndex } from "@/lib/roadmap/quarters";
import {
  DORA_BANDS,
  DORA_BAND_ORDER,
  DORA_METRICS,
  DORA_METRIC_LABEL,
  bandRanges,
  bandsCitation,
  doraBand,
  formatMetric,
  type DoraBand,
  type DoraMetric,
} from "@/lib/dora/bands";
import {
  DORA_DOC_ID,
  latestSample,
  sampleFor,
  sortSamples,
  usableSamples,
} from "@/lib/dora/samples";
import { INCIDENT_DOC_ID, deriveDoraSample } from "@/lib/dora/derive";
import { doraVerdict } from "@/lib/dora/verdict";
import { metricTrendText, type DoraTrendRow } from "./chart-text";
import { analyseDora } from "./analysis";
import { DoraAdvanced } from "./advanced";
import { buildExample } from "./example";
import { newSample, applyValues, type DoraValues } from "./form";
import { LogForm } from "./log-form";
import { BAND_TEXT, SampleRow } from "./sample-row";
import { toMarkdown } from "./markdown";

export const TOOL_ID = "dora-scorecard";

// Recharts loads with the charts, not the page; the figure reserves the space.
const MetricTrendChart = dynamic(() => import("./charts").then((m) => m.MetricTrendChart), {
  ssr: false,
});

const NO_SAMPLES: DoraSample[] = [];

const ICON: Record<DoraMetric, LucideIcon> = {
  deployFreqPerWeek: Rocket,
  leadTimeHours: Clock,
  changeFailRate: AlertTriangle,
  mttrHours: Wrench,
};

const TONE: Record<DoraBand, "success" | "default" | "warning" | "danger"> = {
  Elite: "success",
  High: "default",
  Medium: "warning",
  Low: "danger",
};

/** Charts need two quarters to show a direction. */
const CHART_MIN_QUARTERS = 2;

type SampleUpdate = (fn: (list: readonly DoraSample[]) => DoraSample[]) => void;

/** Writes the scorecard document the agent's tool.dora_scorecard reads too. */
const writeStore: SampleUpdate = (fn) => {
  const { doraScorecards, upsertDoraScorecard } = useWorkspaceStore.getState();
  const cur = (doraScorecards ?? []).find((d) => d.id === DORA_DOC_ID);
  const list = Array.isArray(cur?.samples) ? cur.samples : [];
  upsertDoraScorecard({ ...(cur ?? {}), id: DORA_DOC_ID, samples: fn(list) });
};

/** The latest quarter, up to this one, that has no sample yet. */
function nextQuarterToLog(samples: readonly DoraSample[], now: Date): string {
  const current = currentQuarterIndex(now);
  for (let i = current; i > current - 40; i--) {
    const q = dashQuarter(i);
    if (!sampleFor(samples, q)) return q;
  }
  return dashQuarter(current);
}

const trendRow = (s: DoraSample): DoraTrendRow => ({
  quarter: s.quarter,
  deployFreqPerWeek: s.deployFreqPerWeek,
  leadTimeHours: s.leadTimeHours,
  changeFailRatePct: s.changeFailRate * 100,
  mttrHours: s.mttrHours,
});

/**
 * DORA Scorecard: one sample per quarter of the four DORA metrics, banded
 * by the 2023 Accelerate State of DevOps Report's clusters (lib/dora/bands),
 * typed or filled from the team's releases, boards and incidents, edited in
 * place and deleted with Undo. Charts per metric, each in its own unit; the
 * trend tests and control limits wait for enough quarters, collapsed.
 */
export function DoraScorecardClient() {
  const hydrated = useWorkspaceHydrated();
  const doc = useWorkspaceStore((s) => (s.doraScorecards ?? []).find((d) => d.id === DORA_DOC_ID));
  const releases = useWorkspaceStore((s) =>
    (s.releaseReadinesses ?? []).find((d) => d.id === RELEASE_DOC_ID)
  );
  const stories = useWorkspaceStore((s) => s.stories);
  const flowBoard = useWorkspaceStore((s) =>
    (s.kanbanBoards ?? []).find((b) => b.id === KANBAN_BOARD_ID)
  );
  const incidents = useWorkspaceStore((s) =>
    (s.incidentCommanders ?? []).find((d) => d.id === INCIDENT_DOC_ID)
  );
  const { log } = useHistoryLogger(TOOL_ID);
  const announce = useAnnounce();
  const { refFor, returnTo } = useReturnFocus();
  const [now] = useState(() => new Date());
  const today = todayIso(now);
  // The example lives here only: nothing in it reaches the workspace.
  const [example, setExample] = useState<DoraSample[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Bumped after a save so the form starts again on the next quarter to log.
  const [formKey, setFormKey] = useState(0);
  const preview = example !== null;

  const stored = useMemo(() => usableSamples(doc, { includeExamples: true }), [doc]);
  const samples = example ?? stored ?? NO_SAMPLES;
  const sorted = useMemo(() => sortSamples(samples), [samples]);
  const newestFirst = useMemo(() => [...sorted].reverse(), [sorted]);
  const latest = latestSample(samples);
  const verdict = doraVerdict(samples);
  const rows = useMemo(
    () => sorted.filter((s) => quarterIndex(s.quarter) !== 0).map(trendRow),
    [sorted]
  );
  const analysis = useMemo(() => analyseDora(rows), [rows]);
  const markdown = useMemo(() => toMarkdown(samples), [samples]);
  const storedExamples = !preview && hasExampleItems(stored);

  const update: SampleUpdate = preview
    ? (fn) => setExample((ex) => (ex ? fn(ex) : ex))
    : writeStore;
  // The example's edits aren't the team's history, so they aren't logged.
  const record: typeof log = preview ? () => undefined : log;

  const derive = (quarter: string) =>
    deriveDoraSample({
      quarter,
      releases,
      items: [...storyItems(stories ?? []), ...cardItems(flowBoard?.cards ?? [])],
      incidents,
      today,
    });

  /* ── Changes ──────────────────────────────────────────────────────── */

  const add = (values: DoraValues, derived?: { quarter: string; derivedFrom: DoraDerivedFrom }) => {
    const sample = newSample(values, crypto.randomUUID(), derived);
    undoable({
      label: `Logged ${sample.quarter}`,
      apply: () => {
        update((list) => [...list, sample]);
        record(
          sample.source === "derived" ? DORA_ACTIONS.SAMPLE_DERIVED : DORA_ACTIONS.SAMPLE_LOGGED,
          {
            sampleId: sample.id,
            quarter: sample.quarter,
            deployFreqPerWeek: sample.deployFreqPerWeek,
            leadTimeHours: sample.leadTimeHours,
            changeFailRate: sample.changeFailRate,
            mttrHours: sample.mttrHours,
            ...(sample.derivedFrom ? { derivedFrom: sample.derivedFrom } : {}),
          }
        );
      },
      revert: () => update((list) => list.filter((s) => s.id !== sample.id)),
    });
    setFormKey((k) => k + 1);
    announce(`Logged ${sample.quarter}`);
  };

  const startEdit = (s: DoraSample) => setEditingId(s.id);

  const saveEdit = (s: DoraSample, values: DoraValues) => {
    const next = applyValues(s, values, new Date().toISOString());
    if (next !== s) {
      update((list) => list.map((x) => (x.id === s.id ? next : x)));
      record(DORA_ACTIONS.SAMPLE_UPDATED, { sampleId: s.id, quarter: next.quarter });
      announce(`Saved ${next.quarter}`);
    }
    setEditingId(null);
    returnTo(`edit:${s.id}`);
  };

  const cancelEdit = (s: DoraSample) => {
    setEditingId(null);
    returnTo(`edit:${s.id}`);
  };

  const remove = (s: DoraSample) => {
    // Focus moves to the next row on screen (or the one before) as this one goes.
    const at = newestFirst.findIndex((x) => x.id === s.id);
    const neighbour = newestFirst[at + 1] ?? newestFirst[at - 1];
    if (editingId === s.id) setEditingId(null);
    removeWithUndo<DoraSample>({
      label: `Deleted the ${s.quarter || "undated"} sample`,
      update,
      match: (x) => x.id === s.id,
    });
    record(DORA_ACTIONS.SAMPLE_REMOVED, { sampleId: s.id, quarter: s.quarter });
    if (neighbour) returnTo(`delete:${neighbour.id}`);
    announce(`Deleted the ${s.quarter || "undated"} sample`);
  };

  // Captured when the reset runs (a ref: the Undo toast keeps the closure of
  // the render the dialog opened in), so Undo puts back exactly what went.
  const cleared = useRef<{ samples: DoraSample[]; update: SampleUpdate } | null>(null);
  const clearAll = () => {
    const before = [...samples];
    cleared.current = { samples: before, update };
    setEditingId(null);
    update((list) => list.filter((s) => !before.some((b) => b.id === s.id)));
    record(DORA_ACTIONS.DORA_RESET, { samples: before.length });
    announce(`Cleared ${before.length === 1 ? "1 sample" : `${before.length} samples`}`);
  };
  const undoClear = () => {
    const c = cleared.current;
    if (!c) return;
    // Back where it was cleared from, keeping any sample logged since.
    c.update((list) => [...c.samples.filter((b) => !list.some((s) => s.id === b.id)), ...list]);
    cleared.current = null;
  };

  const loadExample = () => {
    setExample(buildExample(now));
    setEditingId(null);
  };
  const clearExample = () => {
    if (preview) setExample(null);
    else writeStore((list) => list.filter((s) => !isExampleId(s.id)));
    setEditingId(null);
  };

  const promptConfig = useMemo(
    () => ({ toolName: "DORA Scorecard", prompts: generateDoraPrompts({ samples: sorted }) }),
    [sorted]
  );

  if (!hydrated) {
    return (
      <ToolPageWrapper
        toolId={TOOL_ID}
        title="DORA Scorecard"
        description="The four DORA metrics quarter by quarter, banded by the 2023 State of DevOps Report."
        category="Engineering Excellence"
      >
        <p
          role="status"
          className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-sub"
        >
          Loading the scorecard…
        </p>
      </ToolPageWrapper>
    );
  }

  return (
    <ToolPageWrapper
      toolId={TOOL_ID}
      title="DORA Scorecard"
      description="The four DORA metrics quarter by quarter, typed or filled from your releases, boards and incidents, banded by the 2023 State of DevOps Report."
      category="Engineering Excellence"
    >
      {(preview || storedExamples) && (
        <div>
          <ExampleNotice onClear={clearExample} />
          {preview && (
            <p className="-mt-2 mb-4 text-xs text-sub">
              Example: six quarters of a team moving to trunk-based delivery. Nothing in it is
              saved; your own scorecard stays as it is.
            </p>
          )}
        </div>
      )}

      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="dora-scorecard"
          markdown={markdown}
          clipboardText={markdown}
          csvData={{
            headers: [
              "Quarter",
              "Deploys a week",
              "Lead time (h)",
              "Change failure rate",
              "Time to restore (h)",
              "Source",
              "Description",
            ],
            rows: sorted.map((s) => [
              s.quarter,
              s.deployFreqPerWeek,
              s.leadTimeHours,
              s.changeFailRate,
              s.mttrHours,
              s.source ?? "manual",
              s.description ?? "",
            ]),
          }}
          jsonData={{ samples: sorted }}
        />
      </ActionRow>

      {latest ? (
        <section aria-labelledby="dora-latest" className="space-y-2">
          <p id="dora-latest" className="text-sm font-medium text-text" aria-live="polite">
            {verdict}
          </p>
          <KpiGrid cols={4} gap="lg">
            {DORA_METRICS.map((m) => {
              const band = doraBand(m, latest[m]);
              return (
                <StatCard
                  key={m}
                  variant="compact"
                  icon={ICON[m]}
                  label={DORA_METRIC_LABEL[m]}
                  value={formatMetric(m, latest[m])}
                  hint={band ? `${band} · ${latest.quarter}` : latest.quarter}
                  tone={band ? TONE[band] : "default"}
                />
              );
            })}
          </KpiGrid>
          <BandsNote />
        </section>
      ) : (
        <EmptyState
          icon={Gauge}
          action={!preview ? <LoadExampleButton onLoad={loadExample} /> : undefined}
        >
          No quarters logged yet. Log the last quarter below: type the four numbers, or fill them
          from your releases (Release Readiness), your Sprint and Flow boards and your incidents.
        </EmptyState>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <SectionCard title="Log a quarter" icon={Plus} titleSize="lg">
          <LogForm
            key={formKey}
            samples={samples}
            defaultQuarter={nextQuarterToLog(samples, now)}
            now={now}
            today={today}
            derive={derive}
            onAdd={add}
            onEdit={startEdit}
          />
        </SectionCard>

        <SectionCard title="Trend across quarters" icon={BarChart3} titleSize="lg">
          {rows.length >= CHART_MIN_QUARTERS ? (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              {DORA_METRICS.map((m) => {
                const text = metricTrendText(m, rows);
                return (
                  <div key={m}>
                    <h3 className="mb-1 text-sm font-semibold text-text">{DORA_METRIC_LABEL[m]}</h3>
                    <ChartFigure
                      label={`${DORA_METRIC_LABEL[m]} by quarter`}
                      summary={text.summary}
                      table={text.table}
                      plotClassName="h-[180px]"
                    >
                      <MetricTrendChart metric={m} data={rows} />
                    </ChartFigure>
                  </div>
                );
              })}
            </div>
          ) : (
            <NotEnoughData
              have={rows.length}
              need={CHART_MIN_QUARTERS}
              unit={["quarter", "quarters"]}
              action="Log"
              what="each metric's trend"
            />
          )}
        </SectionCard>
      </div>

      {newestFirst.length > 0 && (
        <SectionCard
          title="Quarters"
          titleSize="lg"
          className="mt-6"
          actions={
            <ResetButton
              label="Clear all samples"
              title="Clear every quarter from the scorecard?"
              description={`All ${samples.length === 1 ? "1 sample" : `${samples.length} samples`} go, with their notes.`}
              confirmLabel="Clear samples"
              doneLabel="Cleared the scorecard"
              onReset={clearAll}
              onUndo={undoClear}
            />
          }
        >
          <ul className="space-y-2" aria-label="Quarters, newest first">
            {newestFirst.map((s) => (
              <SampleRow
                key={s.id}
                sample={s}
                samples={samples}
                editing={editingId === s.id}
                now={now}
                today={today}
                refFor={refFor}
                onEdit={startEdit}
                onSave={saveEdit}
                onCancel={cancelEdit}
                onDelete={remove}
              />
            ))}
          </ul>
        </SectionCard>
      )}

      {rows.length > 0 && (
        <div className="mt-6">
          <DoraAdvanced analysis={analysis} />
        </div>
      )}
    </ToolPageWrapper>
  );
}

/** Whose bands these are, and each band's range, behind a disclosure. */
function BandsNote() {
  return (
    <details className="group rounded-lg border border-border bg-card px-3 py-2 text-xs text-sub">
      <summary className="cursor-pointer select-none text-sub">
        Bands: {bandsCitation()}. How they&apos;re set
      </summary>
      <div className="scroll-x-snap relative mt-2">
        <table className="w-full min-w-[520px] text-left">
          <caption className="sr-only">
            DORA bands by metric, {DORA_BANDS.report} {DORA_BANDS.year}
          </caption>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="py-1 pr-3 font-medium">
                Band
              </th>
              {DORA_METRICS.map((m) => (
                <th key={m} scope="col" className="py-1 pr-3 font-medium">
                  {DORA_METRIC_LABEL[m]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DORA_BAND_ORDER.map((band, i) => (
              <tr key={band} className="border-b border-border last:border-0">
                <th scope="row" className={`py-1 pr-3 font-medium ${BAND_TEXT[band]}`}>
                  {band}
                </th>
                {DORA_METRICS.map((m) => {
                  const r = bandRanges(m)[i];
                  return (
                    <td key={m} className="py-1 pr-3 text-text">
                      {r.range}
                      <span className="block text-sub">report: {r.cluster}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2">{DORA_BANDS.note}</p>
    </details>
  );
}
