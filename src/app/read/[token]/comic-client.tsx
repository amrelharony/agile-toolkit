"use client";

import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ErrorBoundary } from "@/components/layout/error-boundary";
import { ComicReader } from "@/components/comic/reader/comic-reader";
import { ComicComingSoon, ComicErrorPanel } from "@/components/comic/reader/comic-status";
import { COMIC_TITLE } from "@/lib/comic/agile-at-work";
import type { ComicSignedUrl } from "@/lib/comic/storage";
import { useReaderPage } from "@/lib/stores/reader-page-store";

function reloadPage() {
  window.location.reload();
}

/**
 * Reader page shell for the private link. No `toolId` on the wrapper: a
 * comic has nothing to undo, no history and no insights.
 *
 * `source` comes from the server, which already checked the token: a ready
 * one carries a short-lived signed URL. A missing PDF shows "coming soon"
 * without downloading pdf.js at all. Reloading (`onReload`, overridable for
 * tests) asks the server again — that is how an expired URL is renewed.
 *
 * It also tells the shared chrome it is a reader page (see
 * lib/stores/reader-page-store): the header names the comic, the mascot and
 * the toasts keep clear of the reader's controls, and "Sign in" links never
 * carry the token along.
 */
export function ComicClient({
  source,
  onReload = reloadPage,
}: {
  source: ComicSignedUrl;
  onReload?: () => void;
}) {
  useReaderPage(COMIC_TITLE);
  return (
    <ToolPageWrapper
      title={COMIC_TITLE}
      description="The colour edition — read it right here, page by page or as two-page spreads."
    >
      {source.status === "ready" ? (
        <ErrorBoundary
          name="ComicReader"
          fallback={(_error, reset) => <ComicErrorPanel kind="crash" onRetry={reset} />}
        >
          <ComicReader src={source.url} onReload={onReload} />
        </ErrorBoundary>
      ) : source.status === "missing" ? (
        <ComicComingSoon />
      ) : (
        <ComicErrorPanel kind="unavailable" onRetry={onReload} />
      )}
    </ToolPageWrapper>
  );
}
