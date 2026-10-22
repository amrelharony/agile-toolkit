"use client";

import Link from "next/link";
import { ArrowRight, BookImage, RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { COMIC_TITLE } from "@/lib/comic/agile-at-work";
import type { ComicLoadError } from "./hooks/use-pdf-document";

/** Shown when the PDF hasn't been uploaded to storage yet, or has gone. */
export function ComicComingSoon() {
  return (
    <EmptyState
      icon={BookImage}
      padding="xl"
      action={
        <Button asChild variant="toolkit" className="min-h-11 md:h-11">
          <Link href="/">
            Explore the Agile Toolkit
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      }
    >
      <p className="font-semibold text-text">{COMIC_TITLE} is coming soon</p>
      <p className="mt-1">The colour edition isn&apos;t uploaded yet — check back soon.</p>
    </EmptyState>
  );
}

/**
 * Why the comic can't be shown: a pdf.js load failure, a render-time crash
 * caught by the reader's ErrorBoundary, or "unavailable" (the server could
 * not get a link to the PDF from storage).
 */
export type ComicErrorKind = ComicLoadError | "crash" | "unavailable";

const ERROR_COPY: Record<ComicErrorKind, string> = {
  invalid: "This copy of the comic couldn't be read — the file may be damaged.",
  password: "This PDF is password-protected, so it can't be shown here.",
  // Nothing arrived for a while (a big file on a slow line still loads).
  timeout: "The comic stopped loading. Check your connection and try again.",
  other: "Something went wrong while opening the comic.",
  // The signed URL ran out (the page sat open for hours); Retry reloads.
  expired: "This reading session has expired.",
  // Render-time exception caught by the reader's ErrorBoundary.
  crash: "The reader hit an unexpected error.",
  unavailable: "The comic can't be loaded right now.",
  // Not shown: a missing file renders <ComicComingSoon/> instead.
  missing: "The comic file couldn't be found.",
};

/**
 * The reader failed: say why, and offer Retry when it can help. For
 * "expired" and "unavailable" the caller's `onRetry` reloads the page,
 * which asks the server for a fresh link to the PDF.
 */
export function ComicErrorPanel({ kind, onRetry }: { kind: ComicErrorKind; onRetry: () => void }) {
  // A password won't appear on a second try.
  const canRetry = kind !== "password";
  return (
    <EmptyState
      icon={TriangleAlert}
      padding="xl"
      action={
        canRetry ? (
          <Button variant="outline" onClick={onRetry} className="min-h-11 md:h-11">
            <RotateCcw aria-hidden="true" />
            {kind === "unavailable" ? "Reload" : "Retry"}
          </Button>
        ) : undefined
      }
    >
      <p className="font-semibold text-text">{ERROR_COPY[kind]}</p>
      <p className="mt-1">
        {canRetry
          ? "If it keeps happening, check back a little later."
          : "Please check back later."}
      </p>
    </EmptyState>
  );
}
