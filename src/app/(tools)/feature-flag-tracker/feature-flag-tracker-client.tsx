"use client";

import { useEffect, useId, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ActionRow } from "@/components/shared/action-row";
import { StatCard } from "@/components/shared/stat-card";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { CalloutAlert } from "@/components/shared/callout-alert";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionCard } from "@/components/shared/section-card";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Trash2,
  ToggleLeft,
  AlertTriangle,
  Archive,
  Clock,
  Activity,
  TrendingUp,
} from "lucide-react";
import { usePersisted } from "@/lib/utils/use-persisted";
import { todayLocalISO } from "@/lib/utils/formatters";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { FEATURE_FLAG_ACTIONS } from "@/lib/history/event-actions";
import { generateFeatureFlagPrompts } from "@/lib/ai-prompts/feature-flag-tracker";
import { cn } from "@/lib/utils";
import { durationsFromTimeRanges, kaplanMeier, medianSurvivalTime } from "@/lib/analytics/survival";
import { bootstrapQuantile } from "@/lib/analytics/bootstrap";
import { mannKendall } from "@/lib/analytics/trend-test";

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

type FlagStatus = "active" | "on" | "off" | "deprecated";
type FlagEnv = "dev" | "staging" | "prod" | "all";
type FlagPurpose = "rollout" | "experiment" | "kill_switch" | "permission";

interface Flag {
  id: string;
  name: string;
  owner?: string;
  status: FlagStatus;
  createdAt: string;
  retiredAt?: string;
  environment: FlagEnv;
  purpose: FlagPurpose;
  description?: string;
}

const STATUS_LABEL: Record<FlagStatus, string> = {
  active: "Active",
  on: "On",
  off: "Off",
  deprecated: "Deprecated",
};

const ENV_LABEL: Record<FlagEnv, string> = {
  dev: "Dev",
  staging: "Staging",
  prod: "Prod",
  all: "All",
};

const PURPOSE_LABEL: Record<FlagPurpose, string> = {
  rollout: "Rollout",
  experiment: "Experiment",
  kill_switch: "Kill switch",
  permission: "Permission",
};

const STALE_DAYS = 90;

/**
 * Parse a `YYYY-MM-DD` string as a *local* date (midnight local time).
 * Avoids `new Date(iso)` which interprets bare date strings as UTC and so
 * shifts the day back/forward depending on the user's timezone.
 */
function parseLocalDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function ageDays(iso: string): number {
  const d = parseLocalDate(iso) ?? new Date(iso);
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function isStale(f: Flag): boolean {
  if (f.retiredAt) return false;
  if (f.status === "deprecated") return false;
  return ageDays(f.createdAt) > STALE_DAYS;
}

export function FeatureFlagTrackerClient() {
  const [flags, setFlags] = usePersisted<Flag[]>("agile-toolkit:feature-flag-tracker", []);
  const { log } = useHistoryLogger("feature-flag-tracker");

  const uid = useId();
  const [name, setName] = useState("");
  const [owner, setOwner] = useState("");
  const [environment, setEnvironment] = useState<FlagEnv>("prod");
  const [purpose, setPurpose] = useState<FlagPurpose>("rollout");
  const [description, setDescription] = useState("");

  // Hourly tick so `Date.now()`-derived ages (and the stale flag) refresh
  // when the page is left open across midnight without requiring a reload.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 3600_000);
    return () => clearInterval(id);
  }, []);

  const addFlag = () => {
    // Flag names are typically code identifiers — cap at 200 chars so a
    // paste of an entire stack trace doesn't end up as the name. Owner
    // and description are similarly bounded to keep storage in check.
    const trimmed = name.trim().slice(0, 200);
    if (!trimmed) return;
    const flag: Flag = {
      id: crypto.randomUUID(),
      name: trimmed,
      owner: owner.trim().slice(0, 120) || undefined,
      status: "active",
      createdAt: todayLocalISO(),
      environment,
      purpose,
      description: description.trim().slice(0, 4000) || undefined,
    };
    setFlags((prev) => [flag, ...prev]);
    log(FEATURE_FLAG_ACTIONS.FLAG_ADDED, {
      flagId: flag.id,
      name: flag.name,
      purpose: flag.purpose,
      environment: flag.environment,
    });
    setName("");
    setOwner("");
    setEnvironment("prod");
    setPurpose("rollout");
    setDescription("");
  };

  const removeFlag = (id: string) => {
    const flag = flags.find((f) => f.id === id);
    setFlags((prev) => prev.filter((f) => f.id !== id));
    log(FEATURE_FLAG_ACTIONS.FLAG_REMOVED, { flagId: id, name: flag?.name });
  };

  const setStatus = (id: string, status: FlagStatus) => {
    setFlags((prev) => prev.map((f) => (f.id === id ? { ...f, status } : f)));
    log(FEATURE_FLAG_ACTIONS.FLAG_UPDATED, {
      flagId: id,
      fields: ["status"],
    });
  };

  const retireFlag = (id: string) => {
    setFlags((prev) =>
      prev.map((f) =>
        f.id === id ? { ...f, status: "deprecated", retiredAt: todayLocalISO() } : f
      )
    );
    log(FEATURE_FLAG_ACTIONS.FLAG_RETIRED, { flagId: id });
  };

  const stats = useMemo(() => {
    const active = flags.filter(
      (f) => f.status === "active" || f.status === "on" || f.status === "off"
    ).length;
    const stale = flags.filter(isStale).length;
    const now = new Date();
    const quarter = Math.floor(now.getMonth() / 3);
    const quarterStart = new Date(now.getFullYear(), quarter * 3, 1).getTime();
    const retiredThisQuarter = flags.filter((f) => {
      if (!f.retiredAt) return false;
      // Parse `retiredAt` as a local date so it lines up with `quarterStart`
      // (also computed in local time). Using `new Date(iso)` would treat a
      // bare YYYY-MM-DD as UTC and could miscount near quarter boundaries.
      const retired = parseLocalDate(f.retiredAt);
      if (!retired) return false;
      return retired.getTime() >= quarterStart;
    }).length;
    const byPurpose: Record<FlagPurpose, number> = {
      rollout: 0,
      experiment: 0,
      kill_switch: 0,
      permission: 0,
    };
    for (const f of flags) byPurpose[f.purpose] += 1;
    return { active, stale, retiredThisQuarter, byPurpose };
  }, [flags]);

  const ageBuckets = useMemo(() => {
    const buckets = [
      { label: "0-30d", min: 0, max: 30 },
      { label: "31-90d", min: 31, max: 90 },
      { label: "91-180d", min: 91, max: 180 },
      { label: ">180d", min: 181, max: Infinity },
    ];
    return buckets.map((b) => ({
      bucket: b.label,
      count: flags.filter((f) => {
        if (f.retiredAt) return false;
        const age = ageDays(f.createdAt);
        return age >= b.min && age <= b.max;
      }).length,
    }));
  }, [flags]);

  // ── Tier-2: KM survival on flag age before retirement ──────────────
  const retiredAges = useMemo(() => {
    return flags
      .filter((f) => f.retiredAt)
      .map((f) => {
        const start = parseLocalDate(f.createdAt) ?? new Date(f.createdAt);
        const end = parseLocalDate(f.retiredAt!) ?? new Date(f.retiredAt!);
        return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86_400_000));
      })
      .filter((d) => Number.isFinite(d));
  }, [flags]);

  const survivalCurve = useMemo(() => {
    if (retiredAges.length < 4) return [];
    // A "deprecated" flag with no `retiredAt` should still be treated as a
    // retirement event for KM purposes — leaving them as censored would
    // pretend the flag is still alive and bias survival upward. Stamp them
    // with today's date so they exit the risk set now.
    const today = todayLocalISO();
    const obs = durationsFromTimeRanges(
      flags.map((f) => ({
        raisedAt: f.createdAt,
        resolvedAt: f.retiredAt ?? (f.status === "deprecated" ? today : undefined),
      }))
    );
    return kaplanMeier(obs);
    // R5: dep was `[flags, retiredAges.length]` which missed CONTENT
    // changes to `flags` whose `retiredAges.length` was unchanged
    // (e.g., a status flip that re-stamps `retiredAt` on an existing
    // count). Depend on `flags` only — the survival curve recomputes
    // exactly when its inputs change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flags]);

  const medianFlagAge = useMemo(() => medianSurvivalTime(survivalCurve), [survivalCurve]);

  const medianFlagAgeCI = useMemo(() => {
    if (retiredAges.length < 3) return null;
    return bootstrapQuantile(retiredAges, 0.5);
  }, [retiredAges]);

  const survivalChartData = useMemo(
    () => survivalCurve.map((p) => ({ t: p.t, survival: Math.round(p.survival * 1000) / 1000 })),
    [survivalCurve]
  );

  // Mann-Kendall on weekly flag-creation count for the trend chip.
  // Anchor at today - 26 weeks so the chart always shows the most recent
  // half-year of activity rather than getting frozen on the team's earliest
  // ever flag (which would let recent surges drop silently off the right edge).
  const weeklyFlagCount = useMemo(() => {
    if (flags.length === 0) return [];
    const WEEKS = 26;
    // R11-fix: unify on LOCAL time throughout. The previous mix
    // (UTC-anchored weekStart + local-parsed flag timestamps) drifted
    // by up to one week in UTC+8 / UTC-12 zones when flags were
    // created late in the evening. `f.createdAt` is `todayLocalISO()`
    // → parseLocalDate returns the local-midnight Date; the anchor
    // and weekStart now also use local accessors so the bucketing
    // matches the user's calendar.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // Step back via setDate() and bucket against explicit per-week boundaries,
    // mirroring oncall-roster (BUG-T5-oncall-roster-4/5). The previous
    // `floor((t - weekStart) / (7*86_400_000))` divided by a fixed week-in-ms:
    // across a DST transition the ms-distance between two local midnights is no
    // longer an exact week multiple, AND the window boundary pushed the most
    // recent days into bucket 26 (>= WEEKS) which the `w < WEEKS` guard dropped
    // — so the latest flags silently vanished from the chart and skewed the
    // Mann-Kendall trend. A linear scan over setDate()-built boundaries fixes both.
    const anchor = new Date(today);
    anchor.setDate(today.getDate() - WEEKS * 7);
    const weekStart = new Date(anchor);
    weekStart.setDate(anchor.getDate() - anchor.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const ts = flags
      .map((f) => parseLocalDate(f.createdAt)?.getTime() ?? new Date(f.createdAt).getTime())
      .filter((t) => Number.isFinite(t) && t >= weekStart.getTime());
    if (ts.length === 0) return [];
    const bucketStarts: number[] = [];
    for (let w = 0; w < WEEKS; w++) {
      const start = new Date(weekStart);
      start.setDate(weekStart.getDate() + w * 7);
      start.setHours(0, 0, 0, 0);
      bucketStarts.push(start.getTime());
    }
    const counts = new Array(WEEKS).fill(0) as number[];
    for (const t of ts) {
      // Linear scan over 26 buckets — assign to the latest bucket that started
      // on or before t. Every t >= weekStart lands in a bucket (never dropped).
      for (let w = WEEKS - 1; w >= 0; w--) {
        if (t >= bucketStarts[w]) {
          counts[w] += 1;
          break;
        }
      }
    }
    return counts;
  }, [flags]);

  const flagTrend = useMemo(() => {
    if (weeklyFlagCount.length < 5) return null;
    // BUG-RD3-feature-flag-tracker-1: Mann-Kendall on a series that is
    // almost entirely zeros (e.g. 25 weeks of 0 + 1 week with a flag)
    // is degenerate — the rank statistic is dominated by ties and the
    // resulting "trend" reading is just noise. Require at least 3
    // non-zero weeks before computing the trend so we don't surface a
    // misleading chip on extremely sparse data.
    const nonZeroWeeks = weeklyFlagCount.filter((c) => c > 0).length;
    if (nonZeroWeeks < 3) return null;
    return mannKendall(weeklyFlagCount);
  }, [weeklyFlagCount]);

  const promptConfig = useMemo(
    () => ({
      toolName: "Feature Flag Tracker",
      prompts: generateFeatureFlagPrompts({
        flags: flags.map((f) => ({
          name: f.name,
          owner: f.owner,
          status: f.status,
          createdAt: f.createdAt,
          retiredAt: f.retiredAt,
          environment: f.environment,
          purpose: f.purpose,
          description: f.description,
        })),
        active: stats.active,
        stale: stats.stale,
        retiredThisQuarter: stats.retiredThisQuarter,
        byPurpose: stats.byPurpose,
      }),
    }),
    [flags, stats]
  );

  return (
    <ToolPageWrapper
      toolId="feature-flag-tracker"
      title="Feature Flag Tracker"
      description="Catalog active flags, surface stale ones, and keep retirement on the team's radar."
      category="Flow & Delivery"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="feature-flag-tracker"
          csvData={{
            headers: [
              "Name",
              "Owner",
              "Status",
              "Environment",
              "Purpose",
              "Created",
              "Retired",
              "Age (days)",
              "Description",
            ],
            rows: flags.map((f) => [
              f.name,
              f.owner ?? "",
              f.status,
              f.environment,
              f.purpose,
              f.createdAt,
              f.retiredAt ?? "",
              ageDays(f.createdAt),
              (f.description ?? "").replace(/\n/g, " "),
            ]),
          }}
          jsonData={flags}
        />
      </ActionRow>

      <KpiGrid cols={4} gap="lg">
        <StatCard
          variant="compact"
          icon={ToggleLeft}
          label="Active flags"
          value={stats.active}
          valueClassName="text-accent"
        />
        <StatCard
          variant="compact"
          icon={AlertTriangle}
          label="Stale (>90d)"
          value={stats.stale}
          tone={stats.stale > 0 ? "warning" : "default"}
        />
        <StatCard
          variant="compact"
          icon={Archive}
          label="Retired this quarter"
          value={stats.retiredThisQuarter}
        />
        <StatCard
          variant="compact"
          icon={Clock}
          label="Total tracked"
          value={flags.length}
          hint={`${stats.byPurpose.experiment} experiment(s)`}
        />
      </KpiGrid>

      {stats.stale > 0 && (
        <CalloutAlert tone="warning" className="mb-4">
          <strong>{stats.stale}</strong> flag{stats.stale === 1 ? "" : "s"} older than {STALE_DAYS}{" "}
          days {stats.stale === 1 ? "is" : "are"} still active. Schedule a retirement sweep before
          they ossify.
        </CalloutAlert>
      )}

      {flagTrend && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {flagTrend.significant ? (
            <span
              className={`inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider px-2 py-1 rounded-md border ${
                flagTrend.trend === "up"
                  ? "border-warning/40 text-warning bg-warning/10"
                  : "border-success/40 text-success bg-success/10"
              }`}
            >
              <TrendingUp className={`w-3 h-3 ${flagTrend.trend === "down" ? "rotate-180" : ""}`} />
              Weekly flag creation trending {flagTrend.trend} significantly
              <span className="opacity-60">· p={flagTrend.pValue.toFixed(3)}</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider px-2 py-1 rounded-md border border-border text-sub bg-surface">
              <TrendingUp className="w-3 h-3" />
              Weekly flag creation trend: no significant change
            </span>
          )}
        </div>
      )}

      {survivalChartData.length > 1 && (
        <SectionCard
          title="Flag retirement survival curve"
          icon={Activity}
          titleSuffix={
            medianFlagAge !== null
              ? `Median ${medianFlagAge}d${
                  medianFlagAgeCI
                    ? ` · 95% CI [${Math.round(medianFlagAgeCI.lower)}, ${Math.round(medianFlagAgeCI.upper)}]`
                    : ""
                }`
              : undefined
          }
          className="mb-4"
        >
          <div className="h-40 -mx-2">
            <FlagSurvivalChart data={survivalChartData} />
          </div>
          <p className="text-xs text-sub mt-2">
            Kaplan-Meier estimate over {retiredAges.length} retired flag
            {retiredAges.length === 1 ? "" : "s"} (active flags are right-censored). Y-axis:
            probability the flag is still active after N days.
          </p>
        </SectionCard>
      )}

      {/* Add-flag form */}
      <Card className="bg-surface border-border mb-4">
        <CardContent className="p-4 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_140px_160px_auto] gap-2">
            <div>
              <Label htmlFor={`${uid}-name`} className="text-xs text-sub">
                Name
              </Label>
              <Input
                id={`${uid}-name`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="checkout_v2_rollout"
                className="bg-bg border-border font-data"
              />
            </div>
            <div>
              <Label htmlFor={`${uid}-owner`} className="text-xs text-sub">
                Owner
              </Label>
              <Input
                id={`${uid}-owner`}
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                placeholder="Owner (optional)"
                className="bg-bg border-border"
              />
            </div>
            <div>
              <Label htmlFor={`${uid}-env`} className="text-xs text-sub">
                Environment
              </Label>
              <Select value={environment} onValueChange={(v) => setEnvironment(v as FlagEnv)}>
                <SelectTrigger id={`${uid}-env`} className="bg-bg border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["dev", "staging", "prod", "all"] as FlagEnv[]).map((e) => (
                    <SelectItem key={e} value={e}>
                      {ENV_LABEL[e]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor={`${uid}-purpose`} className="text-xs text-sub">
                Purpose
              </Label>
              <Select value={purpose} onValueChange={(v) => setPurpose(v as FlagPurpose)}>
                <SelectTrigger id={`${uid}-purpose`} className="bg-bg border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["rollout", "experiment", "kill_switch", "permission"] as FlagPurpose[]).map(
                    (p) => (
                      <SelectItem key={p} value={p}>
                        {PURPOSE_LABEL[p]}
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button
                onClick={addFlag}
                className="gap-2 bg-accent text-bg hover:bg-accent/90 w-full"
              >
                <Plus className="w-4 h-4" />
                Add
              </Button>
            </div>
          </div>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)..."
            rows={2}
            className="bg-bg border-border resize-none text-xs"
            aria-label="Description"
          />
        </CardContent>
      </Card>

      {flags.length === 0 ? (
        <EmptyState icon={ToggleLeft}>
          No flags tracked yet. Add the ones currently in your codebase to start spotting
          stragglers.
        </EmptyState>
      ) : (
        <>
          <div className="space-y-2 mb-6">
            {flags
              .slice()
              .sort((a, b) => ageDays(b.createdAt) - ageDays(a.createdAt))
              .map((f) => {
                const stale = isStale(f);
                const age = ageDays(f.createdAt);
                return (
                  <Card
                    key={f.id}
                    className={cn(
                      "border",
                      stale
                        ? "bg-warning/5 border-warning/40"
                        : f.retiredAt
                          ? "bg-bg/50 border-border"
                          : "bg-surface border-border"
                    )}
                  >
                    <CardContent className="p-3">
                      <div className="grid grid-cols-1 md:grid-cols-[1.5fr_1fr_140px_120px_140px_auto] gap-2 items-start">
                        <div className="min-w-0">
                          <div className="font-data text-sm text-text break-all">{f.name}</div>
                          {f.description && (
                            <div className="text-xs text-sub mt-0.5 whitespace-pre-wrap">
                              {f.description}
                            </div>
                          )}
                        </div>
                        <div className="text-xs text-sub">
                          {f.owner ? (
                            <>
                              <span className="text-text">{f.owner}</span>
                              <span> · {ENV_LABEL[f.environment]}</span>
                            </>
                          ) : (
                            ENV_LABEL[f.environment]
                          )}
                          <div className="text-xs mt-0.5">{PURPOSE_LABEL[f.purpose]}</div>
                        </div>
                        <Select
                          value={f.status}
                          onValueChange={(v) => setStatus(f.id, v as FlagStatus)}
                        >
                          <SelectTrigger
                            className="bg-bg border-border h-8 text-xs"
                            aria-label={`Status for ${f.name}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(["active", "on", "off", "deprecated"] as FlagStatus[]).map((s) => (
                              <SelectItem key={s} value={s} className="text-xs">
                                {STATUS_LABEL[s]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <div
                          className={cn(
                            "text-xs font-data px-2 py-1 rounded text-center",
                            !Number.isFinite(age)
                              ? "bg-bg text-sub"
                              : stale
                                ? "bg-danger/15 text-danger"
                                : age > 30
                                  ? "bg-warning/10 text-warning"
                                  : "bg-bg text-sub"
                          )}
                        >
                          {/* BUG-T3-feature-flag-tracker-2: don't render
                              "NaNd" for flags with an unparseable
                              createdAt — show an em-dash instead. */}
                          {Number.isFinite(age) ? `${age}d` : "—"}
                          {f.retiredAt && (
                            <div className="text-xs text-sub mt-0.5">retired {f.retiredAt}</div>
                          )}
                        </div>
                        <div className="text-xs text-sub">since {f.createdAt}</div>
                        <div className="flex items-center gap-1 justify-end">
                          {!f.retiredAt && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => retireFlag(f.id)}
                              className="h-7 text-xs gap-1"
                            >
                              <Archive className="w-3 h-3" />
                              Retire
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeFlag(f.id)}
                            className="text-sub hover:text-danger min-touch-coarse"
                            aria-label={`Remove ${f.name}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
          </div>

          <Card className="bg-surface border-border">
            <CardContent className="p-4">
              <div className="text-sm font-semibold text-text mb-3">Flags by age (active only)</div>
              <div className="h-56 -mx-2">
                <FlagAgeChart data={ageBuckets} />
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </ToolPageWrapper>
  );
}
