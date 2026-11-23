import type { InkDrawing } from "../types";

/**
 * A pen at work in a 24-unit box: the mark a chat step shows while it runs
 * (chat/tool-steps), in the 20 px slot its tick later takes. It loops as the
 * loading scribble does (`.ink-scribble`), and reduced motion shows it still.
 * Kept out of marks.ts, which every page loads: only the chat draws it.
 */
export const STEP_RUNNING: InkDrawing = {
  name: "step-running",
  viewBox: "0 0 24 24",
  pen: 2.4,
  strokes: [
    {
      d: "M2.6 13.8C4.4 8.6 6.4 8.4 7.6 12.4S10.8 16.4 12.4 12.2S15.8 8.2 17.2 12.2S20 15.8 21.6 10.8",
      tone: "accent",
    },
  ],
};
