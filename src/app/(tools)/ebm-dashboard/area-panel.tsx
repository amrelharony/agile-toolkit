"use client";

/**
 * One key value area: what it asks, its progress, its measures (latest
 * reading, trend, target, progress, and the toolkit reading when it has a
 * source), measure ideas and Ask Amr, and the experiments measured by its
 * measures. The page does every write.
 */

import { useRef, useState } from "react";
import Link from "next/link";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { AiButton, AiSuggestions } from "@/components/ai";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import type {
  EbmValueArea,
  Hypothesis,
  MetricSourceId,
  ProductMetric,
} from "@/lib/stores/workspace-types";
import { formatMetric } from "@/lib/hypotheses/model";
import { testFixHref } from "@/lib/product-metrics/next-steps";
import {
  EMPTY_METRIC_DRAFT,
  isMetricsExample,
  latestReading,
  type MetricValues,
} from "@/lib/product-metrics/model";
import {
  AREA_LABEL,
  AREA_MEANING,
  areaProgress,
  scoreText,
  sourcesFor,
  weakestMeasure,
} from "@/lib/ebm/model";
import { MEASURE_IDEAS, type MeasureIdea } from "@/lib/ebm/ideas";
import { SOURCE_INFO } from "@/lib/ebm/source-info";
import type { SourceReading } from "@/lib/ebm/sources";
import {
  MEASURES_EXISTING_MAX,
  ebmMeasuresTask,
  type EbmMeasuresInput,
  type EbmMeasuresOutput,
} from "@/lib/ai/tasks/ebm-dashboard.lite";
import type { AiSource } from "@/lib/ai/task-types";
import { MetricForm, SELECT_CLASS } from "@/app/(tools)/product-metrics/metric-form";
import { MetricNumbers } from "@/app/(tools)/product-metrics/views";

type Suggested = EbmMeasuresOutput["measures"][number];

const nameKey = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

export interface AreaPanelProps {
  area: EbmValueArea;
  measures: readonly ProductMetric[];
  allMetrics: readonly ProductMetric[];
  readings: Partial<Record<MetricSourceId, SourceReading | null>>;
  experiments: readonly { hypothesis: Hypothesis; metricId: string }[];
  aiInput: Omit<EbmMeasuresInput, "area" | "existing">;
  onAdd: (values: MetricValues, source?: MetricSourceId) => string | null;
  onAddIdeas: (ideas: (MeasureIdea | Suggested)[]) => number;
  onReading: (m: ProductMetric) => void;
  onEdit: (m: ProductMetric) => void;
  onRemove: (m: ProductMetric) => void;
  /** What removing `m` would break (hypotheses or A/B tests linked to it), or null. */
  removeWarning: (m: ProductMetric) => string | null;
  onAcceptSource: (m: ProductMetric, reading: SourceReading) => void;
}

export function AreaPanel({
  area,
  measures,
  allMetrics,
  readings,
  experiments,
  aiInput,
  onAdd,
  onAddIdeas,
  onReading,
  onEdit,
  onRemove,
  removeWarning,
  onAcceptSource,
}: AreaPanelProps) {
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [source, setSource] = useState<MetricSourceId | "">("");
  const [problem, setProblem] = useState("");
  const [answer, setAnswer] = useState<{ items: Suggested[]; source: AiSource } | null>(null);
  const askRef = useRef<HTMLDivElement>(null);
  const progress = areaProgress(measures);
  const names = new Set(measures.map((m) => nameKey(m.name)));
  const ideas = MEASURE_IDEAS[area].filter((i) => !names.has(nameKey(i.name)));
  const suggestions = answer ? answer.items.filter((s) => !names.has(nameKey(s.name))) : [];
  const weakest = weakestMeasure(measures);
  const sources = sourcesFor(area);
  const headingId = `ebm-area-${area}`;
  const removeId = (id: string) => `${headingId}-remove-${id}`;

  /** Remove `m`; its row goes, so focus moves to the area's heading. */
  const remove = (m: ProductMetric) => {
    setConfirming(null);
    onRemove(m);
    requestAnimationFrame(() => headingRef.current?.focus());
  };
  const askRemove = (m: ProductMetric) => (removeWarning(m) ? setConfirming(m.id) : remove(m));
  const keep = (m: ProductMetric) => {
    setConfirming(null);
    requestAnimationFrame(() => document.getElementById(removeId(m.id))?.focus());
  };

  return (
    <section
      aria-labelledby={headingId}
      className="min-w-0 space-y-3 rounded-lg border border-border p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3
            id={headingId}
            ref={headingRef}
            tabIndex={-1}
            className="font-display text-base font-semibold text-text focus:outline-none"
          >
            {AREA_LABEL[area]}
          </h3>
          <p className="text-xs text-sub">{AREA_MEANING[area]}</p>
        </div>
        <p className="text-sm text-text">
          Area progress: <span className="font-data font-semibold">{scoreText(progress)}</span>
        </p>
      </div>

      {measures.length === 0 ? (
        <p className="text-sm text-sub">No measures yet.</p>
      ) : (
        <ul className="space-y-2">
          {measures.map((m) => {
            const reading = m.source ? readings[m.source] : undefined;
            const latest = latestReading(m);
            const fresh =
              reading &&
              !(latest && latest.date === reading.date && latest.value === reading.value);
            return (
              <li key={m.id} className="min-w-0 rounded-md bg-surface-deep p-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="min-w-0 break-words text-sm font-medium text-text">
                    {m.name}
                    {isMetricsExample(m.id) && (
                      <span className="ml-1 text-xs font-normal text-sub">
                        (from the Product Metrics example)
                      </span>
                    )}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    <Button type="button" size="sm" variant="outline" onClick={() => onReading(m)}>
                      <Plus aria-hidden="true" />
                      Reading
                    </Button>
                    <IconButton
                      label={`Edit “${m.name}”`}
                      icon={<Pencil className="h-4 w-4" aria-hidden="true" />}
                      onClick={() => onEdit(m)}
                    />
                    <IconButton
                      id={removeId(m.id)}
                      label={`Remove “${m.name}” from ${AREA_LABEL[area]}`}
                      icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                      onClick={() => askRemove(m)}
                    />
                  </div>
                </div>
                <div className="mt-1">
                  <MetricNumbers metric={m} />
                </div>
                {m.source && (
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-sub">
                    <span>
                      From {SOURCE_INFO[m.source].tool}:{" "}
                      {reading
                        ? `${formatMetric(reading.value, m.unit)} on ${reading.date} (${reading.basis})`
                        : "not enough data there yet"}
                    </span>
                    {fresh && reading && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => onAcceptSource(m, reading)}
                      >
                        Add this reading
                      </Button>
                    )}
                  </p>
                )}
                {confirming === m.id && (
                  <div
                    role="alert"
                    className="mt-2 space-y-2 rounded-md border border-warning/20 bg-warning/10 p-2 text-sm"
                  >
                    <p>{removeWarning(m)}</p>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => remove(m)}>
                        Delete it
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => keep(m)}>
                        Keep it
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {problem && (
        <p className="text-sm text-danger" role="alert">
          {problem}
        </p>
      )}

      {adding ? (
        <MetricForm
          initial={EMPTY_METRIC_DRAFT}
          id="metric_new"
          all={allMetrics}
          views={false}
          directionLockedBy={source ? SOURCE_INFO[source].label : undefined}
          submitLabel={`Add to ${AREA_LABEL[area]}`}
          onSave={(values) => {
            const why = onAdd(values, source || undefined);
            if (why) setProblem(why);
            else {
              setProblem("");
              setAdding(false);
              setSource("");
            }
          }}
          onCancel={() => {
            setAdding(false);
            setSource("");
          }}
        >
          {sources.length > 0
            ? ({ draft, update }) => (
                <Field
                  label="Read it from the toolkit"
                  hint="Optional. The page offers that tool's number as a reading, and it sets which way is better."
                >
                  {(props) => (
                    <select
                      {...props}
                      className={SELECT_CLASS}
                      value={source}
                      onChange={(e) => {
                        const id = e.target.value as MetricSourceId | "";
                        setSource(id);
                        if (!id) return;
                        const info = SOURCE_INFO[id];
                        update({ direction: info.direction, unit: info.unit ?? draft.unit });
                      }}
                    >
                      <option value="">No, I&apos;ll type the readings</option>
                      {sources.map((id) => (
                        <option key={id} value={id}>
                          {SOURCE_INFO[id].label}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              )
            : null}
        </MetricForm>
      ) : (
        <div ref={askRef} className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" />
            Add a measure
          </Button>
          <AiButton
            task={ebmMeasuresTask}
            input={() => ({
              ...aiInput,
              area,
              existing: measures.slice(0, MEASURES_EXISTING_MAX).map((m) => m.name.slice(0, 200)),
            })}
            label="Ask Amr"
            fallbackLabel="Suggest measures"
            onResult={(data, meta) => setAnswer({ items: data.measures, source: meta.source })}
          />
        </div>
      )}

      {answer && suggestions.length === 0 && (
        <p role="status" className="text-sm text-sub">
          Every suggestion is already a measure here.
        </p>
      )}

      {answer && suggestions.length > 0 && (
        <AiSuggestions
          items={suggestions}
          source={answer.source}
          title={`Measures for ${AREA_LABEL[area]}`}
          render={(s) => ({ title: s.name, detail: s.definition || undefined })}
          itemKey={(s) => s.name}
          onAccept={(s) => onAddIdeas([s])}
          onAcceptAll={(items) => onAddIdeas(items)}
          onDismiss={() => setAnswer(null)}
          returnFocus={() => askRef.current?.querySelector("button")}
        />
      )}

      {!adding && ideas.length > 0 && (
        <div className="text-xs text-sub">
          <p>Ideas:</p>
          <ul className="mt-1 flex flex-wrap gap-1">
            {ideas.map((i) => (
              <li key={i.name}>
                <Button type="button" size="sm" variant="ghost" onClick={() => onAddIdeas([i])}>
                  <Plus aria-hidden="true" />
                  {i.name}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-1">
        <h4 className="text-xs font-medium text-sub">Experiments</h4>
        {experiments.length === 0 ? (
          <p className="text-sm text-sub">No hypothesis is measured by these measures yet.</p>
        ) : (
          <ul className="space-y-0.5 text-sm">
            {experiments.map((e) => (
              <li key={e.hypothesis.id} className="break-words">
                {e.hypothesis.believe}{" "}
                <span className="text-xs text-sub">({e.hypothesis.status})</span>
              </li>
            ))}
          </ul>
        )}
        {weakest && (
          <Link href={testFixHref(weakest.id)} className="text-sm text-accent hover:underline">
            Run an experiment
            <span className="sr-only"> for {AREA_LABEL[area]}</span>
          </Link>
        )}
      </div>
    </section>
  );
}
