"use client";

/**
 * The air around Amr while a weather or fireworks scene plays (engine/scene-fx.ts):
 * a layer behind him, wider than his box and reaching above it, so rain falls
 * round his umbrella and sparks burst over his head. CSS animations of transform
 * and opacity only; the sprite mounts it only while the scene is on screen, and
 * never with reduced motion.
 */

import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { FX_SPREAD, SPARK_COLOURS, SPARK_RAYS, particles, type SceneFx } from "./engine/scene-fx";
import styles from "./mascot-fx.module.css";

/** How long the air takes to clear once the scene is over. */
export const FX_FADE_MS = 500;

export function MascotFx({
  kind,
  leaving,
  width,
  height,
}: {
  kind: SceneFx;
  leaving: boolean;
  /** His box, in css px. */
  width: number;
  height: number;
}) {
  const w = width * (1 + 2 * FX_SPREAD.x);
  const h = height * (1 + FX_SPREAD.top);
  const style = {
    left: -width * FX_SPREAD.x,
    top: -height * FX_SPREAD.top,
    width: w,
    height: h,
    "--w": `${w.toFixed(1)}px`,
    "--h": `${h.toFixed(1)}px`,
  } as CSSProperties;

  return (
    <div
      className={cn(styles.fx, styles[kind], leaving && styles.leaving)}
      style={style}
      data-amr-fx={kind}
      aria-hidden="true"
    >
      {kind === "storm" && <span className={styles.flash} />}
      {kind === "dust" && <span className={styles.haze} />}
      {particles(kind).map((p, i) => {
        const vars = {
          "--x": `${p.x.toFixed(1)}%`,
          "--yf": p.y.toFixed(3),
          "--d": `${p.delay.toFixed(2)}s`,
          "--t": `${p.dur.toFixed(2)}s`,
          "--s": p.size.toFixed(2),
        } as CSSProperties;
        if (kind !== "sparks") return <span key={i} className={styles.p} style={vars} />;
        return (
          <span
            key={i}
            className={styles.burst}
            style={{ ...vars, "--c": SPARK_COLOURS[i % SPARK_COLOURS.length] } as CSSProperties}
          >
            {SPARK_RAYS.map((a) => (
              <span key={a} className={styles.ray} style={{ "--a": `${a}deg` } as CSSProperties} />
            ))}
          </span>
        );
      })}
    </div>
  );
}
