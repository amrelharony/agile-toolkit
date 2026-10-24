"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Activity, AlertTriangle, Archive, Clock, Plus, ToggleLeft } from "lucide-react";
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
import { ResortChip } from "@/components/shared/resort-chip";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { ExampleNotice, LoadExampleButton } from "@/components/tool-frame/example-data";
import { useStableOrder } from "@/hooks/use-stable-order";
import { generateFeatureFlagPrompts } from "@/lib/ai-prompts/feature-flag-tracker";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { plural } from "@/lib/charts/chart-text";
import {
  ENV_LABEL,
  PURPOSE_LABEL,
  STATUS_LABEL,
  compareFlags,
  flagStaleness,
  flagSummary,
  normalizeFlags,
  withLiveStatus,
  withRetired,
} from "@/lib/flags/model";
import { FEATURE_FLAG_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { RELEASE_DOC_ID } from "@/lib/releases/gates";
import { todayIso } from "@/lib/sprints/series";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { FeatureFlag, HandoffLink } from "@/lib/stores/workspace-types";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { undoable } from "@/lib/utils/undoable";
import {
  ageBuckets,
  ageChartText,
  createdPerWeek,
  creationTrend,
  flagSurvival,
  retiredWithDays,
  survivalChartText,
  trendSentence,
} from "./analysis";
import { buildExample } from "./example";
import { FlagCard } from "./flag-card";
import { FlagFields } from "./flag-fields";
import {
  applyFlag,
  emptyDraft,
  newFlag,
  releaseOptions,
  validateFlag,
  type FlagDraft,
  type FlagField,
  type FlagValues,
} from "./form";
import { toMarkdown } from "./markdown";
import { stalenessText } from "./text";
import { useLegacyFlagMove } from "./use-legacy-flags";
import { flagVerdict } from "./verdict";

// Recharts loads with each chart, not the page. The fixed-height boxes
// around them reserve the space while the chunk loads.
const chartPlaceholder = () => (
  <div className="h-full w-full animate-pulse rounded-lg bg-muted/30" aria-hidden="true" />
);
const FlagSurvivalChart = dynamic(() => import("./charts").then((m) => m.FlagSurvivalChart), {
  ssr: false,
  loading: chartPlaceholder,
});
const FlagAgeChart = dynamic(() => import("./charts").then((m) => m.FlagAgeChart), {
  ssr: false,
  loading: chartPlaceholder,
});

// A stable empty list: zustand re-renders forever on a selector that
// returns a fresh array each call.
const NONE: FeatureFlag[] = [];
const noLog = () => undefined;
const keyOf = (f: FeatureFlag) => f.id;

const PAGE = {
  toolId: "feature-flag-tracker",
  title: "Feature Flag Tracker",
  description:
    "Track each flag's purpose, owner and planned removal date, see which have outstayed their purpose, and retire them on the day they leave the code.",
  category: "Flow & Delivery",
} as const;

/** Focus what `find` returns once React has re-rendered (a deleted card took focus with it). */
function focusSoon(find: () => HTMLElement | null | undefined) {
  requestAnimationFrame(() => find()?.focus());
}

/**
 * Feature Flag Tracker on workspace.featureFlags: the flags Release
 * Readiness's flag gate, the next steps and agents read too. Each flag has
 * a purpose (which decides when it goes stale: kill switches never do), an
 * owner from the roster, a created day that can be backdated, a planned
 * removal day and the release it ships behind. Live flags are On or Off;
 * retiring takes a day. Deletes offer Undo.
 */
export function FeatureFlagTrackerClient() {
  const hydrated = useWorkspaceHydrated();
  const stored = useWorkspaceStore((s) => s.featureFlags) ?? NONE;
  const releaseDocs = useWorkspaceStore((s) => s.releaseReadinesses);
  const { log } = useHistoryLogger("feature-flag-tracker");
  const announce = useAnnounce();
  const [today, setToday] = useState(() => todayIso());
  const formRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  // The example lives here only: nothing in it reaches the workspace.
  const [example, setExample] = useState<FeatureFlag[] | null>(null);
  const preview = example !== null;
  const storedFlags = useMemo(() => normalizeFlags(stored), [stored]);
  const flags = useMemo(
    () => (example ? normalizeFlags(example) : storedFlags),
    [example, storedFlags]
  );
  const legacyPending = useLegacyFlagMove(stored);

  // Ages and staleness count days: catch up if the page stays open past midnight.
  useEffect(() => {
    const id = window.setInterval(() => setToday(todayIso()), 60 * 60 * 1000);
    return () => window.clearInterval(id);
  }, []);

  // Fixed for the render an edit starts in, so its Undo goes back to the
  // same place even if the example is loaded or cleared in between. The
  // example's edits aren't the team's history, so they aren't logged.
  const upsert: (f: FeatureFlag) => void = preview
    ? (f) =>
        setExample((list) =>
          list
            ? list.some((x) => x.id === f.id)
              ? list.map((x) => (x.id === f.id ? f : x))
              : [f, ...list]
            : list
        )
    : (f) => useWorkspaceStore.getState().upsertFeatureFlag(f);
  const removeOne: (id: string) => void = preview
    ? (id) => setExample((list) => (list ? list.filter((x) => x.id !== id) : list))
    : (id) => useWorkspaceStore.getState().removeFeatureFlag(id);
  const record: typeof log = preview ? noLog : log;

  const releases = (releaseDocs ?? []).find((d) => d.id === RELEASE_DOC_ID)?.releases;
  const options = useMemo(() => releaseOptions(releases), [releases]);
  const releaseName = (id: string) => releases?.find((r) => r.id === id)?.name?.trim() || undefined;

  const summary = useMemo(() => flagSummary(flags, today), [flags, today]);
  const verdict = flagVerdict(flags, today);
  // Live flags first, the most overdue at the top. An edit or a status
  // change doesn't move a card from under the cursor; "Re-sort" catches up.
  const { ordered, isStale, resort } = useStableOrder(flags, keyOf, (a, b) =>
    compareFlags(a, b, today)
  );
  const buckets = useMemo(() => ageBuckets(flags, today), [flags, today]);
  const ageText = ageChartText(buckets, flags, today);
  const survival = useMemo(() => flagSurvival(flags, today), [flags, today]);
  const retiredDated = retiredWithDays(flags, today);
  const weeks = useMemo(() => createdPerWeek(flags), [flags]);
  const trend = creationTrend(weeks);
  const markdown = toMarkdown(flags, today, releaseName);

  /* ── Changes ──────────────────────────────────────────────────────── */

  const current = (id: string) =>
    (preview ? (example ?? []) : (useWorkspaceStore.getState().featureFlags ?? [])).find(
      (f) => f.id === id
    );

  const add = (v: FlagValues) => {
    const flag = newFlag(v, crypto.randomUUID());
    upsert(flag);
    record(FEATURE_FLAG_ACTIONS.FLAG_ADDED, {
      flagId: flag.id,
      name: flag.name,
      purpose: flag.purpose,
      environment: flag.environment ?? null,
      createdAt: flag.createdAt,
    });
    announce(
      `Added “${flag.name}”, ${stalenessText(flagStaleness(flag, today), flag.purpose).toLowerCase()}`
    );
  };

  const save = (f: FeatureFlag, v: FlagValues) => {
    const next = applyFlag(f, v);
    if (next === f) return;
    upsert(next);
    record(FEATURE_FLAG_ACTIONS.FLAG_UPDATED, { flagId: f.id, name: next.name });
    announce(`Saved “${next.name}”`);
  };

  const setStatus = (f: FeatureFlag, status: "on" | "off") => {
    const next = withLiveStatus(f, status);
    if (next === f) return;
    upsert(next);
    record(FEATURE_FLAG_ACTIONS.FLAG_STATUS_CHANGED, { flagId: f.id, from: f.status, to: status });
    announce(
      f.status === "retired" ? `Brought back “${f.name}”, on` : `Turned “${f.name}” ${status}`
    );
  };

  const retire = (f: FeatureFlag, day: string) => {
    const before = f;
    undoable({
      label: `Retired “${f.name}”`,
      apply: () => {
        upsert(withRetired(f, day));
        record(FEATURE_FLAG_ACTIONS.FLAG_RETIRED, { flagId: f.id, retiredAt: day });
      },
      revert: () => {
        if (current(f.id)) upsert(before);
      },
    });
    announce(`Retired “${f.name}” on ${day}`);
  };

  const remove = (f: FeatureFlag) => {
    // Focus moves to the next card's Edit (or the one before, or the form).
    const at = ordered.findIndex((x) => x.id === f.id);
    const near = ordered[at + 1] ?? ordered[at - 1];
    undoable({
      label: `Deleted “${f.name}”`,
      apply: () => {
        removeOne(f.id);
        record(FEATURE_FLAG_ACTIONS.FLAG_REMOVED, { flagId: f.id, name: f.name });
      },
      revert: () => upsert(f),
    });
    announce(`Deleted “${f.name}”`);
    focusSoon(() =>
      near
        ? Array.from(document.querySelectorAll<HTMLElement>("[data-flag-edit]")).find(
            (el) => el.getAttribute("data-flag-edit") === near.id
          )
        : formRef.current?.querySelector<HTMLElement>("input")
    );
  };

  const patchLinks = (
    f: FeatureFlag,
    update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]
  ) => {
    const cur = current(f.id) ?? f;
    upsert({ ...cur, sentTo: update(cur.sentTo) });
  };

  const form = useItemForm<FlagDraft, FlagValues, FlagField>({
    initial: () => emptyDraft(today),
    validate: (d) => validateFlag(d, today),
    onSave: add,
  });

  const loadExample = () => setExample(buildExample(today));
  const clearExample = () => setExample(null);

  /* ── Exports ──────────────────────────────────────────────────────── */

  const promptConfig = useMemo(
    () => ({
      toolName: "Feature Flag Tracker",
      prompts: generateFeatureFlagPrompts({ flags, today, summary }),
    }),
    [flags, today, summary]
  );

  const csvData = {
    headers: [
      "Name",
      "Owner",
      "Status",
      "Purpose",
      "Environment",
      "Created",
      "Remove by",
      "Retired",
      "Age (days)",
      "Staleness",
      "Ships with",
      "Description",
    ],
    rows: [...flags]
      .sort((a, b) => compareFlags(a, b, today))
      .map((f) => {
        const st = flagStaleness(f, today);
        return [
          f.name,
          f.owner ?? "",
          STATUS_LABEL[f.status],
          PURPOSE_LABEL[f.purpose],
          f.environment ? ENV_LABEL[f.environment] : "",
          f.createdAt,
          f.removeBy ?? "",
          f.retiredAt ?? "",
          st.ageDays ?? "",
          f.status === "retired" ? "" : stalenessText(st, f.purpose),
          f.releaseId ? (releaseName(f.releaseId) ?? "") : "",
          (f.description ?? "").replace(/\n/g, " "),
        ];
      }),
  };

  if (!hydrated) {
    return (
      <ToolPageWrapper {...PAGE}>
        <p
          role="status"
          className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-sub"
        >
          Loading flags…
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
              Example: a shop&apos;s flags, a few of them overdue. Nothing in it is saved or sent to
              another tool, and your own flags stay as they are.
            </p>
          </div>
        )}
        {legacyPending && !preview && (
          <p
            role="status"
            className="rounded-lg border border-info/30 bg-info/10 px-4 py-2.5 text-sm text-text"
          >
            Moving the flags saved by the old tracker…
          </p>
        )}

        <ActionRow>
          <AiPromptGenerator config={promptConfig} />
          <ExportButton
            filename="feature-flag-tracker"
            csvData={csvData}
            jsonData={flags}
            markdown={markdown}
            targetRef={exportRef}
          />
        </ActionRow>

        <SectionCard title="Add a flag" icon={Plus} titleSize="lg">
          <div ref={formRef}>
            <ItemForm
              form={form}
              submitLabel="Add flag"
              submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
              footer={
                preview ? (
                  <p className="text-xs text-sub">
                    In the example, it goes on the example. Nothing is saved.
                  </p>
                ) : undefined
              }
            >
              <FlagFields
                form={form}
                today={today}
                releases={options}
                offerAddToRoster={!preview}
              />
            </ItemForm>
          </div>
        </SectionCard>

        {flags.length === 0 ? (
          !legacyPending && (
            <EmptyState
              icon={ToggleLeft}
              action={<LoadExampleButton onLoad={loadExample} className="mt-4" />}
            >
              No flags tracked yet. Add the ones in your code (backdate the ones that have been
              there a while) to see which have outstayed their purpose, or load an example.
            </EmptyState>
          )
        ) : (
          <>
            <KpiGrid cols={4} gap="lg">
              <StatCard
                variant="compact"
                icon={ToggleLeft}
                label="Live"
                value={summary.live}
                hint={`${summary.on} on · ${summary.off} off`}
                valueClassName="text-accent"
              />
              <StatCard
                variant="compact"
                icon={AlertTriangle}
                label="Stale"
                value={summary.stale}
                hint={summary.exempt > 0 ? `${summary.exempt} exempt` : undefined}
                tone={summary.stale > 0 ? "warning" : "default"}
              />
              <StatCard
                variant="compact"
                icon={Clock}
                label="Past removal date"
                value={summary.pastRemoval}
                tone={summary.pastRemoval > 0 ? "danger" : "default"}
              />
              <StatCard
                variant="compact"
                icon={Archive}
                label="Retired this quarter"
                value={summary.retiredThisQuarter}
                hint={`${summary.retired} retired in all`}
              />
            </KpiGrid>

            <div className="space-y-1">
              <p className="text-sm font-medium text-text">{verdict}</p>
              {summary.noOwner > 0 && (
                <p className="text-xs text-sub">
                  {summary.noOwner === 1
                    ? "1 live flag has no owner."
                    : `${summary.noOwner} live flags have no owner.`}{" "}
                  Somebody has to remove it: pick one with Edit.
                </p>
              )}
            </div>

            <section aria-label="Flags" className="space-y-2">
              <ResortChip isStale={isStale} onResort={resort} what="Statuses or dates" />
              <ul
                className="grid grid-cols-1 gap-3 lg:grid-cols-2"
                aria-label="Flags, the most overdue first"
              >
                {ordered.map((f) => (
                  <li key={f.id} className="min-w-0">
                    <FlagCard
                      flag={f}
                      today={today}
                      releases={options}
                      releaseName={f.releaseId ? releaseName(f.releaseId) : undefined}
                      preview={preview}
                      onStatus={setStatus}
                      onRetire={retire}
                      onSave={save}
                      onRemove={remove}
                      onLinksChange={patchLinks}
                    />
                  </li>
                ))}
              </ul>
            </section>

            {summary.live > 0 && (
              <SectionCard title="Live flags by age" icon={Clock} titleSize="lg">
                <ChartFigure
                  label="Live flags by age"
                  summary={ageText.summary}
                  table={ageText.table}
                  caption="Live flags by age"
                  plotClassName="h-56"
                >
                  <FlagAgeChart data={buckets} />
                </ChartFigure>
              </SectionCard>
            )}

            <AdvancedAnalysis summary="Advanced analysis: flag lifetimes and creation trend">
              <div className="space-y-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-text">
                  <Activity className="h-4 w-4 text-sub" aria-hidden="true" />
                  How long flags live
                </h3>
                {survival ? (
                  <ChartFigure
                    label="Share of flags still live after N days (Kaplan-Meier)"
                    summary={survivalChartText(survival).summary}
                    table={survivalChartText(survival).table}
                    caption="Flags still live after N days"
                    plotClassName="h-48"
                  >
                    <FlagSurvivalChart data={survival.curve} />
                  </ChartFigure>
                ) : (
                  <NotEnoughData
                    have={retiredDated}
                    need="distribution"
                    unit={["retired flag with its day", "retired flags with their days"]}
                    action="Retire"
                    what="how long flags usually live"
                  />
                )}
              </div>
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-text">Flags created per week</h3>
                {trend ? (
                  <p className="text-sm text-text">{trendSentence(trend, weeks.length)}</p>
                ) : weeks.length < MIN_SAMPLE.trend ? (
                  <NotEnoughData
                    have={weeks.length}
                    need="trend"
                    unit={["week of flags", "weeks of flags"]}
                    action="Track"
                    what="whether flag creation is speeding up"
                  />
                ) : (
                  <p className="text-sm text-sub">
                    Flags were created in only{" "}
                    {plural(weeks.filter((w) => w.value > 0).length, "week")} of the last{" "}
                    {weeks.length}: too few to read a trend (it needs 3).
                  </p>
                )}
              </div>
            </AdvancedAnalysis>
          </>
        )}
      </div>
    </ToolPageWrapper>
  );
}
