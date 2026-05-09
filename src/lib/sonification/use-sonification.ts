"use client";

import { useCallback, useMemo } from "react";
import { emit } from "./emit";

export function useSonification() {
  const stableEmit = useCallback(
    (toolId: string, eventName: string) => emit(toolId, eventName),
    []
  );
  return useMemo(() => ({ emit: stableEmit }), [stableEmit]);
}

export function useToolSonification(toolId: string) {
  return useCallback((eventName: string) => emit(toolId, eventName), [toolId]);
}
