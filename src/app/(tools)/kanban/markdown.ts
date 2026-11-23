import type {
  DodCriterion,
  KanbanBoard,
  KanbanCard,
  KanbanClassOfService,
  KanbanColumnId,
  Sprint,
  Story,
  WorkflowDefinition,
} from "@/lib/stores/workspace-types";
import { storyProgress } from "@/lib/sprints/progress";
import {
  BOARD_NAME,
  CADENCE_LABEL,
  CLASS_LABEL,
  describedBoard,
  policyStages,
  sleText,
  stagePolicy,
  wipColumns,
} from "@/lib/kanban/workflow";
import { WORK_TYPE_LABEL } from "@/lib/flow/work-types";
import { cycleTimeDays, FLOW_COLUMNS, isLimited } from "./flow-view";
import {
  SPRINT_COLUMNS,
  daysInColumn,
  doneMissingDod,
  sprintBoardVerdict,
  sprintBreaches,
  storiesByColumn,
  wipNudge,
} from "./sprint-view";

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

const CLASS_LABELS: Record<KanbanClassOfService, string> = {
  standard: "Standard",
  expedite: "Expedite",
  fixed_date: "Fixed date",
  intangible: "Intangible",
};

function cardLine(c: KanbanCard): string {
  const tags: string[] = [];
  // Standard is the default; only the classes that change how a card is pulled get a tag.
  if (c.class !== "standard" && CLASS_LABELS[c.class]) tags.push(CLASS_LABELS[c.class]);
  // As on the board: a done card isn't blocked (an agent's move leaves the flag).
  if (c.blocked && c.column !== "done") tags.push("blocked");
  if (c.assignee?.trim()) tags.push(`assigned to ${oneLine(c.assignee)}`);
  const days = c.column === "done" ? cycleTimeDays(c) : null;
  if (days !== null) tags.push(`cycle time ${days.toFixed(1)} days`);
  const description = oneLine(c.description);
  return `- ${oneLine(c.title)}${tags.length ? ` (${tags.join(", ")})` : ""}${
    description ? ` — ${description}` : ""
  }`;
}

/** A table cell's text: one line, pipes escaped. */
const cell = (v: unknown) => oneLine(v).replace(/\|/g, "\\|");

/**
 * The Definition of Workflow as Markdown: what one item is, start and
 * finish, a policy table (Done is the Definition of Done), WIP, pull and
 * blocker policies, classes of service, the SLE, work types and cadences,
 * then its saved versions. Appended only to the export of the board it
 * describes.
 */
export function workflowMarkdown(
  def: WorkflowDefinition,
  wipLimits: Partial<Record<KanbanColumnId, number>>
): string[] {
  const board = describedBoard(def) ?? "flow";
  const lines = ["", "## Definition of Workflow", "", `Describes the ${BOARD_NAME[board]}.`];
  const facts: string[] = [];
  if (def.workItem) facts.push(`- **One work item:** ${oneLine(def.workItem)}`);
  if (def.startPoint) facts.push(`- **Starts when:** ${oneLine(def.startPoint)}`);
  if (def.finishPoint) facts.push(`- **Finished when:** ${oneLine(def.finishPoint)}`);
  if (facts.length) lines.push("", ...facts);
  lines.push("", "| Stage | Enters when | Leaves when |", "| --- | --- | --- |");
  for (const s of policyStages(board)) {
    const p = stagePolicy(def, s.id);
    lines.push(`| ${s.label} | ${cell(p?.enter ?? "")} | ${cell(p?.exit ?? "")} |`);
  }
  lines.push("| Done | Meets the Definition of Done | |");
  const wip = wipColumns(board)
    .map((c) => `${c.label} ${wipLimits[c.key] ? wipLimits[c.key] : "no limit"}`)
    .join(", ");
  const policy: string[] = [
    `- **WIP limits:** ${wip}.${def.wipPolicy ? ` ${oneLine(def.wipPolicy)}` : ""}`,
  ];
  if (def.pullPolicy) policy.push(`- **Pull:** ${oneLine(def.pullPolicy)}`);
  if (def.blockerPolicy) policy.push(`- **Blockers:** ${oneLine(def.blockerPolicy)}`);
  if (board === "flow" && def.classPolicies?.length) {
    policy.push(
      `- **Classes of service:** ${def.classPolicies
        .map((c) => `${CLASS_LABEL[c.class]}: ${oneLine(c.policy)}`)
        .join("; ")}`
    );
  }
  const sle = sleText(def.sle);
  if (sle) policy.push(`- **${sle.replace(/^SLE: /, "SLE:** ")}`);
  if (def.workTypes?.length) {
    policy.push(
      `- **Work types:** ${def.workTypes
        .map(
          (w) =>
            `${WORK_TYPE_LABEL[w.type]}${w.targetPct !== undefined ? ` ${w.targetPct}%` : ""}${
              w.meaning ? ` (${oneLine(w.meaning)})` : ""
            }`
        )
        .join(", ")}`
    );
  }
  if (def.cadences?.length) {
    policy.push(
      `- **Cadences:** ${def.cadences
        .map(
          (c) =>
            `${oneLine(c.name)} (${CADENCE_LABEL[c.cadence].toLowerCase()}${
              c.minutes ? `, ${c.minutes} min` : ""
            })${c.purpose ? `: ${oneLine(c.purpose)}` : ""}`
        )
        .join("; ")}`
    );
  }
  lines.push("", ...policy);
  const versions = def.versions ?? [];
  if (versions.length) {
    lines.push(
      "",
      "## Versions",
      "",
      "| Version | Saved | What changed | Expected |",
      "| --- | --- | --- | --- |"
    );
    for (const v of versions) {
      lines.push(
        `| ${v.version} | ${mdDate(new Date(v.savedAt))} | ${cell(v.note ?? "")} | ${cell(v.expect ?? "")} |`
      );
    }
  }
  return lines;
}

/** The Flow board as one section per column, for a wiki page or a team channel. */
export function toMarkdown(
  board: Pick<KanbanBoard, "cards" | "wipLimits">,
  now: Date = new Date(),
  /** The Definition of Workflow, when it describes the Flow board. */
  workflow?: WorkflowDefinition | null
): string {
  const title = `# Kanban — ${mdDate(now)}`;
  const tail = workflow ? workflowMarkdown(workflow, board.wipLimits) : [];
  if (board.cards.length === 0) return `${[title, "", "No cards yet.", ...tail].join("\n")}\n`;

  const byColumn = new Map<KanbanColumnId, KanbanCard[]>(FLOW_COLUMNS.map((c) => [c.id, []]));
  // Cards from an older build may carry a column that no longer exists;
  // the board shows those in Backlog, so the export does too.
  for (const c of board.cards) (byColumn.get(c.column) ?? byColumn.get("backlog")!).push(c);

  const limitOf = (col: KanbanColumnId) => (isLimited(col) ? (board.wipLimits[col] ?? 0) : 0);
  const over = FLOW_COLUMNS.filter((c) => {
    const limit = limitOf(c.id);
    return limit > 0 && byColumn.get(c.id)!.length > limit;
  });

  const n = board.cards.length;
  const lines = [
    title,
    "",
    `${n} ${n === 1 ? "card" : "cards"}: ${FLOW_COLUMNS.map(
      (c) => `${c.label} ${byColumn.get(c.id)!.length}`
    ).join(", ")}.`,
    over.length > 0
      ? `**Over WIP limit:** ${over
          .map((c) => `${c.label} (${byColumn.get(c.id)!.length}/${limitOf(c.id)})`)
          .join(", ")}.`
      : "All columns are within their WIP limits.",
  ];

  for (const col of FLOW_COLUMNS) {
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

  lines.push(...tail);
  return `${lines.join("\n")}\n`;
}

const pts = (n: number) => `${n} ${n === 1 ? "pt" : "pts"}`;

function storyLine(s: Story, now: Date): string {
  const tags: string[] = [];
  tags.push(
    typeof s.points === "number" && Number.isFinite(s.points) ? pts(s.points) : "no estimate"
  );
  if (s.owner?.trim()) tags.push(oneLine(s.owner));
  if (s.blocked && s.status !== "done") tags.push("blocked");
  if (s.status !== "done") {
    const days = daysInColumn(s, now);
    if (days !== null) tags.push(`${days} ${days === 1 ? "day" : "days"} in column`);
  }
  return `- ${oneLine(s.title)} (${tags.join(", ")})`;
}

/**
 * The Sprint board as Markdown: the sprint's progress and verdict, any
 * WIP nudges, then one section per column — for the Daily Scrum notes or a
 * stakeholder update.
 */
export function sprintBoardMarkdown(
  {
    sprint,
    stories,
    wipLimits,
    dod = [],
    workflow = null,
  }: {
    sprint: Pick<Sprint, "id" | "name" | "goal">;
    stories: readonly Story[];
    wipLimits: Partial<Record<KanbanColumnId, number>>;
    /** The team's Definition of Done, so the verdict reads as the board's header does. */
    dod?: readonly DodCriterion[];
    /** The Definition of Workflow, when it describes the Sprint board. */
    workflow?: WorkflowDefinition | null;
  },
  now: Date = new Date()
): string {
  const title = `# ${oneLine(sprint.name)} board — ${mdDate(now)}`;
  const progress = storyProgress(stories, sprint.id);
  const byColumn = storiesByColumn(stories, sprint.id);
  const breaches = sprintBreaches(byColumn, wipLimits);
  const dodMissing = doneMissingDod(byColumn.done, { items: dod }).length;
  const lines = [title, ""];
  if (sprint.goal?.trim()) lines.push(`**Sprint goal:** ${oneLine(sprint.goal)}`, "");
  lines.push(sprintBoardVerdict(sprint, progress, breaches, dodMissing));
  const tail = workflow ? workflowMarkdown(workflow, wipLimits) : [];
  if (progress.count === 0) return `${[...lines, ...tail].join("\n")}\n`;

  lines.push(
    "",
    `${progress.count} ${progress.count === 1 ? "story" : "stories"}: ${SPRINT_COLUMNS.map(
      (c) => `${c.label} ${byColumn[c.id].length}`
    ).join(", ")}. ${progress.blocked} blocked.`
  );
  for (const b of breaches) lines.push(`**WIP:** ${wipNudge(b)}`);

  for (const col of SPRINT_COLUMNS) {
    const list = byColumn[col.id];
    const limit = col.id === "done" ? 0 : (wipLimits[col.wipKey] ?? 0);
    const count = limit > 0 ? `${list.length}/${limit}` : `${list.length}`;
    lines.push("", `## ${col.label} (${count})`, "");
    if (list.length === 0) lines.push("No stories.");
    else lines.push(...list.map((s) => storyLine(s, now)));
  }
  lines.push(...tail);
  return `${lines.join("\n")}\n`;
}
