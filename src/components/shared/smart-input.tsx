"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PredictedValue } from "@/lib/predictions/registry";

interface SmartInputProps<T extends string | number> {
  predicted: PredictedValue<T> | { value: T; confidence: "none" };
  /** Called when the user accepts the prediction (Tab key or click on chip). */
  onAccept: (value: T) => void;
  /**
   * Render-prop pattern so each tool can plug its existing input markup
   * (preserves dense table rows, custom keyboard handling, etc.).
   *
   * - `ghost` is the prediction's display value when the user's field is
   *   empty; tool can render it as placeholder, suffix, or inline ghost text.
   * - `accept` triggers `onAccept(predicted.value)` — bind to your input's
   *   onKeyDown for Tab handling.
   * - `chip` renders the confidence label + source; show it below the input
   *   when prediction has confidence !== "none".
   */
  render: (api: {
    ghost: string | undefined;
    accept: () => void;
    chip: ReactNode;
    isAccepting: boolean;
  }) => ReactNode;
}

const CONFIDENCE_TONE: Record<string, string> = {
  high: "bg-accent/15 text-accent border-accent/40",
  medium: "bg-[var(--surface-hover)] text-text border-border",
  low: "bg-[var(--surface-hover)] text-sub border-border",
  none: "",
};

export function SmartInput<T extends string | number>({
  predicted,
  onAccept,
  render,
}: SmartInputProps<T>) {
  const [isAccepting, setIsAccepting] = useState(false);
  const acceptingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (acceptingTimer.current) clearTimeout(acceptingTimer.current);
    },
    []
  );

  // Cancel any in-flight "Accepted!" flash if the prediction becomes
  // unavailable (confidence drops to "none"). Without this, the timer
  // could fire after the chip already disappeared, flipping isAccepting
  // back to false on a UI element that's no longer rendered (harmless
  // re-render, but it shows up as a stray setState in the React profiler).
  useEffect(() => {
    if (predicted.confidence === "none" && acceptingTimer.current) {
      clearTimeout(acceptingTimer.current);
      acceptingTimer.current = null;
      setIsAccepting(false);
    }
  }, [predicted.confidence]);

  const accept = () => {
    if (predicted.confidence === "none") return;
    onAccept(predicted.value);
    setIsAccepting(true);
    if (acceptingTimer.current) clearTimeout(acceptingTimer.current);
    acceptingTimer.current = setTimeout(() => setIsAccepting(false), 800);
  };

  const ghost = predicted.confidence === "none" ? undefined : String(predicted.value);

  // Low-confidence intentionally renders a "Suggested" chip without the
  // Tab-to-accept hint — that gentle friction prevents the prediction
  // from being adopted reflexively.
  const conf = "confidence" in predicted ? predicted.confidence : "none";
  const tone = CONFIDENCE_TONE[conf] ?? "";

  const chip =
    conf === "none" ? null : (
      <button
        type="button"
        onClick={accept}
        className={`min-touch-coarse inline-flex items-center gap-1.5 mt-1 text-[11px] font-mono tracking-wider uppercase px-2 py-0.5 rounded-md border transition ${tone}`}
        aria-label={`Accept predicted value: ${ghost}`}
      >
        <span>
          {conf === "low" ? "Suggested:" : conf === "medium" ? "Predicted:" : "Predicted:"} {ghost}
        </span>
        {conf !== "low" && <span className="text-[9px] opacity-70">Tab</span>}
        {"source" in predicted && predicted.source && (
          <span className="text-[10px] opacity-60 hidden sm:inline">· {predicted.source}</span>
        )}
      </button>
    );

  return <>{render({ ghost, accept, chip, isAccepting })}</>;
}
