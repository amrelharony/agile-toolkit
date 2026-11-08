"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Award, Crown, Flag, Sparkles, TrendingUp, X, type LucideIcon } from "lucide-react";
import { useMediaQuery } from "@/hooks/use-media-query";
import { PHONE_MEDIA_QUERY } from "@/lib/layout/breakpoints";
import { useMascotStore, type MascotCorner } from "@/lib/agent/mascot/store";
import { CHIP_MS, useMomentStore } from "@/lib/notify/moment-scheduler";
import { momentChipText } from "@/lib/notify/copy";
import { useActivityUiStore } from "@/lib/stores/activity-ui-store";
import { cn } from "@/lib/utils";

const KIND_ICON: Record<string, LucideIcon> = {
  "level-up": TrendingUp,
  achievement: Award,
  challenge: Flag,
  prestige: Crown,
};

/** A horizontal swipe this long (px) dismisses the chip. */
const SWIPE_PX = 40;
/** Desktop: how far from his corner's edge the chip sits (beside his 132 px box). */
const DESKTOP_SIDE_PX = 156;

/**
 * Where the chip stands: beside Amr, wherever he's parked.
 * - Phones: just past his band (`--amr-band-bottom`, or `--amr-band-top`
 *   under the header when he's docked at the top), on his side.
 * - Larger screens: level with him, to the inside of his corner.
 */
export function momentChipPosition(corner: MascotCorner, phone: boolean): CSSProperties {
  const top = corner.startsWith("top");
  const left = corner.endsWith("Left");
  if (phone) {
    return {
      ...(top
        ? { top: "calc(var(--header-h, 56px) + var(--amr-band-top, 0px) + 8px)" }
        : { bottom: "calc(var(--amr-band-bottom, env(safe-area-inset-bottom, 0px)) + 8px)" }),
      ...(left ? { left: 16 } : { right: 16 }),
    };
  }
  return {
    ...(top ? { top: "calc(var(--header-h, 56px) + 24px)" } : { bottom: 24 }),
    ...(left ? { left: DESKTOP_SIDE_PX } : { right: DESKTOP_SIDE_PX }),
  };
}

/**
 * The moment chip: "Level 8 · tap to see", beside Amr for about 4 s while he
 * cheers. Tapping it opens Activity; the X or a sideways swipe closes it.
 * It stays while hovered or focused, and has no animation under reduced
 * motion. Mounted once in app-shell.tsx; renders nothing between moments.
 */
export function MomentChip() {
  const moment = useMomentStore((s) => s.current);
  const dismiss = useMomentStore((s) => s.dismiss);
  const corner = useMascotStore((s) => s.corner);
  const phone = useMediaQuery(PHONE_MEDIA_QUERY);
  const openActivity = useActivityUiStore((s) => s.openActivity);
  const [held, setHeld] = useState(false);
  const swipeFrom = useRef<number | null>(null);

  // Fade after CHIP_MS, unless the pointer or focus is on it.
  useEffect(() => {
    if (!moment || held) return;
    const id = setTimeout(dismiss, CHIP_MS);
    return () => clearTimeout(id);
  }, [moment, held, dismiss]);

  // A new moment starts un-held.
  useEffect(() => {
    setHeld(false);
  }, [moment?.id]);

  const open = useCallback(() => {
    dismiss();
    openActivity();
  }, [dismiss, openActivity]);

  if (!moment) return null;
  const Icon = KIND_ICON[moment.kind] ?? Sparkles;
  const text = momentChipText(moment.title);
  // Held open while the pointer or focus is on either button.
  const hold = {
    onPointerEnter: () => setHeld(true),
    onPointerLeave: () => setHeld(false),
    onFocus: () => setHeld(true),
    onBlur: () => setHeld(false),
  };

  return (
    <div
      role="status"
      aria-live="polite"
      data-moment-chip
      data-rarity={moment.rarity}
      style={{ position: "fixed", ...momentChipPosition(corner, phone) }}
      className={cn(
        "z-[55] flex max-w-[min(18rem,calc(100vw-32px))] items-center gap-1 rounded-full border border-border bg-surface py-1 pl-3 pr-1 text-sm text-text shadow-lg",
        "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-reduce:animate-none"
      )}
    >
      <button
        type="button"
        onClick={open}
        {...hold}
        onPointerDown={(e) => {
          swipeFrom.current = e.clientX;
        }}
        onPointerUp={(e) => {
          const from = swipeFrom.current;
          swipeFrom.current = null;
          // A swipe closes it (and unmounts it, so no tap follows).
          if (from !== null && Math.abs(e.clientX - from) >= SWIPE_PX) dismiss();
        }}
        onPointerCancel={() => {
          swipeFrom.current = null;
        }}
        className="flex min-h-[44px] min-w-0 touch-pan-y items-center gap-2 rounded-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Icon className="h-4 w-4 shrink-0 text-accent" aria-hidden />
        <span className="truncate">{text}</span>
      </button>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={dismiss}
        {...hold}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sub hover:bg-accent/10 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
