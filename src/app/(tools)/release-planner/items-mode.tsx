"use client";

/**
 * The Release Planner's "count items" mode: how many items are left, the
 * weekly throughput the forecast replays, the answers (when N items are
 * done, how many land by the target date), and the cut line through an
 * ordered list of features. The plan comes in ready (./throughput); these
 * components show it and hand edits back.
 */

import { useId, useState, type Ref } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  Calendar,
  Gauge,
  Layers,
  ListOrdered,
  Plus,
  Scissors,
  Trash2,
} from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { fmt, plural } from "@/lib/charts/chart-text";
import { formatDay } from "@/lib/sprints/release-forecast";
import {
  FEATURES_MAX,
  MAX_WEEKS,
  THROUGHPUT_ITERATIONS,
  THROUGHPUT_WINDOWS,
  perWeekText,
  validateWeeklyCounts,
  type ThroughputWindow,
} from "@/lib/sprints/throughput-forecast";
import type { Epic } from "@/lib/stores/workspace-types";
import { cn } from "@/lib/utils";
import { NumberField, inputCls } from "./inputs";
import type { BacklogScope } from "./scope-source";
import type { ReleasePlannerConfig } from "./store";
import {
  EMPTY_FEATURE_DRAFT,
  ITEMS_SOURCE_LABEL,
  THROUGHPUT_SOURCE_LABEL,
  itemsVerdict,
  sampleLine,
  validateFeatureDraft,
  type FeatureDraft,
  type ForecastMode,
  type ItemsPlan,
  type ItemsSource,
  type ReleaseFeature,
  type ThroughputSource,
} from "./throughput";
import { validateItemCount } from "./validate";

const linkCls = "text-accent underline-offset-2 hover:underline";

/** "Forecast by": story points (velocity) or items (throughput). */
export function ModeSwitch({
  mode,
  onMode,
}: {
  mode: ForecastMode;
  onMode: (mode: ForecastMode) => void;
}) {
  return (
    <ToggleGroup<ForecastMode>
      label="Forecast by"
      size="sm"
      value={mode}
      onValueChange={onMode}
      options={[
        { value: "points", label: "Story points" },
        { value: "items", label: "Item count" },
      ]}
    />
  );
}

/* ── Inputs ─────────────────────────────────────────────────────────── */

export function ItemsCard({
  headingRef,
  config,
  source,
  backlog,
  onSource,
  onQuiet,
  onCommit,
}: {
  headingRef: Ref<HTMLSpanElement>;
  config: ReleasePlannerConfig;
  source: ItemsSource;
  backlog: BacklogScope;
  onSource: (v: ItemsSource) => void;
  onQuiet: (updates: Partial<ReleasePlannerConfig>) => void;
  onCommit: (updates: Partial<ReleasePlannerConfig>) => void;
}) {
  return (
    <SectionCard
      title={
        <span ref={headingRef} tabIndex={-1} className="outline-none">
          Items left
        </span>
      }
      icon={Layers}
    >
      <div className="space-y-4">
        <ToggleGroup<ItemsSource>
          label="Where the item count comes from"
          size="sm"
          value={source}
          onValueChange={onSource}
          options={(["backlog", "typed"] as const).map((v) => ({
            value: v,
            label: ITEMS_SOURCE_LABEL[v],
          }))}
        />
        {source === "backlog" ? (
          backlog.stories === 0 ? (
            <p className="text-sm text-sub">
              No open stories yet. Add them in{" "}
              <Link href="/sprint-planning" className={linkCls}>
                Sprint Planning
              </Link>
              , or type a number.
            </p>
          ) : (
            <p className="text-sm text-sub">
              <span className="font-data text-base text-text">
                {plural(backlog.stories, "open story", "open stories")}
              </span>
              , counted whatever their size: an item forecast trusts stories to be about the same
              size.
            </p>
          )
        ) : (
          <NumberField
            label="Items left to finish"
            suffix="items"
            value={config.itemsCount ?? null}
            placeholder="e.g. 40"
            validate={validateItemCount}
            onChange={(v) => onQuiet({ itemsCount: v ?? undefined })}
            onCommit={(v) => onCommit({ itemsCount: v ?? undefined })}
          />
        )}
      </div>
    </SectionCard>
  );
}

/** The typed weekly counts: only a valid list is saved. */
function CountsField({
  value,
  hint,
  onChange,
  onCommit,
}: {
  value: string;
  hint: string;
  onChange: (value: string) => void;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [synced, setSynced] = useState(value);
  // Follow an outside change (Reset, the example, Undo).
  if (value !== synced) {
    setSynced(value);
    setDraft(value);
    setError(null);
  }
  const check = (raw: string) => {
    const message = validateWeeklyCounts(raw);
    setError(message);
    return message === null;
  };
  return (
    <Field label="Items finished per week, oldest first" hint={hint} error={error ?? undefined}>
      {(props) => (
        <textarea
          {...props}
          value={draft}
          rows={3}
          placeholder="e.g. 4, 6, 3, 0, 5"
          onChange={(e) => {
            const raw = e.target.value;
            setDraft(raw);
            if (check(raw)) {
              setSynced(raw);
              onChange(raw);
            }
          }}
          onBlur={() => {
            if (check(draft)) {
              setSynced(draft);
              onCommit(draft);
            }
          }}
          className="w-full resize-none rounded-md border border-border bg-surface-deep px-3 py-2 font-data text-sm text-text focus:border-accent/50 focus:outline-none focus:ring-1 focus:ring-accent/20"
        />
      )}
    </Field>
  );
}

export function ThroughputCard({
  config,
  plan,
  finished,
  onSource,
  onWindow,
  onQuiet,
  onCommit,
}: {
  config: ReleasePlannerConfig;
  plan: ItemsPlan;
  /** Finished items on each board, for the source buttons' counts. */
  finished: { stories: number; cards: number };
  onSource: (v: ThroughputSource) => void;
  onWindow: (v: ThroughputWindow) => void;
  onQuiet: (updates: Partial<ReleasePlannerConfig>) => void;
  onCommit: (updates: Partial<ReleasePlannerConfig>) => void;
}) {
  const windowId = useId();
  const { sample } = plan;
  const average = plan.forecast.average;
  return (
    <SectionCard title="Throughput" icon={Gauge}>
      <div className="space-y-4">
        <ToggleGroup<ThroughputSource>
          label="Where the weekly counts come from"
          size="sm"
          value={sample.source}
          onValueChange={onSource}
          options={(["stories", "cards", "typed"] as const).map((v) => ({
            value: v,
            label: THROUGHPUT_SOURCE_LABEL[v],
          }))}
        />
        {sample.source === "typed" ? (
          <CountsField
            value={config.throughputInput ?? ""}
            onChange={(v) => onQuiet({ throughputInput: v })}
            onCommit={(v) => onCommit({ throughputInput: v })}
            hint={
              sample.values.length === 0
                ? "Commas, spaces or one per line. A week with nothing finished counts as 0."
                : `${plural(sample.values.length, "week")}${
                    average === null ? "" : `, about ${perWeekText(average)}`
                  }.`
            }
          />
        ) : (
          <div className="space-y-2 text-sm text-sub">
            {sample.values.length === 0 ? (
              <p>
                Nothing finished on the {THROUGHPUT_SOURCE_LABEL[sample.source]} before this week
                yet. Items count once they reach Done on the{" "}
                <Link href="/kanban" className={linkCls}>
                  board
                </Link>
                , or type the counts.
              </p>
            ) : (
              <>
                <p>
                  {sampleLine(sample)}, oldest first:{" "}
                  <span className="font-data text-text">{sample.values.join(", ")}</span>
                </p>
                {average !== null && <p>About {perWeekText(average)}.</p>}
              </>
            )}
            <p className="text-xs">
              Finished so far: {plural(finished.stories, "story", "stories")} on the Sprint board,{" "}
              {plural(finished.cards, "card")} on the Flow board. The week in progress counts once
              it ends.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor={windowId} className="text-sm text-text">
                Weeks of history
              </label>
              <select
                id={windowId}
                value={sample.window}
                onChange={(e) => onWindow(Number(e.target.value) as ThroughputWindow)}
                className={cn(inputCls, "h-11 rounded-md border px-2 text-sm pointer-fine:md:h-9")}
              >
                {THROUGHPUT_WINDOWS.map((w) => (
                  <option key={w} value={w}>
                    The last {w}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

/* ── Results ────────────────────────────────────────────────────────── */

/** Runs per week count as bars, with the P85 bar marked; read as one sentence. */
function WeeksHistogram({
  histogram,
  p50,
  p85,
}: {
  histogram: { weeks: number; count: number }[];
  p50: number | null;
  p85: number | null;
}) {
  if (histogram.length === 0) return null;
  const max = Math.max(...histogram.map((h) => h.count));
  const first = histogram[0].weeks;
  const last = histogram[histogram.length - 1].weeks;
  const label = `Weeks needed across ${THROUGHPUT_ITERATIONS.toLocaleString("en-US")} runs: from ${plural(
    first,
    "week"
  )} to ${plural(last, "week")}${p50 !== null ? `, half within ${plural(p50, "week")}` : ""}${
    p85 !== null ? `, 85% within ${plural(p85, "week")}` : ""
  }.`;
  return (
    <figure className="space-y-1">
      <div
        role="img"
        aria-label={label}
        className="flex h-28 items-end gap-px"
        data-weeks-histogram
      >
        {histogram.map((h) => (
          <div
            key={h.weeks}
            className={cn(
              "min-w-0 flex-1 rounded-t-sm",
              h.weeks === p85 ? "bg-accent" : h.weeks === p50 ? "bg-accent/60" : "bg-accent/30"
            )}
            style={{ height: `${Math.max(2, (h.count / max) * 100)}%` }}
          />
        ))}
      </div>
      <figcaption className="flex justify-between text-xs text-sub">
        <span>{plural(first, "week")}</span>
        <span>The solid bar is the 85% line</span>
        <span>{plural(last, "week")}</span>
      </figcaption>
    </figure>
  );
}

export function ItemsResults({ plan, plotRef }: { plan: ItemsPlan; plotRef: Ref<HTMLDivElement> }) {
  const headingId = useId();
  const f = plan.forecast;
  const when = f.when;
  const how = f.howMany;
  const typed = plan.sample.source === "typed";
  return (
    <SectionCard title="Forecast" icon={Calendar} titleSize="lg">
      <div className="space-y-5" ref={plotRef}>
        {!f.enough && f.notEnough === "few-weeks" ? (
          <NotEnoughData
            have={f.weeksUsed}
            need="forecast"
            unit={["week of throughput", "weeks of throughput"]}
            action={typed ? "Type" : "Finish work over"}
            what="an item forecast"
          />
        ) : (
          <p className="text-sm font-medium text-text" data-testid="items-verdict">
            {itemsVerdict(plan)}
          </p>
        )}

        {when && (
          <section aria-labelledby={`${headingId}-when`} className="space-y-3">
            <h3 id={`${headingId}-when`} className="text-sm font-semibold text-text">
              When will {plural(when.items, "item")} be done?
            </h3>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard
                variant="compact"
                label="Coin flip (P50)"
                value={when.dates.p50 ? formatDay(when.dates.p50) : "—"}
                hint={when.weeks.p50 !== null ? plural(when.weeks.p50, "week") : undefined}
              />
              <StatCard
                variant="compact"
                label="Commit (P85)"
                value={when.dates.p85 ? formatDay(when.dates.p85) : "—"}
                hint={when.weeks.p85 !== null ? plural(when.weeks.p85, "week") : undefined}
                tone="success"
              />
              <StatCard
                variant="compact"
                label="Safe (P95)"
                value={when.dates.p95 ? formatDay(when.dates.p95) : "—"}
                hint={when.weeks.p95 !== null ? plural(when.weeks.p95, "week") : undefined}
              />
              <StatCard
                variant="compact"
                label="By the target"
                value={when.chance === null ? "—" : `${Math.round(when.chance * 100)}%`}
                hint={plan.target ? formatDay(plan.target) : "Set a target date"}
                tone={when.chance !== null && when.chance < 0.5 ? "warning" : "default"}
              />
            </div>
            {when.unfinished > 0 && (
              <p className="text-xs text-sub">
                {plural(when.unfinished, "run")} didn&apos;t finish within {MAX_WEEKS} weeks.
              </p>
            )}
            <WeeksHistogram histogram={when.histogram} p50={when.weeks.p50} p85={when.weeks.p85} />
          </section>
        )}

        {how && (
          <section aria-labelledby={`${headingId}-how`} className="space-y-3">
            <h3 id={`${headingId}-how`} className="text-sm font-semibold text-text">
              How many items by {formatDay(how.target)}?
            </h3>
            <p className="text-xs text-sub">{plural(how.weeks, "whole week")} from the start.</p>
            <dl className="grid grid-cols-3 gap-3">
              {(
                [
                  ["Likely (P50)", how.p50],
                  ["To promise (P85)", how.p85],
                  ["Safe (P95)", how.p95],
                ] as const
              ).map(([label, n]) => (
                <div key={label} className="rounded-lg border border-border bg-surface-deep p-3">
                  <dt className="text-xs text-sub">{label}</dt>
                  <dd className="font-data text-2xl text-text">
                    {fmt(n, 0)}
                    <span className="ml-1 text-sm text-sub">items</span>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {f.enough && !when && !how && (
          <p className="text-sm text-sub">
            Set the items left, or a target date under Dates, to see when they&apos;re done or how
            many fit.
          </p>
        )}
      </div>
    </SectionCard>
  );
}

/* ── The cut line ───────────────────────────────────────────────────── */

export function CutLineCard({
  plan,
  features,
  epics,
  onAdd,
  onMove,
  onRemove,
}: {
  plan: ItemsPlan;
  /** The stored features, in order. */
  features: readonly ReleaseFeature[];
  epics: readonly Pick<Epic, "id" | "title">[];
  onAdd: (feature: Omit<ReleaseFeature, "id">) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onRemove: (feature: ReleaseFeature) => void;
}) {
  const [draft, setDraft] = useState<FeatureDraft>(EMPTY_FEATURE_DRAFT);
  const [errors, setErrors] = useState<Partial<Record<"name" | "items", string>>>({});
  const cut = plan.forecast.cutLine;
  const byId = new Map(plan.features.map((r, i) => [r.id, { row: r, at: cut?.rows[i] }]));
  const above = cut?.above ?? null;

  const submit = () => {
    const result = validateFeatureDraft(draft, epics, features.length);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setDraft(EMPTY_FEATURE_DRAFT);
    onAdd(result.values);
  };

  return (
    <SectionCard title="Features in order" icon={ListOrdered}>
      <div className="space-y-4">
        <p className="text-sm text-sub">
          List the features in the order they&apos;ll be built. Each one&apos;s date counts the ones
          before it, and the target date draws the line: above it, likely done by then (85% of
          runs).
        </p>

        {features.length > 0 && (
          <ol aria-label="Features in order" className="space-y-2">
            {features.map((feature, i) => {
              const info = byId.get(feature.id);
              const row = info?.row;
              const at = info?.at;
              const lineHere = above !== null && i === above && plan.target;
              return (
                <li key={feature.id} className="space-y-2" data-feature={feature.id}>
                  {lineHere && <CutMark target={plan.target as string} />}
                  <div
                    className={cn(
                      "flex flex-wrap items-center gap-2 rounded-lg border border-border p-3",
                      at?.inByTarget === false ? "bg-card" : "bg-surface-deep"
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm font-medium text-text">
                        {i + 1}. {row?.name ?? feature.name}
                      </p>
                      <p className="text-xs text-sub">
                        {plural(row?.items ?? feature.items ?? 0, "item")}
                        {row?.epicId
                          ? row.epicMissing
                            ? " · its epic is no longer on the roadmap"
                            : " · open stories in the epic"
                          : ""}
                        {at
                          ? ` · likely ${at.p50Date ? formatDay(at.p50Date) : "—"}, safe ${
                              at.p85Date ? formatDay(at.p85Date) : "—"
                            }`
                          : ""}
                        {at?.inByTarget === false ? " · below the line" : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <IconButton
                        tooltip={false}
                        label={`Move ${row?.name ?? feature.name} up`}
                        icon={<ArrowUp aria-hidden="true" />}
                        disabled={i === 0}
                        onClick={() => onMove(feature.id, -1)}
                      />
                      <IconButton
                        tooltip={false}
                        label={`Move ${row?.name ?? feature.name} down`}
                        icon={<ArrowDown aria-hidden="true" />}
                        disabled={i === features.length - 1}
                        onClick={() => onMove(feature.id, 1)}
                      />
                      <IconButton
                        tooltip={false}
                        label={`Remove ${row?.name ?? feature.name}`}
                        icon={<Trash2 aria-hidden="true" />}
                        onClick={() => onRemove(feature)}
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {features.length > 0 && above !== null && plan.target && above === features.length && (
          <CutMark target={plan.target} />
        )}

        {features.length > 0 && !cut && (
          <p className="text-sm text-sub">The dates appear once there is a forecast.</p>
        )}
        {cut && !plan.target && (
          <p className="text-sm text-sub">Set a target date under Dates to draw the cut line.</p>
        )}

        {features.length < FEATURES_MAX && (
          <form
            className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            aria-label="Add a feature"
          >
            <Field label="Feature" error={errors.name}>
              {(props) => (
                <Input
                  {...props}
                  value={draft.name}
                  maxLength={120}
                  placeholder="e.g. Saved cards"
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                />
              )}
            </Field>
            <Field label="Items" error={errors.items}>
              {(props) => (
                <Input
                  {...props}
                  inputMode="numeric"
                  value={draft.items}
                  disabled={Boolean(draft.epicId)}
                  placeholder={draft.epicId ? "From the epic" : "e.g. 12"}
                  onChange={(e) => setDraft((d) => ({ ...d, items: e.target.value }))}
                />
              )}
            </Field>
            <Field label="Or an epic">
              {(props) => (
                <select
                  {...props}
                  value={draft.epicId}
                  onChange={(e) => setDraft((d) => ({ ...d, epicId: e.target.value }))}
                  className={cn(
                    inputCls,
                    "h-11 w-full rounded-md border px-2 text-sm pointer-fine:md:h-9"
                  )}
                >
                  <option value="">Type the count</option>
                  {epics.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.title}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Button type="submit" size="sm" className="gap-1">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add
            </Button>
          </form>
        )}
        {epics.length === 0 && (
          <p className="text-xs text-sub">
            Epics on the{" "}
            <Link href="/epic-roadmap" className={linkCls}>
              Epic Roadmap
            </Link>{" "}
            can be counted here by their open stories.
          </p>
        )}
      </div>
    </SectionCard>
  );
}

function CutMark({ target }: { target: string }) {
  return (
    <p
      className="flex items-center gap-2 border-t-2 border-dashed border-warning pt-1 text-xs font-medium text-warning"
      data-cut-line
    >
      <Scissors className="h-3.5 w-3.5" aria-hidden="true" />
      Cut line: {formatDay(target)}
    </p>
  );
}
