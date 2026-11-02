"use client";

import { useEffect, useState } from "react";
import { MASCOT_SPRITE_URL } from "@/components/agent/mascot/mascot-asset";
import { POSES, SHEET } from "@/components/agent/mascot/engine/sprite-poses";
import { cn } from "@/lib/utils";

/** How wide Amr stands beside a balloon; the height follows the sheet's cell. */
const WIDTH = 72;
const HEIGHT = Math.round((WIDTH * SHEET.cellH) / SHEET.cellW);

/**
 * One still frame of Amr waiting, cut from the same sheet the corner figure uses:
 * no animation, no extra file, and `loading="lazy"` so it never competes with the
 * page. A visitor who asked to save data gets the balloon without him, the same
 * rule the corner figure follows.
 */
export function AmrStill({ className }: { className?: string }) {
  const [saveData, setSaveData] = useState(false);
  useEffect(() => {
    const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
    setSaveData(Boolean(nav.connection?.saveData));
  }, []);
  if (saveData) return null;

  const { row, still } = POSES.waiting;
  return (
    <span
      className={cn("relative block shrink-0 overflow-hidden", className)}
      style={{ width: WIDTH, height: HEIGHT }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a crop of a sprite sheet, sized by hand */}
      <img
        src={MASCOT_SPRITE_URL}
        alt="Amr, waiting"
        loading="lazy"
        decoding="async"
        width={WIDTH * SHEET.columns}
        height={HEIGHT * SHEET.rows}
        style={{
          position: "absolute",
          left: -still * WIDTH,
          top: -row * HEIGHT,
          width: WIDTH * SHEET.columns,
          height: HEIGHT * SHEET.rows,
          maxWidth: "none",
        }}
      />
    </span>
  );
}
