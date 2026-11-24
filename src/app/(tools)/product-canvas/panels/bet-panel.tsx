"use client";

/**
 * A Shape Up pitch's place on the betting table, on the pitch itself: where
 * it stands, its cycle, and the circuit breaker once the cycle has ended.
 * "Open the betting table" shows every pitch side by side.
 */

import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import type { CanvasHandle } from "../boxes";
import { BetControls, type BetWriter } from "./bet-controls";

export function BetPanel({
  handle,
  onOpenTable,
}: {
  handle: CanvasHandle;
  /** Show the betting table (the list filtered to Shape Up pitches). */
  onOpenTable?: () => void;
}) {
  const writer: BetWriter = {
    world: handle.world,
    put: handle.put,
    log: (_id, action, payload) => handle.log(action, payload),
  };
  return (
    <SectionCard title="On the betting table" contentClassName="space-y-3">
      <BetControls pitch={handle.canvas} writer={writer} />
      {onOpenTable && (
        <Button type="button" size="sm" variant="ghost" onClick={onOpenTable}>
          Open the betting table
        </Button>
      )}
    </SectionCard>
  );
}
