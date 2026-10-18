import type {
  KanbanBoard,
  KanbanCard,
  KanbanClassOfService,
  KanbanColumnId,
} from "@/lib/stores/workspace-types";

/** "18 Oct 2026" */
function mdDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** A list item's text: one line. */
function oneLine(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .trim();
}

const COLUMNS: { id: KanbanColumnId; label: string }[] = [
  { id: "backlog", label: "Backlog" },
  { id: "ready", label: "Ready" },
  { id: "in_progress", label: "In progress" },
  { id: "review", label: "Review" },
  { id: "done", label: "Done" },
];

const CLASS_LABELS: Record<KanbanClassOfService, string> = {
  standard: "Standard",
  expedite: "Expedite",
  fixed_date: "Fixed date",
  intangible: "Intangible",
};

/** Backlog and Done are queues, not WIP: the board never limits them. */
const limited = (col: KanbanColumnId) => col !== "backlog" && col !== "done";

function cycleDays(c: KanbanCard): number | null {
  if (!c.startedAt || !c.completedAt) return null;
  const ms = new Date(c.completedAt).getTime() - new Date(c.startedAt).getTime();
  return Number.isFinite(ms) ? Math.max(0, ms / (24 * 60 * 60 * 1000)) : null;
}

function cardLine(c: KanbanCard): string {
  const tags: string[] = [];
  // Standard is the default; only the classes that change how a card is pulled get a tag.
  if (c.class !== "standard" && CLASS_LABELS[c.class]) tags.push(CLASS_LABELS[c.class]);
  const days = c.column === "done" ? cycleDays(c) : null;
  if (days !== null) tags.push(`cycle time ${days.toFixed(1)} days`);
  const description = oneLine(c.description);
  return `- ${oneLine(c.title)}${tags.length ? ` (${tags.join(", ")})` : ""}${
    description ? ` — ${description}` : ""
  }`;
}

/** The board as one section per column, for a wiki page or a team channel. */
export function toMarkdown(
  board: Pick<KanbanBoard, "cards" | "wipLimits">,
  now: Date = new Date()
): string {
  const title = `# Kanban — ${mdDate(now)}`;
  if (board.cards.length === 0) return `${title}\n\nNo cards yet.\n`;

  const byColumn = new Map<KanbanColumnId, KanbanCard[]>(COLUMNS.map((c) => [c.id, []]));
  // Cards from an older build may carry a column that no longer exists;
  // the board shows those in Backlog, so the export does too.
  for (const c of board.cards) (byColumn.get(c.column) ?? byColumn.get("backlog")!).push(c);

  const limitOf = (col: KanbanColumnId) => (limited(col) ? (board.wipLimits[col] ?? 0) : 0);
  const over = COLUMNS.filter((c) => {
    const limit = limitOf(c.id);
    return limit > 0 && byColumn.get(c.id)!.length > limit;
  });

  const n = board.cards.length;
  const lines = [
    title,
    "",
    `${n} ${n === 1 ? "card" : "cards"}: ${COLUMNS.map(
      (c) => `${c.label} ${byColumn.get(c.id)!.length}`
    ).join(", ")}.`,
    over.length > 0
      ? `**Over WIP limit:** ${over
          .map((c) => `${c.label} (${byColumn.get(c.id)!.length}/${limitOf(c.id)})`)
          .join(", ")}.`
      : "All columns are within their WIP limits.",
  ];

  for (const col of COLUMNS) {
    const cards = byColumn.get(col.id)!;
    const limit = limitOf(col.id);
    const count =
      limit > 0
        ? `${cards.length}/${limit} WIP${cards.length > limit ? ", over limit" : ""}`
        : `${cards.length}`;
    lines.push("", `## ${col.label} (${count})`, "");
    if (cards.length === 0) lines.push("No cards.");
    else lines.push(...cards.map(cardLine));
  }

  return `${lines.join("\n")}\n`;
}
