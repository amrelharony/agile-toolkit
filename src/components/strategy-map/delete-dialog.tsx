"use client";

/**
 * The question before a part with anything under it goes: what goes with
 * it ("Delete “Busy parents” with 3 impacts and 5 deliverables?"), and that
 * Undo puts it back. A part with nothing under it goes at once, with Undo.
 * Never the browser's confirm().
 */

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import type { StrategyMap, StrategyMapNode } from "@/lib/stores/workspace-types";
import { levelOf } from "@/lib/strategy-map/formats";
import { branchOf, nodeTitle } from "@/lib/strategy-map/model";

/** "3 impacts and 5 deliverables": what goes with `node`, by level, the node itself not counted. */
export function belowText(map: StrategyMap, node: StrategyMapNode): string {
  const below = branchOf(map, node.id).filter((n) => n.id !== node.id);
  const parts: string[] = [];
  for (let level = node.level + 1; level <= 3; level++) {
    const n = below.filter((x) => x.level === level).length;
    if (n === 0) continue;
    const l = levelOf(map.format, level);
    parts.push(`${n} ${n === 1 ? l.label.toLowerCase() : l.plural}`);
  }
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/** "Delete “X” with 2 impacts and 5 deliverables?" */
export function deleteQuestion(map: StrategyMap, node: StrategyMapNode): string {
  const tail = belowText(map, node);
  return `Delete “${nodeTitle(node, map.format)}”${tail ? ` with ${tail}` : ""}?`;
}

export function DeleteNodeDialog({
  map,
  node,
  onClose,
  onConfirm,
}: {
  map: StrategyMap | undefined;
  /** The part asked about; null when the dialog is shut. */
  node: StrategyMapNode | null;
  onClose: () => void;
  onConfirm: (node: StrategyMapNode) => void;
}) {
  const open = Boolean(map && node);
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={map && node ? deleteQuestion(map, node) : ""}
      description="Undo puts everything back. What it was sent to stays where it went."
      confirmLabel="Delete"
      onConfirm={() => {
        if (node) onConfirm(node);
      }}
    />
  );
}
