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
 * cover, the cover swings open, a blank page turns, and the next page turns
 * over with this week's panel printed on its back, so the panel lands face up
 * beside the story's title as it inks in. Amr waves at the foot of the fold.
 * The beats and their times are in book-intro.module.css.
 *
 * The book is square, as printed, and its front is the cover's art. Under the
 * art the cover is lettered, in the gallery's own words, which is what shows
 * if the art hasn't loaded: the head script preloads it only when this intro
 * plays, and the image itself is lazy, so a visit without the intro fetches
 * nothing. Each picture shows once: the cover on the cover, the panel on the
 * second page's back. Before any story is released the page inside holds only
 * Amr, so the intro is finished without a single panel.
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
                <BlankLeaf />
                <PanelLeaf cover={latest?.cover ?? null} />
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
 * What the pages open onto, on the right of the spread: this week's story's
 * title, inking in, under a resting stripe of light. Blank, for Amr, before
 * any story is out.
 */
function InsidePage({ latest }: { latest: BookIntroStory | null }) {
  return (
    <div className={styles.inside}>
      <Grain />
      <Light trackClassName={styles.restingLight} />
      {latest ? (
        <div className={styles.captionAlone}>
          <p className={cn(styles.eyebrow, "font-display font-semibold text-text")}>
            This week&apos;s story
          </p>
          <p
            className={cn(
              styles.storyTitleAlone,
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

/** The first page under the cover: blank paper both sides, turned at once. */
function BlankLeaf() {
  return (
    <div aria-hidden="true" className={styles.leaf1}>
      <div className={cn(styles.face, styles.page)}>
        <Grain />
        <TurnShade className={styles.leaf1Shade} />
      </div>
      <div className={cn(styles.face, styles.page, styles.back)}>
        <Grain />
      </div>
    </div>
  );
}

/**
 * The second page: blank on its front, and this week's panel printed on its
 * back, in the same 3:2 window every intro uses. It lies still a moment, then
 * turns over, so the panel lands face up as the left page of the spread.
 * Blank both sides while the story has no art.
 */
function PanelLeaf({ cover }: { cover: StoryCover | null }) {
  return (
    <div aria-hidden="true" className={styles.leaf2}>
      <div className={cn(styles.face, styles.page)}>
        <Grain />
        <TurnShade className={styles.leaf2Shade} />
      </div>
      <div className={cn(styles.face, styles.page, styles.back)}>
        <Grain />
        {cover ? <IntroPanel panel={cover} className={styles.window} /> : null}
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
