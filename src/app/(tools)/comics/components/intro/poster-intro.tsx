import type { StoryCover } from "@/lib/comics/types";
import { cn } from "@/lib/utils";
import { IntroAmr, IntroOverlay, IntroPanel } from "./intro-parts";
import styles from "./poster-intro.module.css";

/** A page's worth: any more would be too small to take in from a phone. */
const MAX_PANELS = 4;
/** Amr's frame width in px. The CSS scales him with the screen from there. */
const AMR_WIDTH = 112;

/** Each window waits its turn and tilts its own way before it settles. */
const WINDOW_CLASSES = [styles.w1, styles.w2, styles.w3, styles.w4];

const LETTERING = "font-display font-bold text-text";

/**
 * The poster's intro, three seconds long: whoever scanned the QR is standing at a
 * wall with a phone, so it says the episode and its title at once. A page inks
 * itself in with "Episode N" and the title, up to four of the story's panels
 * ink in after them, and Amr comes up at the corner to wave before the page
 * lifts away. Until the art is imported, the title fills one big window.
 *
 * No hooks, so the server page renders it and it plays from the first paint. The
 * choreography is all in poster-intro.module.css.
 */
export function PosterIntro({
  ep,
  title,
  panels,
}: {
  ep: number;
  title: string;
  panels: readonly StoryCover[];
}) {
  const shown = panels.slice(0, MAX_PANELS);
  const hasArt = shown.length > 0;

  return (
    <IntroOverlay kind="poster" label={`Episode ${ep} intro`} className={styles.overlay}>
      <div className={styles.stage}>
        <div className={cn(styles.sheet, hasArt ? styles.sheetArt : styles.sheetTitle)}>
          <p className={cn(styles.caption, LETTERING)}>{`Episode ${ep}`}</p>
          <div className={cn(styles.page, hasArt && styles.pageArt)}>
            {hasArt ? (
              <>
                <p className={cn(styles.title, LETTERING)}>{title}</p>
                <div
                  aria-hidden="true"
                  className={cn(styles.grid, shown.length <= 2 && styles.stacked)}
                >
                  {shown.map((panel, i) => (
                    <IntroPanel
                      key={panel.pathSmall}
                      panel={panel}
                      // Open by 0.5 s, too soon for lazy loading to start. The poster
                      // page shows these same files, so a later visit fetches nothing extra.
                      loading="eager"
                      className={cn(
                        styles.window,
                        WINDOW_CLASSES[i],
                        shown.length === 3 && i === 0 && styles.wide
                      )}
                    />
                  ))}
                </div>
              </>
            ) : (
              <div className={cn("panel", styles.window, styles.bigWindow)}>
                <p className={cn(styles.bigTitle, LETTERING)}>{title}</p>
              </div>
            )}
          </div>
          <span aria-hidden="true" className={styles.amrSpot}>
            <span className={styles.amrRise}>
              <IntroAmr pose="waving" width={AMR_WIDTH} />
            </span>
          </span>
        </div>
      </div>
    </IntroOverlay>
  );
}
