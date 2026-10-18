"use client";

import { useState } from "react";
import { AlertTriangle, HardDrive } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOwnerState } from "@/lib/auth/use-is-owner";
import { useStorageHealth } from "@/lib/stores/storage-health";
import { YourDataDialog } from "@/components/data/your-data-dialog";

/**
 * "Saved in this browser" next to a tool's title, for visitors.
 *
 * Says where the work lives — the question every visitor has and nothing on
 * the page used to answer — and opens the backup dialog. Turns into a
 * warning when the browser has stopped saving. The owner's data syncs to
 * their account, so they don't get it.
 */
export function SavedChip({ className }: { className?: string }) {
  const { visitor } = useOwnerState();
  const writeFailed = useStorageHealth((s) => s.writeFailed);
  const [open, setOpen] = useState(false);
  if (!visitor) return null;
  const label = writeFailed ? "Not saving" : "Saved in this browser";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`${label} — back up or restore your data`}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors",
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
      <YourDataDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
