/**
 * Interrupt Buffer's AI task, the lite half pages import (no zod; the def,
 * with its schemas, is `interrupt-buffer.ts` and loads on first AI use).
 */

import { lazyAiTask } from "../task-ref";
import { classifyInterrupt } from "@/lib/sprints/interrupts";
import type { ClassifyInput, ClassifyOutput } from "./interrupt-buffer";
export type { ClassifyInput, ClassifyOutput } from "./interrupt-buffer";

export const CLASSIFY_MAX = 20;

/** Kinds and sizes without AI: the keyword rules (lib/sprints/interrupts). */
export const interruptClassifyFallback = ({ titles }: ClassifyInput): ClassifyOutput => ({
  items: titles.map((title, index) => ({ index, ...classifyInterrupt(title) })),
});

export const interruptClassifyTask = lazyAiTask<ClassifyInput, ClassifyOutput>(
  {
    id: "interrupt-buffer.classify",
    toolId: "interrupt-buffer",
    fallback: interruptClassifyFallback,
  },
  () => import("./interrupt-buffer").then((m) => m.interruptClassifyTask)
);
