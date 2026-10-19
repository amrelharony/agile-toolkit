"use client";

import { useEffect, useRef, useState } from "react";
import { useAuthOptional } from "@/lib/auth/auth-provider";
import { useOwnerState } from "@/lib/auth/use-is-owner";
import { hasLegacySprintData } from "@/lib/sprints/legacy-keys";
import { useSprintMigrationStore } from "@/lib/sprints/migration-status";
import { syncEngine } from "@/lib/sync/engine";
import { useOwnerSyncGate, useOwnerSyncGateStore } from "@/lib/sync/owner-sync-gate";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { toast } from "@/lib/utils/toast";

/**
 * Moves the old per-tool sprint data (Burndown, Burnup, Velocity, Sprint
 * Comparison) into shared sprints, once, when it is safe to:
 *
 *   1. the workspace has loaded from this browser;
 *   2. auth has settled (an owner whose check is still being retried waits);
 *   3. no "work created while signed out" question is open (merge/discard);
 *   4. for the owner, the cloud's first pull has finished
 *      (`syncEngine.whenReady()`), so moved rows can't beat newer cloud rows;
 *   5. a visitor's data stays local, so it runs straight away.
 *
 * Renders nothing. Without any old key it does nothing at all and never
 * loads the migration code. It must sit inside AuthProvider (the app
 * shell's providers): without one it can't tell the owner from a visitor,
 * so it does nothing rather than risk racing the owner's cloud pull.
 */

/** After this long still waiting (offline owner, slow pull), tools stop showing "Loading sprints…". */
const STALL_MS = 10_000;

type Mode = "off" | "wait" | "blocked" | "local" | "cloud";

function setStatus(status: "idle" | "pending" | "done") {
  useSprintMigrationStore.getState().setStatus(status);
}

export function LegacySprintMigration() {
  const auth = useAuthOptional();
  const owner = useOwnerState();
  const gateOpen = useOwnerSyncGate();
  const decision = useOwnerSyncGateStore((s) => s.decision);
  const hydrated = useWorkspaceHydrated();
  const [found, setFound] = useState(false);
  const started = useRef(false);
  const hasAuth = auth !== null;

  // The cheap check, once: no old keys means nothing to do, ever.
  useEffect(() => {
    if (!hasAuth || started.current || !hasLegacySprintData()) return;
    setFound(true);
    setStatus("pending");
  }, [hasAuth]);

  let mode: Mode = "off";
  if (found && hasAuth) {
    if (!hydrated || !owner.settled || owner.unverified) mode = "wait";
    else if (owner.visitor) mode = "local";
    else if (!owner.isOwner) mode = "wait";
    else if (gateOpen) mode = "cloud";
    else if (decision === "pending" || decision === "discarding") mode = "blocked";
    else mode = "wait";
  }

  // Waiting on the owner's merge/discard answer can take any time: let the
  // tools show what they have meanwhile. Waiting on anything else gets a
  // grace period first.
  useEffect(() => {
    if (started.current) return;
    if (mode === "blocked") {
      setStatus("idle");
      return;
    }
    if (mode !== "wait") return;
    const t = setTimeout(() => {
      if (!started.current) setStatus("idle");
    }, STALL_MS);
    return () => clearTimeout(t);
  }, [mode]);

  useEffect(() => {
    if (started.current || (mode !== "local" && mode !== "cloud")) return;
    started.current = true;
    setStatus("pending");
    const stall = setTimeout(() => setStatus("idle"), STALL_MS);
    void (async () => {
      try {
        if (mode === "cloud") await syncEngine.whenReady();
        const { runLegacySprintMigration, migrationSummary } =
          await import("@/lib/sprints/migrate-legacy");
        const result = await runLegacySprintMigration();
        const summary = migrationSummary(result.report);
        if (summary) toast.success(summary);
      } catch (err) {
        // The old keys stay; the next load tries again.
        // eslint-disable-next-line no-console
        console.warn("[sprint-migration] failed", err);
      } finally {
        clearTimeout(stall);
        setStatus("done");
      }
    })();
  }, [mode]);

  return null;
}
