"use client";

import { useId } from "react";
import Link from "next/link";
import { chapterTools, type ComicChapter } from "@/lib/comic/content";
import { cn } from "@/lib/utils";

/**
 * "Try <tool>" links for a chapter's tools, names and paths from the tool
 * catalog. Wraps onto as many rows as it needs at phone width.
 */
export function ToolLinks({ chapter, className }: { chapter: ComicChapter; className?: string }) {
  const tools = chapterTools(chapter);
  if (!tools.length) return null;
  return (
    <ul
      aria-label={`Tools from ${chapter.title}`}
      className={cn("flex flex-wrap gap-2", className)}
    >
      {tools.map(({ id, name, path, icon: Icon }) => (
        <li key={id} className="min-w-0 max-w-full">
          <Link
            href={path}
            className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-md border border-accent/40 bg-card px-3 py-1 text-sm font-medium text-accent transition-colors hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent md:min-h-9"
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 break-words">Try {name}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * The comic's next step: under the reader, the tools the chapter being read
 * shows in use. Renders nothing before the first chapter, without chapters,
 * or for a chapter that names no tools.
 */
export function ChapterToolsCard({ chapter }: { chapter: ComicChapter | null }) {
  const headingId = useId();
  if (!chapter || !chapterTools(chapter).length) return null;
  return (
    <aside
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-lg border border-accent/30 bg-accent/5 p-4"
    >
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-accent">Try it yourself</p>
        <h2 id={headingId} className="mt-0.5 break-words text-sm font-semibold text-text">
          Tools from &ldquo;{chapter.title}&rdquo;
        </h2>
        <p className="mt-0.5 text-sm text-sub">The toolkit tools this chapter shows in use.</p>
      </div>
      <ToolLinks chapter={chapter} />
    </aside>
  );
}
