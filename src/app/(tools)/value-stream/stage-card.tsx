"use client";

import { useEffect, useId, useState } from "react";
import { ArrowLeft, ArrowRight, Trash2, Waves } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { IconButton } from "@/components/ui/icon-button";
import { BlurInput, BlurTextarea } from "@/components/shared/blur-fields";
import { cn } from "@/lib/utils";
import { fmt } from "@/lib/charts/chart-text";
import type { ValueStreamStage } from "@/lib/stores/workspace-types";
import { waitOf, type Bottleneck } from "@/lib/value-stream/summary";
import { STAGE_DESCRIPTION_MAX, STAGE_NAME_MAX, editError } from "./form";

type NumberField = "processTime" | "leadTime" | "completeAccurate";

/**
 * A number edited in place. It commits on blur or Enter; a blank or
 * impossible value isn't saved (clearing a field used to write 0) and its
 * message shows under the field until it's fixed. Escape puts back the
 * saved value.
 */
function NumberCell({
  label,
  value,
  check,
  onCommit,
  max,
}: {
  label: string;
  value: number;
  /** Why the typed text can't be saved, or null. */
  check: (raw: string) => string | null;
  onCommit: (n: number) => void;
  max?: number;
}) {
  const id = useId();
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState<string | null>(null);
  // A change from elsewhere (an agent, another device, Undo) replaces the draft.
  useEffect(() => {
    setDraft(String(value));
    setError(null);
  }, [value]);
  const commit = () => {
    if (draft.trim() === String(value)) {
      setError(null);
      return;
    }
    const err = check(draft);
    setError(err);
    if (!err) onCommit(Number(draft));
  };
  return (
    <div>
      <label htmlFor={id} className="block text-xs text-sub">
        {label}
      </label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        min={0}
        max={max}
        value={draft}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(String(value));
            setError(null);
          }
        }}
        className="h-8 bg-bg border-border font-data"
      />
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export interface StageCardProps {
  stage: ValueStreamStage;
  /** 0-based position in its map. */
  index: number;
  count: number;
  bottleneck: Bottleneck | null;
  onRename: (name: string) => void;
  onDescription: (description: string | undefined) => void;
  onNumber: (field: NumberField, value: number) => void;
  /** Move one place earlier (-1) or later (+1). */
  onMove: (delta: -1 | 1) => void;
  onDelete: () => void;
}

/**
 * One stage of the map, edited in place: its name, description and times,
 * Move earlier / later, and Delete (with Undo, from the page). The
 * bottleneck wears a badge saying how long work waits there.
 */
export function StageCard({
  stage,
  index,
  count,
  bottleneck,
  onRename,
  onDescription,
  onNumber,
  onMove,
  onDelete,
}: StageCardProps) {
  const name = stage.name.trim() || "Unnamed stage";
  // Remounts the name field when an emptied name is put back, so it shows the saved one.
  const [nameKey, setNameKey] = useState(0);
  const isBottleneck = bottleneck?.stage.id === stage.id;
  const wait = waitOf(stage);
  return (
    <Card
      className={cn(
        "h-full bg-surface border-border",
        isBottleneck && "border-warning/60 bg-warning/5"
      )}
    >
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center gap-1">
          <Waves className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          <span className="text-xs font-mono text-sub">
            {index + 1}/{count}
          </span>
          <div className="ml-auto flex items-center">
            <IconButton
              label={`Move ${name} earlier`}
              icon={<ArrowLeft aria-hidden="true" />}
              disabled={index === 0}
              onClick={() => onMove(-1)}
              className="text-sub"
            />
            <IconButton
              label={`Move ${name} later`}
              icon={<ArrowRight aria-hidden="true" />}
              disabled={index === count - 1}
              onClick={() => onMove(1)}
              className="text-sub"
            />
            <IconButton
              label={`Delete stage ${name}`}
              icon={<Trash2 aria-hidden="true" />}
              onClick={onDelete}
              className="text-sub hover:text-danger"
            />
          </div>
        </div>
        {isBottleneck && bottleneck && (
          <Badge variant="outline" className="border-warning/50 bg-warning/10 text-warning">
            Bottleneck: waits {fmt(bottleneck.waitDays)} d, {fmt(bottleneck.sharePct, 0)}% of the
            lead time
          </Badge>
        )}
        <BlurInput
          key={nameKey}
          value={stage.name}
          // An emptied name puts the old one back rather than leaving a blank stage.
          onCommit={(v) =>
            v.trim() ? onRename(v.trim().slice(0, STAGE_NAME_MAX)) : setNameKey((k) => k + 1)
          }
          aria-label={`Name of stage ${index + 1}`}
          maxLength={STAGE_NAME_MAX}
          className="h-8 bg-bg border-border text-sm"
        />
        <BlurTextarea
          value={stage.description ?? ""}
          onCommit={(v) =>
            onDescription(v.trim() ? v.trim().slice(0, STAGE_DESCRIPTION_MAX) : undefined)
          }
          placeholder="Description (optional)"
          rows={2}
          className="bg-bg border-border resize-none text-xs"
          aria-label={`Description of ${name}`}
        />
        <NumberCell
          label="Process time (days)"
          value={stage.processTime}
          check={(raw) => editError(stage, "processTime", raw)}
          onCommit={(n) => onNumber("processTime", n)}
        />
        <NumberCell
          label="Lead time (days)"
          value={stage.leadTime}
          check={(raw) => editError(stage, "leadTime", raw)}
          onCommit={(n) => onNumber("leadTime", n)}
        />
        <NumberCell
          label="%C/A"
          value={stage.completeAccurate}
          max={100}
          check={(raw) => editError(stage, "completeAccurate", raw)}
          onCommit={(n) => onNumber("completeAccurate", n)}
        />
        <p className="pt-1 text-xs text-sub">Waits {fmt(wait)} d</p>
      </CardContent>
    </Card>
  );
}
