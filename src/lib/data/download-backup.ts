/**
 * The one backup download: everything this browser holds for the toolkit,
 * as a file, with the time remembered. The "Your data" dialog, the weekly
 * reminder, the "stopped saving" banner and the Close sprint dialog all
 * offer it, and each used to carry its own copy of these lines.
 *
 * It only ever runs on a click: nothing here writes a file on its own.
 */

import { saveAs } from "file-saver";
import { backupFilename, collectBackup, serializeBackup } from "@/lib/data/backup";
import { recordBackup } from "@/lib/data/backup-meta";

/** Download the backup file and remember when. Returns how many items it holds. */
export function downloadBackup(): number {
  const backup = collectBackup();
  const blob = new Blob([serializeBackup(backup)], { type: "application/json" });
  saveAs(blob, backupFilename());
  recordBackup();
  return Object.keys(backup.keys).length;
}
