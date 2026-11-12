/**
 * Picker's show-room renderers: frame kind → component, one per kind in
 * `../frames/picker.ts`. Kept small and free of tool page code: the `/join`
 * page loads it for every show room (through the client-only show view, so
 * hooks are fine here).
 *
 * The wheel works out its landing from the frame's numbers (lib/picker/
 * wheel), the same way the host's page does, so every phone stops on the
 * host's name. It turns for about 2.5 s, then says who it landed on in a
 * polite status line; under reduced motion it lands at once. A frame that
 * reaches a phone long after it was shown (someone joining late) lands at
 * once too, rather than spinning a result everyone else already saw.
 *
 * Landing at once still happens a render after the line mounts, so a
 * screen reader hears the name (a live region whose text arrives with it
 * is often missed). The host's own preview has no live line: the tool page
 * already announces the result, and the host would hear it twice.
 */

import { useEffect, useState } from "react";
import { PickerWheel, wheelLabel } from "@/components/picker/picker-wheel";
import { usePrefersReducedMotion } from "@/hooks/use-media-query";
import { SPIN_MS, landingRotation, wheelSlices } from "@/lib/picker/wheel";
import { cn } from "@/lib/utils";
import { PICKER_WHEEL_KIND, type WheelFrame } from "../frames/picker";
import { defineShowRenderer, type ShowRendererProps, type ShowRenderers } from "./types";

/** A frame older than this when it arrives lands at once (allowing for clocks that differ). */
export const LATE_FRAME_MS = SPIN_MS + 15_000;

/** The turn starts a moment after the first paint, so the wheel visibly leaves its start. */
const START_DELAY_MS = 30;

export function WheelFrameView({ payload, frame, surface }: ShowRendererProps<WheelFrame>) {
  const reduced = usePrefersReducedMotion();
  const late = Date.now() - frame.at > LATE_FRAME_MS;
  const still = reduced || late;
  const target = landingRotation(
    wheelSlices(payload.weights),
    payload.winner,
    payload.turns,
    payload.offset
  );
  const [rotation, setRotation] = useState(still ? target : 0);
  const [landed, setLanded] = useState(false);

  useEffect(() => {
    if (still) {
      setRotation(target);
      setLanded(true);
      return;
    }
    // Timers, not animation frames: a phone in the background still lands.
    const start = setTimeout(() => setRotation(target), START_DELAY_MS);
    const land = setTimeout(() => setLanded(true), START_DELAY_MS + SPIN_MS);
    return () => {
      clearTimeout(start);
      clearTimeout(land);
    };
  }, [still, target]);

  const name = payload.names[payload.winner];
  return (
    <div className="space-y-3 text-center">
      {payload.title && (
        <p
          className={cn(
            "break-words font-semibold text-text",
            surface === "phone" ? "text-lg" : "text-sm"
          )}
        >
          {payload.title}
        </p>
      )}
      <PickerWheel
        names={payload.names}
        weights={payload.weights}
        out={payload.out}
        rotation={rotation}
        spinning={!landed}
        winner={landed ? payload.winner : null}
        label={wheelLabel(payload.names.length)}
        className={surface === "phone" ? "max-w-xs" : "max-w-48"}
      />
      <p
        role={surface === "phone" ? "status" : undefined}
        className={cn(
          "break-words",
          landed ? "font-bold text-text" : "text-sub",
          surface === "phone" ? "text-2xl sm:text-3xl" : "text-base"
        )}
      >
        {landed ? name : "Spinning…"}
      </p>
    </div>
  );
}

export const PICKER_RENDERERS: ShowRenderers = {
  [PICKER_WHEEL_KIND]: defineShowRenderer<WheelFrame>(WheelFrameView),
};
