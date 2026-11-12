/**
 * Starting points for a note: the prompts a coach answers for an
 * observation, a coaching moment, an experiment, a 1:1 or a blocker that
 * keeps coming back. Our own words. A template fills an empty note, or adds
 * its prompts under what is already written, and merges its tags.
 */

import type { NotebookEventId } from "./model";

export interface NoteTemplate {
  id: string;
  label: string;
  /** The prompts, one per line, each ending in a colon to write after. */
  body: string;
  tags: readonly string[];
  event?: NotebookEventId;
  linkedTool?: string;
}

export const NOTE_TEMPLATES: readonly NoteTemplate[] = [
  {
    id: "observation",
    label: "Observation",
    body: "What I saw:\n\nWhat it might mean:\n\nWhat I'll watch for next:",
    tags: ["observation"],
  },
  {
    id: "coaching",
    label: "Coaching moment",
    body: "The moment:\n\nWhat I asked or offered:\n\nWhat happened next:",
    tags: ["coaching"],
  },
  {
    id: "experiment",
    label: "Experiment",
    body: "What we're trying:\n\nWhy we're trying it:\n\nHow we'll know it worked:\n\nWhen we'll look again:",
    tags: ["experiment"],
  },
  {
    id: "one-on-one",
    label: "1:1 note",
    body: "What we talked about:\n\nWhat they'd like help with:\n\nWhat I'll follow up:",
    tags: ["1:1"],
    event: "one-on-one",
  },
  {
    id: "impediment-pattern",
    label: "Impediment pattern",
    body: "The blocker:\n\nHow often it has come up:\n\nWho could remove it:\n\nWhat I'll do next:",
    tags: ["blockers"],
    linkedTool: "impediments",
  },
];

export function getTemplate(id: string): NoteTemplate | undefined {
  return NOTE_TEMPLATES.find((t) => t.id === id);
}

/** The body with the template's prompts: them alone for an empty note, else under the text. */
export function bodyWithTemplate(body: string, template: NoteTemplate): string {
  const text = body.trimEnd();
  return text ? `${text}\n\n${template.body}` : template.body;
}
