"use client";

import { useEffect } from "react";
import { useOwnerSyncGate } from "@/lib/sync/owner-sync-gate";
import { installKudosCloudSync, uninstallKudosCloudSync } from "./cloud-sync";
import { resetKudosBackfillLatch, runKudosBackfillIfNeeded } from "./backfill";

/**
 * Owner-only half of the kudos cloud mirror. Mounted under <AuthProvider>
 * in the app shell.
 *
 * Cloud-sync and the backfill POST to `/api/kudos`, which only the owner
 * may call — visitors on the public site keep their kudos in the browser.
 * They start once the verified owner is signed in AND any pending "merge
 * or discard visitor data?" decision is settled (so the backfill never
 * uploads kudos the owner chose to discard), and stop again on sign-out.
 *
 * The local-only receive bridge stays in the app shell for everyone.
 */
export function KudosOwnerBridge() {
  const enabled = useOwnerSyncGate();

  useEffect(() => {
    if (!enabled) return;
    installKudosCloudSync();
    // Microtask: if the gate is already open on the first commit, this
    // effect runs before the app shell's mount effect (children first) —
    // let the workspace-store rehydrate land before the backfill reads it.
    void Promise.resolve().then(() => runKudosBackfillIfNeeded());
    return () => {
      uninstallKudosCloudSync();
      // Kudos sent while the gate is closed aren't queued for cloud sync;
      // the next gate opening (sign-in, merge) must backfill them, even in
      // this same tab session.
      resetKudosBackfillLatch();
    };
  }, [enabled]);

  return null;
}
