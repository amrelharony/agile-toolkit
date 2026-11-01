"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { processPanelImage, type ArtUploader, type UploadedArt } from "@/lib/comics/image-pipeline";
import type { CreditCorner } from "@/lib/comics/story-input";
import { errorMessage } from "./portal-api";

export type ArtJobStatus = "waiting" | "converting" | "uploading" | "failed";

export interface ArtJob {
  key: string;
  file: File;
  status: ArtJobStatus;
  error?: string;
}

interface ArtQueueOptions {
  uploader: ArtUploader;
  /** Read when the job starts, so a corner or an order changed while it waited counts. */
  optionsFor: (key: string) => { corner: CreditCorner; withShare: boolean } | null;
  onDone: (key: string, art: UploadedArt) => void;
}

/**
 * Pictures, converted and uploaded strictly one at a time: a phone can't hold
 * several decoded at once. A failure stays in the list with its file, so one
 * picture can be retried and the rest carry on.
 */
export function useArtQueue({ uploader, optionsFor, onDone }: ArtQueueOptions) {
  const [jobs, setJobs] = useState<ArtJob[]>([]);
  const jobsRef = useRef<ArtJob[]>([]);
  const running = useRef(false);
  const alive = useRef(true);
  const latest = useRef({ optionsFor, onDone, uploader });
  latest.current = { optionsFor, onDone, uploader };

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const write = useCallback((next: ArtJob[]) => {
    jobsRef.current = next;
    if (alive.current) setJobs(next);
  }, []);

  const patch = useCallback(
    (key: string, change: Partial<ArtJob>) =>
      write(jobsRef.current.map((job) => (job.key === key ? { ...job, ...change } : job))),
    [write]
  );

  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      for (;;) {
        const job = jobsRef.current.find((j) => j.status === "waiting");
        if (!job) return;
        const options = latest.current.optionsFor(job.key);
        if (!options) {
          write(jobsRef.current.filter((j) => j.key !== job.key));
          continue;
        }
        try {
          const art = await processPanelImage(job.file, {
            ...options,
            uploader: latest.current.uploader,
            onStep: (step) => patch(job.key, { status: step, error: undefined }),
          });
          write(jobsRef.current.filter((j) => j.key !== job.key));
          latest.current.onDone(job.key, art);
        } catch (err) {
          patch(job.key, { status: "failed", error: errorMessage(err) });
        }
      }
    } finally {
      running.current = false;
    }
  }, [patch, write]);

  const enqueue = useCallback(
    (key: string, file: File) => {
      write([...jobsRef.current.filter((j) => j.key !== key), { key, file, status: "waiting" }]);
      void pump();
    },
    [pump, write]
  );

  const retry = useCallback(
    (key: string) => {
      patch(key, { status: "waiting", error: undefined });
      void pump();
    },
    [patch, pump]
  );

  const dismiss = useCallback(
    (key: string) => write(jobsRef.current.filter((j) => j.key !== key)),
    [write]
  );

  return { jobs, enqueue, retry, dismiss };
}
