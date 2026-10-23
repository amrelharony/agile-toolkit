"use client";

/**
 * The Estimation Guide's notes for Poker's cards: what a card means to the
 * team, its example, and the done stories pinned as its reference. Read
 * only; the guide is where they're edited.
 *
 * Owner side only. A guest's browser has its own (usually empty) guide, and
 * the host's isn't part of the room's payload, so guests see no panel.
 */

import { useCallback, useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { useEstimationGuideStore } from "@/app/(tools)/estimation-guide/store";
import {
  cardReference,
  guideScaleFor,
  type CardReference,
} from "@/app/(tools)/estimation-guide/references";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { isEstimateCard } from "./consensus";
import { GUIDE_SCALE, type ScaleType } from "./types";

export type CardReferenceLookup = (card: string) => CardReference | null;

export function useCardReferences(scaleType: ScaleType | null | undefined): CardReferenceLookup {
  const guide = useEstimationGuideStore(
    useShallow((s) => ({
      selectedScale: s.selectedScale,
      descriptions: s.descriptions,
      examples: s.examples,
      referenceStoryIds: s.referenceStoryIds,
    }))
  );
  // The guide's store waits to be asked (its page merges a shared link first).
  useEffect(() => {
    void useEstimationGuideStore.persist.rehydrate();
  }, []);
  const stories = useWorkspaceStore((s) => s.stories);

  return useCallback(
    (card: string) => {
      if (!isEstimateCard(card)) return null;
      // The deck's own guide scale first; a custom deck borrows the guide's
      // chosen scale, or any scale with that value.
      const own = scaleType && scaleType !== "custom" ? GUIDE_SCALE[scaleType] : null;
      const scale = guideScaleFor(card.trim(), [own, guide.selectedScale]);
      return scale ? cardReference(guide, scale, card.trim(), stories ?? []) : null;
    },
    [guide, scaleType, stories]
  );
}
