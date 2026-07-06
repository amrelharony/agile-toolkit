"use client";

import { useCallback } from "react";
import {
  align as alignFn,
  distribute as distributeFn,
  type AlignOp,
  type DistributeOp,
} from "@/lib/whiteboard/align";
import { normalizedRect } from "@/lib/geometry/bbox";
import { translateFlatPoints } from "@/lib/whiteboard/freehand";
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
      // normalizedRect: line/arrow store signed w/h — align math needs
      // positive extents. The result is a new min-corner for the
      // NORMALIZED rect, so apply it back as a delta on the object's
      // own x/y (identical for every non-delta kind).
      const result = alignFn(
        movable.map((o) => ({ id: o.id, rect: normalizedRect(o) })),
        op
      );
      const updates = movable
        .filter((o) => result[o.id])
        .map((o): WhiteboardObject => {
          const norm = normalizedRect(o);
          const dx = result[o.id].x - norm.x;
          const dy = result[o.id].y - norm.y;
          // Freehand ink lives in world-absolute `points` — translate
          // them with the bbox or align moves the box, not the ink.
          // Branched ternary (not a conditional spread) so TS keeps the
          // per-type narrowing — `card` has a numeric `points` field.
          return o.type === "freehand"
            ? {
                ...o,
                x: o.x + dx,
                y: o.y + dy,
                points: translateFlatPoints(o.points, dx, dy),
                version: o.version + 1,
                updatedAt: new Date().toISOString(),
              }
            : {
                ...o,
                x: o.x + dx,
                y: o.y + dy,
                version: o.version + 1,
                updatedAt: new Date().toISOString(),
              };
        });
      if (updates.length === 0) return;
      pushSnapshot();
      upsertMany(updates);
      log(CANVAS_ACTIONS.OBJECTS_MOVED, { count: updates.length, action: op });
    },
    [selection, objectsById, upsertMany, log, pushSnapshot]
  );

  const onDistribute = useCallback(
    (op: DistributeOp) => {
      const movable = selection
        .map((id) => objectsById.get(id))
        .filter((o): o is WhiteboardObject => !!o && !o.locked);
      if (movable.length < 3) return;
      // Same normalized-rect + delta-application scheme as onAlign —
      // see the comment there.
      const result = distributeFn(
        movable.map((o) => ({ id: o.id, rect: normalizedRect(o) })),
        op
      );
      const updates = movable
        .filter((o) => result[o.id])
        .map((o): WhiteboardObject => {
          const norm = normalizedRect(o);
          const dx = result[o.id].x - norm.x;
          const dy = result[o.id].y - norm.y;
          return o.type === "freehand"
            ? {
                ...o,
                x: o.x + dx,
                y: o.y + dy,
                points: translateFlatPoints(o.points, dx, dy),
                version: o.version + 1,
                updatedAt: new Date().toISOString(),
              }
            : {
                ...o,
                x: o.x + dx,
                y: o.y + dy,
                version: o.version + 1,
                updatedAt: new Date().toISOString(),
              };
        });
      if (updates.length === 0) return;
      pushSnapshot();
      upsertMany(updates);
      log(CANVAS_ACTIONS.OBJECTS_MOVED, { count: updates.length, action: op });
    },
    [selection, objectsById, upsertMany, log, pushSnapshot]
  );

  return { onAlign, onDistribute };
}
