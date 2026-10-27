"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { nanoid } from "nanoid";
import { Activity, Flame, Plus, Wrench } from "lucide-react";
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
import { useStableOrder } from "@/hooks/use-stable-order";
import { generateTechDebtPrompts } from "@/lib/ai-prompts/tech-debt";
import { fmt } from "@/lib/charts/chart-text";
import { sendHandoff } from "@/lib/handoffs/send";
import type { HandoffLink } from "@/lib/handoffs/types";
import { TECH_DEBT_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { normalizeCadence } from "@/lib/sprints/cadence";
import { todayIso } from "@/lib/sprints/series";
import { selectCadenceDoc } from "@/lib/sprints/use-ceremony-cadence";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Story, TechDebtItem } from "@/lib/stores/workspace-types";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import type { TechDebtConflict } from "@/lib/tech-debt/legacy";
import {
  debtComparator,
  debtStoryOf,
  debtSummary,
  debtVerdict,
  rankDebt,
  rankedDebt,
} from "@/lib/tech-debt/model";
import {
  currentTechDebt,
  patchDebt,
  removeTechDebtRecord,
  restoreTechDebtRecord,
  saveDebt,
  saveTechDebt,
  type TechDebtRecordSnapshot,
} from "@/lib/tech-debt/store";
import { undoable } from "@/lib/utils/undoable";
import { countedDebt, heatTone, hotspotGrid, survivalChartText, timeToResolve } from "./analysis";
import { AppearedNotice, ConflictNotice, withBlobValue } from "./conflict-notice";
import { DebtForm, newDebt, type NewDebt } from "./debt-form";
import { DebtRow, type BacklogStory } from "./debt-row";
import { buildExample } from "./example";
import { toMarkdown, type BacklogState } from "./markdown";
import { useLegacyDebt } from "./use-legacy-debt";
import { debtCsv, withPatch, type DebtPatch } from "./view";

export const TOOL_ID = "tech-debt";

// Recharts loads with the chart, not the page; the fixed-height box
// reserves the space while it does.
const ResolutionSurvivalChart = dynamic(
  () => import("./charts").then((m) => m.ResolutionSurvivalChart),
  { ssr: false }
);

const keyOf = (t: TechDebtItem) => t.id;
const NO_STORIES: Story[] = [];

/** A name short enough for a one-line toast. */
function shortName(name: string, max = 40): string {
  const t = name.trim() || "Untitled item";
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Focus the title of the item with `id` (or `fallback`) once React has re-rendered. */
function focusSoon(id: string | null, fallback?: HTMLElement | null) {
  requestAnimationFrame(() => {
    const el = id
      ? Array.from(document.querySelectorAll<HTMLElement>("[data-debt-title]")).find(
          (b) => b.getAttribute("data-debt-title") === id
        )
      : undefined;
    (el ?? fallback)?.focus();
  });
}

/** An item's links after `update`, the list dropped when it empties. */
function withLinks(
  t: TechDebtItem,
  update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]
): TechDebtItem {
  const links = update(t.sentTo);
  return links.length > 0 ? { ...t, sentTo: links } : withPatch(t, { sentTo: undefined });
}

const IMPACTS = [5, 4, 3, 2, 1] as const;
const EFFORTS = [1, 2, 3, 4, 5] as const;

/**
 * The Tech Debt tracker: one store, workspace.techDebt, which agents, the
 * anti-patterns, the predictor and the next steps read. Items are added
 * through a form that saves nothing until the debt is named and rated,
 * edited in place, kept in a stable order while edited (Re-sort catches
 * up), aged in sprints of the team's cadence, scored with the interest
 * term capped, put on the backlog as a story, resolved on a day (with
 * Undo), and deleted with Undo. The old page's own storage moves in once
 * (useLegacyDebt).
 */
export function TechDebtClient() {
  const hydrated = useWorkspaceHydrated();
  const { records, pending, conflicts, settleConflict, appeared, dismissAppeared } =
    useLegacyDebt();
  // Read so a backlog story finished on the board re-renders its row.
  const stories = useWorkspaceStore((s) => s.stories) ?? NO_STORIES;
  const cadence = useWorkspaceStore(selectCadenceDoc);
  const len = useMemo(() => normalizeCadence(cadence).sprintLengthDays, [cadence]);
  const { log } = useHistoryLogger(TOOL_ID);
  const announce = useAnnounce();
  const [today] = useState(() => todayIso());
  const [formOpen, setFormOpen] = useState(false);
  const newRef = useRef<HTMLButtonElement>(null);

  const counted = useMemo(() => countedDebt(records), [records]);
  const showsExampleOnly = records.length > 0 && records.every((t) => isExampleId(t.id));
  const mixedExample = hasExampleItems(records) && !showsExampleOnly;
  const summary = useMemo(
    () => debtSummary(counted, len, today, stories),
    [counted, len, today, stories]
  );
  const verdict = useMemo(() => debtVerdict(counted, len, today), [counted, len, today]);
  const hotspot = useMemo(() => hotspotGrid(counted), [counted]);
  const survival = useMemo(() => timeToResolve(counted, today), [counted, today]);
  const chart = useMemo(() => survivalChartText(survival), [survival]);

  // Open first, then score, then age. An edit doesn't move a row out from
  // under the cursor; "Re-sort" catches the order up.
  const comparator = useMemo(() => debtComparator(len, today), [len, today]);
  const { ordered, isStale, resort } = useStableOrder(records, keyOf, comparator);

  const storyOf = useCallback(
    (t: TechDebtItem): BacklogStory | null => {
      const s = debtStoryOf(t, stories);
      return s ? { id: s.storyId, done: s.done } : null;
    },
    [stories]
  );
  const backlogState = useCallback(
    (t: TechDebtItem): BacklogState => {
      const s = storyOf(t);
      return s ? (s.done ? "done" : "sent") : null;
    },
    [storyOf]
  );

  const markdown = useMemo(
    () =>
      toMarkdown(records, new Date(), { sprintLengthDays: len, verdict, backlog: backlogState }),
    [records, len, verdict, backlogState]
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "Technical Debt Tracker",
      prompts: generateTechDebtPrompts({
        items: rankedDebt(counted, len, today).map((r) => r.item),
        totalInterestPerSprint: summary.interestPerSprint,
      }),
    }),
    [counted, len, today, summary.interestPerSprint]
  );

  /* ── Changes ──────────────────────────────────────────────────────── */

  // Example items aren't the team's history.
  const record = (
    t: Pick<TechDebtItem, "id">,
    action: string,
    payload: Record<string, unknown>
  ) => {
    if (!isExampleId(t.id)) log(action, payload);
  };

  const add = (values: NewDebt) => {
    const item = saveDebt(newDebt(values, `td_${nanoid(8)}`));
    record(item, TECH_DEBT_ACTIONS.ITEM_ADDED, { itemId: item.id, title: item.title });
    announce(`Added “${item.title}”`);
  };

  const edit = (t: TechDebtItem, patch: DebtPatch, field: string) => {
    if (patchDebt(t.id, (x) => withPatch(x, patch))) {
      record(t, TECH_DEBT_ACTIONS.ITEM_UPDATED, { itemId: t.id, fields: [field] });
    }
  };

  const resolve = (t: TechDebtItem) => {
    const prev = currentTechDebt().find((x) => x.id === t.id);
    if (!prev || prev.resolvedAt) return;
    const label = `Resolved “${shortName(t.title)}”`;
    undoable({
      label,
      apply: () => {
        saveDebt({ ...prev, resolvedAt: today });
        record(t, TECH_DEBT_ACTIONS.ITEM_RESOLVED, { itemId: t.id, title: t.title });
      },
      revert: () => {
        saveDebt(prev);
      },
    });
    announce(label);
  };

  const reopen = (t: TechDebtItem) => {
    const prev = currentTechDebt().find((x) => x.id === t.id);
    if (!prev || !prev.resolvedAt) return;
    const label = `Reopened “${shortName(t.title)}”`;
    undoable({
      label,
      apply: () => {
        saveDebt(withPatch(prev, { resolvedAt: undefined }));
        record(t, TECH_DEBT_ACTIONS.ITEM_UPDATED, { itemId: t.id, fields: ["resolvedAt"] });
      },
      revert: () => {
        saveDebt(prev);
      },
    });
    announce(label);
  };

  const send = (t: TechDebtItem) => {
    // No points: effort 1–5 isn't story points, so the story lands
    // unestimated and Planning Poker's nudge picks it up.
    const link = sendHandoff(
      "backlog-story",
      { title: t.title, sourceRef: { tool: TOOL_ID, id: t.id } },
      {
        getLinks: () => currentTechDebt().find((x) => x.id === t.id)?.sentTo,
        setLinks: (update) => {
          patchDebt(t.id, (x) => withLinks(x, update));
        },
      }
    );
    if (!link) return;
    record(t, TECH_DEBT_ACTIONS.ITEM_SENT_TO_BACKLOG, { itemId: t.id, storyId: link.targetId });
    announce(`Put “${shortName(t.title)}” on the backlog`);
  };

  const remove = (t: TechDebtItem) => {
    let snapshot: TechDebtRecordSnapshot | null = null;
    // Focus moves to the next item on screen (or the one before) as this one goes.
    const at = ordered.findIndex((x) => x.id === t.id);
    const neighbour = ordered[at + 1] ?? ordered[at - 1];
    undoable({
      label: `Deleted “${shortName(t.title)}”`,
      apply: () => {
        snapshot = removeTechDebtRecord(t.id);
        record(t, TECH_DEBT_ACTIONS.ITEM_REMOVED, { itemId: t.id, title: t.title });
      },
      revert: () => {
        if (snapshot) restoreTechDebtRecord(snapshot);
        focusSoon(t.id);
      },
    });
    focusSoon(neighbour?.id ?? null, newRef.current);
    announce(`Deleted “${shortName(t.title)}”`);
  };

  const takeOldValue = (c: TechDebtConflict) => {
    const prev = currentTechDebt().find((x) => x.id === c.id);
    settleConflict(c);
    if (!prev) return;
    const label = `Used the old page's value on “${shortName(prev.title)}”`;
    undoable({
      label,
      apply: () => {
        saveDebt(withBlobValue(prev, c));
      },
      revert: () => {
        saveDebt(prev);
      },
    });
    announce(label);
  };

  // Loading is offered only on an empty tracker. Neither is logged: the
  // example isn't the team's work. Its ids start with "example-", so
  // agents, next steps and the anti-patterns leave them out.
  const loadExample = () => {
    saveTechDebt(buildExample());
    setFormOpen(false);
  };
  const clearExample = () => {
    const ids = currentTechDebt()
      .filter((t) => isExampleId(t.id))
      .map((t) => t.id);
    let snapshots: TechDebtRecordSnapshot[] = [];
    undoable({
      label: "Cleared the example",
      apply: () => {
        snapshots = ids.map(removeTechDebtRecord);
      },
      revert: () => snapshots.forEach(restoreTechDebtRecord),
    });
  };

  const csv = debtCsv(records, len, today, backlogState);
  const interestValue =
    summary.open === 0
      ? "—"
      : summary.unestimated === summary.open
        ? "—"
        : fmt(summary.interestPerSprint);
  const interestHint =
    summary.open === 0
      ? "No open debt"
      : summary.unestimated === summary.open
        ? "None estimated yet"
        : summary.unestimated > 0
          ? `Points a sprint; ${summary.unestimated} not estimated`
          : "Points a sprint, open debt";

  return (
    <ToolPageWrapper
      toolId={TOOL_ID}
      title="Technical Debt Tracker"
      description="Register tech debt with impact × effort and the interest it gains each sprint, rank it by a capped score, find the hotspots, and put the top items on the backlog."
      category="Risk & Governance"
    >
      {!hydrated ? (
        <p
          role="status"
          className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-sub"
        >
          Loading tech debt…
        </p>
      ) : (
        <div className="space-y-4">
          {hasExampleItems(records) && (
            <div>
              <ExampleNotice onClear={clearExample} />
              <p className="-mt-2 text-xs text-sub">
                {mixedExample
                  ? "The example's items are listed but not counted while you have your own."
                  : "Example: a payments team's debt with 14-day sprints. It isn't put on your backlog."}
              </p>
            </div>
          )}

          <ConflictNotice
            conflicts={conflicts}
            records={records}
            onKeep={settleConflict}
            onUseOld={takeOldValue}
          />
          <AppearedNotice count={appeared} onDismiss={dismissAppeared} />

          {pending && (
            <p role="status" className="text-xs text-sub">
              Some items from the old Tech Debt page are still moving in; they&apos;re listed as
              they&apos;ll read once moved.
            </p>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2">
            {records.length > 0 && (
              <>
                <AiPromptGenerator config={promptConfig} />
                <ExportButton
                  filename="tech-debt"
                  csvData={csv}
                  jsonData={records}
                  markdown={markdown}
                  clipboardText={markdown}
                />
              </>
            )}
            <Button
              ref={newRef}
              type="button"
              size="sm"
              className="gap-1"
              aria-expanded={formOpen}
              onClick={() => setFormOpen((o) => !o)}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              New debt
            </Button>
          </div>

          {formOpen && (
            <SectionCard title="New debt" icon={Plus}>
              <DebtForm
                today={today}
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
                icon={Wrench}
                action={
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    <LoadExampleButton onLoad={loadExample} />
                  </div>
                }
              >
                No debt logged yet. Use &ldquo;New debt&rdquo; for the shortcuts that slow the team
                down, or load an example to see a tracker filled in.
              </EmptyState>
            )
          ) : (
            <>
              <p className="text-sm font-medium text-text">{verdict}</p>

              <KpiGrid cols={[2, 3, 5]} marginBottom="none">
                <StatCard
                  variant="compact"
                  label="Open"
                  value={summary.open}
                  hint={`${summary.resolved} paid down`}
                />
                <StatCard
                  variant="compact"
                  label="Interest a sprint"
                  value={interestValue}
                  hint={interestHint}
                />
                <StatCard
                  variant="compact"
                  label="Oldest open"
                  value={
                    summary.oldestSprints === null
                      ? "—"
                      : `${summary.oldestSprints} ${summary.oldestSprints === 1 ? "sprint" : "sprints"}`
                  }
                  hint={`${len}-day sprints`}
                />
                <StatCard
                  variant="compact"
                  label="On the backlog"
                  value={summary.inBacklog}
                  hint="Open items with a story"
                />
                <StatCard
                  variant="compact"
                  label="Top hotspot"
                  value={summary.hotspot?.area ?? "—"}
                  valueClassName="truncate"
                  hint={
                    summary.hotspot
                      ? `${summary.hotspot.impact} impact points of open debt`
                      : "Give open items an area"
                  }
                />
              </KpiGrid>

              <SectionCard title="Impact × effort" icon={Flame}>
                <HotspotMatrix grid={hotspot.grid} />
                <p className="mt-2 text-xs text-sub">
                  {hotspot.open} open {hotspot.open === 1 ? "item" : "items"}. Top left (high
                  impact, low effort) is the best paydown.
                </p>
              </SectionCard>

              <ResortChip isStale={isStale} onResort={resort} what="Scores" />
              <ul className="space-y-2" aria-label="Debt, open first by score">
                {ordered.map((t) => (
                  <DebtRow
                    key={t.id}
                    ranked={rankDebt(t, len, today)}
                    sprintLengthDays={len}
                    today={today}
                    example={isExampleId(t.id)}
                    story={storyOf(t)}
                    onEdit={edit}
                    onResolve={resolve}
                    onResolvedOn={(item, day) => edit(item, { resolvedAt: day }, "resolvedAt")}
                    onReopen={reopen}
                    onSend={send}
                    onDelete={remove}
                  />
                ))}
              </ul>

              <AdvancedAnalysis summary="Advanced analysis: how long debt takes to pay down">
                {survival.points.length > 1 ? (
                  <ChartFigure
                    label="Debt still open after each number of days"
                    summary={chart.summary}
                    table={chart.table}
                    caption="Debt still open, Kaplan-Meier"
                    plotClassName="h-[180px]"
                  >
                    <ResolutionSurvivalChart data={survival.points} />
                  </ChartFigure>
                ) : (
                  <NotEnoughData
                    have={survival.resolved}
                    need="distribution"
                    unit={["paid-down item", "paid-down items"]}
                    action="Pay down"
                    what="how long debt takes to pay down"
                  />
                )}
                <p className="flex items-start gap-2 text-xs text-sub">
                  <Activity className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  Kaplan-Meier over every item: open ones count as still waiting.
                </p>
              </AdvancedAnalysis>
            </>
          )}
        </div>
      )}
    </ToolPageWrapper>
  );
}

/**
 * The 5×5 hotspot matrix as a table: impact down (5 at the top), effort
 * across, each cell the number of open items there, tinted by how many
 * (accent tints, never a hex).
 */
function HotspotMatrix({ grid }: { grid: number[][] }) {
  return (
    <div className="relative max-w-sm">
      <table className="w-full table-fixed border-separate border-spacing-1 text-xs">
        <caption className="sr-only">
          Open debt by impact (rows, 5 at the top) and effort (columns)
        </caption>
        <thead>
          <tr>
            <th scope="col" className="w-8">
              <span className="sr-only">Impact</span>
            </th>
            {EFFORTS.map((e) => (
              <th key={e} scope="col" className="text-center font-data font-normal text-sub">
                E{e}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {IMPACTS.map((i) => (
            <tr key={i}>
              <th scope="row" className="pr-1 text-right font-data font-normal text-sub">
                I{i}
              </th>
              {EFFORTS.map((e) => {
                const count = grid[i - 1][e - 1];
                return (
                  <td
                    key={e}
                    className={`h-8 rounded border text-center font-data ${heatTone(count)}`}
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
