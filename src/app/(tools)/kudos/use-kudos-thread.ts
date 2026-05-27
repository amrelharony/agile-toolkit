"use client";

/**
 * Per-mount thread-expansion state.
 *
 * Reply composers are revealed inline beneath their parent card; this
 * hook tracks WHICH cards have an open composer right now. State is
 * deliberately not persisted — closing and re-opening the page should
 * collapse every composer, like Slack threads.
 */

import { useCallback, useState } from "react";

export interface UseKudosThreadHook {
  expandedKudosIds: Set<string>;
  toggleExpand: (id: string) => void;
  isExpanded: (id: string) => boolean;
}

export function useKudosThread(): UseKudosThreadHook {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const isExpanded = useCallback((id: string) => expanded.has(id), [expanded]);

  return { expandedKudosIds: expanded, toggleExpand, isExpanded };
}
