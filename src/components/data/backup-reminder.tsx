"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { saveAs } from "file-saver";
import { useOwnerState } from "@/lib/auth/use-is-owner";
import { backupFilename, collectBackup, serializeBackup } from "@/lib/data/backup";
import { recordBackup } from "@/lib/data/backup-meta";
import { backupReminderDue, recordBackupReminder } from "@/lib/data/backup-reminder";
import { isQuietRoute } from "@/lib/gamification/quiet";
import { toast } from "@/lib/utils/toast";

/** Let the page settle before nudging. */
const REMINDER_DELAY_MS = 20_000;

/**
 * A weekly-at-most "back up your work" toast for visitors whose only copy
 * is this browser. Renders nothing.
 */
export function BackupReminder() {
  const { visitor } = useOwnerState();
  const pathname = usePathname();
  const quiet = isQuietRoute(pathname);

  useEffect(() => {
    if (!visitor || quiet) return;
    const timer = window.setTimeout(() => {
      if (!backupReminderDue()) return;
      recordBackupReminder();
      toast.info("Back up your toolkit data", {
        description:
          "Your work is saved only in this browser. A backup file lets you get it back if site data is cleared.",
        duration: 15_000,
        action: {
          label: "Download backup",
          onClick: () => {
            const blob = new Blob([serializeBackup(collectBackup())], {
              type: "application/json",
            });
            saveAs(blob, backupFilename());
            recordBackup();
          },
        },
      });
    }, REMINDER_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [visitor, quiet]);

  return null;
}
