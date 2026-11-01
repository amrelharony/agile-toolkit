"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import {
  FEW_RUNS,
  FLAKY_HIGH_RATE,
  FLAKY_STATUSES,
  FLAKY_STATUS_LABEL,
  QUARANTINE_ALERT_DAYS,
  fewRuns,
  flakyRate,
  quarantinedDays,
} from "@/lib/quality/flaky";
import type { FlakyStatus, FlakyTest } from "@/lib/stores/workspace-types";
import { cn } from "@/lib/utils";
import { TestForm, type TestValues } from "./test-form";
import { quarantineText, rateText } from "./view";

/**
 * The card's editor in place of the card. The Edit button that opened it
 * goes with the card, so its first field takes focus as it mounts (as the
 * other tools' edit panels do); the page returns focus to Edit on close.
 */
function EditSection({
  titleId,
  title,
  children,
}: {
  titleId: string;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("input, select, textarea")?.focus();
  }, []);
  return (
    <section
      ref={ref}
      aria-labelledby={titleId}
      className="rounded-lg border border-accent/40 bg-card p-3 sm:p-4"
    >
      <h3 id={titleId} className="mb-3 text-sm font-semibold text-text">
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * One flaky test: its rate as failures of runs, a "few runs" note under
 * FEW_RUNS (the rate shows anyway), its quarantine age, the status, and an
 * editor in place of the card while it is being edited.
 */
export function TestCard({
  test: t,
  today,
  editing,
  onEdit,
  onCancel,
  onSave,
  onStatus,
  onRemove,
}: {
  test: FlakyTest;
  today: string;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (values: TestValues) => void;
  onStatus: (status: FlakyStatus) => void;
  onRemove: () => void;
}) {
  const titleId = useId();
  if (editing) {
    return (
      <EditSection titleId={titleId} title={`Edit “${t.name}”`}>
        <TestForm today={today} editing={t} onSave={onSave} onCancel={onCancel} />
      </EditSection>
    );
  }
  const rate = flakyRate(t);
  const high = rate !== null && rate > FLAKY_HIGH_RATE && t.status !== "fixed";
  const quarantine = quarantineText(t, today);
  const days = quarantinedDays(t, today);
  const longQuarantine = days !== null && days >= QUARANTINE_ALERT_DAYS;
  const notes = [
    t.owner ? `Owner: ${t.owner}` : null,
    `First seen ${t.firstSeenAt}`,
    t.fixedAt ? `${t.status === "fixed" ? "Fixed" : "Last fixed"} ${t.fixedAt}` : null,
  ].filter(Boolean);
  return (
    <article
      aria-labelledby={titleId}
      className="space-y-2 rounded-lg border border-border bg-card p-3"
    >
      <div className="flex flex-wrap items-start gap-2">
        <h3 id={titleId} className="min-w-0 flex-1 break-words text-sm font-medium text-text">
          {t.name}
        </h3>
        {t.suite && (
          <Badge variant="outline" className="max-w-full truncate font-data text-xs">
            {t.suite}
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span
          className="relative h-2 min-w-0 flex-1 overflow-hidden rounded bg-surface"
          aria-hidden="true"
        >
          <span
            className={cn("absolute inset-y-0 left-0 rounded", high ? "bg-danger" : "bg-accent")}
            style={{ width: `${Math.round((rate ?? 0) * 100)}%` }}
          />
        </span>
        <span className={cn("shrink-0 text-xs font-data", high ? "text-danger" : "text-sub")}>
          {rateText(t)}
        </span>
      </div>
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-sub">
        {notes.map((n) => (
          <span key={n}>{n}</span>
        ))}
        {quarantine && (
          <span className={longQuarantine ? "font-medium text-warning" : undefined}>
            {quarantine}
          </span>
        )}
        {fewRuns(t) && (
          <span className="text-warning">
            Few runs (under {FEW_RUNS}): one more failure moves this rate a lot
          </span>
        )}
      </p>
      {t.description && (
        <p className="whitespace-pre-wrap break-words text-xs text-sub">{t.description}</p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <Field label={`Status for ${t.name}`} hideLabel className="w-40">
          {(props) => (
            <select
              {...props}
              className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-base text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:h-9 md:text-sm"
              value={t.status}
              onChange={(e) => onStatus(e.target.value as FlakyStatus)}
            >
              {FLAKY_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {FLAKY_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-edit-test={t.id}
          aria-label={`Edit ${t.name}`}
          onClick={onEdit}
        >
          <Pencil aria-hidden="true" />
          Edit
        </Button>
        <IconButton
          label={`Delete ${t.name}`}
          icon={<Trash2 aria-hidden="true" />}
          onClick={onRemove}
          className="text-sub hover:text-danger"
        />
      </div>
    </article>
  );
}
