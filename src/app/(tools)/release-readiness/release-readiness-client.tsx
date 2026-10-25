"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useShallow } from "zustand/react/shallow";
import { BarChart3, CheckCircle2, ListChecks, Plus, Rocket, Settings2 } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ActionRow } from "@/components/shared/action-row";
import { AdvancedAnalysis } from "@/components/shared/advanced-analysis";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ChartFigure } from "@/components/shared/chart-card";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { ExampleNotice, LoadExampleButton } from "@/components/tool-frame/example-data";
import { DOD_STORAGE_KEY, EMPTY_DOD, normalizeDod } from "@/app/(tools)/dod-builder/summary";
import { generateReleaseReadinessPrompts } from "@/lib/ai-prompts/release-readiness";
import { MIN_SAMPLE, enoughData } from "@/lib/analytics/min-sample";
import { fmt, plural } from "@/lib/charts/chart-text";
import { RELEASE_READINESS_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { normalizeFlags } from "@/lib/flags/model";
import {
  describedGate,
  gateLabels,
  gateResults,
  releaseChecks,
  reopenRelease,
  rollBackRelease,
  shipRelease,
  storedGates,
  withRelease,
  withShipPlans,
} from "@/lib/releases/auto-gates";
import { RELEASE_DOC_ID, teamGates } from "@/lib/releases/gates";
import { releaseStats, shipEvents } from "@/lib/releases/model";
import { RETRO_CURRENT_ID } from "@/lib/retro/board";
import { todayIso } from "@/lib/sprints/series";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  FeatureFlag,
  HandoffLink,
  Release,
  ReleaseGateDef,
  ReleaseReadiness,
  RetroBoard,
} from "@/lib/stores/workspace-types";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { undoable, removeWithUndo } from "@/lib/utils/undoable";
import { usePersisted } from "@/lib/utils/use-persisted";
import {
  passChartText,
  passControl,
  passSeries,
  passTrend,
  skippedChartText,
  skippedRows,
  trendSentence,
} from "./analysis";
import { buildExample, type ReleaseReadinessExample } from "./example";
import {
  EMPTY_RELEASE,
  applyRelease,
  newRelease,
  validateRelease,
  type ReleaseDraft,
  type ReleaseField,
  type ReleaseValues,
} from "./form";
import { GatesEditor } from "./gates-editor";
import { toMarkdown } from "./markdown";
import { ReleaseCard } from "./release-card";
import { ReleaseFields } from "./release-fields";
import { STATUS_LABEL, dayLabel, nameOf } from "./text";
import { nextRelease, overallVerdict, releaseVerdict } from "./verdict";

// Recharts loads with the charts, not the page. Each chart sits in a
// fixed-height box, so the placeholder fills it and the layout holds still.
const chartPlaceholder = () => (
  <div className="h-full w-full animate-pulse rounded-lg bg-muted/30" aria-hidden="true" />
);
const GatePassControlChart = dynamic(() => import("./charts").then((m) => m.GatePassControlChart), {
  ssr: false,
  loading: chartPlaceholder,
});
const SkippedGatesChart = dynamic(() => import("./charts").then((m) => m.SkippedGatesChart), {
  ssr: false,
  loading: chartPlaceholder,
});

const NO_FLAGS: FeatureFlag[] = [];
const NO_BOARDS: RetroBoard[] = [];
const EMPTY_DOC: ReleaseReadiness = { id: RELEASE_DOC_ID, releases: [] };
const noLog = () => undefined;

const PAGE = {
  toolId: "release-readiness",
  title: "Release Readiness Checklist",
  description:
    "Check each release against your team's gates, ship it on the day it went out, and see how often releases ship on time and which gates get skipped.",
  category: "Incidents & Reliability",
} as const;

type DocUpdate = (doc: ReleaseReadiness) => ReleaseReadiness;

/** Writes the workspace document the agent actions and Premortem's links read. */
function writeStore(update: DocUpdate) {
  const { releaseReadinesses, upsertReleaseReadiness } = useWorkspaceStore.getState();
  const current = (releaseReadinesses ?? []).find((d) => d.id === RELEASE_DOC_ID) ?? EMPTY_DOC;
  upsertReleaseReadiness({ ...update(current), id: RELEASE_DOC_ID });
}

/** Where a release's rollback went as a retro topic: the cards on the current retro sent from it. */
function retroLinksOf(boards: readonly RetroBoard[] | undefined, releaseId: string): HandoffLink[] {
  const board = (boards ?? []).find((b) => b.id === RETRO_CURRENT_ID);
  return (board?.cards ?? [])
    .filter((c) => c.sourceRef?.tool === "release-readiness" && c.sourceRef.id === releaseId)
    .map((c) => ({ route: "retro-topic" as const, targetId: c.id, at: "" }));
}

/** Focus what `find` returns once React has re-rendered (a deleted card took focus with it). */
function focusSoon(find: () => HTMLElement | null | undefined) {
  requestAnimationFrame(() => find()?.focus());
}

/**
 * Today's local day, kept current: release day often starts in a tab left
 * open overnight, whose Ship dialog would otherwise open on yesterday and
 * refuse the real today as the future. A minute's tick costs nothing (the
 * same day doesn't re-render), and a tab coming back checks at once.
 */
function useToday(): string {
  const [today, setToday] = useState(() => todayIso());
  useEffect(() => {
    const refresh = () => setToday(todayIso());
    const id = window.setInterval(refresh, 60 * 1000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  return today;
}

/**
 * Release Readiness: each release's gates (the team's own list, the
 * built-ins until it changes, two of them checked from the Feature Flag
 * Tracker and the DoD Builder), a dated Ship that freezes the gates as
 * they stood, rollbacks with their day, reopened releases whose earlier
 * ships still count, and the on-time rate and skipped gates over every ship.
 */
export function ReleaseReadinessClient() {
  const hydrated = useWorkspaceHydrated();
  const stored = useWorkspaceStore(
    useShallow((s) => (s.releaseReadinesses ?? []).find((d) => d.id === RELEASE_DOC_ID))
  );
  const rawFlags = useWorkspaceStore((s) => s.featureFlags) ?? NO_FLAGS;
  // Read as the Feature Flag Tracker and the agent read them (old statuses,
  // rows written through the generic CRUD), so all three decide the flag
  // gate the same way and freeze the same result at ship.
  const storedFlags = useMemo(() => normalizeFlags(rawFlags), [rawFlags]);
  const retroBoards = useWorkspaceStore((s) => s.retroBoards) ?? NO_BOARDS;
  // The DoD Builder's checklist, read as the Team charter reads it.
  const [dodRaw] = usePersisted(DOD_STORAGE_KEY, EMPTY_DOD);
  const storedDod = useMemo(() => normalizeDod(dodRaw), [dodRaw]);
  const { log } = useHistoryLogger("release-readiness");
  const announce = useAnnounce();
  const today = useToday();
  const addRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  // The example lives here only: nothing in it reaches the workspace.
  const [example, setExample] = useState<ReleaseReadinessExample | null>(null);
  const preview = example !== null;
  const doc: ReleaseReadiness = example?.doc ?? stored ?? EMPTY_DOC;
  const flags = example?.flags ?? storedFlags;
  const dod = example?.dod ?? storedDod;

  // Fixed for the render an edit starts in, so its Undo goes back to the
  // same place even if the example is loaded or cleared in between. The
  // example's edits aren't the team's history, so they aren't logged.
  const write: (update: DocUpdate) => void = preview
    ? (update) => setExample((ex) => (ex ? { ...ex, doc: update(ex.doc) } : ex))
    : writeStore;
  const record: typeof log = preview ? noLog : log;

  const rows = useMemo(
    () =>
      doc.releases.map((release) => ({
        release,
        results: gateResults(release, doc, releaseChecks(release, flags, dod, today)),
      })),
    [doc, flags, dod, today]
  );
  // Every ship judged against the plan it went out against (withShipPlans).
  const judged = useMemo(() => withShipPlans(doc), [doc]);
  const stats = useMemo(() => releaseStats(judged), [judged]);
  const events = useMemo(() => shipEvents(judged), [judged]);
  const labels = useMemo(() => gateLabels(doc), [doc]);
  const labelOf = (id: string) => labels.get(id) ?? id;
  const skipped = useMemo(() => skippedRows(stats, (id) => labels.get(id) ?? id), [stats, labels]);
  const skippedText = skippedChartText(skipped);
  const series = passSeries(events);
  const control = passControl(series);
  const trend = passTrend(series);
  const quotable = enoughData(stats.shipped, "average");

  const verdicts = new Map(
    rows.map(({ release, results }) => [release.id, releaseVerdict(release, results, today)])
  );
  const next = nextRelease(doc.releases);
  const verdict = overallVerdict({
    releases: doc.releases,
    stats,
    labelOf,
    next: next ? verdicts.get(next.id) : undefined,
  });
  const gates = storedGates(doc);
  const markdown = toMarkdown({
    today,
    verdict,
    releases: rows,
    stats,
    skipped,
    gates: teamGates(doc).map(describedGate),
  });

  /* ── Changes ──────────────────────────────────────────────────────── */

  const currentOf = (id: string, d: ReleaseReadiness) => d.releases.find((r) => r.id === id);

  /** Replace a release with Undo; `before` is what Undo puts back. */
  const change = (before: Release, after: Release, label: string, onApply: () => void) => {
    undoable({
      label,
      apply: () => {
        write((d) => withRelease(d, after));
        onApply();
      },
      revert: () => write((d) => (currentOf(before.id, d) ? withRelease(d, before) : d)),
    });
    announce(label);
  };

  const add = (v: ReleaseValues) => {
    const release = newRelease(v, crypto.randomUUID());
    write((d) => ({ ...d, releases: [release, ...d.releases] }));
    record(RELEASE_READINESS_ACTIONS.RELEASE_ADDED, {
      releaseId: release.id,
      name: release.name,
      plannedDate: release.plannedDate,
    });
    announce(`Added “${release.name}”, planned ${dayLabel(release.plannedDate)}`);
  };

  const save = (r: Release, v: ReleaseValues) => {
    const nextRelease = applyRelease(r, v);
    if (nextRelease === r) return;
    write((d) => {
      const cur = currentOf(r.id, d);
      return cur ? withRelease(d, applyRelease(cur, v)) : d;
    });
    record(RELEASE_READINESS_ACTIONS.RELEASE_UPDATED, { releaseId: r.id, name: v.name });
    announce(`Saved “${v.name}”`);
  };

  const toggleGate = (r: Release, gateId: string, passed: boolean) => {
    write((d) => {
      const cur = currentOf(r.id, d);
      return cur ? withRelease(d, { ...cur, gates: { ...cur.gates, [gateId]: passed } }) : d;
    });
    record(RELEASE_READINESS_ACTIONS.GATE_TOGGLED, { releaseId: r.id, gate: gateId, passed });
    announce(`${labelOf(gateId)} ${passed ? "passed" : "open again"} on ${nameOf(r)}`);
  };

  const ship = (r: Release, day: string) => {
    if (r.status !== "planning") return;
    const shipped = shipRelease(r, doc, releaseChecks(r, flags, dod, today), day);
    const open = shipped.gatesOpenAtShip ?? 0;
    change(
      r,
      shipped,
      `Shipped “${nameOf(r)}” on ${dayLabel(day)}${open > 0 ? ` with ${plural(open, "gate")} open` : ""}`,
      () =>
        record(RELEASE_READINESS_ACTIONS.RELEASE_SHIPPED, {
          releaseId: r.id,
          name: r.name,
          plannedDate: r.plannedDate,
          shippedDate: day,
          gatesOpenAtShip: open,
        })
    );
  };

  const rollBack = (r: Release, day: string) => {
    if (r.status !== "shipped") return;
    change(
      r,
      rollBackRelease(r, day),
      `Marked “${nameOf(r)}” rolled back on ${dayLabel(day)}`,
      () =>
        record(RELEASE_READINESS_ACTIONS.RELEASE_ROLLED_BACK, {
          releaseId: r.id,
          rolledBackAt: day,
        })
    );
  };

  const reopen = (r: Release) => {
    if (r.status === "planning") return;
    change(
      r,
      reopenRelease(r, doc),
      `Reopened “${nameOf(r)}” for planning; its ship still counts`,
      () => record(RELEASE_READINESS_ACTIONS.RELEASE_REOPENED, { releaseId: r.id, name: r.name })
    );
  };

  const remove = (r: Release) => {
    // Focus moves to the next card's Delete (or the one before, or the form).
    const at = doc.releases.findIndex((x) => x.id === r.id);
    const near = doc.releases[at + 1] ?? doc.releases[at - 1];
    // Undo puts it back in its place with the same id, so a premortem
    // linked to it finds it again.
    removeWithUndo<Release>({
      label: `Deleted “${nameOf(r)}”`,
      update: (fn) => write((d) => ({ ...d, releases: fn(d.releases) })),
      match: (x) => x.id === r.id,
    });
    record(RELEASE_READINESS_ACTIONS.RELEASE_REMOVED, { releaseId: r.id, name: r.name });
    announce(`Deleted “${nameOf(r)}”`);
    focusSoon(() =>
      near
        ? Array.from(document.querySelectorAll<HTMLElement>("[data-release-delete]")).find(
            (el) => el.getAttribute("data-release-delete") === near.id
          )
        : addRef.current?.querySelector<HTMLElement>("input")
    );
  };

  const setGates = (fn: (list: ReleaseGateDef[]) => ReleaseGateDef[]) =>
    write((d) => ({ ...d, gates: fn(storedGates(d)) }));
  const gatesChanged = (what: string) => {
    record(RELEASE_READINESS_ACTIONS.GATES_CHANGED, { change: what });
    announce(what);
  };

  const form = useItemForm<ReleaseDraft, ReleaseValues, ReleaseField>({
    initial: EMPTY_RELEASE,
    validate: validateRelease,
    onSave: add,
  });

  /* ── Exports ──────────────────────────────────────────────────────── */

  const promptConfig = useMemo(
    () => ({
      toolName: "Release Readiness",
      prompts: generateReleaseReadinessPrompts({
        releases: rows.map(({ release: r, results }) => ({
          name: nameOf(r),
          status: STATUS_LABEL[r.status],
          plannedDate: r.plannedDate,
          shippedDate: r.shippedDate,
          rolledBackAt: r.rolledBackAt,
          gatesPassed: results.filter((g) => g.passed).length,
          gatesTotal: results.length,
          openGates: results.filter((g) => !g.passed).map((g) => g.label),
          description: r.description,
        })),
        stats,
        skipped,
      }),
    }),
    [rows, stats, skipped]
  );

  const csvData = {
    headers: [
      "Release",
      "Status",
      "Planned",
      "Shipped",
      "Rolled back",
      "Gates passed",
      "Open gates",
      "Earlier ships",
      "Description",
    ],
    rows: rows.map(({ release: r, results }) => [
      nameOf(r),
      STATUS_LABEL[r.status],
      r.plannedDate,
      r.shippedDate ?? "",
      r.rolledBackAt ?? "",
      `${results.filter((g) => g.passed).length} / ${results.length}`,
      results
        .filter((g) => !g.passed)
        .map((g) => g.label)
        .join("; "),
      (r.previousShips ?? []).map((s) => s.shippedDate).join("; "),
      (r.description ?? "").replace(/\n/g, " "),
    ]),
  };

  const loadExample = () => setExample(buildExample(today));
  const clearExample = () => setExample(null);

  if (!hydrated) {
    return (
      <ToolPageWrapper {...PAGE}>
        <p
          role="status"
          className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-sub"
        >
          Loading releases…
        </p>
      </ToolPageWrapper>
    );
  }

  return (
    <ToolPageWrapper {...PAGE}>
      <div ref={exportRef} className="space-y-6">
        {preview && (
          <div>
            <ExampleNotice onClear={clearExample} />
            <p className="-mt-2 text-xs text-sub">
              Example: a checkout team&apos;s last six releases, with its own flags and Definition
              of Done. Nothing in it is saved, and your own releases stay as they are.
            </p>
          </div>
        )}

        <ActionRow>
          <AiPromptGenerator config={promptConfig} />
          <ExportButton
            filename="release-readiness"
            csvData={csvData}
            jsonData={doc}
            markdown={markdown}
            targetRef={exportRef}
          />
        </ActionRow>

        <KpiGrid cols={3} gap="lg">
          <StatCard
            variant="compact"
            icon={Rocket}
            label="Went out"
            value={stats.shipped}
            hint={
              stats.rolledBack > 0
                ? `incl. ${stats.rolledBack} rolled back`
                : plural(doc.releases.length, "release") + " tracked"
            }
          />
          <StatCard
            variant="compact"
            icon={CheckCircle2}
            label="% on time"
            value={quotable && stats.pct !== null ? `${stats.pct.toFixed(0)}%` : "—"}
            hint={
              stats.shipped === 0
                ? "no ships yet"
                : !quotable
                  ? `shows after ${MIN_SAMPLE.average} ships (${stats.shipped} so far)`
                  : stats.rolledBack > 0
                    ? `of ${stats.shipped} shipped, incl. ${stats.rolledBack} rolled back`
                    : `of ${stats.shipped} shipped`
            }
            tone={
              !quotable || stats.pct === null
                ? "default"
                : stats.pct >= 80
                  ? "success"
                  : stats.pct >= 50
                    ? "warning"
                    : "danger"
            }
          />
          <StatCard
            variant="compact"
            icon={ListChecks}
            label="Avg gates open at ship"
            value={quotable && stats.avgGatesOpen !== null ? fmt(stats.avgGatesOpen) : "—"}
            hint={
              stats.shipped === 0
                ? "no ships yet"
                : quotable
                  ? `over ${plural(stats.shipped, "ship")}`
                  : `shows after ${MIN_SAMPLE.average} ships (${stats.shipped} so far)`
            }
            tone={
              !quotable || stats.avgGatesOpen === null
                ? "default"
                : stats.avgGatesOpen === 0
                  ? "success"
                  : stats.avgGatesOpen <= 1
                    ? "warning"
                    : "danger"
            }
          />
        </KpiGrid>

        {doc.releases.length > 0 && <p className="text-sm font-medium text-text">{verdict}</p>}

        <SectionCard title="Add a release" icon={Plus} titleSize="lg">
          <div ref={addRef}>
            <ItemForm
              form={form}
              submitLabel="Add release"
              submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
              footer={
                preview ? (
                  <p className="text-xs text-sub">
                    In the example, it goes on the example. Nothing is saved.
                  </p>
                ) : undefined
              }
            >
              <ReleaseFields form={form} />
            </ItemForm>
          </div>
        </SectionCard>

        {doc.releases.length === 0 ? (
          <EmptyState
            icon={Rocket}
            action={<LoadExampleButton onLoad={loadExample} className="mt-4" />}
          >
            No releases yet. Add one above to check it against your gates before it ships, or load
            an example to see a few releases shipped, rolled back and reopened.
          </EmptyState>
        ) : (
          <ul className="space-y-4" aria-label="Releases, newest first">
            {rows.map(({ release, results }) => (
              <li key={release.id}>
                <ReleaseCard
                  release={release}
                  results={results}
                  verdict={verdicts.get(release.id) ?? ""}
                  linkedFlags={flags.filter((f) => f.releaseId === release.id)}
                  today={today}
                  preview={preview}
                  retroLinks={retroLinksOf(retroBoards, release.id)}
                  getRetroLinks={() =>
                    retroLinksOf(useWorkspaceStore.getState().retroBoards, release.id)
                  }
                  onToggleGate={toggleGate}
                  onShip={ship}
                  onRollBack={rollBack}
                  onReopen={reopen}
                  onSave={save}
                  onRemove={remove}
                />
              </li>
            ))}
          </ul>
        )}

        <SectionCard
          title={`Gates (${gates.filter((g) => !g.archived).length})`}
          icon={Settings2}
          titleSize="lg"
        >
          <GatesEditor gates={gates} setGates={setGates} onChanged={gatesChanged} />
        </SectionCard>

        {stats.shipped > 0 && (
          <SectionCard title="Most-skipped gates" icon={BarChart3} titleSize="lg">
            <ChartFigure
              label="Most-skipped gates, across every ship"
              summary={skippedText.summary}
              table={skippedText.table}
              caption="Gates open at ship"
              plotClassName="h-[320px]"
            >
              <SkippedGatesChart data={skipped} />
            </ChartFigure>
          </SectionCard>
        )}

        {stats.shipped > 0 && (
          <AdvancedAnalysis summary="Advanced analysis: gate-pass rate per ship">
            {control ? (
              <ChartFigure
                label="Gate-pass rate per ship, with control limits"
                summary={passChartText(series, control).summary}
                table={passChartText(series, control).table}
                caption="Gate-pass rate per ship"
                plotClassName="h-[220px]"
              >
                <GatePassControlChart data={series} control={control} />
              </ChartFigure>
            ) : (
              <NotEnoughData
                have={series.length}
                need="changePoint"
                unit={["ship", "ships"]}
                action="Record"
                what="control limits on the gate-pass rate"
              />
            )}
            {trend ? (
              <p className="text-sm text-text">{trendSentence(trend)}</p>
            ) : (
              <NotEnoughData
                have={series.length}
                need="trend"
                unit={["ship", "ships"]}
                action="Record"
                what="whether the gate-pass rate is trending"
              />
            )}
          </AdvancedAnalysis>
        )}
      </div>
    </ToolPageWrapper>
  );
}
