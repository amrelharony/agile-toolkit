"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { nanoid } from "nanoid";
import { Plus, ShieldAlert, TrendingUp } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AdvancedAnalysis } from "@/components/shared/advanced-analysis";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ChartFigure } from "@/components/shared/chart-card";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { ResortChip } from "@/components/shared/resort-chip";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import {
  ExampleNotice,
  LoadExampleButton,
  hasExampleItems,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { Button } from "@/components/ui/button";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { useStableOrder } from "@/hooks/use-stable-order";
import { generateRiskRegisterPrompts } from "@/lib/ai-prompts/risk-register";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { getHandoffRoute } from "@/lib/handoffs/registry";
import { sendHandoff } from "@/lib/handoffs/send";
import type { HandoffLink } from "@/lib/handoffs/types";
import { RISK_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import type { RiskRegisterConflict } from "@/lib/risks/legacy-register";
import {
  RISK_STATUS_LABEL,
  compareRisks,
  impedimentLinkOf,
  riskImpedimentSource,
  riskLevel,
  riskSummary,
  riskVerdict,
} from "@/lib/risks/model";
import {
  currentRisks,
  patchRisk,
  removeRiskRecord,
  restoreRiskRecord,
  saveRisk,
  saveRisks,
  type RiskRecordSnapshot,
} from "@/lib/risks/store";
import { emit as sonify } from "@/lib/sonification/emit";
import { todayIso } from "@/lib/sprints/series";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Risk } from "@/lib/stores/workspace-types";
import { findRosterMember } from "@/lib/team/names";
import { useTeamRoster, useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { undoable } from "@/lib/utils/undoable";
import {
  CHART_MIN_WEEKS,
  analyseRisks,
  closedUndatedCount,
  countedRisks,
  daysText,
  exportedRisks,
  riskMatrix,
  timeToClose,
  undatedClosedNote,
  weekName,
  weeklyChartText,
  weeklyRiskSeries,
  type MatrixView,
} from "./analysis";
import { AppearedNotice, ConflictNotice, withBlobValue } from "./conflict-notice";
import { buildExample } from "./example";
import { residualText, toMarkdown, type ImpedimentState } from "./markdown";
import { RiskForm, newRisk, type NewRisk } from "./risk-form";
import { RiskRow, type RaisedImpediment } from "./risk-row";
import { LEVEL_TONE } from "./scales";
import { useLegacyRisks } from "./use-legacy-risks";
import { risksCsv, withPatch, withStatus, type RiskPatch } from "./view";

export const TOOL_ID = "risk-register";

// Recharts loads with the chart, not the page; the fixed-height box
// reserves the space while it does.
const OpenRisksChart = dynamic(() => import("./charts").then((m) => m.OpenRisksChart), {
  ssr: false,
});

const keyOf = (r: Risk) => r.id;

/** A name short enough for a one-line toast. */
function shortName(name: string, max = 40): string {
  const t = name.trim() || "Untitled risk";
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Focus the title of the risk with `id` (or `fallback`) once React has re-rendered. */
function focusSoon(id: string | null, fallback?: HTMLElement | null) {
  requestAnimationFrame(() => {
    const el = id
      ? Array.from(document.querySelectorAll<HTMLElement>("[data-risk-title]")).find(
          (b) => b.getAttribute("data-risk-title") === id
        )
      : undefined;
    (el ?? fallback)?.focus();
  });
}

/** A risk's links after `update`, the list dropped when it empties. */
function withLinks(
  r: Risk,
  update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]
): Risk {
  const links = update(r.sentTo);
  return links.length > 0 ? { ...r, sentTo: links } : withPatch(r, { sentTo: undefined });
}

const MATRIX_VIEWS = [
  { value: "now" as const, label: "Now" },
  { value: "after" as const, label: "After mitigation" },
];

/**
 * The Risk Register: one store, workspace.risks, which agents, the
 * premortem's hand-off, the dashboards and the next steps read. Risks are
 * added through a form that saves nothing until the risk is named and
 * rated, edited in place, kept in a stable order while edited (Re-sort
 * catches up), owned by someone on the roster, flagged when their
 * mitigation is overdue, rated again for after the mitigation, raised as
 * an impediment once they happen, and deleted with Undo. The old page's
 * own storage moves in once (useLegacyRisks).
 */
export function RiskRegisterClient() {
  const hydrated = useWorkspaceHydrated();
  const { records, pending, conflicts, settleConflict, appeared, dismissAppeared } =
    useLegacyRisks();
  // Read so a resolved impediment re-renders the row's "Close the risk".
  const impediments = useWorkspaceStore((s) => s.impediments);
  const roster = useTeamRoster();
  const { log } = useHistoryLogger(TOOL_ID);
  const announce = useAnnounce();
  const [today] = useState(() => todayIso());
  const [formOpen, setFormOpen] = useState(false);
  const [view, setView] = useState<MatrixView>("now");
  const newRef = useRef<HTMLButtonElement>(null);

  const counted = useMemo(() => countedRisks(records), [records]);
  // The rows the move found only in the workspace, as they read now (one
  // deleted since drops out of the notice).
  const appearedRisks = useMemo(
    () => records.filter((r) => appeared.includes(r.id)),
    [records, appeared]
  );
  const showsExampleOnly = records.length > 0 && records.every((r) => isExampleId(r.id));
  const mixedExample = hasExampleItems(records) && !showsExampleOnly;
  const summary = useMemo(() => riskSummary(counted, today), [counted, today]);
  const verdict = useMemo(() => riskVerdict(counted, today), [counted, today]);
  const ttc = useMemo(() => timeToClose(counted, today), [counted, today]);
  const weeks = useMemo(() => weeklyRiskSeries(counted, today), [counted, today]);
  // Closed risks with no close day: left out of the chart's "open" and the
  // time to mitigate, and named so the team can date them.
  const undated = useMemo(() => closedUndatedCount(counted), [counted]);
  const chart = useMemo(() => weeklyChartText(weeks, undated), [weeks, undated]);
  const analysis = useMemo(() => analyseRisks(weeks), [weeks]);
  const matrix = useMemo(() => riskMatrix(counted, view), [counted, view]);

  // Active first, then score, then days overdue. An edit doesn't move a
  // row out from under the cursor; "Re-sort" catches the order up.
  const { ordered, isStale, resort } = useStableOrder(records, keyOf, (a, b) =>
    compareRisks(a, b, today)
  );

  const impedimentOf = useCallback(
    (r: Risk): RaisedImpediment | null => {
      const link = impedimentLinkOf(r);
      const route = getHandoffRoute("impediment");
      if (!link || !route.exists(link.targetId)) return null;
      return { id: link.targetId, resolved: route.isDone?.(link.targetId) ?? false };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the route reads this slice
    [impediments]
  );
  const impedimentState = useCallback(
    (r: Risk): ImpedimentState => {
      const imp = impedimentOf(r);
      return imp ? (imp.resolved ? "resolved" : "raised") : null;
    },
    [impedimentOf]
  );

  const markdown = useMemo(
    () => toMarkdown(records, new Date(), { verdict, impediment: impedimentState }),
    [records, verdict, impedimentState]
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "Risk Register",
      prompts: generateRiskRegisterPrompts({
        risks: counted,
        today,
        medianTTM: ttc.medianDays,
        closed: ttc.closed,
      }),
    }),
    [counted, today, ttc.medianDays, ttc.closed]
  );

  /* ── Changes ──────────────────────────────────────────────────────── */

  // Example risks aren't the team's history.
  const record = (r: Pick<Risk, "id">, action: string, payload: Record<string, unknown>) => {
    if (!isExampleId(r.id)) log(action, payload);
  };

  const add = (values: NewRisk) => {
    const risk = saveRisk(newRisk(values, `risk_${nanoid(8)}`));
    sonify(TOOL_ID, "risk-added");
    record(risk, RISK_ACTIONS.RISK_ADDED, { riskId: risk.id, title: risk.title });
    announce(`Added “${risk.title}”`);
  };

  const edit = (r: Risk, patch: RiskPatch, field: string) => {
    // The owner keeps the roster's spelling, as the agent's set_owner stores it.
    const owner = patch.owner?.trim();
    const fixed: RiskPatch =
      field === "owner"
        ? { owner: owner ? (findRosterMember(roster, owner)?.name ?? owner) : undefined }
        : patch;
    if (patchRisk(r.id, (x) => withPatch(x, fixed))) {
      record(r, RISK_ACTIONS.RISK_UPDATED, { riskId: r.id, fields: [field] });
    }
  };

  const setStatus = (r: Risk, status: Risk["status"]) => {
    const prev = currentRisks().find((x) => x.id === r.id);
    if (!prev || prev.status === status) return;
    const next = withStatus(prev, status, today);
    const label =
      status === "closed"
        ? `Closed “${shortName(r.title)}”`
        : `Moved “${shortName(r.title)}” to ${RISK_STATUS_LABEL[status].toLowerCase()}`;
    undoable({
      label,
      apply: () => {
        saveRisk(next);
        record(r, RISK_ACTIONS.RISK_UPDATED, {
          riskId: r.id,
          fields: ["status"],
          from: prev.status,
          to: status,
        });
      },
      revert: () => {
        saveRisk(prev);
      },
    });
    announce(label);
  };

  const raise = (r: Risk) => {
    const link = sendHandoff("impediment", riskImpedimentSource(r), {
      getLinks: () => currentRisks().find((x) => x.id === r.id)?.sentTo,
      setLinks: (update) => {
        patchRisk(r.id, (x) => withLinks(x, update));
      },
    });
    if (!link) return;
    record(r, RISK_ACTIONS.RISK_ESCALATED, { riskId: r.id, impedimentId: link.targetId });
    announce(`Raised “${shortName(r.title)}” as an impediment`);
  };

  const remove = (r: Risk) => {
    let snapshot: RiskRecordSnapshot | null = null;
    // Focus moves to the next risk on screen (or the one before) as this one goes.
    const at = ordered.findIndex((x) => x.id === r.id);
    const neighbour = ordered[at + 1] ?? ordered[at - 1];
    undoable({
      label: `Deleted “${shortName(r.title)}”`,
      apply: () => {
        snapshot = removeRiskRecord(r.id);
        record(r, RISK_ACTIONS.RISK_REMOVED, { riskId: r.id, title: r.title });
      },
      revert: () => {
        if (snapshot) restoreRiskRecord(snapshot);
        focusSoon(r.id);
      },
    });
    focusSoon(neighbour?.id ?? null, newRef.current);
    announce(`Deleted “${shortName(r.title)}”`);
  };

  const takeOldValue = (c: RiskRegisterConflict) => {
    const prev = currentRisks().find((x) => x.id === c.id);
    settleConflict(c);
    if (!prev) return;
    const label = `Used the old page's value on “${shortName(prev.title)}”`;
    undoable({
      label,
      apply: () => {
        saveRisk(withBlobValue(prev, c));
      },
      revert: () => {
        saveRisk(prev);
      },
    });
    announce(label);
  };

  // Loading is offered only on an empty register. Neither is logged: the
  // example isn't the team's work. The example's ids start with
  // "example-", so agents, next steps and the dashboards leave them out.
  const loadExample = () => {
    saveRisks(buildExample());
    setFormOpen(false);
  };
  const clearExample = () => {
    const ids = currentRisks()
      .filter((r) => isExampleId(r.id))
      .map((r) => r.id);
    let snapshots: RiskRecordSnapshot[] = [];
    undoable({
      label: "Cleared the example",
      apply: () => {
        snapshots = ids.map(removeRiskRecord);
      },
      revert: () => snapshots.forEach(restoreRiskRecord),
    });
    // The notice (and its button) goes with the example.
    focusSoon(null, newRef.current);
  };
  const dismissAppearedNotice = () => {
    dismissAppeared();
    focusSoon(null, newRef.current);
  };

  const newButton = () => (
    <Button
      ref={newRef}
      type="button"
      size="sm"
      className="gap-1"
      aria-expanded={formOpen}
      onClick={() => setFormOpen((o) => !o)}
    >
      <Plus className="h-4 w-4" aria-hidden="true" />
      New risk
    </Button>
  );

  const csv = risksCsv(records, today, impedimentState);
  // The JSON lists what the Markdown and the CSV list: the team's own risks
  // while there are any, never the example's mixed in with them.
  const json = useMemo(() => exportedRisks(records), [records]);
  const active = summary.active;

  return (
    <ToolPageWrapper
      toolId={TOOL_ID}
      title="Risk Register"
      description="Track risks on a 5×5 likelihood × impact matrix: who owns each, the plan and when it's due, the rating after mitigation, and raise one as an impediment once it happens."
      category="Risk & Governance"
    >
      {!hydrated ? (
        <p
          role="status"
          className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-sub"
        >
          Loading risks…
        </p>
      ) : (
        <div className="space-y-4">
          {hasExampleItems(records) && (
            <div>
              <ExampleNotice onClear={clearExample} />
              <p className="-mt-2 text-xs text-sub">
                {mixedExample
                  ? "The example's risks are listed but not counted while you have your own."
                  : "Example: a checkout team's register five weeks before a holiday release. Its people aren't added to your team, and it isn't raised anywhere."}
              </p>
            </div>
          )}

          <ConflictNotice
            conflicts={conflicts}
            records={records}
            onKeep={settleConflict}
            onUseOld={takeOldValue}
            afterLast={() => newRef.current}
          />
          <AppearedNotice risks={appearedRisks} onDismiss={dismissAppearedNotice} />

          {pending && (
            <p role="status" className="text-xs text-sub">
              Some risks from the old Risk Register page are still moving in; they&apos;re listed as
              they&apos;ll read once moved.
            </p>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2">
            {records.length > 0 && (
              <>
                <AiPromptGenerator config={promptConfig} />
                <ExportButton
                  filename="risk-register"
                  csvData={csv}
                  jsonData={json}
                  markdown={markdown}
                  clipboardText={markdown}
                />
              </>
            )}
            {newButton()}
          </div>

          {formOpen && (
            <SectionCard title="New risk" icon={Plus}>
              <RiskForm
                today={today}
                roster={roster}
                typicalDays={ttc.medianDays}
                onSave={add}
                onCancel={() => {
                  setFormOpen(false);
                  newRef.current?.focus();
                }}
              />
            </SectionCard>
          )}

          {records.length === 0 ? (
            !formOpen && (
              <EmptyState
                icon={ShieldAlert}
                action={
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    <LoadExampleButton onLoad={loadExample} />
                  </div>
                }
              >
                No risks logged yet. Use &ldquo;New risk&rdquo; for anything that could knock the
                sprint or the release off course, or load an example to see a register filled in.
                Causes sent from a Premortem land here too.
              </EmptyState>
            )
          ) : (
            <>
              <p className="text-sm font-medium text-text">{verdict}</p>

              <KpiGrid cols={[2, 3, 3]} marginBottom="none">
                <StatCard
                  variant="compact"
                  label="Active"
                  value={active}
                  hint={`${summary.byStatus.open} open, ${summary.byStatus.mitigating} mitigating`}
                />
                <StatCard
                  variant="compact"
                  label="High or critical"
                  value={summary.high}
                  tone={summary.high > 0 ? "warning" : "default"}
                />
                <StatCard
                  variant="compact"
                  label="Overdue"
                  value={summary.overdue}
                  tone={summary.overdue > 0 ? "danger" : "default"}
                  hint="Active, mitigation past due"
                />
                <StatCard
                  variant="compact"
                  label="No owner"
                  value={summary.unowned}
                  hint="Active risks"
                />
                <StatCard
                  variant="compact"
                  label="Exposure"
                  value={active > 0 ? summary.exposure : "—"}
                  hint={active > 0 ? residualText(summary) : "No active risks"}
                />
                <StatCard
                  variant="compact"
                  label="Median time to mitigate"
                  value={daysText(ttc.medianDays)}
                  hint={
                    ttc.closed < MIN_SAMPLE.average
                      ? `Shows once ${MIN_SAMPLE.average} are closed (${ttc.closed} so far)`
                      : ttc.medianDays === null
                        ? "Fewer than half have closed yet"
                        : `Over ${ttc.closed} closed`
                  }
                />
              </KpiGrid>

              <SectionCard
                title="Likelihood × impact"
                icon={ShieldAlert}
                actions={
                  <ToggleGroup
                    label="Matrix shows"
                    size="sm"
                    options={MATRIX_VIEWS}
                    value={view}
                    onValueChange={setView}
                  />
                }
              >
                <RiskMatrix grid={matrix.grid} />
                <p className="mt-2 text-xs text-sub">
                  {view === "now"
                    ? `${matrix.placed} active ${matrix.placed === 1 ? "risk" : "risks"} by their current rating. Closed and accepted risks are left out.`
                    : `${matrix.placed} active ${matrix.placed === 1 ? "risk" : "risks"} by their rating after mitigation${
                        matrix.unassessed > 0
                          ? `; ${matrix.unassessed} not assessed ${matrix.unassessed === 1 ? "isn't" : "aren't"} shown`
                          : ""
                      }.`}
                </p>
              </SectionCard>

              <ResortChip isStale={isStale} onResort={resort} what="Ratings or statuses" />
              <ul className="space-y-2" aria-label="Risks, active first">
                {ordered.map((r) => (
                  <RiskRow
                    key={r.id}
                    risk={r}
                    today={today}
                    example={isExampleId(r.id)}
                    impediment={impedimentOf(r)}
                    onEdit={edit}
                    onStatus={setStatus}
                    onClosedOn={(risk, day) => edit(risk, { resolvedAt: day }, "resolvedAt")}
                    onRaise={raise}
                    onDelete={remove}
                  />
                ))}
              </ul>

              <SectionCard title="Open risks over time" icon={TrendingUp}>
                {weeks.length >= CHART_MIN_WEEKS ? (
                  <ChartFigure
                    label="Open risks over time"
                    summary={chart.summary}
                    table={chart.table}
                    caption="Risks per week"
                    plotClassName="h-[240px]"
                  >
                    <OpenRisksChart
                      data={weeks.map((w) => ({
                        week: weekName(w),
                        raised: w.raised,
                        open: w.open,
                      }))}
                    />
                  </ChartFigure>
                ) : (
                  <>
                    <NotEnoughData
                      have={weeks.length}
                      need={CHART_MIN_WEEKS}
                      unit={["week", "weeks"]}
                      action="Keep the register for"
                      what="the open risks week by week"
                    />
                    {/* The chart's summary says it once the chart shows. */}
                    {undated > 0 && (
                      <p className="mt-2 text-xs text-sub">{undatedClosedNote(undated)}</p>
                    )}
                  </>
                )}
              </SectionCard>

              <AdvancedAnalysis summary="Advanced analysis: trend, forecast and shifts">
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-text">Risks raised per week</h3>
                  {analysis.trend ? (
                    <p className="text-sm text-text">{analysis.trend}</p>
                  ) : (
                    <NotEnoughData
                      have={analysis.weeks}
                      need="trend"
                      unit={["week", "weeks"]}
                      action="Keep the register for"
                      what="a trend test"
                    />
                  )}
                </section>
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-text">Open risks ahead</h3>
                  {analysis.forecast ? (
                    <p className="text-sm text-text">{analysis.forecast}</p>
                  ) : (
                    <NotEnoughData
                      have={analysis.weeks}
                      need="forecast"
                      unit={["week", "weeks"]}
                      action="Keep the register for"
                      what="a forecast"
                    />
                  )}
                  {analysis.shifts ? (
                    <p className="text-sm text-text">{analysis.shifts}</p>
                  ) : (
                    <NotEnoughData
                      have={analysis.weeks}
                      need="changePoint"
                      unit={["week", "weeks"]}
                      action="Keep the register for"
                      what="change points"
                    />
                  )}
                </section>
                <p className="text-xs text-sub">
                  Counted over the last {weeks.length === 1 ? "week" : `${weeks.length} weeks`}. A
                  reopened risk counts as open again
                  {undated > 0 ? "; a closed risk with no close day isn't counted" : ""}.
                </p>
              </AdvancedAnalysis>
            </>
          )}
        </div>
      )}
    </ToolPageWrapper>
  );
}

const LIKELIHOODS = [5, 4, 3, 2, 1] as const;
const IMPACTS = [1, 2, 3, 4, 5] as const;

/**
 * The 5×5 matrix as a table: likelihood down (5 at the top), impact
 * across, each cell the number of active risks there, tinted by the
 * level its score falls in (theme tokens).
 */
function RiskMatrix({ grid }: { grid: number[][] }) {
  return (
    <div className="relative max-w-sm">
      <table className="w-full table-fixed border-separate border-spacing-1 text-xs">
        <caption className="sr-only">
          Active risks by likelihood (rows, 5 at the top) and impact (columns)
        </caption>
        <thead>
          <tr>
            <th scope="col" className="w-8">
              <span className="sr-only">Likelihood</span>
            </th>
            {IMPACTS.map((i) => (
              <th key={i} scope="col" className="text-center font-data font-normal text-sub">
                I{i}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {LIKELIHOODS.map((p) => (
            <tr key={p}>
              <th scope="row" className="pr-1 text-right font-data font-normal text-sub">
                P{p}
              </th>
              {IMPACTS.map((i) => {
                const count = grid[p - 1][i - 1];
                return (
                  <td
                    key={i}
                    className={`h-8 rounded border text-center font-data ${LEVEL_TONE[riskLevel(p * i)]}`}
                  >
                    {count > 0 ? count : <span className="sr-only">0</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
