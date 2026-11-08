"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { FLASH_MS, useFlash } from "@/hooks/use-flash";
import { copyToClipboard } from "@/lib/utils/export";
import { toast } from "@/lib/utils/toast";

export interface CopyButtonProps extends Omit<ButtonProps, "onClick" | "children" | "onCopy"> {
  /** The text to copy, or a function that builds it when clicked. */
  text: string | (() => string | Promise<string>);
  /** The button's label. Default "Copy". */
  label?: React.ReactNode;
  /** The label while confirming. Default "Copied". */
  copiedLabel?: React.ReactNode;
  /** What screen readers hear (and the pop-up says, if the user wants them). */
  announcement?: string;
  /** The toast when the copy fails. */
  errorMessage?: string;
  /** Hide the copy/check icon. */
  hideIcon?: boolean;
  /** Called after a successful copy. */
  onCopied?: () => void;
  /** How long the confirmation shows (ms). Default 1.5 s. */
  confirmMs?: number;
}

/**
 * Copies text and confirms in place: the button reads "Copied ✓" for 1.5 s.
 * No toast, sound or vibration (unless the user turned on confirmations as
 * pop-ups); a failure still shows `toast.error`.
 */
export const CopyButton = React.forwardRef<HTMLButtonElement, CopyButtonProps>(
  (
    {
      text,
      label = "Copy",
      copiedLabel = "Copied",
      announcement = "Copied",
      errorMessage = "Couldn't copy. Check your browser's clipboard permission.",
      hideIcon = false,
      onCopied,
      confirmMs = FLASH_MS,
      variant = "outline",
      size = "sm",
      disabled,
      ...props
    },
    ref
  ) => {
    const { flash, isFlashing } = useFlash(confirmMs);
    const [busy, setBusy] = React.useState(false);
    // A ref guards a second click while copying: a native `disabled` on the
    // focused button would drop keyboard focus to <body>.
    const busyRef = React.useRef(false);
    const copied = isFlashing();

    const onClick = async () => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      try {
        const value = typeof text === "function" ? await text() : text;
        if (await copyToClipboard(value)) {
          flash(announcement);
          onCopied?.();
        } else {
          toast.error(errorMessage);
        }
      } catch {
        toast.error(errorMessage);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    };

    return (
      <Button
        ref={ref}
        type="button"
        variant={variant}
        size={size}
        disabled={disabled}
        aria-disabled={busy || undefined}
        data-copied={copied ? "true" : undefined}
        onClick={() => void onClick()}
        {...props}
      >
        {hideIcon ? null : copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        {copied ? copiedLabel : label}
      </Button>
    );
  }
);
CopyButton.displayName = "CopyButton";
