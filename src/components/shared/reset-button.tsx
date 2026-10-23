"use client";

import { useState, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { undoable } from "@/lib/utils/undoable";

export interface ResetButtonProps {
  /** The button text: "Reset", "Clear board", "Reset this scale". */
  label?: string;
  /** A question naming the action: "Reset the estimation guide?" */
  title: string;
  /** What will be lost: "Your descriptions and examples for 13 cards." */
  description?: ReactNode;
  /** Names the action in the dialog: "Reset guide". */
  confirmLabel: string;
  /** Past tense, for the Undo toast: "Reset the estimation guide". */
  doneLabel: string;
  /** Wipe the data. Capture what `onUndo` needs before this runs. */
  onReset: () => void;
  /** Put the data back exactly as it was. */
  onUndo: () => void;
  disabled?: boolean;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
}

/**
 * A bulk reset: confirm first, then still offer Undo.
 *
 * Several tools wiped everything (criteria, history, every scale's notes)
 * on one click with no way back. A reset is the one action that gets both
 * guards: the dialog stops the slip, and the toast covers the "oh no, not
 * that one" a second after confirming.
 */
export function ResetButton({
  label = "Reset",
  title,
  description,
  confirmLabel,
  doneLabel,
  onReset,
  onUndo,
  disabled,
  variant = "ghost",
  size = "sm",
  className,
}: ResetButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        disabled={disabled}
        className={className}
        onClick={() => setOpen(true)}
      >
        <RotateCcw aria-hidden="true" />
        {label}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={description}
        confirmLabel={confirmLabel}
        onConfirm={() => undoable({ label: doneLabel, apply: onReset, revert: onUndo })}
      />
    </>
  );
}
