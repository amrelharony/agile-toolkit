"use client";

import { useMemo } from "react";
import { useAuthOptional } from "./auth-provider";
import { OWNER_UNVERIFIED } from "./owner-check";

export { OWNER_SEEN_KEY } from "./owner-check";

// Kept out of auth-provider.tsx so the many tests that stub
// `vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional }))`
// drive these hooks without extra mocking.

/**
 * True only for the server-verified owner. AuthProvider reports
 * "authenticated" solely after `/api/auth/owner` confirmed the session,
 * so any other Supabase session (or none) reads as a visitor. Returns
 * false when no AuthProvider is mounted (the guest tree).
 */
export function useIsOwner(): boolean {
  const auth = useAuthOptional();
  return auth?.status === "authenticated" && auth.user !== null;
}

export interface OwnerState {
  /** The server-verified owner. */
  isOwner: boolean;
  /** Auth is past its initial "loading" state. */
  settled: boolean;
  /**
   * A session exists but the owner check went unanswered (offline, 5xx,
   * timeout) and AuthProvider is retrying. Neither owner nor visitor:
   * nothing owner-only runs, but nothing should treat the (almost always
   * the owner's) session as a visitor's either.
   */
  unverified: boolean;
  /**
   * A confirmed visitor: settled, not the owner, and not merely awaiting
   * an owner re-check. Use this — not `settled && !isOwner` — before acting
   * on someone as a visitor (marking their writes, dropping share links).
   */
  visitor: boolean;
}

/**
 * `useIsOwner()` plus whether auth has settled, for callers that must not
 * act on the initial "loading" state (e.g. treating a still-loading owner
 * as a visitor). Without an AuthProvider there is nothing to wait for.
 */
export function useOwnerState(): OwnerState {
  const auth = useAuthOptional();
  const isOwner = auth?.status === "authenticated" && auth.user !== null;
  const settled = auth ? auth.status !== "loading" : true;
  const unverified = auth?.status === "error" && auth.error === OWNER_UNVERIFIED;
  const visitor = settled && !isOwner && !unverified;
  return useMemo(
    () => ({ isOwner, settled, unverified, visitor }),
    [isOwner, settled, unverified, visitor]
  );
}
