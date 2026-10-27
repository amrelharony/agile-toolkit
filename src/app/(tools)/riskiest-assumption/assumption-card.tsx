"use client";

/**
 * One assumption: its rank and score (or "Not rated", or what settled
 * it), the statement and notes (edited in place), the two ratings with a
 * Clear each, the status, and its test: "Test" makes a linked hypothesis
 * in the Hypothesis Tracker, the card then shows where that test stands,
 * and once it has a decisive result offers to mark the assumption the
 * same way (never on its own). Delete offers Undo.
 */

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, FlaskConical, Pencil, Trash2 } from "lucide-react";
import { ScalePicker, offScale, type ScaleStep } from "@/components/shared/scale-picker";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { ASSUMPTION_STATUSES, ratingOf } from "@/lib/assumptions/model";
import { getHandoffRoute } from "@/lib/handoffs/registry";
import type { LinkedTest } from "@/lib/hypotheses/model";
import type { Assumption, AssumptionLevel, AssumptionStatus } from "@/lib/stores/workspace-types";
import { cn } from "@/lib/utils";
import { AssumptionEditor } from "./assumption-form";
import { EVIDENCE_STEPS, RISK_STEPS, type AssumptionValues } from "./form";
import { STATUS_LABEL, statusLabel } from "./view";

/** Matches <Input>: 44 px on phones, 36 px from md. */
const SELECT_CLASS =
  "flex h-11 md:h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-base md:text-sm text-text shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/** A rating's meaning, "Not rated", or how an off-scale stored value counts. */
function ratingHint(
  steps: readonly ScaleStep[],
  value: number | null,
  off: number | null
): string | undefined {
  if (value === null) return "Not rated";
  if (off !== null) return `Stored as ${off}: ranked as ${value} until you pick a step.`;
  return steps.find((s) => s.value === value)?.meaning;
}

export interface AssumptionCardProps {
  assumption: Assumption;
  /** Its place and score in the ranking; null while it is unrated or tested. */
  rank: { rank: number; score: number } | null;
  /** What settled it, for a tested one: "Validated by its hypothesis". */
  result: string;
  test: LinkedTest;
  /** The status its hypothesis's result points to, offered as one click. */
  offered: "validated" | "invalidated" | null;
  example: boolean;
  /** The first in the ranking: test this one first. */
  first: boolean;
  onWords: (a: Assumption, values: AssumptionValues) => void;
  onRate: (
    a: Assumption,
    key: "riskLevel" | "evidenceLevel",
    value: AssumptionLevel | null
  ) => void;
  onStatus: (a: Assumption, status: AssumptionStatus) => void;
  onTest: (a: Assumption) => void;
  onRemove: (a: Assumption) => void;
}

export function AssumptionCard({
  assumption: a,
  rank,
  result,
  test,
  offered,
  example,
  first,
  onWords,
  onRate,
  onStatus,
  onTest,
  onRemove,
}: AssumptionCardProps) {
  const [editing, setEditing] = useState(false);
  const titleId = useId();
  const editRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  const title = a.statement?.trim() || "Untitled assumption";
  const risk = ratingOf(a.riskLevel);
  const evidence = ratingOf(a.evidenceLevel);
  const offRisk = offScale(RISK_STEPS, a.riskLevel);
  const offEvidence = offScale(EVIDENCE_STEPS, a.evidenceLevel);
  const known = (ASSUMPTION_STATUSES as readonly string[]).includes(a.status);

  useEffect(() => {
    if (editing || !refocus.current) return;
    refocus.current = false;
    editRef.current?.focus();
  }, [editing]);

  if (editing) {
    return (
      <AssumptionEditor
        assumption={a}
        onSave={(values) => {
          onWords(a, values);
          refocus.current = true;
          setEditing(false);
        }}
        onCancel={() => {
          refocus.current = true;
          setEditing(false);
        }}
      />
    );
  }

  const hypothesisHref =
    test.state !== "none" ? getHandoffRoute("hypothesis").targetHref(test.hypothesisId) : "";

  return (
    <article
      aria-labelledby={titleId}
      className={cn(
        "space-y-3 rounded-lg border border-border bg-card p-3 sm:p-4",
        first && "border-l-4 border-l-accent"
      )}
      // A rating or a status can move the card to another list, which draws
      // it anew: the page finds it here to put focus back.
      data-assumption-card={a.id}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {rank ? (
              <span className="rounded-full border border-border bg-surface px-2 py-0.5 font-data text-xs text-sub">
                #{rank.rank} · score {rank.score}
              </span>
            ) : result ? (
              <span className="rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-xs text-success">
                Tested: {result}
              </span>
            ) : (
              <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs text-warning">
                Not rated
              </span>
            )}
            {first && <span className="text-xs font-medium text-accent">Test this first</span>}
            {example && (
              <span className="rounded-full border border-info/30 px-2 py-0.5 text-xs text-info">
                Example
              </span>
            )}
          </div>
          <h3 id={titleId} className="break-words text-sm font-medium text-text">
            {title}
          </h3>
          {a.description && (
            <p className="whitespace-pre-line break-words text-xs text-sub">{a.description}</p>
          )}
          {a.testIdea && (
            <p className="break-words text-xs text-sub">
              <span className="text-text">Test idea: </span>
              {a.testIdea}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center">
          <IconButton
            ref={editRef}
            label={`Edit ${title}`}
            icon={<Pencil className="h-4 w-4" />}
            className="text-sub hover:text-text"
            data-assumption-edit={a.id}
            onClick={() => setEditing(true)}
          />
          <IconButton
            label={`Delete ${title}`}
            icon={<Trash2 className="h-4 w-4" />}
            className="text-sub hover:text-danger"
            onClick={() => onRemove(a)}
          />
        </div>
      </div>

      <div
        className="grid grid-cols-1 gap-3 md:grid-cols-2"
        role="group"
        aria-label={`Ratings of ${title}`}
      >
        <div className="min-w-0" data-rating="riskLevel">
          <ScalePicker
            label="Risk"
            size="sm"
            steps={RISK_STEPS}
            // A value stored off the 1–5 scale (an older agent's 7) shows as
            // "Custom" until a step is picked; it ranks as its nearest step.
            value={offRisk ?? risk}
            onValueChange={(v) => onRate(a, "riskLevel", v as AssumptionLevel)}
            onClear={() => onRate(a, "riskLevel", null)}
            hint={ratingHint(RISK_STEPS, risk, offRisk)}
          />
        </div>
        <div className="min-w-0" data-rating="evidenceLevel">
          <ScalePicker
            label="Evidence"
            size="sm"
            steps={EVIDENCE_STEPS}
            value={offEvidence ?? evidence}
            onValueChange={(v) => onRate(a, "evidenceLevel", v as AssumptionLevel)}
            onClear={() => onRate(a, "evidenceLevel", null)}
            hint={ratingHint(EVIDENCE_STEPS, evidence, offEvidence)}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
        <Field label={`Status of ${title}`} hideLabel className="w-full sm:w-40">
          {(props) => (
            <select
              {...props}
              className={SELECT_CLASS}
              value={a.status}
              onChange={(e) => onStatus(a, e.target.value as AssumptionStatus)}
            >
              {!known && <option value={a.status}>{statusLabel(a.status)}</option>}
              {ASSUMPTION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          )}
        </Field>

        {test.state === "none" ? (
          !result && (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1"
                disabled={example}
                aria-label={`Test ${title}`}
                onClick={() => onTest(a)}
              >
                <FlaskConical className="h-4 w-4" aria-hidden="true" />
                Test
              </Button>
              <span className="text-xs text-sub">
                {example
                  ? "Example assumptions stay out of the Hypothesis Tracker."
                  : "Makes a hypothesis to test it in the Hypothesis Tracker."}
              </span>
            </>
          )
        ) : (
          <Link
            href={hypothesisHref}
            data-assumption-test=""
            className={cn(
              "inline-flex items-center gap-1 text-xs underline-offset-2 hover:underline",
              test.state === "tested" ? "text-success" : "text-accent"
            )}
          >
            <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
            {test.state === "testing"
              ? `Testing (${test.status}) · Open hypothesis`
              : test.result === "inconclusive"
                ? "Inconclusive: test again · Open hypothesis"
                : `Its hypothesis was ${test.result} · Open`}
          </Link>
        )}
        {offered && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1"
            // The visible words first, so speech input can say them.
            aria-label={`Mark ${offered}: “${title}”`}
            onClick={() => onStatus(a, offered)}
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Mark {offered}
          </Button>
        )}
      </div>
    </article>
  );
}
