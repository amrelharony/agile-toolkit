"use client";

import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from "react";
import type { AllocationSheet } from "@/lib/realtime/vote-room/allocation";

/** What a sheet shows, as one string: two sheets with the same key look the same. */
export function sheetKeyOf(sheet: AllocationSheet | null): string {
  if (!sheet) return "";
  return [
    sheet.id,
    sheet.budget,
    sheet.unit,
    ...sheet.items.map((x) => `${x.id}|${x.text}|${x.cap ?? ""}|${x.hint ?? ""}`),
  ].join("\n");
}

interface Held {
  sheet: AllocationSheet;
  /** The round entered by hand on it that is saved now; null while none is. */
  savedRoundId: string | null;
}

/**
 * The sheet the count entry types on, held still while it is in use.
 *
 * The kit's count entry starts over, dropping every split typed, whenever
 * its sheet changes, and this game's sheet changes with every purchase
 * (each feature's cap and the budget follow what's left) and every saved
 * round (its number). So the page holds the sheet:
 *  - from the first amount typed into the count entry, so a purchase at
 *    the table, by an agent or in another tab doesn't wipe the splits
 *    added so far (the save caps every total again against the game as it
 *    is then, so a held sheet is safe);
 *  - once a round entered by hand is saved, while the count entry shows
 *    it, so after Undo its totals are still there to save again.
 * It lets go when the count entry moves on from a saved round ("Enter
 * another round", hiding it, a live round: `SavedRoundNote` unmounts),
 * when someone asks for the current numbers, and on a reset. A live room
 * keeps its own round until New round, which needs the current sheet, so
 * a live round's save lets go at once.
 */
export function useHeldSheet(current: AllocationSheet | null) {
  const [held, setHeld] = useState<Held | null>(null);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current);
    },
    []
  );

  const sheet = held?.sheet ?? current;

  /** onChangeCapture around the panel: the first amount typed in the count entry holds its sheet. */
  const onEntryChange = (e: SyntheticEvent) => {
    if (held || !current) return;
    const target = e.target as Element | null;
    // The count entry's boxes (amounts, and "People who split" for totals).
    if (target?.closest?.("[data-allocation-box]")) setHeld({ sheet: current, savedRoundId: null });
  };

  /** A round entered by hand on the shown sheet was saved: keep it while it shows. */
  const keepSaved = (roundId: string) => {
    if (sheet) setHeld({ sheet, savedRoundId: roundId });
  };

  /** That round's save was undone: its sheet stays, for saving it again. */
  const unsave = (roundId: string) =>
    setHeld((h) => (h?.savedRoundId === roundId ? { ...h, savedRoundId: null } : h));

  const release = () => setHeld(null);

  // Deferred, and cancelled by a remount: React's development double mount
  // unmounts a note once without the count entry moving on.
  const noteShown = useCallback(() => {
    if (pending.current) clearTimeout(pending.current);
    pending.current = null;
  }, []);
  const noteGone = useCallback((roundId: string) => {
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => {
      pending.current = null;
      setHeld((h) => (h?.savedRoundId === roundId ? null : h));
    }, 0);
  }, []);

  return {
    sheet,
    isHeld: held !== null,
    /** A held sheet no round was saved on, that no longer matches the game. */
    stale:
      held !== null && held.savedRoundId === null && sheetKeyOf(held.sheet) !== sheetKeyOf(current),
    onEntryChange,
    keepSaved,
    unsave,
    release,
    noteShown,
    noteGone,
  };
}

/**
 * What a saved round did, as it was worked out when it was saved (never
 * recomputed against the rows it changed). Its unmount tells the page the
 * count entry moved on from that round.
 */
export function SavedRoundNote({
  roundId,
  text,
  onShown,
  onGone,
}: {
  roundId: string;
  text: string;
  onShown: () => void;
  onGone: (roundId: string) => void;
}) {
  useEffect(() => {
    onShown();
    return () => onGone(roundId);
  }, [roundId, onShown, onGone]);
  return <p className="text-sm text-text">Saved: {text}</p>;
}
