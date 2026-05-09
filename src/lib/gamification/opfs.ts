"use client";

import type { XpEvent } from "./types";

/**
 * Origin Private File System writer for the VDna data lake.  Appends JSON
 * lines to `agile-toolkit-dna.jsonl` with rotation at 4 MB.  Fully
 * feature-detected — on browsers without OPFS we silently no-op.
 */

const FILE_NAME = "agile-toolkit-dna.jsonl";
const MAX_SIZE_BYTES = 4 * 1024 * 1024;

let dirHandle: FileSystemDirectoryHandle | null = null;
let fileHandle: FileSystemFileHandle | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function ensureHandles(): Promise<boolean> {
  if (typeof navigator === "undefined") return false;
  // Safari < 17 lacks OPFS, Firefox has partial support.
  if (!navigator.storage || typeof navigator.storage.getDirectory !== "function") return false;
  if (dirHandle && fileHandle) return true;
  try {
    dirHandle = await navigator.storage.getDirectory();
    fileHandle = await dirHandle.getFileHandle(FILE_NAME, { create: true });
    return true;
  } catch {
    return false;
  }
}

/** Append an XP event as a JSON line.  Never throws. */
export function appendXpEvent(event: XpEvent & { visitorId?: string }) {
  writeQueue = writeQueue
    .then(async () => {
      const ok = await ensureHandles();
      if (!ok || !fileHandle) return;
      try {
        const file = await fileHandle.getFile();
        const target: FileSystemFileHandle = fileHandle;
        if (file.size > MAX_SIZE_BYTES) {
          // Rotate: rename to .old and create fresh.  FileSystemAccess spec
          // doesn't support rename portably, so we just truncate via new write.
          if (dirHandle) {
            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const w = await (target as any).createWritable({ keepExistingData: false });
              await w.close();
            } catch {
              /* best effort */
            }
          }
        }
        const line = JSON.stringify(event) + "\n";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const writable = await (target as any).createWritable({ keepExistingData: true });
        const currentSize = (await target.getFile()).size;
        await writable.write({ type: "write", position: currentSize, data: line });
        await writable.close();
      } catch {
        /* OPFS unavailable or quota exceeded */
      }
    })
    .catch(() => undefined);
}

export async function readRecentEvents(limit = 200): Promise<XpEvent[]> {
  const ok = await ensureHandles();
  if (!ok || !fileHandle) return [];
  try {
    const file = await fileHandle.getFile();
    const text = await file.text();
    const lines = text.trim().split("\n");
    return lines
      .slice(-limit)
      .map((l) => {
        try {
          return JSON.parse(l) as XpEvent;
        } catch {
          return null;
        }
      })
      .filter((x): x is XpEvent => x !== null);
  } catch {
    return [];
  }
}

export async function clearLake(): Promise<boolean> {
  const ok = await ensureHandles();
  if (!ok || !fileHandle || !dirHandle) return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = await (fileHandle as any).createWritable({ keepExistingData: false });
    await w.close();
    return true;
  } catch {
    return false;
  }
}

export function isOpfsAvailable(): boolean {
  if (typeof navigator === "undefined") return false;
  return Boolean(navigator.storage && typeof navigator.storage.getDirectory === "function");
}
