import { SHEET } from "@/components/agent/mascot/engine/sprite-poses";
import type { StoryCover } from "@/lib/comics/types";
import { cn } from "@/lib/utils";
import { IntroAmr, IntroOverlay, IntroPanel } from "./intro-parts";
import styles from "./book-intro.module.css";

/** This week's story, the one the gallery leads with: the newest released. */
export interface BookIntroStory {
  title: string;
  cover: StoryCover | null;
}

/**
 * The intro at /comics, the address printed on the book's back cover. The
 * closed book rises toward the reader, its cover swings open, and inside is
 * this week's story with Amr waving at the foot of the fold. The beats and
 * their times are in book-intro.module.css.
 *
 * The cover is lettered on paper, in the gallery's own words, until the book's
 * cover art is here. Before any story is released the page inside holds only
 * Amr, so the intro is finished without a single panel.
 *
 * Not a client component: the server page renders it, so it's in the static
 * HTML for the head script to show from the first paint.
 */
export function BookIntro({ latest }: { latest: BookIntroStory | null }) {
  return (
    <IntroOverlay kind="book" label="Agile at Work intro" className={styles.overlay}>
      <div className={styles.scene}>
        <div className={styles.lift}>
          <div className={styles.push}>
            <div className={styles.glide}>
              <div className={styles.book}>
                <span aria-hidden="true" className={cn(styles.leaf, styles.leafBack)} />
                <span aria-hidden="true" className={cn(styles.leaf, styles.leafMid)} />
                <InsidePage latest={latest} />
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
 * What the cover opens onto: the story's first panel with its title lettered
 * under it, the title alone while it has no art, or a blank page for Amr.
 */
function InsidePage({ latest }: { latest: BookIntroStory | null }) {
  if (!latest) return <div className={styles.inside} />;
  const { title, cover } = latest;
  return (
    <div className={styles.inside}>
      {cover ? <IntroPanel panel={cover} className={styles.window} /> : null}
      <div className={cover ? styles.caption : styles.captionAlone}>
        <p className={cn(styles.eyebrow, "font-display font-semibold text-text")}>
          This week&apos;s story
        </p>
        <p
          className={cn(
            cover ? styles.storyTitle : styles.storyTitleAlone,
            // A long title stops short of Amr rather than running into him.
            cover ? "line-clamp-3" : "line-clamp-4",
            "text-balance font-display font-semibold text-text"
          )}
        >
          {title}
        </p>
      </div>
    </div>
  );
}

/** The front cover, and the inside of it once it has turned. */
function BookCover() {
  return (
    <div className={styles.cover}>
      <div className={cn(styles.face, styles.front)}>
        <span aria-hidden="true" className={styles.hinge} />
        {/* Lettered until the book's own cover art takes its place. */}
        <p className={cn(styles.title, "font-display font-bold text-text")}>
          <span className={styles.line}>Agile</span> <span className={styles.line}>at Work</span>
        </p>
        <span aria-hidden="true" className={styles.titleRule} />
        <p className={cn(styles.byline, "font-display font-medium text-text")}>
          <span className={styles.line}>Workplace comics</span>{" "}
          <span className={styles.line}>by Amr Elharony</span>
        </p>
      </div>
      <span aria-hidden="true" className={cn(styles.face, styles.back)}>
        <span className={styles.endpaper} />
      </span>
    </div>
  );
}

/**
 * Amr at his sheet's own cell size, so the CSS scales him once, from the
 * book's width. The outer span places him, the inner one pops him in: his own
 * element's animation is his frames.
 */
function WavingAmr({ alone }: { alone: boolean }) {
  return (
    <span aria-hidden="true" className={cn(styles.amr, alone ? styles.amrAlone : styles.amrAtFold)}>
      <span className={styles.amrPop}>
        <IntroAmr pose="waving" width={SHEET.cellW} />
      </span>
    </span>
  );
}
