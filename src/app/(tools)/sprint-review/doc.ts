import type {
  ChecklistItem,
  DemoFeature,
  FeedbackItem,
  Sprint,
  SprintReview,
  Story,
} from "@/lib/stores/workspace-types";
import {
  DRAFT_REVIEW_ID,
  blankReview,
  reviewDocId,
  reviewHasContent,
} from "@/lib/sprints/review-doc";
import { listAnd } from "@/lib/charts/chart-text";
import { FEEDBACK_CATEGORIES, LEGACY_STARTER } from "./constants";
import type { FeedbackCategory } from "./types";

/**
 * Where a sprint review lives. Each sprint has its own document, under
 * `sprint-review:sprint:<sprintId>` with `sprintId` set; the cockpit, the
 * next steps and the tool.sprint_review.* agent actions read the same ids
 * (lib/sprints/review-doc).
 *
 * `sprint-review:current` keeps its old meaning: the one review from before
 * reviews were per sprint, now the draft for when no sprint is chosen. A
 * sprint with no document yet shows its facts and stores nothing until the
 * first edit, so opening the page never counts as holding the review.
 */

export { DRAFT_REVIEW_ID, blankReview, reviewDocId, reviewHasContent };

const text = (v: unknown): string =>
  typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
const points = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : 0;
const hasId = (v: unknown): v is { id: string } =>
  typeof v === "object" && v !== null && typeof (v as { id?: unknown }).id === "string";
const list = <T>(v: unknown): T[] => (Array.isArray(v) ? v.filter(hasId) : []) as T[];

export function isFeedbackCategory(v: unknown): v is FeedbackCategory {
  return typeof v === "string" && (FEEDBACK_CATEGORIES as readonly string[]).includes(v);
}

/**
 * A stored review with every field in shape, whatever wrote it: older
 * clients, agents (the MCP surface reads every list as optional), hand
 * edits. A feedback category that isn't one of the three is kept as it is;
 * the page shows it as uncategorised until someone picks one.
 */
export function normalizeReview(doc: SprintReview): SprintReview {
  return {
    ...doc,
    sprintName: text(doc.sprintName),
    sprintNumber: text(doc.sprintNumber),
    meetingDate: text(doc.meetingDate),
    features: list<DemoFeature>(doc.features).map((f) => ({
      ...f,
      name: text(f.name),
      description: text(f.description),
      acceptanceCriteria: text(f.acceptanceCriteria),
      timeMinutes: points(f.timeMinutes),
    })),
    feedbackItems: list<FeedbackItem>(doc.feedbackItems).map((f) => ({
      ...f,
      stakeholder: text(f.stakeholder),
      feedback: text(f.feedback),
    })),
    checklistItems: list<ChecklistItem>(doc.checklistItems).map((c) => ({
      ...c,
      label: text(c.label),
      checked: Boolean(c.checked),
    })),
    committed: points(doc.committed),
    completed: points(doc.completed),
    totalBacklog: points(doc.totalBacklog),
    backlogDone: points(doc.backlogDone),
  };
}

const featureKey = (f: DemoFeature) =>
  [f.id, f.name, f.description, f.acceptanceCriteria, f.timeMinutes].join("\u0000");
const checkKey = (c: ChecklistItem) => [c.id, c.label, c.checked].join("\u0000");

/**
 * Whether the draft is still the old page's starter content, untouched
 * (any meeting date: the old page stamped one on the first visit). Such a
 * draft is shown as empty and never offered for a sprint.
 */
export function isStarterDraft(doc: SprintReview): boolean {
  const s = LEGACY_STARTER;
  return (
    doc.id === DRAFT_REVIEW_ID &&
    !doc.sprintId &&
    doc.sprintName === s.sprintName &&
    doc.sprintNumber === s.sprintNumber &&
    doc.feedbackItems.length === 0 &&
    doc.features.map(featureKey).join("\n") === s.features.map(featureKey).join("\n") &&
    doc.checklistItems.map(checkKey).join("\n") === s.checklistItems.map(checkKey).join("\n") &&
    doc.committed === s.committed &&
    doc.completed === s.completed &&
    doc.totalBacklog === s.totalBacklog &&
    doc.backlogDone === s.backlogDone
  );
}

export interface ReviewView {
  /** The review to show and edit. */
  doc: SprintReview;
  /** False while there is no document: nothing is written until an edit. */
  stored: boolean;
}

/**
 * The review for `sprint`, or the draft without one. A sprint's document
 * written by an agent without `sprintId` gets it back, and an untouched
 * starter draft reads as no draft at all.
 */
export function viewReview(
  docs: readonly SprintReview[] | undefined,
  sprint?: Pick<Sprint, "id" | "name">
): ReviewView {
  const id = reviewDocId(sprint?.id);
  const found = (docs ?? []).find((d) => d && d.id === id);
  if (!found) return { doc: blankReview(sprint), stored: false };
  const doc = normalizeReview(found);
  if (!sprint)
    return isStarterDraft(doc) ? { doc: blankReview(), stored: false } : { doc, stored: true };
  return {
    doc: { ...doc, sprintId: sprint.id, sprintName: doc.sprintName || sprint.name },
    stored: true,
  };
}

/** The draft, when it holds demo items, feedback or a checklist of the user's. */
export function usableDraft(docs: readonly SprintReview[] | undefined): SprintReview | null {
  const { doc, stored } = viewReview(docs);
  return stored && reviewHasContent(doc) ? doc : null;
}

const many = (n: number, one: string, more: string) => `${n} ${n === 1 ? one : more}`;

/** "3 demo items, 2 pieces of feedback and a checklist of 8". */
export function contentSummary(doc: SprintReview): string {
  const parts = [
    doc.features.length > 0 ? many(doc.features.length, "demo item", "demo items") : "",
    doc.feedbackItems.length > 0
      ? many(doc.feedbackItems.length, "piece of feedback", "pieces of feedback")
      : "",
    doc.checklistItems.length > 0 ? `a checklist of ${doc.checklistItems.length}` : "",
  ].filter(Boolean);
  return parts.length > 0 ? listAnd(parts) : "nothing yet";
}

/**
 * What resetting `doc` deletes, for the confirm: only the parts it has
 * ("This deletes 3 demo items and the review date."). A sprint's review
 * carries the sprint's name by itself, so only the draft's typed name and
 * number are listed.
 */
export function resetSummary(doc: SprintReview): string {
  const typedNumbers = [doc.committed, doc.completed, doc.totalBacklog, doc.backlogDone].some(
    (n) => n > 0
  );
  const naming = doc.sprintId
    ? []
    : [doc.sprintName.trim() && "name", doc.sprintNumber.trim() && "number"].filter(Boolean);
  const parts = [
    doc.features.length > 0 ? many(doc.features.length, "demo item", "demo items") : "",
    doc.feedbackItems.length > 0
      ? many(doc.feedbackItems.length, "piece of feedback", "pieces of feedback")
      : "",
    doc.checklistItems.length > 0 ? `a checklist of ${doc.checklistItems.length}` : "",
    doc.meetingDate.trim() ? "the review date" : "",
    typedNumbers ? "the typed numbers" : "",
    naming.length > 0 ? `the sprint ${naming.join(" and ")}` : "",
  ].filter(Boolean);
  return parts.length > 0
    ? `This deletes ${listAnd(parts)}.`
    : "The review holds nothing yet; resetting deletes it.";
}

/** The longest backlog story title made from a piece of feedback. */
export const FEEDBACK_TITLE_MAX = 120;

/**
 * A piece of feedback as a backlog story's title: one line, cut at a word
 * with an ellipsis when it is long. The story links back to the feedback
 * (its sourceRef), where the full text stays; the backlog would otherwise
 * cut it mid-word at its own limit and say nothing.
 */
export function feedbackStoryTitle(text: string, max = FEEDBACK_TITLE_MAX): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  // A word longer than half the limit is cut where it stands.
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:]+$/, "")}…`;
}

/**
 * `sprint`'s review started from the draft: the draft's demo items,
 * feedback and checklist (copied; the draft stays as it is). Feedback keeps
 * where it was sent, so a story made from it isn't sent twice.
 *
 * The draft's review date and typed numbers stay behind. Most drafts are
 * the old page's starter with an edit or two, so its date is the day of the
 * first visit and its numbers are the starter's made-up 40/36; copied, they
 * would outrank the sprint's own numbers in the verdict and the export.
 */
export function startFromDraft(
  sprintDoc: SprintReview,
  draft: SprintReview,
  sprint: Pick<Sprint, "id" | "name">
): SprintReview {
  return {
    ...sprintDoc,
    id: reviewDocId(sprint.id),
    sprintId: sprint.id,
    sprintName: sprintDoc.sprintName || sprint.name,
    features: draft.features.map((f) => ({ ...f })),
    feedbackItems: draft.feedbackItems.map((f) => ({
      ...f,
      ...(f.sentTo ? { sentTo: f.sentTo.map((l) => ({ ...l })) } : {}),
    })),
    checklistItems: draft.checklistItems.map((c) => ({ ...c })),
  };
}

/* ── Demo items from done stories ────────────────────────────────────── */

/**
 * The demo item made from a story has an id derived from the story's, so
 * the page (and an agent) can tell which done stories are already in the
 * demo without a field the document doesn't have.
 */
export function demoIdFor(storyId: string): string {
  return `story-${storyId}`;
}

/** A demo item for a done story: its title, not timed yet. */
export function featureFromStory(story: Pick<Story, "id" | "title">): DemoFeature {
  return {
    id: demoIdFor(story.id),
    name: story.title.trim(),
    description: "",
    acceptanceCriteria: "",
    timeMinutes: 0,
  };
}

/** The done stories with whether each is in the demo already. */
export function demoCandidates(
  done: readonly Story[],
  features: readonly DemoFeature[]
): { story: Story; inDemo: boolean }[] {
  const ids = new Set(features.map((f) => f.id));
  return done.map((story) => ({ story, inDemo: ids.has(demoIdFor(story.id)) }));
}

/** The review with demo items for `stories` added (those not in it yet). */
export function withStoriesInDemo(doc: SprintReview, stories: readonly Story[]): SprintReview {
  const ids = new Set(doc.features.map((f) => f.id));
  const added = stories.filter((s) => !ids.has(demoIdFor(s.id))).map(featureFromStory);
  return added.length === 0 ? doc : { ...doc, features: [...doc.features, ...added] };
}

/** A demo item's minutes, or null while it isn't timed (0, from the old blank rows). */
export function demoMinutes(f: Pick<DemoFeature, "timeMinutes">): number | null {
  return Number.isFinite(f.timeMinutes) && f.timeMinutes > 0 ? f.timeMinutes : null;
}

/** Total demo minutes and how many items have no time yet. */
export function demoLength(features: readonly DemoFeature[]): {
  minutes: number;
  untimed: number;
} {
  let minutes = 0;
  let untimed = 0;
  for (const f of features) {
    const m = demoMinutes(f);
    if (m === null) untimed++;
    else minutes += m;
  }
  return { minutes, untimed };
}

/* ── Lists ───────────────────────────────────────────────────────────── */

/** A name short enough for a one-line toast or announcement. */
export function shortName(name: string, max = 40): string {
  const t = name.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/**
 * `items` with the one whose id is `id` moved by `delta` places (clamped),
 * the same list when it can't move.
 */
export function moveItem<T extends { id: string }>(
  items: readonly T[],
  id: string,
  delta: number
): T[] {
  const from = items.findIndex((x) => x.id === id);
  if (from === -1) return [...items];
  const to = Math.max(0, Math.min(items.length - 1, from + delta));
  if (to === from) return [...items];
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** The standard checklist as new, unticked items. */
export function standardChecklist(
  labels: readonly string[],
  newId: () => string = () => crypto.randomUUID()
): ChecklistItem[] {
  return labels.map((label) => ({ id: newId(), label, checked: false }));
}
