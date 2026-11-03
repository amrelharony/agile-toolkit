/** Shapes of a comic story as pages see it. No server imports, safe anywhere. */

export type ComicCollection = "book" | "weekly";

export interface DialogueLine {
  speaker: string;
  line: string;
}

export interface Panel {
  /** Storage path of the 1536 px file, loaded only when a panel opens full screen. */
  pathFull: string;
  /** Storage path of the 768 px file: what every page loads. */
  pathSmall: string;
  /** Real dimensions, so a panel holds its space while it loads. */
  width: number;
  height: number;
  /** What the panel shows, for people who can't see the art. */
  alt: string;
  /** Speech is baked into the art, so it's repeated here as text. */
  dialogue: DialogueLine[];
  /** Words on signs and screens in the art. */
  signs: string[];
}

export interface Story {
  ep: number;
  collection: ComicCollection;
  title: string;
  lesson: string;
  squadQuestion: string;
  castNames: string[];
  themes: string[];
  panels: Panel[];
  sharePath: string | null;
  bookPage: number | null;
  releaseAt: string;
  updatedAt: string;
}

/** The first panel of a story: all the gallery and the feed ever see of the art. */
export type StoryCover = Pick<Panel, "pathSmall" | "width" | "height">;

/** One story as a flashcard: its title, and the lesson and question to recall. */
export interface StudyCard {
  ep: number;
  title: string;
  lesson: string;
  question: string;
}

/** One gallery card: enough to find a story, not enough to read it. */
export interface StorySummary {
  ep: number;
  title: string;
  lesson: string;
  castNames: string[];
  themes: string[];
  cover: StoryCover | null;
  releaseAt: string;
  updatedAt: string;
}
