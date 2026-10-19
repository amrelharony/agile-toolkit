"use client";

import { saveAs } from "file-saver";
import { AlertTriangle, Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStorageHealth } from "@/lib/stores/storage-health";
import { backupFilename, collectBackup, serializeBackup } from "@/lib/data/backup";
import { recordBackup } from "@/lib/data/backup-meta";

/**
 * Shown when the browser stops saving (storage full or blocked). The work
 * still exists in memory at this point, so offer the backup right here —
 * after a reload it would be gone.
 *
 * Note: collectBackup reads localStorage, so it captures what was saved up
 * to the failure; in-memory state newer than that is exported per tool.
 */
export function StorageHealthBanner() {
  const writeFailed = useStorageHealth((s) => s.writeFailed);
  const dismissed = useStorageHealth((s) => s.dismissed);
  const dismiss = useStorageHealth((s) => s.dismiss);
  if (!writeFailed || dismissed) return null;

  const download = () => {
    const blob = new Blob([serializeBackup(collectBackup())], { type: "application/json" });
    saveAs(blob, backupFilename());
    recordBackup();
  };

  return (
    <div
      role="alert"
      className="sticky top-0 z-[60] flex flex-wrap items-center gap-3 border-b border-warning/40 bg-warning/10 px-4 py-2.5 text-sm text-text backdrop-blur"
    >
      <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        <span className="font-semibold">This browser stopped saving your work.</span> Its storage is
        full or blocked, so changes will be lost when you close or reload the page. Download a
        backup now, then free up space or use another browser.
      </p>
      <Button type="button" size="sm" onClick={download} className="gap-1.5">
        <Download aria-hidden="true" />
        Download backup
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={dismiss}
        aria-label="Dismiss storage warning"
      >
        <X aria-hidden="true" />
      </Button>
    </div>
  );
}
