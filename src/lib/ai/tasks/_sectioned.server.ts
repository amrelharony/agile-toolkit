import "server-only";

/**
 * What the sectioned tools' drafting prompts share (lib/sectioned: Kickoff
 * and Product Canvas), the server half only. Each tool's own `.server.ts`
 * builds its prompt with these, so the model reads every section's id,
 * label and prompt from the catalog here and the browser never sends a
 * prompt. The tasks themselves (schemas, caps, fallbacks) stay in each
 * tool's own files.
 */

import type { SectionDef, SectionFormat, SectionKind } from "@/lib/sectioned/model";

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

function kindNote(def: SectionDef): string {
  if (def.kind === "list")
    return def.max === 1 ? "a list of 1 line" : `a list of up to ${def.max} lines`;
  return def.kind === "long" ? "one longer answer" : "one short answer";
}

/**
 * The format's sections for a prompt, one per line in the format's order:
 * "- <id>: <label> (<what it holds>). <prompt>". `kinds` keeps only the
 * sections of those kinds (the list sections a draft fills, say).
 */
export function sectionListText(
  format: SectionFormat,
  opts: { kinds?: readonly SectionKind[] } = {}
): string {
  return format.sections
    .filter((def) => !opts.kinds || opts.kinds.includes(def.kind))
    .map((def) => `- ${def.id}: ${oneLine(def.label)} (${kindNote(def)}). ${oneLine(def.prompt)}`)
    .join("\n");
}

/** The rules every sectioned draft follows, one sentence each: join them into the system text. */
export const SECTIONED_RULES: readonly string[] = [
  "Use only the section ids listed, and leave out a line that fits none of them.",
  "Write one idea per line, in plain words and sentence case, with no emoji and no Markdown.",
  "Never invent names, dates or numbers: use only the ones the input gives.",
  "Leave a section out rather than pad it with weak lines.",
];
