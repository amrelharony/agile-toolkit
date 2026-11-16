/**
 * Audience Wall's export: every saved wall, newest first, or one wall
 * (lib/audience-wall/markdown, which Amr's export_session reads too).
 */

import { sessionMarkdown, wallsMarkdown } from "@/lib/audience-wall/markdown";
import type { WallSession } from "@/lib/audience-wall/model";

/** The page's export: every wall on screen. */
export function toMarkdown(sessions: readonly WallSession[]): string {
  return wallsMarkdown(sessions);
}

/** One wall's export, as its own document. */
export function wallMarkdown(session: WallSession): string {
  return `# Audience Wall\n\n${sessionMarkdown(session)}`;
}

/** A file name for one wall's export: "audience-wall-2026-11-12". */
export function wallFilename(session: Pick<WallSession, "savedAt">): string {
  return `audience-wall-${session.savedAt.slice(0, 10)}`;
}
