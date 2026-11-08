"use client";

import { useEffect, useRef, useState } from "react";
import { saveAs } from "file-saver";
import { Check, Download, HardDrive, ShieldCheck, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  backupFilename,
  collectBackup,
  parseBackup,
  restoreBackup,
  serializeBackup,
  type BackupFileV1,
} from "@/lib/data/backup";
import { announceRestored, readLastBackupAt, recordBackup } from "@/lib/data/backup-meta";
import { useIsOwner } from "@/lib/auth/use-is-owner";
import { toast } from "@/lib/utils/toast";
import { useFlash } from "@/hooks/use-flash";

interface StorageInfo {
  usedBytes: number | null;
  persisted: boolean | null;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "never"
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/**
 * "Your data": back up, restore and protect what this browser holds.
 *
 * The toolkit stores visitors' work only in this browser, so this is the one
 * place to take it elsewhere (another browser or computer), get it back after
 * clearing site data, or ask the browser not to evict it.
 */
export function YourDataDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isOwner = useIsOwner();
  const fileRef = useRef<HTMLInputElement>(null);
  const [info, setInfo] = useState<StorageInfo>({ usedBytes: null, persisted: null });
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  // The download and "Last backup" confirm it in place; no toast.
  const { flash, isFlashing } = useFlash();
  const downloaded = isFlashing();
  const [pending, setPending] = useState<BackupFileV1 | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setLastBackup(readLastBackupAt());
    const storage = navigator.storage;
    void (async () => {
      const [estimate, persisted] = await Promise.all([
        storage?.estimate?.().catch(() => null),
        storage?.persisted?.().catch(() => null),
      ]);
      setInfo({ usedBytes: estimate?.usage ?? null, persisted: persisted ?? null });
    })();
  }, [open]);

  const download = () => {
    const backup = collectBackup();
    const blob = new Blob([serializeBackup(backup)], { type: "application/json" });
    saveAs(blob, backupFilename());
    recordBackup();
    setLastBackup(readLastBackupAt());
    flash(`Backup downloaded: ${Object.keys(backup.keys).length} items saved.`);
  };

  const pickFile = async (file: File) => {
    setError(null);
    const result = parseBackup(await file.text());
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPending(result.backup);
  };

  const restore = () => {
    if (!pending) return;
    restoreBackup(pending);
    announceRestored();
    window.location.reload();
  };

  const keepData = async () => {
    const granted = await navigator.storage?.persist?.().catch(() => false);
    setInfo((i) => ({ ...i, persisted: Boolean(granted) }));
    if (granted) toast.success("This browser will keep your toolkit data");
    else
      toast.info("Your browser didn't allow it", {
        description: "Download a backup now and then to be safe.",
      });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Your data</DialogTitle>
            <DialogDescription>
              {isOwner
                ? "Your work syncs to your account and is also kept in this browser."
                : "Everything you make in the toolkit is saved in this browser only, and none of it is sent to our servers. The comics and kudos pages do send one anonymous count when you arrive, saying only which printed piece brought you there, if any, and the episode."}
            </DialogDescription>
          </DialogHeader>

          <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-card p-3 text-sm">
            <div>
              <dt className="text-xs text-sub">Stored in this browser</dt>
              <dd className="font-medium text-text">
                {info.usedBytes === null ? "—" : formatBytes(info.usedBytes)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-sub">Last backup</dt>
              <dd className="font-medium text-text">{formatDate(lastBackup)}</dd>
            </div>
          </dl>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-text">Back up</h3>
            <p className="text-sm text-sub">
              Download a file with all your boards, lists and settings. Your AI API keys are never
              included.
            </p>
            <Button type="button" onClick={download} className="gap-2">
              {downloaded ? <Check aria-hidden="true" /> : <Download aria-hidden="true" />}
              {downloaded ? "Backup downloaded" : "Download backup"}
            </Button>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-text">Restore</h3>
            <p className="text-sm text-sub">
              Replace this browser&apos;s toolkit data with a backup file
              {isOwner ? ". This also replaces the copy in your account." : "."}
            </p>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              id="restore-backup-file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void pickFile(f);
              }}
            />
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              onClick={() => fileRef.current?.click()}
            >
              <Upload aria-hidden="true" />
              Restore from file…
            </Button>
            {error && (
              <p className="text-sm text-danger" role="alert">
                {error}
              </p>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-text">Keep it on this device</h3>
            {info.persisted ? (
              <p className="flex items-center gap-2 text-sm text-success">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                This browser won&apos;t clear your toolkit data to free up space.
              </p>
            ) : (
              <>
                <p className="text-sm text-sub">
                  Browsers can delete site data when space runs low, and Safari after 7 days without
                  a visit. Ask this browser to keep it.
                </p>
                <Button type="button" variant="outline" className="gap-2" onClick={keepData}>
                  <HardDrive aria-hidden="true" />
                  Keep data on this device
                </Button>
              </>
            )}
          </section>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(o) => !o && setPending(null)}
        title="Replace this browser's data?"
        description={
          pending
            ? `The backup from ${formatDate(pending.createdAt)} (${Object.keys(pending.keys).length} items) will replace what's here now${isOwner ? ", and in your account" : ""}. The page reloads afterwards.`
            : undefined
        }
        confirmLabel="Restore backup"
        onConfirm={restore}
      />
    </>
  );
}
