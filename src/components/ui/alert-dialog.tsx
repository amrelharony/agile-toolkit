"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * A confirmation that has to be answered: `role="alertdialog"`, no close X,
 * and a click outside doesn't dismiss it (Escape and Cancel do). Built on
 * the Radix dialog primitive the project already ships, so it needs no new
 * dependency. Use it instead of `window.confirm`, which phones render as a
 * bare system prompt and which blocks the page.
 */
export interface AlertDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description: React.ReactNode;
  /** Label of the button that carries out the action. */
  confirmLabel: string;
  cancelLabel?: string;
  /** Runs on confirm; the dialog then closes. */
  onConfirm: () => void;
  /** Style the confirm button as destructive (red). */
  destructive?: boolean;
  className?: string;
  /**
   * Where focus goes when the alert closes. Radix returns focus to a dialog
   * trigger, and this alert has none (it is opened from state), so without
   * this focus falls to `<body>`, which strands keyboard and screen-reader
   * users when the alert sits over another modal. Return the element to
   * focus; when it gives nothing, Radix's default runs.
   */
  returnFocus?: () => HTMLElement | null | undefined;
  /** Extra style for the overlay (e.g. stop short of Amr's phone bands). */
  overlayStyle?: React.CSSProperties;
  /** Extra style for the content box (e.g. centre it between Amr's bands). */
  contentStyle?: React.CSSProperties;
}

export function AlertDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  destructive = false,
  className,
  returnFocus,
  overlayStyle,
  contentStyle,
}: AlertDialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-modal bg-black/70 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none"
          style={overlayStyle}
        />
        <DialogPrimitive.Content
          role="alertdialog"
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => {
            const target = returnFocus?.();
            if (!target) return;
            e.preventDefault();
            target.focus();
          }}
          style={contentStyle}
          className={cn(
            "fixed left-1/2 top-1/2 z-modal grid -translate-x-1/2 -translate-y-1/2 gap-3",
            "w-[calc(100vw-2rem)] max-w-sm max-h-[calc(100dvh-2rem)] overflow-y-auto",
            "panel bg-background p-4 sm:p-6 shadow-modal outline-none",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none",
            className
          )}
        >
          <DialogPrimitive.Title className="text-base font-semibold text-text">
            {title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="text-sm text-sub">
            {description}
          </DialogPrimitive.Description>
          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <DialogPrimitive.Close asChild>
              <Button variant="outline">{cancelLabel}</Button>
            </DialogPrimitive.Close>
            <Button
              variant={destructive ? "destructive" : "default"}
              onClick={() => {
                onConfirm();
                onOpenChange(false);
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
