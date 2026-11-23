"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { AlertTriangle, HardDrive } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOwnerState } from "@/lib/auth/use-is-owner";
import { LAST_BACKUP_AGE_WIDEST, lastBackupAge, lastBackupText } from "@/lib/data/backup-meta";
import { useLastBackupAt } from "@/lib/data/use-last-backup";
import { useStorageHealth } from "@/lib/stores/storage-health";

// The dialog (backup, restore, storage estimate) loads on first open; the
// chip itself is on every tool page.
const YourDataDialog = dynamic(
  () => import("@/components/data/your-data-dialog").then((m) => m.YourDataDialog),
  { ssr: false }
);

const SAVED_LABEL = "Saved in this browser";

/**
 * The chip's box. The placeholder below shares it, so the two are always the
 * same size: change the chip's size here, not on the button.
 */
// 32 px with a mouse, 44 px on touch screens; min-h so it grows instead of clipping.
const CHIP_BOX =
  "inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-xs pointer-coarse:min-h-11";

/**
 * When the last backup was, under the chip's label: "Last backup: 3 days
 * ago", or "No backup yet". Below the `lg` width it reads "Backup: 3 days
 * ago", which is no wider than the label above it: on a phone the chip
 * keeps the width it had and the toolbar its rows, and on a tablet the
 * toolbar takes no more room from the title beside it.
 */
function BackupLine({ age }: { age: string | null }) {
  if (age === null) return <>No backup yet</>;
  return (
    <>
      <span className="max-lg:hidden">Last backup: </span>
      <span className="lg:hidden">Backup: </span>
      {age}
    </>
  );
}

/** A copy of a line that only holds its width: invisible, no height, in the line's own cell. */
const WIDTH_HOLDER = "invisible col-start-1 h-0 overflow-hidden whitespace-nowrap";

/**
 * The chip's two lines: its label, and the last backup's age. Each shares
 * its cell with an invisible copy of the widest text that line can hold, so
 * the chip is one width whatever it says. The placeholder renders the same
 * thing before any of it can be read, and nothing moves when the real chip
 * takes its place or a backup is downloaded.
 */
function ChipText({ label, age }: { label: string; age: string | null }) {
  return (
    <span className="grid justify-items-start text-left leading-tight">
      <span className="col-start-1 row-start-1 whitespace-nowrap">{label}</span>
      <span className="col-start-1 row-start-2 whitespace-nowrap" data-saved-chip-backup="">
        <BackupLine age={age} />
      </span>
      <span aria-hidden="true" className={cn(WIDTH_HOLDER, "row-start-1")}>
        {SAVED_LABEL}
      </span>
      <span aria-hidden="true" className={cn(WIDTH_HOLDER, "row-start-2")}>
        <BackupLine age={LAST_BACKUP_AGE_WIDEST} />
      </span>
    </span>
  );
}

/**
 * "Saved in this browser" next to a tool's title, for visitors, with when
 * the last backup was under it.
 *
 * Says where the work lives — the question every visitor has and nothing on
 * the page used to answer — and how old the only other copy is, and opens
 * the backup dialog. Turns into a warning when the browser has stopped
 * saving. The owner's data syncs to their account, so they don't get it.
 *
 * Until auth settles nobody knows which of the two the reader is, so it
 * holds the chip's place with an invisible copy, in the server HTML too.
 * Mounting the chip only then wrapped the toolbar onto a second line on
 * phones and pushed the whole tool down after the first paint. The copy goes
 * once auth settles on anyone but a visitor: the owner, or a session whose
 * owner check is being retried (offline, 5xx). That session is almost always
 * the owner's, who gets no chip, and the retries can run for as long as the
 * reader stays offline, so holding a blank chip-sized gap in every toolbar
 * for it would only cost room.
 */
export function SavedChip({ className }: { className?: string }) {
  const { settled, visitor } = useOwnerState();
  const writeFailed = useStorageHealth((s) => s.writeFailed);
  // Follows a download made anywhere on the page, or in another tab.
  const lastBackup = useLastBackupAt();
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  if (!settled) {
    return (
      // Not a control: invisible, hidden from assistive tech, never focusable.
      <span
        aria-hidden="true"
        data-saved-chip-placeholder=""
        className={cn(CHIP_BOX, "invisible", className)}
      >
        <HardDrive className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <ChipText label={SAVED_LABEL} age={LAST_BACKUP_AGE_WIDEST} />
      </span>
    );
  }
  if (!visitor) return null;
  const label = writeFailed ? "Not saving" : SAVED_LABEL;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpened(true);
          setOpen(true);
        }}
        aria-haspopup="dialog"
        aria-label={`${label}. ${lastBackupText(lastBackup)}. Back up or restore your data`}
        className={cn(
          CHIP_BOX,
          "transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          writeFailed
            ? "border-warning/40 bg-warning/10 text-warning hover:bg-warning/15"
            : "border-border text-sub hover:border-accent/40 hover:text-text",
          className
        )}
      >
        {writeFailed ? (
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <HardDrive className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        )}
        <ChipText label={label} age={lastBackupAge(lastBackup)} />
      </button>
      {opened && <YourDataDialog open={open} onOpenChange={setOpen} />}
    </>
  );
}
