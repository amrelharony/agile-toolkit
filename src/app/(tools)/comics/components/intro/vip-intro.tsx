import { Fragment, type ComponentType, type CSSProperties } from "react";
import { SHEET } from "@/components/agent/mascot/engine/sprite-poses";
import type { StoryCover } from "@/lib/comics/types";
import { cn } from "@/lib/utils";
import { IntroAmr, IntroOverlay, IntroPanel } from "./intro-parts";
import styles from "./vip-intro.module.css";

/**
 * The VIP intro (9 s), for a reader who scanned the QR inside the book: the
 * most elaborate of the three, since it's the reward for owning the book.
 *
 * Three depth layers drift at three speeds, so the page has parallax: empty
 * panel outlines at the back, the lettering and the tools in the middle, Amr in
 * front. An ink wipe opens it, the welcome is lettered word by word, Amr jumps
 * in and asks his question, the tools are dealt in, the early comics fan out
 * when there are any, and the page turns away. vip-intro.module.css holds the
 * timeline; without early comics the tools simply hold until the page turns.
 *
 * vip-client.tsx renders it for an unlocked device only: the server never sends
 * it to anyone else, so the head script's forgeable hint can't show it.
 */

/** What the intro shows of a VIP tool: the hub's own name and icon. */
export interface VipIntroTool {
  id: string;
  name: string;
  icon: ComponentType<{ className?: string }>;
}

/** An early comic. Only its cover is shown: the story isn't out yet. */
export interface VipIntroComic {
  ep: number;
  cover: StoryCover | null;
}

// The hub's own words: the description's welcome, Amr's line and the heading.
const WELCOME = "Welcome, reader of the book";
const QUESTION = "Would one of these help your team this week?";
const EARLY_HEADING = "The next four weeks of comics";

const MAX_TOOLS = 3;
const MAX_COVERS = 3;

// One class per beat, since each carries its own literal delay.
const WORD_CLASSES = [styles.word0, styles.word1, styles.word2, styles.word3, styles.word4];
const DEAL_CLASSES = [styles.deal0, styles.deal1, styles.deal2];

/**
 * The back layer: empty panels as column spans of a 12-column page, in rows of
 * two or three like a real page. More rows than any screen shows, so the drift
 * never reaches an edge.
 */
const GHOST_SPANS = [
  [5, 7],
  [4, 4, 4],
  [7, 5],
  [3, 6, 3],
  [6, 6],
  [8, 4],
  [4, 3, 5],
  [5, 7],
  [4, 8],
].flat();

interface FanPlace {
  /** Across and down, in % of a cover. */
  x: string;
  y: string;
  tilt: string;
  z: number;
}

/**
 * Where each cover lands, by how many there are: a hand of cards, the middle
 * one on top, the outer ones a little lower so the fan arcs.
 */
const FANS: Record<number, readonly FanPlace[]> = {
  1: [{ x: "0%", y: "0%", tilt: "0deg", z: 1 }],
  2: [
    { x: "-30%", y: "2%", tilt: "-4deg", z: 2 },
    { x: "30%", y: "2%", tilt: "4deg", z: 1 },
  ],
  3: [
    { x: "-52%", y: "5%", tilt: "-6deg", z: 1 },
    { x: "0%", y: "0%", tilt: "0deg", z: 3 },
    { x: "52%", y: "5%", tilt: "6deg", z: 2 },
  ],
};

export function VipIntro({
  tools,
  earlyComics,
}: {
  tools: readonly VipIntroTool[];
  earlyComics: readonly VipIntroComic[];
}) {
  const shownTools = tools.slice(0, MAX_TOOLS);
  const covers = earlyComics
    .flatMap((comic) => (comic.cover ? [{ ep: comic.ep, cover: comic.cover }] : []))
    .slice(0, MAX_COVERS);
  const fan = FANS[covers.length] ?? [];

  return (
    <IntroOverlay kind="vip" label="VIP intro" className={styles.overlay}>
      <div aria-hidden="true" className={styles.back}>
        {GHOST_SPANS.map((span, i) => (
          <span key={i} className={styles.ghost} style={{ gridColumn: `span ${span}` }} />
        ))}
      </div>

      <div className={cn(styles.stage, covers.length > 0 && styles.withComics)}>
        <div className={styles.welcome}>
          <p className={cn("font-display font-bold text-text", styles.welcomeLine)}>
            {WELCOME.split(" ").map((word, i) => (
              <Fragment key={word}>
                {i > 0 ? " " : null}
                <span className={cn(styles.word, WORD_CLASSES[i])}>{word}</span>
              </Fragment>
            ))}
          </p>
          <span aria-hidden="true" className={styles.rule} />
        </div>

        {/* PR 8: the user's 3D book comes in here, between the welcome and the tools. */}

        {/* Before the tools, so a screen reader hears the question first; the
            grid areas place it at the foot of the page. */}
        <div
          className={styles.front}
          style={{ "--amr-w": `${SHEET.cellW}px`, "--amr-h": `${SHEET.cellH}px` } as CSSProperties}
        >
          {/* Sized by the CSS, then scaled inside: IntroAmr only takes pixels. */}
          <span aria-hidden="true" className={styles.amrBox}>
            <span className={styles.amrSpring}>
              <span className={styles.amrScale}>
                <span className={styles.amrJump}>
                  <IntroAmr pose="jumping" width={SHEET.cellW} />
                </span>
                <span className={styles.amrAsk}>
                  <IntroAmr pose="waiting" width={SHEET.cellW} />
                </span>
              </span>
            </span>
          </span>
          {shownTools.length > 0 ? (
            <p className={cn("balloon font-display font-medium", styles.question)}>{QUESTION}</p>
          ) : null}
        </div>

        <div className={styles.slot}>
          {shownTools.length > 0 ? (
            <ul className={styles.tools}>
              {shownTools.map((tool, i) => {
                const Icon = tool.icon;
                return (
                  <li key={tool.id} className={cn("panel", styles.tool, DEAL_CLASSES[i])}>
                    <span aria-hidden="true" className={cn("text-accent", styles.toolIcon)}>
                      <Icon className="h-full w-full" />
                    </span>
                    <span className={cn("font-display font-semibold text-text", styles.toolName)}>
                      {tool.name}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}

          {covers.length > 0 ? (
            <div className={styles.comics}>
              <p className={cn("font-display font-semibold text-text", styles.comicsHeading)}>
                {EARLY_HEADING}
              </p>
              <div aria-hidden="true" className={styles.fan}>
                {covers.map(({ ep, cover }, i) => (
                  <IntroPanel
                    key={ep}
                    panel={cover}
                    className={styles.cover}
                    style={
                      {
                        "--fan-x": fan[i].x,
                        "--fan-y": fan[i].y,
                        "--fan-tilt": fan[i].tilt,
                        zIndex: fan[i].z,
                      } as CSSProperties
                    }
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div aria-hidden="true" className={styles.ink} />
      <div aria-hidden="true" className={styles.shade} />
    </IntroOverlay>
  );
}
