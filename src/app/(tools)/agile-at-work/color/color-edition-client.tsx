"use client";

import Link from "next/link";
import { ArrowLeft, BookImage, BookOpen, QrCode } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ErrorBoundary } from "@/components/layout/error-boundary";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import {
  COLOR_EDITION_LAST_PAGE_KEY,
  COLOR_EDITION_TITLE,
  COMIC_ROUTE,
  COMIC_TITLE,
  comicAsset,
  type ComicAsset,
} from "@/lib/comic/agile-at-work";
import { ComicReader } from "../components/comic-reader";
import { ComicErrorPanel } from "../components/comic-status";

export type ColorEditionAccess = "unlocked" | "locked" | "invalid-link";

/**
 * Colour edition shell. The server page decided access from the cookie;
 * this only renders the outcome. The reader runs read-only: no Download
 * button, and its own "continue from" page.
 */
export function ColorEditionClient({
  access,
  asset,
}: {
  access: ColorEditionAccess;
  /** The colour PDF; null unless the visitor is unlocked. */
  asset: ComicAsset | null;
}) {
  const unlocked = access === "unlocked";

  return (
    <ToolPageWrapper
      title={COLOR_EDITION_TITLE}
      description={
        unlocked
          ? "Read the colour edition right here in your browser."
          : "For readers of the printed book."
      }
    >
      {!unlocked ? (
        <ColorEditionLocked invalidLink={access === "invalid-link"} />
      ) : asset?.available ? (
        <ErrorBoundary
          name="ColorEditionReader"
          fallback={(_error, reset) => (
            <ComicErrorPanel
              kind="crash"
              onRetry={reset}
              src={asset.src}
              size={asset.size}
              download={false}
            />
          )}
        >
          <ComicReader
            src={asset.src}
            size={asset.size}
            download={false}
            lastPageKey={COLOR_EDITION_LAST_PAGE_KEY}
          />
        </ErrorBoundary>
      ) : (
        <ColorEditionComingSoon />
      )}
    </ToolPageWrapper>
  );
}

/** The free black-and-white edition when it's published, else the tools. */
function FallbackLink() {
  if (comicAsset().available) {
    return (
      <Button asChild variant="toolkit" className="min-h-11 md:h-11">
        <Link href={COMIC_ROUTE}>
          <BookOpen aria-hidden="true" />
          Read the free edition
        </Link>
      </Button>
    );
  }
  return (
    <Button asChild variant="toolkit" className="min-h-11 md:h-11">
      <Link href="/">
        <ArrowLeft aria-hidden="true" />
        Back to tools
      </Link>
    </Button>
  );
}

function ColorEditionLocked({ invalidLink }: { invalidLink: boolean }) {
  return (
    <EmptyState icon={QrCode} padding="xl" action={<FallbackLink />}>
      {invalidLink ? (
        <>
          <p className="font-semibold text-text">That link didn&apos;t open the colour edition</p>
          <p className="mt-1">
            Scan the QR code inside your copy of {COMIC_TITLE} again, or check that the whole link
            was copied.
          </p>
        </>
      ) : (
        <>
          <p className="font-semibold text-text">The colour edition comes with the printed book</p>
          <p className="mt-1">
            Scan the QR code inside your copy of {COMIC_TITLE} to open it. This device will remember
            it after that.
          </p>
        </>
      )}
    </EmptyState>
  );
}

/** Unlocked, but no colour PDF was built into this deployment yet. */
function ColorEditionComingSoon() {
  return (
    <EmptyState icon={BookImage} padding="xl" action={<FallbackLink />}>
      <p className="font-semibold text-text">The colour edition is coming soon</p>
      <p className="mt-1">
        It will appear here as soon as it&apos;s published. This device is already unlocked, so
        there&apos;s no need to scan again.
      </p>
    </EmptyState>
  );
}
