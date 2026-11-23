"use client";

/**
 * What Ask Amr's step ideas need beside <AiSuggestions>: the list shown,
 * and an add the step list refused (full, too big, or the obstacle it
 * works on is gone). A refused idea isn't used up: it stays in the list,
 * and the reason shows in place, so nothing is dropped without a word.
 *
 * <AiSuggestions> marks an item taken before calling onAccept, so a
 * refusal starts the list afresh (a new key round) without the ideas that
 * were added.
 */

import { useRef, useState } from "react";
import type { AiSource } from "@/lib/ai/task-types";

export function useStepIdeas<T>() {
  const [suggested, setSuggested] = useState<{ items: T[]; source: AiSource } | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const added = useRef(new Set<T>());

  /** A new answer: shown afresh. */
  const show = (items: T[], source: AiSource) => {
    added.current = new Set();
    setRefusal(null);
    setSuggested({ items, source });
  };

  /** An idea's add came back: true when it was added, else it stays and says why. */
  const settle = (item: T, why: string | null): boolean => {
    setRefusal(why);
    if (!why) {
      added.current.add(item);
      return true;
    }
    setSuggested((s) => s && { ...s, items: s.items.filter((x) => !added.current.has(x)) });
    setRound((r) => r + 1);
    return false;
  };

  const close = () => {
    setSuggested(null);
    setRefusal(null);
  };

  /** Each idea's key in the list, new after a refusal. */
  const itemKey = (item: T) => `${round}\u0000${JSON.stringify(item)}`;

  return { suggested, refusal, show, settle, close, itemKey };
}
