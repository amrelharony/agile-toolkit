"use client";

import { useOwnerState } from "@/lib/auth/use-is-owner";

/**
 * Whether this browser's reading should be counted (lib/comics/stats): any
 * confirmed visitor, never the owner, and nothing while sign-in is still being
 * checked, so the owner's own reading can't tilt the figures meant to show what
 * readers like.
 */
export function useCounting(): boolean {
  return useOwnerState().visitor;
}
