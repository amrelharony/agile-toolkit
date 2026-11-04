/**
 * Running an import: one panel at a time, saving after each, so it can stop
 * anywhere and carry on from there. Resumes by source_id rather than by number:
 * the owner may have reordered the queue since the last run. Pure apart from
 * what's passed in.
 */

import { isBookEp } from "./entry";
import type { ImportStory } from "./import-weekly";
import {
  everReleased,
  panelHasArt,
  publishProblems,
  unreviewedPanels,
  type CreditCorner,
  type OwnerStory,
  type StoredPanel,
} from "./story-input";

export interface PanelArt {
  pathFull: string;
  pathSmall: string;
  sharePath: string | null;
  width: number;
  height: number;
}

export interface ImportDeps<F> {
  createStory(story: ImportStory<F>): Promise<OwnerStory>;
  savePanels(ep: number, panels: StoredPanel[], sharePath: string | null): Promise<OwnerStory>;
  release(ep: number): Promise<OwnerStory>;
  /** shareCorner is the share image's credit corner; it only matters when withShare. */
  convertAndUpload(
    file: F,
    panel: StoredPanel,
    withShare: boolean,
    shareCorner: CreditCorner
  ): Promise<PanelArt>;
}

export interface ImportProgress {
  storiesDone: number;
  storiesTotal: number;
  /** Stories that were already finished and left alone. */
  skipped: number;
  panelsDone: number;
  current: string | null;
  failures: { ep: number; title: string; message: string }[];
}

/** Finished means nothing left to upload. Text the owner has edited is left alone. */
export function isStoryFinished(story: OwnerStory): boolean {
  return story.panels.length > 0 && story.panels.every(panelHasArt) && Boolean(story.sharePath);
}

/**
 * Book episodes go live at import, so printed links show art at once, but only
 * with every description written and checked. Until then they stay as text. A
 * weekly story is always a draft here: its date comes from "Schedule the queue".
 *
 * Only a story this run uploaded art for is a candidate. One that was already
 * complete may be held back or taken down on purpose, and a re-run started to
 * finish something else mustn't put it out: that's the review queue's "Publish
 * them", which asks first.
 */
function shouldRelease(story: OwnerStory): boolean {
  return (
    isBookEp(story.ep) &&
    !story.releaseAt &&
    !everReleased(story) &&
    unreviewedPanels(story) === 0 &&
    publishProblems(story).length === 0
  );
}

const message = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong.");

export async function runImport<F>(options: {
  plan: readonly ImportStory<F>[];
  existing: readonly OwnerStory[];
  deps: ImportDeps<F>;
  onProgress?: (progress: ImportProgress) => void;
  shouldStop?: () => boolean;
}): Promise<ImportProgress> {
  const { plan, existing, deps, onProgress, shouldStop } = options;
  const bySource = new Map(existing.flatMap((s) => (s.sourceId ? [[s.sourceId, s] as const] : [])));
  const progress: ImportProgress = {
    storiesDone: 0,
    storiesTotal: plan.length,
    skipped: 0,
    panelsDone: 0,
    current: null,
    failures: [],
  };
  const report = () => onProgress?.({ ...progress, failures: [...progress.failures] });

  for (const planned of plan) {
    if (shouldStop?.()) break;
    let story = bySource.get(planned.sourceId) ?? null;
    let uploaded = false;
    try {
      if (story && isStoryFinished(story)) {
        progress.skipped += 1;
      } else {
        progress.current = planned.title;
        report();
        if (!story) story = await deps.createStory(planned);

        let stopped = false;
        for (let i = 0; i < planned.panels.length; i += 1) {
          // A panel the owner added or removed in the portal isn't this script's any more.
          const panel = story.panels[i];
          if (panel && panelHasArt(panel) && (i > 0 || story.sharePath)) continue;
          if (shouldStop?.()) {
            stopped = true;
            break;
          }
          const textOf = panel ?? planned.panels[i].text;
          const art = await deps.convertAndUpload(
            planned.panels[i].file,
            textOf,
            i === 0,
            planned.shareCorner ?? textOf.creditCorner
          );
          const panels = [...story.panels];
          panels[i] = {
            ...textOf,
            pathFull: art.pathFull,
            pathSmall: art.pathSmall,
            width: art.width,
            height: art.height,
          };
          story = await deps.savePanels(
            story.ep,
            panels,
            i === 0 ? art.sharePath : story.sharePath
          );
          uploaded = true;
          progress.panelsDone += 1;
          report();
        }
        if (stopped) break;
      }
      if (story && uploaded && shouldRelease(story)) await deps.release(story.ep);
      progress.storiesDone += 1;
    } catch (err) {
      progress.failures.push({ ep: planned.ep, title: planned.title, message: message(err) });
    }
    progress.current = null;
    report();
  }
  progress.current = null;
  report();
  return progress;
}

/** Numbers in the plan already held by some other story, which would block it. */
export function planConflicts<F>(
  plan: readonly ImportStory<F>[],
  existing: readonly OwnerStory[]
): number[] {
  const bySource = new Set(existing.map((s) => s.sourceId));
  const byEp = new Map(existing.map((s) => [s.ep, s]));
  return plan.filter((p) => !bySource.has(p.sourceId) && byEp.has(p.ep)).map((p) => p.ep);
}
