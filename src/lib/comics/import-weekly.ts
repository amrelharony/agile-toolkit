/**
 * Reading a weekly batch out of a folder. Pure.
 *
 * Two kinds of folder: the one scripts/extract-weekly-pdf.py cuts out of the
 * comic's PDFs (editorial/stories.json, with Claude's drafts merged in when
 * there are any), and the older production folder (editorial/<WEEKLY_SCRIPT_FILE>).
 * Any number of stories, from one to MAX_IMPORT_STORIES.
 *
 * The production scripts hold a great deal that must stay private: research
 * references, originality reviews, art reviews, production notes. So this never
 * copies a script and removes what it knows about. It builds each story from a
 * fixed list of fields, and anything else is dropped by construction, including
 * whatever a later edition adds.
 */

import { BOOK_EPISODE_COUNT } from "./entry";
import { cleanText } from "./extras";
import { readGuessDraft, type GuessDraft } from "./guess";
import {
  DEFAULT_CREDIT_CORNER,
  STORY_LIMITS,
  type CreditCorner,
  type StoredPanel,
} from "./story-input";
import type { DialogueLine } from "./types";

/** What extract-weekly-pdf.py writes. Looked for first. */
export const PDF_STORIES_FILE = "stories.json";
/** The older production file. Its editorial folder also holds pilots, briefs and a rejected reserve. */
export const WEEKLY_SCRIPT_FILE = "Agile_At_Work_Batch_1_100_Story_Scripts.json";
/** All 330 stories in one go, with room for a few more. */
export const MAX_IMPORT_STORIES = 400;
/** The highest weekly number the database allows (migration 0029). */
const MAX_EP = 999;

/** The only script fields read. */
export const STORY_KEYS = [
  "working_title",
  "lesson",
  "squad_question",
  "cast_names",
  "theme_ids",
  "production_number",
  "episode_id",
  "art_files",
  "panels",
  "guess",
  "try_action",
  "try_tool",
] as const;
export const PANEL_KEYS = ["panel", "visual", "dialogue", "embedded_text", "alt"] as const;

export interface ScriptPanel {
  panel: number;
  visual: string;
  dialogue: DialogueLine[];
  embeddedText: string[];
  /** A drafted description. When there is one, it's used instead of the art direction. */
  alt?: string;
}

export interface ScriptStory {
  title: string;
  lesson: string;
  squadQuestion: string;
  castNames: string[];
  themes: string[];
  productionNumber: number;
  episodeId: string;
  artFiles: string[];
  panels: ScriptPanel[];
  /** Claude's draft of the guess, Try it this week line and tool, or null. */
  draft: GuessDraft | null;
}

const isString = (v: unknown): v is string => typeof v === "string";
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter(isString) : []);

function pickPanel(raw: unknown): ScriptPanel | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<(typeof PANEL_KEYS)[number], unknown>;
  if (typeof p.panel !== "number" || !isString(p.visual)) return null;
  const alt = cleanText(p.alt, STORY_LIMITS.alt);
  return {
    panel: p.panel,
    visual: p.visual,
    ...(alt ? { alt } : {}),
    dialogue: Array.isArray(p.dialogue)
      ? p.dialogue.flatMap((d: { speaker?: unknown; line?: unknown } | null) =>
          d && isString(d.line)
            ? [{ speaker: isString(d.speaker) ? d.speaker : "", line: d.line }]
            : []
        )
      : [],
    embeddedText: strings(p.embedded_text),
  };
}

/** One story from one script, or null if a field it needs is missing. */
export function pickStory(raw: unknown): ScriptStory | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<(typeof STORY_KEYS)[number], unknown>;
  if (!isString(s.working_title) || !isString(s.episode_id)) return null;
  if (typeof s.production_number !== "number" || !Number.isInteger(s.production_number))
    return null;
  if (!Array.isArray(s.panels)) return null;
  const panels = s.panels.map(pickPanel);
  if (panels.some((p) => p === null)) return null;
  return {
    title: s.working_title,
    lesson: isString(s.lesson) ? s.lesson : "",
    squadQuestion: isString(s.squad_question) ? s.squad_question : "",
    castNames: strings(s.cast_names),
    themes: strings(s.theme_ids),
    productionNumber: s.production_number,
    episodeId: s.episode_id,
    artFiles: strings(s.art_files),
    panels: panels as ScriptPanel[],
    draft: readGuessDraft({ guess: s.guess, tryAction: s.try_action, tryTool: s.try_tool }),
  };
}

const SENTENCE_BREAK = /(?<=[.!?])\s+(?=[A-Z])/;
/** Sentences that tell the artist something rather than describe the picture. */
const DIRECTION =
  /balloon|upperLEFT|upperRIGHT|\bmust\b|\bexactly\b|\bnever\b|\bdo not\b|readable|in frame|quadruped/i;
/** Uppercase only: "the right person" is description, "Turtle RIGHT" is staging. */
const POSITION_WORD = /(?<![A-Za-z-])(?:LEFT|RIGHT|CENTRE)(?:-(?:LEFT|RIGHT|CENTRE))*(?![A-Za-z])/g;
export const DESCRIPTION_TARGET = 220;
/** One enormous first sentence still has to fit the field. */
const DESCRIPTION_MAX = 320;

function stripPositions(sentence: string): string {
  return sentence
    .replace(POSITION_WORD, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function cutAtWord(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.lastIndexOf(" ", limit);
  return text.slice(0, cut > 0 ? cut : limit).trim();
}

/**
 * A script's art direction, turned into a starting description for the panel.
 * It's only a start: some direction always gets through, which is why every
 * imported panel goes through the review queue. Never empty, as long as the
 * script said anything at all.
 */
export function cleanDescription(visual: string): string {
  const sentences = visual.trim().split(SENTENCE_BREAK).filter(Boolean);
  const kept = sentences
    .filter((sentence) => !DIRECTION.test(sentence))
    .map(stripPositions)
    .filter(Boolean);

  let description = "";
  for (const sentence of kept) {
    const next = description ? `${description} ${sentence}` : sentence;
    if (description && next.length > DESCRIPTION_TARGET) break;
    description = next;
    if (description.length >= DESCRIPTION_TARGET) break;
  }
  // Every sentence was direction. A wrong description the owner will see is
  // better than an empty one, and the review queue marks it either way.
  if (!description) description = stripPositions(sentences[0] ?? "");
  return cutAtWord(description, DESCRIPTION_MAX);
}

export function weeklyEp(productionNumber: number): number {
  return BOOK_EPISODE_COUNT + productionNumber;
}

export function scriptPanelToStored(panel: ScriptPanel): StoredPanel {
  return {
    pathFull: "",
    pathSmall: "",
    width: 0,
    height: 0,
    alt: panel.alt ?? cleanDescription(panel.visual),
    dialogue: panel.dialogue,
    signs: panel.embeddedText,
    needsReview: true,
    creditCorner: DEFAULT_CREDIT_CORNER,
  };
}

export interface ImportPanel<F> {
  /** The picture on disk. Resolved before anything starts. */
  file: F;
  text: StoredPanel;
}

export interface ImportStory<F> {
  ep: number;
  sourceId: string;
  title: string;
  lesson: string;
  squadQuestion: string;
  castNames: string[];
  themes: string[];
  bookPage: number | null;
  panels: ImportPanel<F>[];
  /** The share image's credit corner, when it isn't the first panel's. */
  shareCorner?: CreditCorner;
  /** Claude's draft, saved for the owner to approve. Never shown until then. */
  draft?: GuessDraft | null;
}

export type ImportPlan<F> =
  | { ok: true; stories: ImportStory<F>[] }
  | { ok: false; problems: string[] };

export interface FolderFile {
  /** Path inside the chosen folder, with forward slashes. */
  path: string;
}

/** "AgileBatch/art/N001_P01.png" and "art/N001_P01.png" are the same file. */
function endsWithPath(path: string, tail: string): boolean {
  return path === tail || path.endsWith(`/${tail}`);
}

/** The folder's stories file: the PDF extract's first, then the older production file. */
export function findWeeklyScriptFile<F extends FolderFile>(files: readonly F[]): F | null {
  return (
    files.find((f) => endsWithPath(f.path, `editorial/${PDF_STORIES_FILE}`)) ??
    files.find((f) => endsWithPath(f.path, `editorial/${WEEKLY_SCRIPT_FILE}`)) ??
    null
  );
}

const MAX_LISTED_PROBLEMS = 12;

function listProblems(label: string, items: readonly string[]): string {
  const shown = items.slice(0, MAX_LISTED_PROBLEMS).join(", ");
  const more = items.length - MAX_LISTED_PROBLEMS;
  return `${label}: ${shown}${more > 0 ? ` and ${more} more` : ""}.`;
}

/**
 * The whole batch, or everything wrong with it. All or nothing up front, so an
 * hour's import can't discover a missing file at story 90.
 */
export function planWeeklyImport<F extends FolderFile>(
  scripts: unknown,
  files: readonly F[]
): ImportPlan<F> {
  const episodes = (scripts as { episodes?: unknown } | null)?.episodes;
  if (!Array.isArray(episodes)) {
    return { ok: false, problems: ["The stories file has no list of episodes."] };
  }
  const problems: string[] = [];
  if (episodes.length === 0 || episodes.length > MAX_IMPORT_STORIES) {
    problems.push(
      `Found ${episodes.length} stories in the file. An import takes 1 to ${MAX_IMPORT_STORIES}.`
    );
  }

  const artByName = new Map<string, F>();
  for (const file of files) {
    const name = /(?:^|\/)(art\/[^/]+)$/.exec(file.path)?.[1];
    if (name) artByName.set(name, file);
  }

  const stories: ImportStory<F>[] = [];
  const missing: string[] = [];
  const seenEps = new Set<number>();
  const seenIds = new Set<string>();

  episodes.forEach((raw, i) => {
    const story = pickStory(raw);
    if (!story) {
      problems.push(`Story ${i + 1} in the scripts is missing a field it needs.`);
      return;
    }
    const ep = weeklyEp(story.productionNumber);
    if (story.productionNumber < 1 || ep > MAX_EP || seenEps.has(ep)) {
      problems.push(`${story.episodeId} has a bad or repeated production number.`);
      return;
    }
    if (seenIds.has(story.episodeId)) {
      problems.push(`${story.episodeId} appears twice in the scripts.`);
      return;
    }
    seenEps.add(ep);
    seenIds.add(story.episodeId);
    if (story.panels.length === 0 || story.panels.length > STORY_LIMITS.panels) {
      problems.push(
        `${story.episodeId} has ${story.panels.length} panels. A story takes 1 to ${STORY_LIMITS.panels}.`
      );
      return;
    }
    if (story.panels.length !== story.artFiles.length) {
      problems.push(
        `${story.episodeId} has ${story.panels.length} panels but ${story.artFiles.length} art files.`
      );
      return;
    }
    const ordered = [...story.panels].sort((a, b) => a.panel - b.panel);
    const panels: ImportPanel<F>[] = [];
    ordered.forEach((panel, at) => {
      const name = story.artFiles[at];
      const file = artByName.get(name);
      if (!file) {
        missing.push(name);
        return;
      }
      panels.push({ file, text: scriptPanelToStored(panel) });
    });
    stories.push({
      ep,
      sourceId: story.episodeId,
      title: story.title,
      lesson: story.lesson,
      squadQuestion: story.squadQuestion,
      castNames: story.castNames,
      themes: story.themes,
      bookPage: null,
      panels,
      draft: story.draft,
    });
  });

  if (missing.length > 0) problems.push(listProblems("Art files not in this folder", missing));
  return problems.length > 0 ? { ok: false, problems } : { ok: true, stories };
}
