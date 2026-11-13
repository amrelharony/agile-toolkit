/**
 * Audience Wall as Markdown: one wall, or every saved wall. The page's
 * export and Amr's export_session read the same text. Anonymous: posts,
 * votes, scores and themes, never a name. Pure and server-safe.
 */

import {
  WALL_KIND_LABEL,
  isScored,
  rankedPosts,
  repliesByPost,
  topTen,
  wallCounts,
  type WallSession,
  type WallSessionPost,
} from "./model";

/** Text safe in a Markdown line or table cell. */
function md(text: string): string {
  return text
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/([\\`*_[\]|<>#])/g, "\\$1")
    .trim();
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function average(p: WallSessionPost): string {
  if (!p.scorers) return "not scored";
  return `${Math.round(((p.score ?? 0) / p.scorers) * 10) / 10} from ${plural(p.scorers, "score")}`;
}

function postLine(p: WallSessionPost, scored: boolean): string {
  const bits = [scored ? average(p) : plural(p.votes, "vote")];
  if (p.answered) bits.push("answered");
  const merged = p.merged.length > 0 ? ` (also: ${p.merged.map(md).join("; ")})` : "";
  return `- ${md(p.text)}${merged} — ${bits.join(", ")}`;
}

/** One saved wall as Markdown. */
export function sessionMarkdown(s: WallSession): string {
  const c = wallCounts(s);
  const scored = isScored(s);
  const lines: string[] = [
    `## ${md(s.prompt)}`,
    "",
    `${WALL_KIND_LABEL[s.kind]}, ${s.savedAt.slice(0, 10)}. ${plural(c.posts, "post")}, anonymous${
      s.source === "manual" ? ", typed in by hand" : ""
    }.`,
    "",
  ];

  if (s.kind === "crowd" && scored) {
    const top = topTen(s);
    lines.push("### Top ten", "");
    top.forEach((p, i) => lines.push(`${i + 1}. ${md(p.text)} — ${average(p)}`));
    if (top.length === 0) lines.push("Nobody scored a post.");
    lines.push("");
  }

  if (s.themes.length > 0) {
    const byId = new Map(s.posts.map((p) => [p.id, p]));
    lines.push("### Themes", "");
    for (const t of s.themes) {
      lines.push(`**${md(t.name)}** (${plural(t.postIds.length, "post")})`);
      for (const id of t.postIds) {
        const p = byId.get(id);
        if (p) lines.push(`- ${md(p.text)}`);
      }
      lines.push("");
    }
  }

  lines.push(s.kind === "questions" ? "### Questions" : "### Posts", "");
  if (s.posts.length === 0) lines.push("No posts.");
  const replies = repliesByPost(s);
  for (const p of rankedPosts(s)) {
    if (p.re && s.posts.some((x) => x.id === p.re)) continue;
    lines.push(postLine(p, scored));
    for (const r of replies.get(p.id) ?? []) {
      lines.push(`  - Yes, and… ${md(r.text)} — ${plural(r.votes, "vote")}`);
    }
  }
  lines.push("");

  const sent = s.sent.filter((x) => x.sentTo.length > 0);
  if (sent.length > 0) {
    lines.push("### Sent to the backlog", "");
    for (const x of sent) lines.push(`- ${md(x.title)}`);
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

/** Every saved wall, newest first, as one Markdown document. */
export function wallsMarkdown(sessions: readonly WallSession[]): string {
  if (sessions.length === 0) return "# Audience Wall\n\nNo saved walls yet.\n";
  return `# Audience Wall\n\n${sessions.map(sessionMarkdown).join("\n")}`;
}
