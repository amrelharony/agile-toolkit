"use client";

import { useId, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, type ToggleOption } from "@/components/ui/toggle-group";
import {
  BUG_PRIORITIES,
  BUG_REACH,
  BUG_SEVERITIES,
  type BugChecks,
  type BugPriority,
  type BugReach,
  type BugReport,
  type BugSeverity,
} from "@/lib/stores/workspace-types";
import {
  CELL_ADVICE,
  CHECK_QUESTIONS,
  PRIORITY_LABEL,
  PRIORITY_MEANING,
  REACH_LABEL,
  SEVERITY_LABEL,
  SEVERITY_MEANING,
  YES_NO_CHECKS,
  bugWords,
  mismatched,
  priorityFor,
  severityByRules,
  type YesNoCheck,
} from "@/lib/bug-triage/model";

const YES_NO: ToggleOption<"yes" | "no">[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

const SEVERITY_OPTIONS: ToggleOption<BugSeverity>[] = BUG_SEVERITIES.map((s) => ({
  value: s,
  label: SEVERITY_LABEL[s],
  description: SEVERITY_MEANING[s],
}));

const PRIORITY_OPTIONS: ToggleOption<BugPriority>[] = BUG_PRIORITIES.map((p) => ({
  value: p,
  label: PRIORITY_LABEL[p],
  description: PRIORITY_MEANING[p],
}));

const REACH_OPTIONS: ToggleOption<BugReach>[] = BUG_REACH.map((r) => ({
  value: r,
  label: r === "all" ? "Everyone" : REACH_LABEL[r].replace(/ (person|people)$/, ""),
  ariaLabel: REACH_LABEL[r],
}));

export interface Placement {
  severity: BugSeverity;
  priority: BugPriority;
  checks?: BugChecks;
}

/**
 * The quick checks, then where the bug goes: the answers suggest a
 * severity (`severityByRules`) and a priority (`priorityFor`), and both can
 * be changed. Until one is picked, each follows the suggestion. Save places
 * the bug (`onSave`).
 */
export function TriageForm({
  bug,
  onSave,
  saveLabel = "Place it",
  onCancel,
}: {
  bug: BugReport;
  onSave: (placed: Placement) => void;
  saveLabel?: string;
  onCancel?: () => void;
}) {
  const [checks, setChecks] = useState<BugChecks>(bug.checks ?? {});
  const [severity, setSeverity] = useState<BugSeverity | null>(
    bug.status === "triaged" ? (bug.severity ?? null) : null
  );
  const [priority, setPriority] = useState<BugPriority | null>(
    bug.status === "triaged" ? (bug.priority ?? null) : null
  );
  const id = useId();
  const guess = severityByRules(bugWords(bug), checks);
  const shownSeverity = severity ?? guess.severity;
  const shownPriority = priority ?? priorityFor(shownSeverity, checks);
  const check = mismatched(shownSeverity, shownPriority);

  const setCheck = (key: YesNoCheck, v: "yes" | "no") =>
    setChecks((c) => ({ ...c, [key]: v === "yes" }));
  const answer = (key: YesNoCheck) =>
    checks[key] === undefined ? null : checks[key] ? "yes" : "no";

  return (
    <div className="space-y-3">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-text">Quick checks</legend>
        {YES_NO_CHECKS.slice(0, 3).map((key) => (
          <div key={key} className="flex flex-wrap items-center justify-between gap-2">
            <span id={`${id}-${key}`} className="min-w-0 flex-1 basis-48 text-sm text-sub">
              {CHECK_QUESTIONS[key]}
            </span>
            <ToggleGroup
              label={CHECK_QUESTIONS[key]}
              size="sm"
              options={YES_NO}
              value={answer(key)}
              onValueChange={(v) => setCheck(key, v)}
            />
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="min-w-0 flex-1 basis-48 text-sm text-sub">{CHECK_QUESTIONS.reach}</span>
          <ToggleGroup
            label={CHECK_QUESTIONS.reach}
            size="sm"
            options={REACH_OPTIONS}
            value={checks.reach ?? null}
            onValueChange={(reach) => setChecks((c) => ({ ...c, reach }))}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="min-w-0 flex-1 basis-48 text-sm text-sub">
            {CHECK_QUESTIONS.blocksRelease}
          </span>
          <ToggleGroup
            label={CHECK_QUESTIONS.blocksRelease}
            size="sm"
            options={YES_NO}
            value={answer("blocksRelease")}
            onValueChange={(v) => setCheck("blocksRelease", v)}
          />
        </div>
      </fieldset>

      <p className="text-sm text-sub" data-testid="triage-suggestion">
        Suggested: {SEVERITY_LABEL[guess.severity]} ×{" "}
        {PRIORITY_LABEL[priorityFor(guess.severity, checks)]}. {guess.reason}
      </p>

      <div className="space-y-2">
        <div className="space-y-1">
          <p className="text-sm font-medium text-text">How bad</p>
          <ToggleGroup
            label="Severity: how bad"
            size="sm"
            options={SEVERITY_OPTIONS}
            value={shownSeverity}
            onValueChange={setSeverity}
          />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-text">How soon</p>
          <ToggleGroup
            label="Priority: how soon"
            size="sm"
            options={PRIORITY_OPTIONS}
            value={shownPriority}
            onValueChange={setPriority}
          />
        </div>
        <p className="text-sm text-text">
          {check && <span className="mr-1 font-semibold text-warning">Check:</span>}
          {CELL_ADVICE[shownSeverity][shownPriority]}.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          className="gap-1"
          onClick={() => onSave({ severity: shownSeverity, priority: shownPriority, checks })}
        >
          <Check aria-hidden="true" />
          {saveLabel}
        </Button>
        {onCancel && (
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
