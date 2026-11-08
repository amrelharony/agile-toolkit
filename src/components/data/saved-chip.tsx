"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { AlertTriangle, HardDrive } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOwnerState } from "@/lib/auth/use-is-owner";
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
const CHIP_BOX = "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs";

/**
 * "Saved in this browser" next to a tool's title, for visitors.
 *
 * Says where the work lives — the question every visitor has and nothing on
 * the page used to answer — and opens the backup dialog. Turns into a
 * warning when the browser has stopped saving. The owner's data syncs to
 * their account, so they don't get it.
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
        <HardDrive className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{SAVED_LABEL}</span>
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
        aria-label={`${label} — back up or restore your data`}
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
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <HardDrive className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        <span>{label}</span>
      </button>
      {opened && <YourDataDialog open={open} onOpenChange={setOpen} />}
    </>
  );
}
