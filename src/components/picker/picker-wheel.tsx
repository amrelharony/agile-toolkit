"use client";

/**
 * The Picker's wheel, drawn in the comic's ink: watercolour slices sized by
 * weight, inked outlines and an inked pointer at the top. It only draws: the
 * caller says how far it is turned (`rotation`) and whether that turn
 * animates (`spinning`, about 2.5 s, easing out). Under reduced motion the
 * caller passes the landing rotation with `spinning` false, so it lands at
 * once and stays still.
 *
 * Shared by the tool page and the live room's phones (the show renderer), so
 * it holds no tool state. The names are drawn for sighted people only; the
 * wheel is one image with a plain label, and callers announce the result.
 */

import { memo } from "react";
import { cn } from "@/lib/utils";
import { SPIN_MS, labelChars, polar, sliceLabel, slicePath, wheelSlices } from "@/lib/picker/wheel";

/** Washes the slices cycle through: theme tokens, never colours. */
const TONES = ["accent", "wood", "moss", "plum", "info", "warning"] as const;

const VIEW = 200;
const C = VIEW / 2;
const R = 92;

export interface PickerWheelProps {
  names: readonly string[];
  weights: readonly number[];
  /** Indexes drawn greyed: already had their turn this round. */
  out?: readonly number[];
  /** Degrees, clockwise. */
  rotation: number;
  /** Animate the turn to `rotation`. */
  spinning: boolean;
  /** The slice it landed on, outlined once the wheel stops. */
  winner?: number | null;
  /** Spoken name for the whole wheel. */
  label: string;
  className?: string;
}

function PickerWheelImpl({
  names,
  weights,
  out = [],
  rotation,
  spinning,
  winner = null,
  label,
  className,
}: PickerWheelProps) {
  const slices = wheelSlices(names.map((_, i) => weights[i] ?? 1));
  const outSet = new Set(out);
  const chars = labelChars(names.length);
  const fontSize = names.length <= 6 ? 11 : names.length <= 12 ? 9.5 : names.length <= 20 ? 8 : 7;

  return (
    <div
      role="img"
      aria-label={label}
      className={cn("relative mx-auto aspect-square w-full max-w-xs", className)}
    >
      <div
        className="h-full w-full"
        style={{
          transform: `rotate(${rotation}deg)`,
          transition: spinning
            ? `transform ${SPIN_MS}ms cubic-bezier(0.12, 0.62, 0.16, 1)`
            : "none",
        }}
        data-testid="picker-wheel-disc"
        data-rotation={Math.round(rotation * 100) / 100}
      >
        <svg
          viewBox={`0 0 ${VIEW} ${VIEW}`}
          className="ink-art ink-still h-full w-full"
          aria-hidden="true"
        >
          <circle cx={C} cy={C} r={R} className="fill-card" />
          {slices.map((s, i) => {
            const isOut = outSet.has(i);
            const tone = isOut ? "sub" : TONES[i % TONES.length];
            const won = !spinning && winner === i;
            return (
              <path
                key={`fill-${i}`}
                d={slicePath(C, C, R, s)}
                className={cn("ink-fill", `ink-fill-${tone}`)}
                style={won ? { opacity: 0.5 } : isOut ? { opacity: 0.12 } : undefined}
              />
            );
          })}
          {slices.map((s, i) => (
            <path
              key={`line-${i}`}
              d={slicePath(C, C, R, s)}
              className="ink-line ink-tone-ink"
              pathLength={1}
              fill="none"
              strokeWidth={!spinning && winner === i ? 3.2 : 1.6}
            />
          ))}
          <circle
            cx={C}
            cy={C}
            r={R}
            className="ink-line ink-tone-ink"
            pathLength={1}
            fill="none"
            strokeWidth={3}
          />
          {slices.map((s, i) => {
            const [x, y] = polar(C, C, R * 0.6, s.mid);
            return (
              <text
                key={`label-${i}`}
                x={x}
                y={y}
                transform={`rotate(${s.mid - 90} ${x} ${y})`}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={fontSize}
                className={cn(
                  "font-display",
                  outSet.has(i) ? "fill-sub" : "fill-text",
                  !spinning && winner === i && "font-bold"
                )}
              >
                {sliceLabel(names[i], chars)}
              </text>
            );
          })}
          <circle cx={C} cy={C} r={11} className="fill-card" />
          <circle
            cx={C}
            cy={C}
            r={11}
            className="ink-line ink-tone-ink"
            pathLength={1}
            fill="none"
            strokeWidth={2.4}
          />
        </svg>
      </div>
      {/* The pointer stays put at the top while the disc turns under it. */}
      <svg
        viewBox="0 0 40 40"
        className="ink-art ink-still pointer-events-none absolute left-1/2 top-0 h-9 w-9 -translate-x-1/2 -translate-y-1"
        aria-hidden="true"
      >
        <path
          d="M 8 6 L 32 6 L 20 34 Z"
          className="ink-fill ink-fill-danger"
          style={{ opacity: 0.85 }}
        />
        <path
          d="M 8 6 L 32 6 L 20 34 Z"
          className="ink-line ink-tone-ink"
          pathLength={1}
          fill="none"
          strokeWidth={2.6}
        />
      </svg>
    </div>
  );
}

export const PickerWheel = memo(PickerWheelImpl);

/** Spoken name for a wheel: "Wheel with 8 names". */
export function wheelLabel(count: number): string {
  return `Wheel with ${count} ${count === 1 ? "name" : "names"}`;
}
