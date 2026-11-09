import type { ReactNode } from "react";
import { InkArt } from "@/components/ink/ink-art";
import type { InkDrawing } from "@/lib/ink/types";

/**
 * A settings page's title panel: its spot drawing (lib/ink/drawings/pages), a
 * hand-lettered title and what the page is for, framed like every other page
 * header. No hooks, so the server pages render it into their HTML.
 */
export function SettingsHeader({
  title,
  art,
  children,
}: {
  title: string;
  art: InkDrawing;
  /** The page's description: a sentence or two. */
  children: ReactNode;
}) {
  return (
    <header className="panel ink-host mb-6 flex items-start gap-3 px-4 py-4 sm:gap-4 sm:px-6 sm:py-5">
      <InkArt drawing={art} boil className="h-11 w-11 shrink-0 sm:h-16 sm:w-16" />
      <div className="min-w-0 space-y-2">
        <h1 className="font-display text-fluid-h2 font-bold leading-tight text-text">{title}</h1>
        <p className="max-w-2xl text-sub">{children}</p>
      </div>
    </header>
  );
}
