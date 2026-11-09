"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { toast } from "@/lib/utils/toast";

/** How long a control shows its confirmation ("Copied ✓"). */
export const FLASH_MS = 1500;

const DEFAULT_KEY = "default";

export interface Flash {
  /**
   * Confirm an action in place: the control reads its confirmation for
   * `FLASH_MS`, screen readers hear `message`, and the notification policy
   * gets an `echo` (a pop-up only when the user turned on "Show
   * confirmations as pop-ups"; otherwise nothing, no sound, no buzz).
   * `key` tells several controls in one component apart.
   */
  flash: (message: string, key?: string) => void;
  /** Whether the control with `key` is showing its confirmation now. */
  isFlashing: (key?: string) => boolean;
  /** The key flashing now, or null. */
  flashing: string | null;
}

/**
 * Inline confirmation for actions that only echo what the user just did
 * (copy a link, download a file): the button says so for a moment instead
 * of a toast. Failures still use `toast.error`.
 */
export function useFlash(durationMs: number = FLASH_MS): Flash {
  const announce = useAnnounce();
  const [flashing, setFlashing] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const flash = useCallback(
    (message: string, key: string = DEFAULT_KEY) => {
      setFlashing(key);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        setFlashing((cur) => (cur === key ? null : cur));
      }, durationMs);
      announce(message);
      // The policy sends an echo inline (nothing shows) unless the user asked
      // for confirmations as pop-ups.
      toast.success(message, { kind: "echo" });
    },
    [announce, durationMs]
  );

  const isFlashing = useCallback((key: string = DEFAULT_KEY) => flashing === key, [flashing]);

  return { flash, isFlashing, flashing };
}
