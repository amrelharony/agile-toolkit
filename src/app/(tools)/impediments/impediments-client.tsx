"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ListChecks, Trash2, TrendingUp, X } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ChartFigure } from "@/components/shared/chart-card";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { ResortChip } from "@/components/shared/resort-chip";
import { SectionCard } from "@/components/shared/section-card";
import {
  ExampleNotice,
  LoadExampleButton,
  hasExampleItems,
} from "@/components/tool-frame/example-data";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { ToggleGroup, type ToggleOption } from "@/components/ui/toggle-group";
import { useStableOrder } from "@/hooks/use-stable-order";
import { generateImpedimentPrompts } from "@/lib/ai-prompts/impediments";
import { MIN_SAMPLE, enoughData } from "@/lib/analytics/min-sample";
import { plural } from "@/lib/charts/chart-text";
import { IMPEDIMENT_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { hasLegacyImpediments } from "@/lib/impediments/legacy-key";
import {
  IMPEDIMENT_CATEGORIES,
  IMPEDIMENT_CATEGORY_LABEL,
  IMPEDIMENT_SEVERITIES,
  IMPEDIMENT_SEVERITY_LABEL,
  IMPEDIMENT_STATUS_LABEL,
  compareImpediments,
  dayOf,
  daysOverdue,
  impedimentAgeDays,
  impedimentDueDate,
  impedimentStatus,
  impedimentSummary,
  withImpedimentStatus,
  type ImpedimentStatus,
} from "@/lib/impediments/model";
import { emit as sonify } from "@/lib/sonification/emit";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  Impediment,
  ImpedimentCategory,
  ImpedimentSeverity,
  WhiteboardObject,
} from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";
import { undoable } from "@/lib/utils/undoable";
import { analyseImpediments } from "./analysis";
import { ImpedimentsAdvanced } from "./advanced";
import { ImpedimentCard } from "./components/impediment-card";
import { LogForm } from "./components/log-form";
import { buildExample, exampleRows } from "./example";
import { applyValues, newImpediment, type ImpedimentValues } from "./form";
import {
  NO_FILTERS,
  avgDaysText,
  buildWeeklyImpedimentSeries,
  categoryLabel,
  dayLabel,
  isFiltered,
  matchesFilters,
  openByCategory,
  resolutionDays,
  severityLabel,
  statusCounts,
  titleOf,
  usableImpediments,
  weeklyChartText,
  type ImpedimentFilters,
  type StatusFilter,
} from "./helpers";
import { toMarkdown } from "./markdown";
import { impedimentVerdict } from "./verdict";

// Recharts loads with the chart, not the page; the fixed-height box
// reserves the space while it does.
const WeeklyImpedimentsChart = dynamic(
  () => import("./charts").then((m) => m.WeeklyImpedimentsChart),
  { ssr: false }
);

// A stable empty list: zustand re-renders forever on a selector that
// returns a fresh array each call.
const NONE: Impediment[] = [];

/** Fewer weeks than this and the weekly chart is a bar or two: the verdict says it better. */
const CHART_MIN_WEEKS = 3;

const keyOf = (i: Impediment) => i.id;

const STATUS_DONE: Record<ImpedimentStatus, string> = {
  open: "Reopened",
  escalated: "Escalated",
  resolved: "Resolved",
};

/** Added to the announcement when a change takes the card out of the filtered list. */
const HIDDEN_NOTE = ", now hidden by the filters";

/**
 * Focus what `find` returns once React has re-rendered. Deleting a card,
 * or a change that takes it out of the filter, unmounts the focused
 * control, and focus would otherwise drop to <body>.
 */
function focusSoon(find: () => HTMLElement | null | undefined) {
  requestAnimationFrame(() => find()?.focus());
}

/** The Edit button of the card for `id`; ids go in no selector, so need no escaping. */
function editButtonOf(id: string): HTMLElement | undefined {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-impediment-edit]")).find(
    (el) => el.getAttribute("data-impediment-edit") === id
  );
}

/**
 * True while impediments this browser kept under the tool's old store are
 * still waiting for their one-time move into the workspace (the app shell
 * runs it, once auth and the first cloud pull have settled). The check is
 * a cheap storage read, so it is polled until the move is done.
 */
function useLegacyMovePending(): boolean {
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (!hasLegacyImpediments()) return;
    setPending(true);
    const timer = window.setInterval(() => {
      if (hasLegacyImpediments()) return;
      setPending(false);
      window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);
  return pending;
}

/**
 * Canvas objects pinned to these impediments. Deleting an impediment
 * unpins them (workspace removeImpediment), so Undo pins them back.
 */
function pinnedTo(ids: ReadonlySet<string>): WhiteboardObject[] {
  return (useWorkspaceStore.getState().whiteboardObjects ?? []).filter(
    (o) => o.sourceRef?.tool === "impediment" && ids.has(o.sourceRef.entityId)
  );
}

function repin(objects: readonly WhiteboardObject[]) {
  if (objects.length === 0) return;
  const { whiteboardObjects, upsertWhiteboardObjects } = useWorkspaceStore.getState();
  const current = new Map((whiteboardObjects ?? []).map((o) => [o.id, o]));
  const now = new Date().toISOString();
  // Only objects still there and still unpinned: one re-pinned or deleted
  // on the canvas since is left as it is.
  const back = objects.flatMap((o) => {
    const live = current.get(o.id);
    return live && !live.sourceRef
      ? [{ ...live, sourceRef: o.sourceRef, version: live.version + 1, updatedAt: now }]
      : [];
  });
  if (back.length > 0) upsertWhiteboardObjects(back);
}

export function ImpedimentsClient() {
  // workspace.impediments is the one store: what this page logs, what
  // standup, retro and Scrum of Scrums hand off, and what agents write.
  const stored = useWorkspaceStore((s) => s.impediments ?? NONE);
  const upsert = useWorkspaceStore((s) => s.upsertImpediment);
  const removeOne = useWorkspaceStore((s) => s.removeImpediment);
  const list = useMemo(() => usableImpediments(stored), [stored]);
  const today = todayLocalISO();
  const { log } = useHistoryLogger("impediments");
  const announce = useAnnounce();
  const legacyPending = useLegacyMovePending();
  const exportRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const clearFiltersRef = useRef<HTMLButtonElement>(null);
  const [filters, setFilters] = useState<ImpedimentFilters>(NO_FILTERS);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

  const summary = useMemo(() => impedimentSummary(list, today), [list, today]);
  const took = useMemo(() => resolutionDays(list), [list]);
  // Offered as a due date only once the average means something.
  const typicalDays =
    enoughData(took.length, "average") && summary.avgResolutionDays !== null
      ? Math.max(1, Math.round(summary.avgResolutionDays))
      : null;
  const weeks = useMemo(() => buildWeeklyImpedimentSeries(list, today), [list, today]);
  const chart = useMemo(() => weeklyChartText(weeks), [weeks]);
  const analysis = useMemo(() => analyseImpediments(weeks, took), [weeks, took]);
  const counts = useMemo(() => statusCounts(list, today), [list, today]);
  const byCategory = useMemo(() => openByCategory(list), [list]);

  const shown = useMemo(
    () => list.filter((i) => matchesFilters(i, filters, today)),
    [list, filters, today]
  );
  // Escalated first, then open (overdue, most severe, oldest), then
  // resolved. A status change or an edit doesn't move a card out from
  // under the cursor; "Re-sort" catches the order up.
  const { ordered, isStale, resort } = useStableOrder(shown, keyOf, (a, b) =>
    compareImpediments(a, b, today)
  );

  /* ── Focus ── */

  /** The log form's opener, or its title while it is open. */
  const logStart = () => logRef.current?.querySelector<HTMLElement>("[data-log-opener], input");

  /**
   * Once the card for `id` has gone from the list (deleted, or out of the
   * filter), focus the card shown after it, else the one before, else
   * "Clear filters", else the log form.
   */
  function focusPast(id: string) {
    const at = ordered.findIndex((i) => i.id === id);
    const near = at >= 0 ? (ordered[at + 1] ?? ordered[at - 1]) : undefined;
    focusSoon(() => (near && editButtonOf(near.id)) || clearFiltersRef.current || logStart());
  }

  /* ── Changes ── */

  function add(values: ImpedimentValues) {
    const item = newImpediment(values, crypto.randomUUID());
    upsert(item);
    sonify("impediments", "impediment-raised");
    log(IMPEDIMENT_ACTIONS.IMPEDIMENT_RAISED, {
      title: item.title,
      severity: item.severity,
      category: item.category ?? null,
      assignedTo: item.owner ?? null,
    });
    announce(`Logged “${item.title}”`);
  }

  // A save or a status change can take the card out of the filtered list,
  // and it leaves at once (the stable order only holds cards still shown):
  // the announcement says so, and focus moves on to its neighbour.
  function save(row: Impediment, values: ImpedimentValues) {
    const next = applyValues(row, values);
    if (next === row) return;
    upsert(next);
    log(IMPEDIMENT_ACTIONS.IMPEDIMENT_UPDATED, { id: row.id, title: next.title });
    const hidden = !matchesFilters(next, filters, today);
    announce(`Saved “${titleOf(next)}”${hidden ? HIDDEN_NOTE : ""}`);
    if (hidden) focusPast(row.id);
  }

  function setStatus(row: Impediment, status: ImpedimentStatus, day: string) {
    const next = withImpedimentStatus(row, status, day);
    if (next === row) return;
    const from = impedimentStatus(row);
    upsert(next);
    if (status === "resolved") {
      sonify("impediments", "impediment-resolved");
      log(IMPEDIMENT_ACTIONS.IMPEDIMENT_RESOLVED, {
        id: row.id,
        title: titleOf(row),
        ageDays: impedimentAgeDays(next, today),
      });
    } else {
      log(IMPEDIMENT_ACTIONS.IMPEDIMENT_STATUS_CHANGED, {
        id: row.id,
        title: titleOf(row),
        from,
        to: status,
      });
    }
    const done =
      from === "escalated" && status === "open" ? "Moved back to open:" : STATUS_DONE[status];
    const hidden = !matchesFilters(next, filters, today);
    announce(`${done} “${titleOf(row)}”${hidden ? HIDDEN_NOTE : ""}`);
    if (hidden) focusPast(row.id);
  }

  function remove(row: Impediment) {
    const pins = pinnedTo(new Set([row.id]));
    undoable({
      label: `Deleted “${titleOf(row)}”`,
      apply: () => {
        removeOne(row.id);
        log(IMPEDIMENT_ACTIONS.IMPEDIMENT_REMOVED, { id: row.id, title: titleOf(row) });
      },
      revert: () => {
        upsert(row);
        repin(pins);
      },
    });
    focusPast(row.id);
  }

  /**
   * Each "Delete all" keeps what it took for its own Undo. One snapshot
   * shared by every reset (ResetButton's onReset / onUndo pair) let the
   * Undo of an earlier toast restore what a later one deleted, say an
   * example loaded in between, and lose the real rows.
   */
  function deleteAll() {
    const rows = useWorkspaceStore.getState().impediments ?? [];
    const pins = pinnedTo(new Set(rows.map((i) => i.id)));
    undoable({
      label: `Deleted ${plural(rows.length, "impediment")}`,
      apply: () => rows.forEach((i) => removeOne(i.id)),
      revert: () => {
        rows.forEach(upsert);
        repin(pins);
      },
    });
    // The list and the button that opened the dialog are gone.
    focusSoon(logStart);
  }

  const loadExample = () => buildExample(today).forEach(upsert);
  const clearExample = () => exampleRows(list).forEach((i) => removeOne(i.id));

  /* ── Exports ── */

  const promptConfig = useMemo(
    () => ({
      toolName: "Impediment Tracker",
      prompts: generateImpedimentPrompts({
        impediments: list.map((i) => ({
          title: titleOf(i),
          description: i.description ?? "",
          category: categoryLabel(i.category),
          severity: severityLabel(i.severity),
          status: IMPEDIMENT_STATUS_LABEL[impedimentStatus(i)],
          raisedBy: i.raisedBy ?? "",
          assignedTo: i.owner ?? "",
          raisedDate: dayOf(i.raisedAt) ?? "",
          resolvedDate: dayOf(i.resolvedAt) ?? undefined,
        })),
      }),
    }),
    [list]
  );

  const csvData = {
    headers: [
      "Title",
      "Description",
      "Category",
      "Severity",
      "Status",
      "Raised by",
      "Owner",
      "Raised",
      "Escalated",
      "Due",
      "Resolved",
      "Age (days)",
      "Days overdue",
    ],
    rows: list.map((i) => [
      titleOf(i),
      i.description ?? "",
      categoryLabel(i.category),
      severityLabel(i.severity),
      IMPEDIMENT_STATUS_LABEL[impedimentStatus(i)],
      i.raisedBy ?? "",
      i.owner ?? "",
      dayOf(i.raisedAt) ?? "",
      dayOf(i.escalatedAt) ?? "",
      impedimentDueDate(i) ?? "",
      dayOf(i.resolvedAt) ?? "",
      impedimentAgeDays(i, today) ?? "",
      daysOverdue(i, today),
    ]),
  };

  const statusOptions: ToggleOption<StatusFilter>[] = (
    [
      ["all", "All"],
      ["open", "Open"],
      ["escalated", "Escalated"],
      ["overdue", "Overdue"],
      ["resolved", "Resolved"],
    ] as const
  ).map(([value, label]) => ({ value, label: `${label} (${counts[value]})` }));

  const filtered = isFiltered(filters);

  return (
    <ToolPageWrapper
      toolId="impediments"
      title="Impediment Tracker"
      description="Log, escalate, and resolve team impediments. Monitor age, severity, and resolution metrics."
      category="Team Health & Maturity"
    >
      <div ref={exportRef} className="space-y-6">
        {hasExampleItems(list) && <ExampleNotice onClear={clearExample} />}
        {legacyPending && (
          <p
            role="status"
            className="rounded-lg border border-info/30 bg-info/10 px-4 py-2.5 text-sm text-text"
          >
            Moving impediments saved in this browser…
          </p>
        )}

        <div ref={logRef}>
          <LogForm today={today} typicalDays={typicalDays} onAdd={add} />
        </div>

        {list.length === 0 ? (
          !legacyPending && (
            <EmptyState icon={AlertTriangle} action={<LoadExampleButton onLoad={loadExample} />}>
              No impediments logged. Use “Log impediment” for anything in the team’s way, or load an
              example to see the tracker filled in. Blockers sent from Standup, Retro and Scrum of
              Scrums land here too.
            </EmptyState>
          )
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat term="Open" value={summary.open} tone="text-accent" />
              <Stat term="Escalated" value={summary.escalated} tone="text-warning" />
              <Stat
                term="Overdue"
                value={summary.overdue}
                tone={summary.overdue > 0 ? "text-danger" : "text-text"}
              />
              <Stat
                term="Average time to resolve"
                value={
                  enoughData(took.length, "average") ? avgDaysText(summary.avgResolutionDays) : "—"
                }
                note={
                  enoughData(took.length, "average")
                    ? `Over ${took.length} resolved`
                    : `Shows once ${MIN_SAMPLE.average} are resolved`
                }
                tone="text-success"
              />
            </dl>

            <SectionCard
              title={`Impediments (${list.length})`}
              icon={ListChecks}
              actions={
                <>
                  <AiPromptGenerator config={promptConfig} />
                  <ExportButton
                    filename="impediments"
                    csvData={csvData}
                    jsonData={list}
                    markdown={toMarkdown(list, today)}
                    targetRef={exportRef}
                  />
                  {/* Confirm, then Undo, as ResetButton does; see deleteAll for why not it. */}
                  <Button
                    type="button"
                    variant="danger-ghost"
                    size="sm"
                    onClick={() => setConfirmDeleteAll(true)}
                  >
                    <Trash2 aria-hidden="true" />
                    Delete all
                  </Button>
                  <ConfirmDialog
                    open={confirmDeleteAll}
                    onOpenChange={setConfirmDeleteAll}
                    title={
                      list.length === 1
                        ? "Delete the 1 impediment?"
                        : `Delete all ${list.length} impediments?`
                    }
                    description="They go from every tool that reads them: the sprint cockpit, Standup, Retro and the dashboards."
                    confirmLabel="Delete all"
                    onConfirm={deleteAll}
                  />
                </>
              }
              contentClassName="space-y-4"
            >
              <div className="space-y-1">
                <p className="text-sm font-medium text-text">{impedimentVerdict(list, today)}</p>
                {byCategory.length > 0 && (
                  <p className="text-xs text-sub">
                    Unresolved by category:{" "}
                    {byCategory.map((c) => `${c.label} ${c.count}`).join(" · ")}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
                <div className="flex min-w-0 flex-col gap-1.5">
                  <span className="text-sm text-text" aria-hidden="true">
                    Show
                  </span>
                  <ToggleGroup
                    label="Show impediments"
                    size="sm"
                    options={statusOptions}
                    value={filters.status}
                    onValueChange={(status) => setFilters((f) => ({ ...f, status }))}
                  />
                </div>
                <div className="grid w-full grid-cols-2 gap-3 sm:flex sm:w-auto">
                  <FilterSelect
                    label="Category"
                    value={filters.category}
                    options={IMPEDIMENT_CATEGORIES.map((c) => ({
                      value: c,
                      label: IMPEDIMENT_CATEGORY_LABEL[c],
                    }))}
                    onChange={(category) =>
                      setFilters((f) => ({
                        ...f,
                        category: category as ImpedimentCategory | "all",
                      }))
                    }
                  />
                  <FilterSelect
                    label="Severity"
                    value={filters.severity}
                    options={IMPEDIMENT_SEVERITIES.map((s) => ({
                      value: s,
                      label: IMPEDIMENT_SEVERITY_LABEL[s],
                    }))}
                    onChange={(severity) =>
                      setFilters((f) => ({
                        ...f,
                        severity: severity as ImpedimentSeverity | "all",
                      }))
                    }
                  />
                </div>
                {filtered && (
                  <p className="flex items-center gap-2 text-xs text-sub" role="status">
                    Showing {shown.length} of {list.length}
                    <Button
                      ref={clearFiltersRef}
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="gap-1"
                      onClick={() => setFilters(NO_FILTERS)}
                    >
                      <X aria-hidden="true" />
                      Clear filters
                    </Button>
                  </p>
                )}
              </div>

              <ResortChip isStale={isStale} onResort={resort} what="Statuses or dates" />
              {ordered.length === 0 ? (
                <p className="text-sm text-sub">No impediments match these filters.</p>
              ) : (
                <ul
                  className="grid grid-cols-1 gap-3 lg:grid-cols-2"
                  aria-label="Impediments, escalated first"
                >
                  {ordered.map((i) => (
                    <li key={i.id} className="min-w-0">
                      <ImpedimentCard
                        impediment={i}
                        today={today}
                        typicalDays={typicalDays}
                        onStatus={setStatus}
                        onSave={save}
                        onRemove={remove}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>

            {weeks.length >= CHART_MIN_WEEKS && (
              <SectionCard title="Raised per week" icon={TrendingUp}>
                <ChartFigure
                  label="Impediments raised per week"
                  summary={chart.summary}
                  table={chart.table}
                  caption="Impediments per week"
                  plotClassName="h-[220px]"
                >
                  <WeeklyImpedimentsChart
                    data={weeks.map((w) => ({
                      week: dayLabel(w.start),
                      raised: w.raised,
                      open: w.open,
                    }))}
                  />
                </ChartFigure>
              </SectionCard>
            )}

            <ImpedimentsAdvanced analysis={analysis} />
          </>
        )}
      </div>
    </ToolPageWrapper>
  );
}

function Stat({
  term,
  value,
  note,
  tone,
}: {
  term: string;
  value: number | string;
  note?: string;
  tone: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 sm:p-4">
      <dt className="text-xs text-sub">{term}</dt>
      <dd className={`mt-1 font-data text-fluid-h2 font-bold ${tone}`}>{value}</dd>
      {note && <dd className="mt-0.5 text-xs text-sub">{note}</dd>}
    </div>
  );
}

/** A compact native select with an "All" option (reliable on phones). */
function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label} className="min-w-0 sm:w-40">
      {(props) => (
        <select
          {...props}
          className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-1 text-base text-text shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring pointer-fine:md:h-9 pointer-fine:md:text-sm"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="all">All</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}
