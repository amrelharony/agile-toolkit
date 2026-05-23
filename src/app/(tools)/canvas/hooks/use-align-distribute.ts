"use client";

import { useCallback } from "react";
import { align as alignFn, distribute as distributeFn, type AlignOp, type DistributeOp } from "@/lib/whiteboard/align";
import { CANVAS_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import type { WhiteboardObject } from "@/lib/stores/workspace-types";

type LogFn = ReturnType<typeof useHistoryLogger>["log"];

/**
 * Align + distribute callbacks for the floating align toolbar.
 *
 * Locked objects are filtered out — the toolbar still works on the
 * remaining selection, matching Miro's behaviour. Both callbacks
 * version-bump every moved object so realtime peers see the change,
 * and snapshot only when there's a real mutation to record (so the
 * undo stack doesn't fill with no-op entries the user has to Cmd+Z
 * past to reach a real edit).
 *
 * Align needs ≥2 selected objects; distribute needs ≥3.
 */
export function useAlignDistribute(params: {
  selection: readonly string[];
  objectsById: ReadonlyMap<string, WhiteboardObject>;
  upsertMany: (objs: WhiteboardObject[]) => void;
  pushSnapshot: () => void;
  log: LogFn;
}) {
  const { selection, objectsById, upsertMany, pushSnapshot, log } = params;

  const onAlign = useCallback(
    (op: AlignOp) => {
      const movable = selection
        .map((id) => objectsById.get(id))
        .filter((o): o is WhiteboardObject => !!o && !o.locked);
      if (movable.length < 2) return;
      const result = alignFn(
        movable.map((o) => ({ id: o.id, rect: { x: o.x, y: o.y, w: o.w, h: o.h } })),
        op,
      );
      const updates = movable
        .filter((o) => result[o.id])
        .map((o) => ({
          ...o,
          x: result[o.id].x,
          y: result[o.id].y,
          version: o.version + 1,
          updatedAt: new Date().toISOString(),
        }));
      if (updates.length === 0) return;
      pushSnapshot();
      upsertMany(updates);
      log(CANVAS_ACTIONS.OBJECTS_MOVED, { count: updates.length, action: op });
    },
    [selection, objectsById, upsertMany, log, pushSnapshot],
  );

  const onDistribute = useCallback(
    (op: DistributeOp) => {
      const movable = selection
        .map((id) => objectsById.get(id))
        .filter((o): o is WhiteboardObject => !!o && !o.locked);
      if (movable.length < 3) return;
      const result = distributeFn(
        movable.map((o) => ({ id: o.id, rect: { x: o.x, y: o.y, w: o.w, h: o.h } })),
        op,
      );
      const updates = movable
        .filter((o) => result[o.id])
        .map((o) => ({
          ...o,
          x: result[o.id].x,
          y: result[o.id].y,
          version: o.version + 1,
          updatedAt: new Date().toISOString(),
        }));
      if (updates.length === 0) return;
      pushSnapshot();
      upsertMany(updates);
      log(CANVAS_ACTIONS.OBJECTS_MOVED, { count: updates.length, action: op });
    },
    [selection, objectsById, upsertMany, log, pushSnapshot],
  );

  return { onAlign, onDistribute };
}
