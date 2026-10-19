"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A question naming the action, e.g. "Clear this board?" */
  title: string;
  /** What will be lost, e.g. "All 12 cards will be removed." */
  description?: React.ReactNode;
  /** Names the action, e.g. "Clear board". Never just "OK". */
  confirmLabel: string;
  cancelLabel?: string;
  /** `danger` for anything that deletes or discards work. */
  tone?: "danger" | "default";
  onConfirm: () => void;
}

/**
 * In-page confirmation for destructive or disruptive actions.
 *
 * Use it instead of `window.confirm` (unstyled, and blocked in some embedded
 * contexts). Focus lands on Cancel, so Enter never destroys work by accident.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "danger",
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md"
        {...(description ? {} : { "aria-describedby": undefined })}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            autoFocus
            data-testid="confirm-dialog-cancel"
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={tone === "danger" ? "destructive" : "default"}
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
