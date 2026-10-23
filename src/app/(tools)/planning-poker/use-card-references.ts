"use client";

/**
 * The Estimation Guide's notes for Poker's cards: what a card means to the
 * team, its example, and the done stories pinned as its reference. Read
 * only; the guide is where they're edited.
 *
 * Owner side only. A guest's browser has its own (usually empty) guide, and
 * the host's isn't part of the room's payload, so guests see no panel.
 */

import { useCallback, useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useEstimationGuideStore } from "@/app/(tools)/estimation-guide/store";
import {
  cardReference,
  guideScaleFor,
  type CardReference,
} from "@/app/(tools)/estimation-guide/references";
import { scales } from "@/lib/constants/scales";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { estimateCards, isEstimateCard } from "./consensus";
import { GUIDE_SCALE, type ScaleType } from "./types";

export type CardReferenceLookup = (card: string) => CardReference | null;

/**
 * The guide scale a custom deck reads as a whole: one whose values are the
 * deck's estimate cards exactly (the default custom deck is the guide's
 * Powers of 2), else the first of `preferred`, then of the guide's scales,
 * that holds every card. Null when none does, and each card falls back to
 * a scale of its own.
 *
 * Entries are per scale because an 8 on Fibonacci and an 8 on Powers of 2
 * can mean different things; picking per card would show one deck's cards
 * against two scales' calibrations.
 */
export function deckGuideScale(
  deck: readonly string[],
  preferred: readonly (string | null | undefined)[] = []
): string | null {
  const cards = estimateCards(deck).map((c) => c.trim());
  if (cards.length === 0) return null;
  const valuesOf = (name: string) =>
    (scales.find((s) => s.name === name)?.values ?? []).map(String);
  const exact = scales.find((s) => {
    const values = s.values.map(String);
    return values.length === cards.length && values.every((v, i) => v === cards[i]);
  });
  if (exact) return exact.name;
  const holdsAll = (name: string) => {
    const values = valuesOf(name);
    return values.length > 0 && cards.every((c) => values.includes(c));
  };
  for (const name of preferred) if (name && holdsAll(name)) return name;
  return scales.find((s) => holdsAll(s.name))?.name ?? null;
}

export function useCardReferences(
  scaleType: ScaleType | null | undefined,
  deck: readonly string[] = []
): CardReferenceLookup {
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

  // The deck's own guide scale; a custom deck reads as the guide scale it
  // matches, if any.
  const deckKey = deck.join("\n");
  const own = useMemo(
    () =>
      scaleType && scaleType !== "custom"
        ? GUIDE_SCALE[scaleType]
        : scaleType === "custom"
          ? deckGuideScale(deckKey.split("\n"), [guide.selectedScale])
          : null,
    [scaleType, deckKey, guide.selectedScale]
  );

  return useCallback(
    (card: string) => {
      if (!isEstimateCard(card)) return null;
      // Else the guide's chosen scale, or any scale with that value.
      const scale = guideScaleFor(card.trim(), [own, guide.selectedScale]);
      return scale ? cardReference(guide, scale, card.trim(), stories ?? []) : null;
    },
    [guide, own, stories]
  );
}
