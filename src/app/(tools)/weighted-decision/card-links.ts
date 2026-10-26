/**
 * Canvas cards pinned to a matrix's options. Deleting an option (or the
 * matrix it is in) unpins them (the store's cascadeSourceRefRemoval), and
 * an Undo that only put the option back would leave them unpinned: the
 * delete keeps their links first and the Undo re-pins them, as
 * lib/decisions/store's restoreDecisionRecord does for a decision record.
 */

import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { WhiteboardObject } from "@/lib/stores/workspace-types";

/** One card's link, as the delete found it. */
export interface CardLink {
  id: string;
  sourceRef: NonNullable<WhiteboardObject["sourceRef"]>;
}

/** The store's tool name for a card pinned to a weighted option. */
const OPTION_CARD_TOOL = "weightedOption";

/** The cards pinned to any of the options `optionIds`, right now (before the delete). */
export function optionCardLinks(optionIds: readonly string[]): CardLink[] {
  const ids = new Set(optionIds);
  return (useWorkspaceStore.getState().whiteboardObjects ?? []).flatMap((o) =>
    o.sourceRef && o.sourceRef.tool === OPTION_CARD_TOOL && ids.has(o.sourceRef.entityId)
      ? [{ id: o.id, sourceRef: o.sourceRef }]
      : []
  );
}

/** Re-pin the cards a delete unpinned: each only while it is still there and unpinned. */
export function repinCards(cards: readonly CardLink[]): void {
  if (cards.length === 0) return;
  const objects = new Map(
    (useWorkspaceStore.getState().whiteboardObjects ?? []).map((o) => [o.id, o])
  );
  const at = new Date().toISOString();
  const back = cards.flatMap(({ id, sourceRef }) => {
    const o = objects.get(id);
    // version + updatedAt bump so peers accept the change (last write wins).
    return o && !o.sourceRef ? [{ ...o, sourceRef, version: o.version + 1, updatedAt: at }] : [];
  });
  if (back.length > 0) useWorkspaceStore.getState().upsertWhiteboardObjects(back);
}
