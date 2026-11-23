"use client";

/**
 * "Ask Amr" for metrics: suggestions for the view open (a North Star with
 * inputs, HEART for a feature, the funnel's stages), from what the product
 * does. The person adds one or all through the page's store, with Undo;
 * a suggestion that would break a view's rule (a second North Star, a
 * second metric on a stage) or repeats a name reads "already set" and
 * can't be added. Without AI, "Suggest metrics" answers from our own
 * templates.
 */

import { useMemo, useRef, useState } from "react";
import { AiButton, AiSuggestions } from "@/components/ai";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  SUGGEST_EXISTING_MAX,
  SUGGEST_FEATURE_MAX,
  SUGGEST_PRODUCT_MAX,
  productMetricsSuggestTask,
  type MetricFramework,
  type MetricsSuggestInput,
  type SuggestedMetric,
} from "@/lib/ai/tasks/product-metrics.lite";
import type { AiSource } from "@/lib/ai/task-types";
import type { ProductMetric } from "@/lib/stores/workspace-types";
import {
  AARRR_LABEL,
  HEART_LABEL,
  ROLE_LABEL,
  compactMetric,
  metricRuleProblems,
} from "@/lib/product-metrics/model";

const nameKey = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const cut = (s: string, max: number) => (s.length > max ? s.slice(0, max) : s);

/** A suggestion as a new metric row (no readings yet). */
export function rowFromSuggestion(
  s: SuggestedMetric,
  id: string,
  now: string,
  feature: string
): ProductMetric {
  return compactMetric({
    id,
    name: s.name,
    definition: s.definition || undefined,
    unit: s.unit || undefined,
    direction: s.direction,
    role: s.role,
    heart: s.heartCategory
      ? {
          category: s.heartCategory,
          feature: feature.trim() || "The feature",
          ...(s.goal ? { goal: s.goal } : {}),
          ...(s.signal ? { signal: s.signal } : {}),
        }
      : undefined,
    aarrr: s.aarrrStage,
    readings: [],
    createdAt: now,
    updatedAt: now,
  });
}

const where = (s: SuggestedMetric) =>
  [
    s.role ? ROLE_LABEL[s.role] : "",
    s.heartCategory ? `HEART: ${HEART_LABEL[s.heartCategory]}` : "",
    s.aarrrStage ? `Funnel: ${AARRR_LABEL[s.aarrrStage]}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

export function SuggestPanel({
  framework,
  metrics,
  productGoal,
  newId,
  onAdd,
}: {
  framework: MetricFramework;
  metrics: readonly ProductMetric[];
  productGoal: string | null;
  newId: () => string;
  /** Write the rows (with Undo); returns how many went in. */
  onAdd: (rows: ProductMetric[]) => number;
}) {
  const [product, setProduct] = useState("");
  const [feature, setFeature] = useState("");
  const [answer, setAnswer] = useState<{ items: SuggestedMetric[]; source: AiSource } | null>(null);
  const [status, setStatus] = useState("");
  const buttonRef = useRef<HTMLDivElement>(null);
  const real = useMemo(() => metrics.filter((m) => !m.id.startsWith("example-")), [metrics]);

  const input = (): MetricsSuggestInput => ({
    framework,
    product: cut(product.trim(), SUGGEST_PRODUCT_MAX),
    ...(productGoal ? { productGoal: cut(productGoal, 1000) } : {}),
    ...(framework === "heart" && feature.trim()
      ? { feature: cut(feature.trim(), SUGGEST_FEATURE_MAX) }
      : {}),
    existing: real.slice(0, SUGGEST_EXISTING_MAX).map((m) => cut(m.name, 200)),
  });

  const blocked = (s: SuggestedMetric): string | null => {
    if (real.some((m) => nameKey(m.name) === nameKey(s.name)))
      return "already set: the name is in your list";
    const row = rowFromSuggestion(s, "metric_check", new Date().toISOString(), feature);
    return metricRuleProblems(row, real).length > 0 ? "already set" : null;
  };
  const open = answer ? answer.items.filter((s) => !blocked(s)) : [];
  const taken = answer ? answer.items.filter((s) => blocked(s)) : [];

  const add = (items: SuggestedMetric[]) => {
    const now = new Date().toISOString();
    const n = onAdd(items.map((s) => rowFromSuggestion(s, newId(), now, feature)));
    setStatus(
      n === items.length
        ? `Added ${n} ${n === 1 ? "metric" : "metrics"}.`
        : `Added ${n} of ${items.length}: the rest would break a view's rule.`
    );
  };

  return (
    <section aria-label="Suggest metrics" className="space-y-3 rounded-lg border border-border p-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field
          label="What does your product do?"
          hint="One line, for Ask Amr. Nothing here is saved."
        >
          {(props) => (
            <Input
              {...props}
              maxLength={SUGGEST_PRODUCT_MAX}
              value={product}
              onChange={(e) => setProduct(e.target.value)}
            />
          )}
        </Field>
        {framework === "heart" && (
          <Field label="Feature">
            {(props) => (
              <Input
                {...props}
                maxLength={SUGGEST_FEATURE_MAX}
                value={feature}
                onChange={(e) => setFeature(e.target.value)}
              />
            )}
          </Field>
        )}
      </div>
      <div ref={buttonRef} className="flex flex-wrap items-center gap-2">
        <AiButton
          task={productMetricsSuggestTask}
          input={input}
          label="Ask Amr"
          fallbackLabel="Suggest metrics"
          disabledReason={
            !product.trim()
              ? "Say what the product does first."
              : framework === "heart" && !feature.trim()
                ? "Name the feature first."
                : null
          }
          onResult={(data, meta) => {
            setStatus("");
            setAnswer({ items: data.metrics, source: meta.source });
          }}
        />
      </div>
      <p role="status" aria-live="polite" className="text-xs text-sub">
        {status}
      </p>
      {answer && open.length > 0 && (
        <AiSuggestions
          items={open}
          source={answer.source}
          title="Suggested metrics"
          render={(s) => ({
            title: s.name,
            detail: [where(s), s.definition].filter(Boolean).join(" · ") || undefined,
          })}
          itemKey={(s) => s.name}
          onAccept={(s) => add([s])}
          onAcceptAll={(items) => add(items)}
          onDismiss={() => setAnswer(null)}
          returnFocus={() => buttonRef.current?.querySelector("button")}
        />
      )}
      {answer && taken.length > 0 && (
        <div className="text-xs text-sub">
          <p className="font-medium">Already set, so not offered:</p>
          <ul className="list-disc pl-5">
            {taken.map((s) => (
              <li key={s.name} className="break-words">
                {s.name} ({blocked(s)})
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
