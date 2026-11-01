"use client";

import { useState, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { undoable } from "@/lib/utils/undoable";

/**
 * A bulk change behind a confirm, then Undo, like `ResetButton`, except
 * that each confirm keeps its own way back: `run` makes the change and
 * returns how to undo exactly that change. The market's two resets
 * ("Refund unfunded features", "Reset game") used to share one snapshot,
 * so with both toasts open the older Undo put back the newer one's rows.
 */
export function UndoableReset({
  label,
  title,
  description,
  confirmLabel,
  doneLabel,
  run,
  disabled,
  variant = "ghost",
}: {
  label: string;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  /** Past tense, for the Undo toast. */
  doneLabel: string;
  /** Make the change; return its undo, taken from what it changed. */
  run: () => () => void;
  disabled?: boolean;
  variant?: ButtonProps["variant"];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant={variant}
        size="sm"
        disabled={disabled}
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
        onConfirm={() => {
          let revert: (() => void) | null = null;
          undoable({
            label: doneLabel,
            apply: () => {
              revert = run();
            },
            revert: () => revert?.(),
          });
        }}
      />
    </>
  );
}
