"use client";

/**
 * One saved test: its plan, its result (or "Too early to call"), the
 * hypothesis it tests with that hypothesis's status read live, its
 * guardrails, the checks Amr suggests (or the fixed ones without AI), its
 * status, and the team's decision with a note. This page never writes the
 * hypothesis: its card says to use the result there.
 */

import Link from "next/link";
import { useId, useRef, useState } from "react";
import { FlaskConical, Pencil, Trash2, X } from "lucide-react";
import { AiButton, AiSuggestions } from "@/components/ai";
import { BlurTextarea } from "@/components/shared/blur-fields";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import type { AiSource } from "@/lib/ai/task-types";
import { abPlanCheckTask, planCheckInput } from "@/lib/ai/tasks/ab-calculator.lite";
import type {
  AbDecision,
  AbTest,
  AbTestStatus,
  Hypothesis,
  ProductMetric,
} from "@/lib/stores/workspace-types";
import { AB_DECISIONS, AB_TEST_STATUSES, TOOL_TEXT_MAX } from "@/lib/stores/workspace-types";
import { DECISION_LABEL, STATUS_LABEL, countText, testSummary } from "@/lib/experiments/model";
import { isExampleId } from "@/lib/utils/example-id";
import { cn } from "@/lib/utils";
import { ResultView } from "./result-view";
import { ToggleField } from "./plan-fields";
import { changeText, planSettingsText } from "./markdown";
import { hypothesisLine, metricLine } from "./view";

/** A check Amr (or the fixed list) suggests: a guardrail to watch, or a risk for the note. */
export type CheckItem =
  | { kind: "guardrail"; name: string; why: string }
  | { kind: "risk"; text: string };

const STATUS_TONE: Record<AbTestStatus, string> = {
  planned: "border-border text-sub",
  running: "border-info/40 bg-info/10 text-info",
  done: "border-success/40 bg-success/10 text-success",
};

export interface TestCardProps {
  test: AbTest;
  hypotheses: readonly Hypothesis[];
  metrics: readonly ProductMetric[];
  onOpen: (t: AbTest) => void;
  onRemove: (t: AbTest) => void;
  onStatus: (t: AbTest, status: AbTestStatus) => void;
  onDecision: (t: AbTest, decision: AbDecision | null) => void;
  onNote: (t: AbTest, note: string) => void;
  onAcceptChecks: (t: AbTest, items: CheckItem[]) => void;
  onRemoveGuardrail: (t: AbTest, index: number) => void;
}

export function TestCard({
  test: t,
  hypotheses,
  metrics,
  onOpen,
  onRemove,
  onStatus,
  onDecision,
  onNote,
  onAcceptChecks,
  onRemoveGuardrail,
}: TestCardProps) {
  const titleId = useId();
  const aiRef = useRef<HTMLDivElement>(null);
  const [checks, setChecks] = useState<{ items: CheckItem[]; source: AiSource } | null>(null);
  const s = testSummary(t);
  const title = t.name.trim() || "Untitled test";
  const linked = hypothesisLine(t.hypothesisId, hypotheses);
  const metric = metricLine(t.metricId, t.metricName, metrics);
  const open = linked?.hypothesis && ["drafted", "running"].includes(linked.hypothesis.status);
  const guardrails = t.guardrails ?? [];

  return (
    <article
      aria-labelledby={titleId}
      data-ab-test={t.id}
      className="min-w-0 space-y-3 rounded-lg border border-border bg-card p-3 sm:p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="break-words text-sm font-medium text-text">
            {title}
          </h3>
          {t.question && <p className="break-words text-xs text-sub">{t.question}</p>}
        </div>
        <div className="flex shrink-0 items-center">
          <IconButton
            label={`Open ${title} in the calculator`}
            icon={<Pencil className="h-4 w-4" />}
            className="text-sub hover:text-text"
            data-ab-open={t.id}
            onClick={() => onOpen(t)}
          />
          <IconButton
            label={`Delete ${title}`}
            icon={<Trash2 className="h-4 w-4" />}
            className="text-sub hover:text-danger"
            onClick={() => onRemove(t)}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-2 py-0.5 text-xs",
            STATUS_TONE[t.status] ?? "border-border text-sub"
          )}
        >
          {STATUS_LABEL[t.status] ?? t.status}
        </span>
        {t.decision && (
          <span className="inline-flex items-center rounded-full border border-accent/40 px-2 py-0.5 text-xs text-text">
            {DECISION_LABEL[t.decision]}
          </span>
        )}
        {isExampleId(t.id) && (
          <span className="inline-flex items-center rounded-full border border-info/30 px-2 py-0.5 text-xs text-info">
            Example
          </span>
        )}
      </div>

      {(linked || metric) && (
        <div className="space-y-1 text-xs">
          {linked && (
            <p className={cn("break-words", linked.hypothesis ? "text-text" : "text-warning")}>
              {linked.text}
            </p>
          )}
          {linked?.hypothesis && t.decision && open && (
            <p className="text-sub">
              Use the result on the hypothesis card:{" "}
              <Link href="/hypothesis-tracker" className="text-accent underline underline-offset-2">
                open the Hypothesis Tracker
              </Link>
              .
            </p>
          )}
          {metric && <p className="break-words text-sub">Metric: {metric}</p>}
        </div>
      )}

      <p className="text-xs text-sub">
        {s.plan
          ? `${countText(s.plan.perVariant)} a version to find ${changeText(t)} (${planSettingsText(t)})${
              s.plan.run
                ? `; ${s.plan.run.days} days at ${countText(t.plan.dailyTraffic ?? 0)} a day`
                : ""
            }.`
          : "This plan can't be sized: open it in the calculator to fix it."}
      </p>

      {s.result ? (
        <ResultView reading={s.result} />
      ) : (
        <p className="text-sm text-sub">No counts yet: open it in the calculator to type them.</p>
      )}

      {guardrails.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-sub">Guardrails</p>
          <ul className="space-y-1">
            {guardrails.map((g, i) => (
              <li key={`${g.name}-${i}`} className="flex items-start gap-1 text-sm">
                <span className="min-w-0 flex-1 break-words text-text">
                  {g.name}
                  {g.why && <span className="text-sub"> — {g.why}</span>}
                </span>
                <IconButton
                  label={`Remove the guardrail ${g.name}`}
                  icon={<X className="h-3.5 w-3.5" />}
                  className="shrink-0 text-sub hover:text-danger"
                  onClick={() => onRemoveGuardrail(t, i)}
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div ref={aiRef} className="space-y-2">
        <AiButton
          task={abPlanCheckTask}
          input={() =>
            planCheckInput({
              name: t.name,
              question: t.question,
              metricName: metric ?? t.metricName,
              hypothesis: linked?.hypothesis?.believe,
            })
          }
          onResult={(data, meta) =>
            setChecks({
              items: [
                ...data.guardrails.map((g) => ({ kind: "guardrail" as const, ...g })),
                ...data.risks.map((text) => ({ kind: "risk" as const, text })),
              ],
              source: meta.source,
            })
          }
          size="sm"
          variant="outline"
          label="Ask Amr for checks"
          fallbackLabel="Suggest checks"
        />
        {checks && (
          <AiSuggestions
            items={checks.items}
            title="Checks for this test"
            acceptLabel="Add"
            source={checks.source}
            itemKey={(c) => (c.kind === "guardrail" ? `g:${c.name}` : `r:${c.text}`)}
            render={(c) =>
              c.kind === "guardrail"
                ? { title: `Guardrail: ${c.name}`, detail: c.why }
                : { title: c.text, detail: "Goes in the note" }
            }
            onAccept={(c) => onAcceptChecks(t, [c])}
            onAcceptAll={(list) => onAcceptChecks(t, list)}
            onDismiss={() => {
              aiRef.current?.querySelector<HTMLElement>("button")?.focus();
              setChecks(null);
            }}
          />
        )}
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-3 border-t border-border pt-3">
        <ToggleField
          label="Status"
          groupLabel={`Status of ${title}`}
          value={t.status}
          onChange={(status) => onStatus(t, status)}
          options={AB_TEST_STATUSES.map((v) => ({ value: v, label: STATUS_LABEL[v] }))}
        />
        <ToggleField<AbDecision | "none">
          label="Decision"
          groupLabel={`Decision on ${title}`}
          value={t.decision ?? "none"}
          onChange={(d) => onDecision(t, d === "none" ? null : d)}
          options={[
            { value: "none", label: "Not yet" },
            ...AB_DECISIONS.map((d) => ({ value: d, label: DECISION_LABEL[d] })),
          ]}
        />
      </div>
      <Field label="Note" className="gap-1">
        {(props) => (
          <BlurTextarea
            id={props.id}
            rows={2}
            value={t.note ?? ""}
            maxLength={Math.max(TOOL_TEXT_MAX.text, (t.note ?? "").length)}
            placeholder="Why the team decided it, what to try next"
            className="resize-none text-sm"
            onCommit={(v) => onNote(t, v)}
          />
        )}
      </Field>
      {!s.result && t.status !== "planned" && (
        <p className="flex items-center gap-1 text-xs text-sub">
          <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
          Type the counts as they come in; the result waits for the planned sample.
        </p>
      )}
    </article>
  );
}
