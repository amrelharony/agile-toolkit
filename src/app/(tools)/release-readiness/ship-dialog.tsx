"use client";

/**
 * The dialogs that date a step in a release's life: Ship (the day it went
 * out, today unless moved back, and the gates still open) and Mark rolled
 * back (the day it was reverted). They replace the browser's confirm(),
 * which recorded today whatever the real day was. Focus opens on Cancel, so
 * Enter alone never ships; Enter in the date field confirms.
 */

import { useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useItemForm } from "@/components/shared/item-form";
import type { Release } from "@/lib/stores/workspace-types";
import { rollbackDateError, shipDateError, type GateResult } from "@/lib/releases/auto-gates";
import { plural } from "@/lib/charts/chart-text";
import { nameOf } from "./text";

interface DayDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  fieldLabel: string;
  /** The day the field opens on. */
  initial: string;
  min?: string;
  max: string;
  /** The field's error, or null when the day is fine. */
  validate: (day: string) => string | null;
  confirmLabel: string;
  /** "destructive" for a step that undoes a ship. */
  confirmVariant?: "default" | "destructive";
  onConfirm: (day: string) => void;
  children?: ReactNode;
}

function DayDialog({ open, onOpenChange, ...props }: DayDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          cancelRef.current?.focus();
        }}
      >
        {/* Mounted while open only, so each opening starts from `initial`. */}
        <DayForm {...props} cancelRef={cancelRef} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function DayForm({
  title,
  description,
  fieldLabel,
  initial,
  min,
  max,
  validate,
  confirmLabel,
  confirmVariant = "default",
  onConfirm,
  children,
  cancelRef,
  onClose,
}: Omit<DayDialogProps, "open" | "onOpenChange"> & {
  cancelRef: React.RefObject<HTMLButtonElement>;
  onClose: () => void;
}) {
  const form = useItemForm<{ day: string }, string, "day">({
    initial: { day: initial },
    validate: ({ day }) => {
      const error = validate(day);
      return error ? { ok: false, errors: { day: error } } : { ok: true, values: day };
    },
    onSave: (day) => {
      onConfirm(day);
      onClose();
    },
    resetOnSave: false,
  });
  const { draft, update, errors, formRef, submit } = form;
  return (
    <form ref={formRef} onSubmit={submit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <Field label={fieldLabel} error={errors.day} required className="max-w-xs">
        {(p) => (
          <Input
            {...p}
            type="date"
            min={min}
            max={max}
            value={draft.day}
            onChange={(e) => update({ day: e.target.value })}
          />
        )}
      </Field>
      {children}
      <DialogFooter className="gap-2 sm:gap-0">
        <Button ref={cancelRef} type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant={confirmVariant}>
          {confirmLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Ship `release`: on a day up to today, listing the gates still open and why. */
export function ShipDialog({
  release,
  open,
  onOpenChange,
  today,
  openGates,
  onShip,
}: {
  release: Release;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  today: string;
  openGates: readonly GateResult[];
  onShip: (day: string) => void;
}) {
  const name = nameOf(release);
  return (
    <DayDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Ship ${name}?`}
      description={
        openGates.length === 0
          ? "Every gate passes. Pick the day it went out; it can be an earlier day."
          : `${plural(openGates.length, "gate")} ${openGates.length === 1 ? "is" : "are"} still open. It ships anyway, and the open ${openGates.length === 1 ? "gate is" : "gates are"} kept with it. Pick the day it went out.`
      }
      fieldLabel="Shipped on"
      initial={today}
      max={today}
      validate={(day) => shipDateError(day, today)}
      confirmLabel={
        openGates.length === 0
          ? `Ship ${name}`
          : `Ship with ${plural(openGates.length, "gate")} open`
      }
      onConfirm={onShip}
    >
      {openGates.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm font-medium text-text">Still open</p>
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-sub">
            {openGates.map((g) => (
              <li key={g.id}>
                <span className="text-text">{g.label}</span>
                {g.check?.passed === false && <span>: {g.check.detail}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </DayDialog>
  );
}

/** Mark `release` rolled back: on a day from its ship day to today. */
export function RollbackDialog({
  release,
  open,
  onOpenChange,
  today,
  onRollBack,
}: {
  release: Release;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  today: string;
  onRollBack: (day: string) => void;
}) {
  const shipped = release.shippedDate?.slice(0, 10);
  return (
    <DayDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Mark ${nameOf(release)} rolled back?`}
      description="It still went out, so it keeps counting in % on time and the skipped gates. Pick the day it was rolled back."
      fieldLabel="Rolled back on"
      initial={today}
      min={shipped}
      max={today}
      validate={(day) => rollbackDateError(day, shipped, today)}
      confirmLabel="Mark rolled back"
      confirmVariant="destructive"
      onConfirm={onRollBack}
    />
  );
}
