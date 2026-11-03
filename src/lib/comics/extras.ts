/**
 * What a story may have beyond its panels and notes, both optional and written
 * in the portal: a short quiz, and its own "try this with your team" tool over
 * the one its theme picks (lib/comics/try-tool). Pure, for the portal, the
 * owner route and the pages alike.
 *
 * They live in their own columns (migration 0033) and are read apart from the
 * story, so a story page works the same before that migration runs.
 */

import { getToolById, tools, type ToolDefinition } from "@/lib/constants/tools";
import { isShelved } from "@/lib/tools/catalog";

export interface QuizQuestion {
  question: string;
  /** Two to four. */
  options: string[];
  /** The right option's index. */
  answer: number;
  /** Why, shown after checking. Optional. */
  explain?: string;
}

export interface StoryExtras {
  quiz: QuizQuestion[] | null;
  tryTool: string | null;
}

export const NO_EXTRAS: StoryExtras = { quiz: null, tryTool: null };

/** Under the database's 8,000, with room for how jsonb spaces what it stores. */
export const QUIZ_MAX_BYTES = 7_000;

/**
 * Mirrors the quiz check in migration 0033. The database also caps the stored
 * quiz at 8,000 bytes, which text in a script of 3-byte letters can reach within
 * these lengths, so checkExtras holds it to QUIZ_MAX_BYTES first.
 */
export const QUIZ_LIMITS = {
  questions: 3,
  minOptions: 2,
  maxOptions: 4,
  question: 200,
  option: 120,
  explain: 300,
} as const;

/** A tool a story may point to: a main tool, never shelved, VIP-only or unreleased. */
export function pickableTool(id: string): ToolDefinition | null {
  const tool = getToolById(id);
  if (!tool || isShelved(tool) || tool.access || tool.pendingApproval) return null;
  return (tool.kind ?? "tool") === "tool" ? tool : null;
}

/** The tools the portal offers, by name. */
export function pickableTools(): { id: string; name: string }[] {
  return tools
    .filter((t) => pickableTool(t.id))
    .map((t) => ({ id: t.id, name: t.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  return clean.length > 0 && clean.length <= max ? clean : null;
}

function question(raw: unknown): QuizQuestion | null {
  if (typeof raw !== "object" || raw === null) return null;
  const q = raw as Record<string, unknown>;
  const asked = text(q.question, QUIZ_LIMITS.question);
  if (!asked || !Array.isArray(q.options)) return null;
  const options = q.options.map((o) => text(o, QUIZ_LIMITS.option));
  if (options.length < QUIZ_LIMITS.minOptions || options.length > QUIZ_LIMITS.maxOptions) {
    return null;
  }
  if (options.some((o) => o === null)) return null;
  // Two answers alike make "the right one" meaningless.
  if (new Set(options.map((o) => o!.toLowerCase())).size !== options.length) return null;
  const answer = q.answer;
  if (typeof answer !== "number" || !Number.isInteger(answer)) return null;
  if (answer < 0 || answer >= options.length) return null;
  const explain =
    q.explain === undefined || q.explain === "" ? undefined : text(q.explain, QUIZ_LIMITS.explain);
  if (explain === null) return null;
  return { question: asked, options: options as string[], answer, ...(explain ? { explain } : {}) };
}

/**
 * A stored quiz, as a page shows it: null unless every question is whole. A
 * quiz with one broken question isn't shown in part.
 */
export function readQuiz(raw: unknown): QuizQuestion[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > QUIZ_LIMITS.questions) return null;
  const quiz = raw.map(question);
  return quiz.every((q): q is QuizQuestion => q !== null) ? quiz : null;
}

export type ExtrasCheck =
  | { ok: true; extras: StoryExtras }
  | { ok: false; field: "quiz" | "tryTool" };

/** The owner route's check on what the portal sends: both fields, each null to clear it. */
export function checkExtras(body: unknown): ExtrasCheck {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  let quiz: QuizQuestion[] | null = null;
  if (b.quiz !== null && b.quiz !== undefined) {
    quiz = readQuiz(b.quiz);
    if (!quiz) return { ok: false, field: "quiz" };
    if (new TextEncoder().encode(JSON.stringify(quiz)).length > QUIZ_MAX_BYTES) {
      return { ok: false, field: "quiz" };
    }
  }
  let tryTool: string | null = null;
  if (b.tryTool !== null && b.tryTool !== undefined) {
    if (typeof b.tryTool !== "string" || !pickableTool(b.tryTool)) {
      return { ok: false, field: "tryTool" };
    }
    tryTool = b.tryTool;
  }
  return { ok: true, extras: { quiz, tryTool } };
}
