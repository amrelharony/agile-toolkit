"use client";

import Link from "next/link";
import { ArrowLeft, BookImage, Download, RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { COMIC_DOWNLOAD_NAME, COMIC_TITLE, formatBytes } from "@/lib/comic/agile-at-work";
import { cn } from "@/lib/utils";
import type { ComicLoadError } from "../hooks/use-pdf-document";

/**
 * "Download PDF (12.3 MB)". A same-origin `<a download>` (never an "open in
 * a new tab" link: the site CSP sets `object-src 'none'`, which can blank
 * the browser's built-in PDF viewer). The size is always announced, and
 * shown from `sm` up where the toolbar has room for it.
 */
export function DownloadPdfButton({
  src,
  size,
  className,
}: {
  src: string;
  size: number | null;
  className?: string;
}) {
  return (
    <Button asChild variant="toolkit" className={cn("min-h-11 md:h-11", className)}>
      <a href={src} download={COMIC_DOWNLOAD_NAME}>
        <Download aria-hidden="true" />
        Download PDF
        {/* The space keeps "PDF (12.3 MB)" apart in the accessible name; in
            the inline-flex button, gap-2 does the visual spacing. */}
        {size !== null && (
          <>
            {" "}
            <span className="sr-only sm:not-sr-only">({formatBytes(size)})</span>
          </>
        )}
      </a>
    </Button>
  );
}

/** Shown when no PDF was published at build time, or the file has gone. */
export function ComicComingSoon() {
  return (
    <EmptyState
      icon={BookImage}
      padding="xl"
      action={
        <Button asChild variant="toolkit" className="min-h-11 md:h-11">
          <Link href="/">
            <ArrowLeft aria-hidden="true" />
            Back to tools
          </Link>
        </Button>
      }
    >
      <p className="font-semibold text-text">{COMIC_TITLE} is coming soon</p>
      <p className="mt-1">The comic will appear here as soon as it&apos;s published.</p>
    </EmptyState>
  );
}

const ERROR_COPY: Record<ComicLoadError | "crash", string> = {
  invalid: "This copy of the comic couldn't be read — the file may be damaged.",
  password: "This PDF is password-protected, so it can't be shown here.",
  timeout: "The comic took too long to load. Check your connection and try again.",
  other: "Something went wrong while opening the comic.",
  // Render-time exception caught by the reader's ErrorBoundary.
  crash: "The reader hit an unexpected error.",
  // Not shown: a missing file renders <ComicComingSoon/> instead.
  missing: "The comic file couldn't be found.",
};

/** The reader failed: say why, offer Retry (when it can help) and Download. */
export function ComicErrorPanel({
  kind,
  onRetry,
  src,
  size,
}: {
  kind: ComicLoadError | "crash";
  onRetry: () => void;
  src: string;
  size: number | null;
}) {
  return (
    <EmptyState
      icon={TriangleAlert}
      padding="xl"
      action={
        <div className="flex flex-wrap items-center justify-center gap-2">
          {/* A password won't appear on a second try. */}
          {kind !== "password" && (
            <Button variant="outline" onClick={onRetry} className="min-h-11 md:h-11">
              <RotateCcw aria-hidden="true" />
              Retry
            </Button>
          )}
          <DownloadPdfButton src={src} size={size} />
        </div>
      }
    >
      <p className="font-semibold text-text">{ERROR_COPY[kind]}</p>
      <p className="mt-1">You can still download the PDF and read it in any PDF viewer.</p>
    </EmptyState>
  );
}
