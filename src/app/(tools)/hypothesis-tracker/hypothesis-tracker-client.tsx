"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Lightbulb, Activity } from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { durationsFromTimeRanges, kaplanMeier, medianSurvivalTime } from "@/lib/analytics/survival";
import { generateHypothesisTrackerPrompts } from "@/lib/ai-prompts/hypothesis-tracker";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { HYPOTHESIS_ACTIONS } from "@/lib/history/event-actions";
import { ActionRow } from "@/components/shared/action-row";
import { StatCard } from "@/components/shared/stat-card";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionCard } from "@/components/shared/section-card";
import { emit as sonify } from "@/lib/sonification/emit";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { todayLocalISO } from "@/lib/utils/formatters";
import { chartTheme } from "@/components/charts/chart-theme";

type Status = "drafted" | "running" | "validated" | "invalidated" | "inconclusive";

interface Hypothesis {
  id: string;
  // Optional rationale/context captured at creation. Distinct from `outcome`,
  // which is filled in only after the hypothesis resolves.
  description?: string;
  believe: string;
  willDo: string;
  toLearn: string;
  successMetric: string;
  experiment?: string;
  outcome?: string;
  status: Status;
  raisedAt: string;
  resolvedAt?: string;
}

function empty(): Hypothesis {
  return {
    id: nanoid(8),
    believe: "",
    willDo: "",
    toLearn: "",
    successMetric: "",
    status: "drafted",
    raisedAt: todayLocalISO(),
  };
}

function setStatus(h: Hypothesis, status: Status): Hypothesis {
  const done = status === "validated" || status === "invalidated" || status === "inconclusive";
  return { ...h, status, resolvedAt: done ? (h.resolvedAt ?? todayLocalISO()) : undefined };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type TextField =
  | "description"
  | "believe"
  | "willDo"
  | "toLearn"
  | "successMetric"
  | "experiment"
  | "outcome";

function useDraftField(value: string, commit: (next: string) => void) {
  const [draft, setDraft] = useState(value);
  const lastRef = useRef(value);
  useEffect(() => {
    setDraft(value);
    lastRef.current = value;
  }, [value]);
  const onBlur = () => {
    // Cap committed value at 4000 chars. Hypothesis statements / outcomes
    // are essay-length but rarely book-length; without the cap a paste-bomb
    // would balloon the persisted store past the 5 MB origin quota and
    // silently kill writes for every other tool on this domain.
    const next = draft.slice(0, 4000);
    if (next !== lastRef.current) {
      lastRef.current = next;
      commit(next);
    }
  };
  return { draft, setDraft, onBlur };
}

function HypothesisRow({
  h,
  update,
  logUpdate,
  updateStatus,
  remove,
}: {
  h: Hypothesis;
  update: (id: string, patch: Partial<Hypothesis>) => void;
  logUpdate: (id: string, fields: string[]) => void;
  updateStatus: (id: string, status: Status) => void;
  remove: (id: string) => void;
}) {
  const description = useDraftField(h.description ?? "", (next) => {
    update(h.id, { description: next });
    logUpdate(h.id, ["description"]);
  });
  const believe = useDraftField(h.believe, (next) => {
    update(h.id, { believe: next });
    logUpdate(h.id, ["believe"]);
  });
  const willDo = useDraftField(h.willDo, (next) => {
    update(h.id, { willDo: next });
    logUpdate(h.id, ["willDo"]);
  });
  const toLearn = useDraftField(h.toLearn, (next) => {
    update(h.id, { toLearn: next });
    logUpdate(h.id, ["toLearn"]);
  });
  const successMetric = useDraftField(h.successMetric, (next) => {
    update(h.id, { successMetric: next });
    logUpdate(h.id, ["successMetric"]);
  });
  const experiment = useDraftField(h.experiment ?? "", (next) => {
    update(h.id, { experiment: next });
    logUpdate(h.id, ["experiment"]);
  });
  const outcome = useDraftField(h.outcome ?? "", (next) => {
    update(h.id, { outcome: next });
    logUpdate(h.id, ["outcome"]);
  });

  return (
    <Card className="bg-surface border-border">
      <CardContent className="p-4 space-y-3">
        {/* Optional one-line context for the hypothesis. Captured at
            creation, distinct from the post-hoc `outcome` field. */}
        <Textarea
          rows={2}
          value={description.draft}
          onChange={(e) => description.setDraft(e.target.value)}
          onBlur={description.onBlur}
          placeholder="Description (optional) — context, link, or rationale..."
          className="bg-bg border-border text-sm"
        />
        <div className="flex items-start gap-3">
          <Lightbulb className="w-5 h-5 text-accent mt-0.5 shrink-0" />
          <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-2">
            <div>
              <div className="text-[10px] uppercase text-sub mb-1">We believe</div>
              <Textarea
                rows={2}
                value={believe.draft}
                onChange={(e) => believe.setDraft(e.target.value)}
                onBlur={believe.onBlur}
                placeholder="... that users want X"
                className="bg-bg border-border text-sm"
              />
            </div>
            <div>
              <div className="text-[10px] uppercase text-sub mb-1">We will do</div>
              <Textarea
                rows={2}
                value={willDo.draft}
                onChange={(e) => willDo.setDraft(e.target.value)}
                onBlur={willDo.onBlur}
                placeholder="... ship feature Y"
                className="bg-bg border-border text-sm"
              />
            </div>
            <div>
              <div className="text-[10px] uppercase text-sub mb-1">To learn</div>
              <Textarea
                rows={2}
                value={toLearn.draft}
                onChange={(e) => toLearn.setDraft(e.target.value)}
                onBlur={toLearn.onBlur}
                placeholder="... whether users engage"
                className="bg-bg border-border text-sm"
              />
            </div>
          </div>
          <div className="flex flex-col gap-2 items-end">
            <Select value={h.status} onValueChange={(v) => updateStatus(h.id, v as Status)}>
              <SelectTrigger className="bg-bg border-border w-full sm:w-36 capitalize">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(
                  ["drafted", "running", "validated", "invalidated", "inconclusive"] as Status[]
                ).map((s) => (
                  <SelectItem key={s} value={s} className="capitalize">
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => remove(h.id)}
              className="text-sub hover:text-danger"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <Input
            value={successMetric.draft}
            onChange={(e) => successMetric.setDraft(e.target.value)}
            onBlur={successMetric.onBlur}
            placeholder="Success metric (e.g. 30% DAU activation within 14 days)"
            className="bg-bg border-border text-sm"
          />
          <Input
            value={experiment.draft}
            onChange={(e) => experiment.setDraft(e.target.value)}
            onBlur={experiment.onBlur}
            placeholder="Experiment design"
            className="bg-bg border-border text-sm"
          />
        </div>
        {h.resolvedAt && (
          <Textarea
            rows={2}
            value={outcome.draft}
            onChange={(e) => outcome.setDraft(e.target.value)}
            onBlur={outcome.onBlur}
            placeholder="Outcome: what did we learn?"
            className="bg-bg border-border text-sm"
          />
        )}
        <div className="text-xs text-sub flex items-center gap-3">
          <Badge variant="outline" className="capitalize">
            {h.status}
          </Badge>
          <span>raised {h.raisedAt}</span>
          {h.resolvedAt && <span>resolved {h.resolvedAt}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

const HT_ID = "hypothesisTracker:current"; // MUST match HT_ID in hypothesis-tracker.ts.
const EMPTY_HYPOTHESES: Hypothesis[] = [];

// Synced workspace singleton (was isolated usePersisted/localStorage) wrapping
// the hypotheses[] array. Drop-in [state, setState] (structural types).
function useHypotheses(): [
  Hypothesis[],
  (u: Hypothesis[] | ((p: Hypothesis[]) => Hypothesis[])) => void,
] {
  const doc = useWorkspaceStore(
    useShallow((s) => (s.hypothesisTrackers ?? []).find((d) => d.id === HT_ID))
  );
  const upsert = useWorkspaceStore((s) => s.upsertHypothesisTracker);
  const items = doc?.hypotheses ?? EMPTY_HYPOTHESES;
  const setItems = (u: Hypothesis[] | ((p: Hypothesis[]) => Hypothesis[])) => {
    const cur =
      (useWorkspaceStore.getState().hypothesisTrackers ?? []).find((d) => d.id === HT_ID)
        ?.hypotheses ?? [];
    const next = typeof u === "function" ? u(cur) : u;
    upsert({ id: HT_ID, hypotheses: next });
  };
  return [items, setItems];
}

export function HypothesisTrackerClient() {
  const [items, setItems] = useHypotheses();
  const { log } = useHistoryLogger("hypothesis-tracker");

  const add = () => {
    const item = empty();
    setItems((s) => [item, ...s]);
    log(HYPOTHESIS_ACTIONS.HYPOTHESIS_ADDED, { hypothesisId: item.id });
  };
  const update = (id: string, patch: Partial<Hypothesis>) => {
    setItems((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  };
  const logUpdate = (id: string, fields: string[]) => {
    log(HYPOTHESIS_ACTIONS.HYPOTHESIS_UPDATED, {
      hypothesisId: id,
      fields,
    });
  };
  const updateStatus = (id: string, status: Status) => {
    if (status === "validated") sonify("hypothesis-tracker", "validated");
    else if (status === "invalidated") sonify("hypothesis-tracker", "invalidated");
    else sonify("hypothesis-tracker", "status-change");
    const prev = items.find((x) => x.id === id);
    setItems((s) => s.map((x) => (x.id === id ? setStatus(x, status) : x)));
    log(HYPOTHESIS_ACTIONS.STATUS_CHANGED, {
      hypothesisId: id,
      from: prev?.status,
      to: status,
    });
  };
  const remove = (id: string) => {
    const item = items.find((x) => x.id === id);
    setItems((s) => s.filter((x) => x.id !== id));
    log(HYPOTHESIS_ACTIONS.HYPOTHESIS_REMOVED, {
      hypothesisId: id,
      believe: item?.believe,
    });
  };

  const validationRate = useMemo(() => {
    const closed = items.filter((i) => i.resolvedAt);
    if (closed.length === 0) return 0;
    return closed.filter((i) => i.status === "validated").length / closed.length;
  }, [items]);

  // ── Tier-2: KM survival on validation time (raised → validated/invalidated) ──
  const resolvedDurations = useMemo(
    () =>
      items
        .filter((i) => i.resolvedAt)
        .map((i) => {
          const start = new Date(i.raisedAt).getTime();
          const end = new Date(i.resolvedAt!).getTime();
          // Bail out for malformed dates by returning NaN, which the
          // `Number.isFinite` filter below excludes. Without this, a bad
          // entry produced `NaN` (start) − `NaN` (end) = `NaN` which then
          // poisoned the survival series and broke the chart.
          if (!Number.isFinite(start) || !Number.isFinite(end)) return NaN;
          return Math.max(0, Math.round((end - start) / 86_400_000));
        })
        .filter((d) => Number.isFinite(d)),
    [items]
  );

  const survivalCurve = useMemo(() => {
    if (resolvedDurations.length < 4) return [];
    const obs = durationsFromTimeRanges(
      items.map((i) => ({ raisedAt: i.raisedAt, resolvedAt: i.resolvedAt }))
    );
    return kaplanMeier(obs);
  }, [items, resolvedDurations.length]);

  const medianTimeToValidate = medianSurvivalTime(survivalCurve);

  const survivalChartData = useMemo(
    () => survivalCurve.map((p) => ({ t: p.t, survival: Math.round(p.survival * 1000) / 1000 })),
    [survivalCurve]
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "Hypothesis Tracker",
      prompts: generateHypothesisTrackerPrompts({ items, validationRate, medianTimeToValidate }),
    }),
    [items, validationRate, medianTimeToValidate]
  );

  return (
    <ToolPageWrapper
      toolId="hypothesis-tracker"
      title="Hypothesis Tracker"
      description="Frame product bets as testable hypotheses. Track validation rate and median time-to-learn."
      category="Product Discovery"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="hypotheses"
          csvData={{
            headers: [
              "Description",
              "Believe",
              "Will do",
              "To learn",
              "Success metric",
              "Experiment",
              "Outcome",
              "Status",
              "Raised",
              "Resolved",
            ],
            rows: items.map((i) => [
              i.description ?? "",
              i.believe,
              i.willDo,
              i.toLearn,
              i.successMetric,
              i.experiment ?? "",
              i.outcome ?? "",
              i.status,
              i.raisedAt,
              i.resolvedAt ?? "",
            ]),
          }}
          jsonData={items}
        />
        <Button onClick={add} className="gap-2 bg-accent text-bg hover:bg-accent/90">
          <Plus className="w-4 h-4" />
          New Hypothesis
        </Button>
      </ActionRow>

      <KpiGrid cols={3}>
        <StatCard variant="compact" label="Total" value={items.length} />
        <StatCard
          variant="compact"
          label="Validation Rate"
          value={`${Math.round(validationRate * 100)}%`}
          hint="of closed hypotheses"
          valueClassName="text-accent"
        />
        <StatCard
          variant="compact"
          label="Median Time to Learn"
          value={medianTimeToValidate !== null ? `${medianTimeToValidate}d` : "—"}
        />
      </KpiGrid>

      {survivalChartData.length > 1 && (
        <SectionCard
          title="Validation survival curve"
          icon={Activity}
          titleSuffix={
            medianTimeToValidate !== null ? `Median ${medianTimeToValidate}d` : undefined
          }
          className="my-4"
        >
          <div className="h-40 -mx-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={survivalChartData}
                margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
              >
                <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" />
                <XAxis
                  dataKey="t"
                  tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
                  axisLine={{ stroke: chartTheme.gridColor }}
                  label={{
                    value: "days",
                    fill: chartTheme.axisColor,
                    fontSize: 10,
                    position: "insideBottom",
                    offset: -2,
                  }}
                />
                <YAxis
                  domain={[0, 1]}
                  tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
                  axisLine={{ stroke: chartTheme.gridColor }}
                  tickFormatter={(v) => `${Math.round(v * 100)}%`}
                />
                <Tooltip
                  contentStyle={chartTheme.tooltipStyle}
                  formatter={(v) => [`${(Number(v) * 100).toFixed(1)}%`, "still open"]}
                  labelFormatter={(v) => `${v}d`}
                />
                <Line
                  type="stepAfter"
                  dataKey="survival"
                  stroke={chartTheme.colors.cyan}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11px] text-sub mt-2">
            Kaplan-Meier estimate over {resolvedDurations.length} resolved hypothes
            {resolvedDurations.length === 1 ? "is" : "es"} (drafted / running are right-censored).
            Y-axis: probability the hypothesis is still open after N days.
          </p>
        </SectionCard>
      )}

      <div className="space-y-3">
        {items.map((h) => (
          <HypothesisRow
            key={h.id}
            h={h}
            update={update}
            logUpdate={logUpdate}
            updateStatus={updateStatus}
            remove={remove}
          />
        ))}
        {items.length === 0 && (
          <EmptyState icon={Lightbulb}>
            No hypotheses yet. Click &ldquo;New Hypothesis&rdquo; to start.
          </EmptyState>
        )}
      </div>
    </ToolPageWrapper>
  );
}
