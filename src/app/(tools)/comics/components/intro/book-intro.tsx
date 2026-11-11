import type { CSSProperties } from "react";
import { FIGURE_BOTTOM, FIGURE_TOP, SHEET } from "@/components/agent/mascot/engine/sprite-poses";
import { COVER_INTRO_SIZE, COVER_INTRO_URL } from "@/lib/book/art";
import type { StoryCover } from "@/lib/comics/types";
import { cn } from "@/lib/utils";
import { IntroAmr, IntroOverlay, IntroPanel } from "./intro-parts";
import { CoverLettering, Grain, Ground, Light, PageEdges, TurnShade } from "./intro-look";
import styles from "./book-intro.module.css";

/** This week's story, the one the gallery leads with: the newest released. */
export interface BookIntroStory {
  title: string;
  cover: StoryCover | null;
}

/**
 * The intro at /comics, the address printed on the book's back cover. The
 * closed book rises toward the reader and lands, a stripe of light crosses its
 * cover, the cover swings open, and two blank pages turn after it, quickly,
 * one then the other. As the second passes upright it uncovers the page
 * beneath: this week's panel, with the story's title under it inking in. Amr
 * waves at the foot of the fold. The beats and their times are in
 * book-intro.module.css. That page is the spread's right-hand one, which
 * shows whole on every screen, a phone's included, so the panel and the title
 * are always in view.
 *
 * The book is square, as printed, and its front is the cover's art. Under the
 * art the cover is lettered, in the gallery's own words, which is what shows
 * if the art hasn't loaded: the head script preloads it only when this intro
 * plays, and the image itself is lazy, so a visit without the intro fetches
 * nothing. Each picture shows once: the cover on the cover, the panel on the
 * page under the two turning pages. Before any story is released that page
 * holds only Amr, so the intro is finished without a single panel.
 *
 * Not a client component: the server page renders it, so it's in the static
 * HTML for the head script to show from the first paint.
 */
export function BookIntro({ latest }: { latest: BookIntroStory | null }) {
  return (
    <IntroOverlay kind="book" label="Agile at Work intro" className={styles.overlay}>
      <div className={styles.scene}>
        {/* On the ground, outside the book's 3D space, so the book always draws over it. */}
        <span aria-hidden="true" className={styles.groundBox}>
          <Ground className={styles.groundGrow} />
        </span>
        <div className={styles.lift}>
          <div className={styles.push}>
            <div className={styles.glide}>
              <div className={styles.book}>
                <span aria-hidden="true" className={styles.block}>
                  <PageEdges />
                </span>
                <InsidePage latest={latest} />
                {/* The two pages over it: the cover lifts off them, then each turns in turn. */}
                <BlankLeaf className={styles.leaf1} shadeClassName={styles.leaf1Shade} />
                <BlankLeaf className={styles.leaf2} shadeClassName={styles.leaf2Shade} />
                <BookCover />
                <WavingAmr alone={!latest} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </IntroOverlay>
  );
}

/**
 * What the pages open onto, on the right of the spread: this week's panel, in
 * the same 3:2 window every intro uses, with the story's title lettered under
 * it, inking in, all under a resting stripe of light. The title alone, larger,
 * while the story has no art; blank, for Amr, before any story is out.
 */
function InsidePage({ latest }: { latest: BookIntroStory | null }) {
  const cover = latest?.cover ?? null;
  return (
    <div className={styles.inside}>
      <Grain />
      <Light trackClassName={styles.restingLight} />
      {cover ? <IntroPanel panel={cover} className={styles.window} /> : null}
      {latest ? (
        <div className={cn(styles.titleInk, cover ? styles.caption : styles.captionAlone)}>
          <p className={cn(styles.eyebrow, "font-display font-semibold text-text")}>
            This week&apos;s story
          </p>
          <p
            className={cn(
              cover ? styles.storyTitle : styles.storyTitleAlone,
              // A long title stops at the page's foot rather than running off it.
              "line-clamp-4 text-balance font-display font-semibold text-text"
            )}
          >
            {latest.title}
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * A page between the cover and the inside page: blank paper both sides, which
 * turns as soon as the sheet above it is out of the way. Its back lands as the
 * spread's left page, in the inside page's light.
 */
function BlankLeaf({ className, shadeClassName }: { className: string; shadeClassName: string }) {
  return (
    <div aria-hidden="true" className={className}>
      <div className={styles.face}>
        <Grain />
        <TurnShade className={shadeClassName} />
      </div>
      <div className={cn(styles.face, styles.back)}>
        <Grain />
        {/* The inside page's light, its stripe off this page: the spread lies in one light. */}
        <Light trackClassName={styles.shadeOnly} />
      </div>
    </div>
  );
}

/** The front cover, the inside of it once it has turned, and its board's edge. */
function BookCover() {
  return (
    <div className={styles.cover}>
      <div className={styles.face}>
        {/* Lettered under the art, for the moment before it arrives. */}
        <CoverLettering />
        <Grain className={styles.overArt} />
        <Light className={styles.overArt} trackClassName={styles.coverLight} />
        <TurnShade className={cn(styles.overArt, styles.coverShade)} />
        {/* The cover's own words are lettered above, so the art adds none. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={COVER_INTRO_URL}
          width={COVER_INTRO_SIZE}
          height={COVER_INTRO_SIZE}
          alt=""
          loading="lazy"
          decoding="async"
          className={styles.art}
        />
      </div>
      <span aria-hidden="true" className={cn(styles.face, styles.back)}>
        <Grain />
        <span className={styles.endpaper} />
      </span>
      <span aria-hidden="true" className={styles.boardEdge} />
    </div>
  );
}

/**
 * His sheet's cell and where his figure stands in it, which the CSS places and
 * sizes him by: from here, so it can't drift from the sheet.
 */
const AMR_CELL = {
  "--amr-cell-w": `${SHEET.cellW}px`,
  "--amr-cell-h": `${SHEET.cellH}px`,
  "--amr-feet": `${FIGURE_BOTTOM}px`,
  "--amr-figure-h": `${FIGURE_BOTTOM - FIGURE_TOP}px`,
} as CSSProperties;

/**
 * Amr at his sheet's own cell size, so the CSS scales him once, from the
 * book's width. The outer span places him, the inner one pops him in: his own
 * element's animation is his frames.
 */
function WavingAmr({ alone }: { alone: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(styles.amr, alone ? styles.amrAlone : styles.amrAtFold)}
      style={AMR_CELL}
    >
      <span className={styles.amrPop}>
        <IntroAmr pose="waving" width={SHEET.cellW} />
      </span>
    </span>
  );
}
