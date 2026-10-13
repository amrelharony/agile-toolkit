"use client";

import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ErrorBoundary } from "@/components/layout/error-boundary";
import { COMIC_TITLE, comicAsset } from "@/lib/comic/agile-at-work";
import { ComicReader } from "./components/comic-reader";
import { ComicComingSoon, ComicErrorPanel } from "./components/comic-status";

/**
 * Reader page shell. No `toolId` on the wrapper: a comic has nothing to
 * undo, no history and no insights.
 *
 * Whether the PDF exists was decided at build time (comicAsset), so a
 * deployment without the file shows "coming soon" without downloading
 * pdf.js at all.
 */
export function AgileAtWorkClient() {
  const asset = comicAsset();

  return (
    <ToolPageWrapper
      title={COMIC_TITLE}
      description="Read the Agile at Work comic right here, or download the PDF."
    >
      {asset.available ? (
        <ErrorBoundary
          name="ComicReader"
          fallback={(_error, reset) => (
            <ComicErrorPanel kind="crash" onRetry={reset} src={asset.src} size={asset.size} />
          )}
        >
          <ComicReader src={asset.src} size={asset.size} />
        </ErrorBoundary>
      ) : (
        <ComicComingSoon />
      )}
    </ToolPageWrapper>
  );
}
