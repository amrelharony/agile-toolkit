"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { processPanelImage, type ArtUploader, type UploadedArt } from "@/lib/comics/image-pipeline";
import type { CreditCorner } from "@/lib/comics/story-input";
import { errorMessage } from "./portal-api";

export type ArtJobStatus = "waiting" | "converting" | "uploading" | "failed";

export interface ArtJob {
  /** This job, as opposed to the panel it's for: a panel's picture can be replaced mid-job. */
  id: number;
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

let jobSerial = 0;

/**
 * Pictures, converted and uploaded strictly one at a time: a phone can't hold
 * several decoded at once. A failure stays in the list with its file, so one
 * picture can be retried and the rest carry on.
 *
 * A job that was replaced or dismissed while it ran is out of the list, and what
 * it produces is ignored: its file is left for the Unused art list. When the form
 * goes away everything stops, so nothing it started can save afterwards.
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
      jobsRef.current = [];
    };
  }, []);

  const write = useCallback((next: ArtJob[]) => {
    jobsRef.current = next;
    if (alive.current) setJobs(next);
  }, []);

  const patch = useCallback(
    (id: number, change: Partial<ArtJob>) =>
      write(jobsRef.current.map((job) => (job.id === id ? { ...job, ...change } : job))),
    [write]
  );

  const drop = useCallback(
    (id: number) => write(jobsRef.current.filter((job) => job.id !== id)),
    [write]
  );

  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      while (alive.current) {
        const job = jobsRef.current.find((j) => j.status === "waiting");
        if (!job) return;
        const options = latest.current.optionsFor(job.key);
        if (!options) {
          drop(job.id);
          continue;
        }
        try {
          const art = await processPanelImage(job.file, {
            ...options,
            uploader: latest.current.uploader,
            onStep: (step) => patch(job.id, { status: step, error: undefined }),
          });
          if (!alive.current) return;
          if (!jobsRef.current.some((j) => j.id === job.id)) continue;
          drop(job.id);
          latest.current.onDone(job.key, art);
        } catch (err) {
          patch(job.id, { status: "failed", error: errorMessage(err) });
        }
      }
    } finally {
      running.current = false;
    }
  }, [drop, patch]);

  const enqueue = useCallback(
    (key: string, file: File) => {
      jobSerial += 1;
      const job: ArtJob = { id: jobSerial, key, file, status: "waiting" };
      write([...jobsRef.current.filter((j) => j.key !== key), job]);
      void pump();
    },
    [pump, write]
  );

  const retry = useCallback(
    (key: string) => {
      const job = jobsRef.current.find((j) => j.key === key);
      if (!job) return;
      patch(job.id, { status: "waiting", error: undefined });
      void pump();
    },
    [patch, pump]
  );

  const dismiss = useCallback(
    (key: string) => write(jobsRef.current.filter((j) => j.key !== key)),
    [write]
  );

  /** Every job gone, and whatever is running comes to nothing. */
  const cancelAll = useCallback(() => write([]), [write]);

  return { jobs, enqueue, retry, dismiss, cancelAll };
}
