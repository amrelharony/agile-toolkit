/**
 * What kind of change a story is: a fix, a change to something that exists,
 * or something new. Release notes group the stories a release ships by it,
 * and Flow Insights guesses a story's work type from it (a fix is a
 * defect), so both class a story the same way. Read from the story as it
 * is, with no AI: its tags, where it came from and how its title starts.
 * Pure, so the pages and the agent actions agree.
 */

import type { Story } from "@/lib/stores/workspace-types";

/** The tag a story sent from Bug Triage carries, which marks it as a fix. */
export const BUG_TAG = "bug";

export type StoryKind = "fix" | "change" | "new";

/** Tags that mark a story as a fix (any case). */
const FIX_TAGS: ReadonlySet<string> = new Set([BUG_TAG, "fix"]);

/** Title openings that mark a fix, and a change (any case). */
const FIX_STARTS = ["fix", "bug"] as const;
const CHANGE_STARTS = ["change", "update", "improve", "rename", "remove"] as const;

function startsWithAny(title: string, starts: readonly string[]): boolean {
  const lead = title.trimStart().toLowerCase();
  return starts.some((s) => lead.startsWith(s));
}

/**
 * The story's kind:
 *   - fix: a tag is "bug" or "fix" (any case), it was sent from Bug Triage,
 *     or its title starts with "Fix" or "Bug";
 *   - change: its title starts with "Change", "Update", "Improve", "Rename"
 *     or "Remove";
 *   - otherwise new.
 * Titles are matched in any case ("fix login" is a fix too).
 */
export function storyKind(story: Pick<Story, "title" | "tags" | "sourceRef">): StoryKind {
  const tags: unknown = story.tags;
  if (
    Array.isArray(tags) &&
    tags.some((t) => typeof t === "string" && FIX_TAGS.has(t.trim().toLowerCase()))
  ) {
    return "fix";
  }
  if (story.sourceRef?.tool === "bug-triage") return "fix";
  const title = typeof story.title === "string" ? story.title : "";
  if (startsWithAny(title, FIX_STARTS)) return "fix";
  if (startsWithAny(title, CHANGE_STARTS)) return "change";
  return "new";
}
