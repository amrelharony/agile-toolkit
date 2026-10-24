"use client";

import { useAuthOptional } from "@/lib/auth/auth-provider";
import { useOwnerState } from "@/lib/auth/use-is-owner";
import { useOwnerSyncGate, useOwnerSyncGateStore } from "@/lib/sync/owner-sync-gate";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";

/**
 * When a one-time move of old per-tool storage into the workspace may run,
 * shared by every legacy-data mount:
 *
 *   1. the workspace has loaded from this browser;
 *   2. auth has settled (an owner whose check is still being retried waits);
 *   3. no "work created while signed out" question is open (merge/discard);
 *   4. for the owner, after the cloud's first pull (the caller awaits
 *      `syncEngine.whenReady()` in "cloud" mode), so moved rows can't beat
 *      newer cloud rows;
 *   5. a visitor's data stays local, so it runs straight away.
 *
 * "off": nothing to move, or no AuthProvider (it can't tell the owner from
 * a visitor, so it never risks racing the owner's cloud pull). "wait": not
 * yet. "blocked": waiting on the owner's merge/discard answer. "local" and
 * "cloud": run now.
 */
export type LegacyMigrationMode = "off" | "wait" | "blocked" | "local" | "cloud";

export function useLegacyMigrationMode(found: boolean): LegacyMigrationMode {
  const auth = useAuthOptional();
  const owner = useOwnerState();
  const gateOpen = useOwnerSyncGate();
  const decision = useOwnerSyncGateStore((s) => s.decision);
  const hydrated = useWorkspaceHydrated();

  if (!found || auth === null) return "off";
  if (!hydrated || !owner.settled || owner.unverified) return "wait";
  if (owner.visitor) return "local";
  if (!owner.isOwner) return "wait";
  if (gateOpen) return "cloud";
  if (decision === "pending" || decision === "discarding") return "blocked";
  return "wait";
}
