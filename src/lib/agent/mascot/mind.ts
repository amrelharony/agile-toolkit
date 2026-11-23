"use client";

/**
 * Amr's mind for this tab: his inner state (brain/state.ts) and what he
 * remembers of the visitor (memory.ts), in one place that everything touching
 * him can reach: his taps and carries, his senses, the chat and the tools. It is
 * made the first time something asks for it, which is when the visit is noted.
 *
 * `feel` says something happened to him; `did` says he did something, so that he
 * varies what he does next. What he remembers is saved a moment later, to this
 * browser only. "Clear data on this browser" forgets it (see forgetMind).
 */

import { resetOnLocalDataClear } from "@/lib/utils/clear-local-data";
import { createBrain, type Brain, type BrainEvent } from "./brain/state";
import {
  counted,
  loadMemory,
  noteVisit,
  recalled,
  saveMemory,
  type Arrival,
  type MascotMemory,
} from "./memory";

export interface Mind {
  brain: Brain;
  memory: MascotMemory;
  /** How this visit began: a first visit, the same day again, the next day, or back after a while. */
  arrival: Arrival;
}

let mind: Mind | null = null;
let saving: ReturnType<typeof setTimeout> | undefined;

function storage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/** Someone he has met starts a little fonder, an old friend more so (up to a point). */
function fondness(memory: MascotMemory): number {
  return 0.4 + Math.min(0.2, Math.max(0, memory.days - 1) * 0.02);
}

export function getMind(): Mind {
  if (mind) return mind;
  const { memory, arrival } = noteVisit(loadMemory(storage()), new Date());
  saveMemory(storage(), memory);
  mind = { brain: createBrain({ start: { affection: fondness(memory) } }), memory, arrival };
  resetOnLocalDataClear(forgetMind);
  return mind;
}

/**
 * Forget the visitor in this tab. "Clear data on this browser" runs it before
 * it removes the stored memory: otherwise a save already on its way, or the
 * next thing that happens to him before the page reloads, would put the old
 * memory straight back. If he is asked again before the reload, he starts from
 * whatever the storage holds by then.
 */
export function forgetMind(): void {
  clearTimeout(saving);
  saving = undefined;
  mind = null;
}

function saveSoon(): void {
  if (saving !== undefined) return;
  saving = setTimeout(() => {
    saving = undefined;
    if (mind) saveMemory(storage(), mind.memory);
  }, 1500);
}

/** Something happened to him: it moves his mood, and that kind of thing is counted. */
export function feel(event: BrainEvent): void {
  const m = getMind();
  m.brain.note(event);
  m.memory = counted(m.memory, event);
  saveSoon();
}

/** He did this (a reaction or a scene by name): remembered, so he doesn't repeat himself. */
export function did(what: string): void {
  const m = getMind();
  m.memory = recalled(m.memory, what);
  saveSoon();
}

/** The last things he did, oldest first. */
export function recentlyDid(): readonly string[] {
  return getMind().memory.recent;
}

let arrivalTaken = false;

/** How this visit began, the first time it's asked; after that it's old news. */
export function takeArrival(): Arrival {
  const { arrival } = getMind();
  if (arrivalTaken) return { kind: "same-day" };
  arrivalTaken = true;
  return arrival;
}

/** Test-only: forget the mind (not the storage). */
export function __resetMindForTests(): void {
  forgetMind();
  arrivalTaken = false;
}
