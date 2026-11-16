/**
 * The generic text frame's renderer: a title and a line of text, large on
 * a phone. Every show tool can send it (`frames.ts` "text").
 */

import type { TextFrame } from "../frames";
import { defineShowRenderer, type ShowRendererProps } from "./types";

export function TextFrameView({ payload, surface }: ShowRendererProps<TextFrame>) {
  return (
    <div className="space-y-2 text-center">
      <p
        className={
          surface === "phone"
            ? "break-words text-2xl font-bold text-text sm:text-3xl"
            : "break-words text-lg font-semibold text-text"
        }
      >
        {payload.title}
      </p>
      {payload.body && <p className="break-words text-base text-sub">{payload.body}</p>}
    </div>
  );
}

export const TEXT_RENDERER = defineShowRenderer<TextFrame>(TextFrameView);
