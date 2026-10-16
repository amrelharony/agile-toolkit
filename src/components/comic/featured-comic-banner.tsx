import Link from "next/link";
import { ArrowRight, BookImage } from "lucide-react";
import { COMIC_ROUTE, COMIC_TITLE } from "@/lib/comic/agile-at-work";

/**
 * Home-page feature card for the "Agile at Work" comic. The home grid keeps
 * categories collapsed, so without this the comic would sit unseen inside the
 * Library row. Render it only when `comicAsset().available` — there is
 * deliberately no Download button here, so a missing PDF can never be
 * advertised or saved as a 404 page.
 *
 * The whole card is clickable through a stretched link (the CTA's `::after`
 * covers the card), while the link's accessible name stays "Read the comic".
 * No `active-press` on the CTA: a transform on :active would shrink the
 * `::after` back to the button mid-click, so a press that started elsewhere
 * on the card would release outside the link and never navigate.
 */
export function FeaturedComicBanner() {
  return (
    <section
      aria-labelledby="featured-comic-title"
      className="
        group relative flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6
        p-4 sm:p-6 rounded-2xl
        bg-[var(--card)] border border-border
        backdrop-blur-[20px] saturate-[1.4]
        overflow-hidden
        transition-all duration-medium ease-spring
        hover:bg-[var(--cardH)] hover:shadow-glow
      "
    >
      {/* Inset top light */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[rgba(255,255,255,0.06)] to-transparent pointer-events-none" />

      <ComicPanelArt />

      <div className="min-w-0 flex-1">
        <span className="inline-flex items-center px-2.5 py-1 rounded-full border border-border bg-[var(--glow)] font-mono text-xs text-accent tracking-wider uppercase">
          New · Comic
        </span>
        <h2
          id="featured-comic-title"
          className="mt-3 font-bold tracking-tight text-fluid-h3 gradient-text-animated"
        >
          {COMIC_TITLE}
        </h2>
        <p className="mt-1 text-fluid-body text-sub">
          A comic book about agile at work — read it free in your browser.
        </p>
        <Link
          href={COMIC_ROUTE}
          className="
            mt-4 inline-flex w-full sm:w-auto items-center justify-center gap-2 px-5 py-3 rounded-xl
            bg-accent text-bg font-mono text-xs sm:text-sm font-semibold uppercase tracking-wider
            hover:shadow-glow-strong
            transition-all duration-default ease-spring
            min-h-[44px]
            after:absolute after:inset-0 after:rounded-2xl
          "
        >
          Read the comic
          <ArrowRight className="w-4 h-4" aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}

/** Decorative comic-page thumbnail built from CSS only, so the banner never
 * depends on (or 404s for) a cover image. */
function ComicPanelArt() {
  return (
    <div
      aria-hidden="true"
      className="
        relative shrink-0 grid grid-cols-3 grid-rows-2 gap-1.5 p-1.5
        w-full h-28 sm:w-48 sm:h-36
        rounded-xl border border-border bg-[var(--bg2)]
        sm:-rotate-2 transition-transform duration-medium ease-spring group-hover:rotate-0
      "
    >
      {/* Wide establishing shot: halftone sky */}
      <div className="col-span-2 rounded-md border border-border bg-[radial-gradient(var(--accent)_1px,transparent_1.5px)] bg-[length:7px_7px] opacity-80" />
      {/* Tall panel: the book itself */}
      <div className="row-span-2 rounded-md border border-border bg-[var(--glow)] flex items-center justify-center">
        <BookImage className="w-7 h-7 text-accent" />
      </div>
      {/* Speech bubble */}
      <div className="relative rounded-md border border-border bg-[var(--card)]">
        <span className="absolute left-1.5 top-1.5 h-3 w-8 rounded-full bg-text" />
        <span className="absolute left-3 top-[1.05rem] h-1.5 w-1.5 rotate-45 bg-text" />
      </div>
      {/* Action lines */}
      <div className="rounded-md border border-border bg-[repeating-linear-gradient(135deg,var(--accent2)_0_2px,transparent_2px_7px)] opacity-70" />
    </div>
  );
}
