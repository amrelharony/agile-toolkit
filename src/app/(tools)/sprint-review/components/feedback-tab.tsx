"use client";

/**
 * Tab 2 — Stakeholder Feedback. The review's date (backdatable), a form
 * that records nothing until who, what kind and what are filled in, the
 * feedback edited in place, and a summary by category. A piece of
 * feedback becomes a backlog story through the backlog-story hand-off
 * (never from the example), and the item then links to that story.
 */

import { useState } from "react";
import Link from "next/link";
import { BookCheck, MessageSquare, Pencil, Trash2 } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { SendToMenu } from "@/components/handoff/send-to-menu";
import { SectionCard } from "@/components/shared/section-card";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { SPRINT_REVIEW_ACTIONS } from "@/lib/history/event-actions";
import { getHandoffRoute, liveLink } from "@/lib/handoffs/registry";
import type { HandoffLink, HandoffSource } from "@/lib/handoffs/types";
import { cn } from "@/lib/utils";
import { removeWithUndo } from "@/lib/utils/undoable";
import type { Story } from "@/lib/stores/workspace-types";
import {
  CATEGORY_COLORS,
  CATEGORY_HEADINGS,
  CATEGORY_LABELS,
  CATEGORY_RULE,
  FEEDBACK_CATEGORIES,
} from "../constants";
import { isFeedbackCategory, shortName } from "../doc";
import { STORY_STATUS_LABEL, dayLabel } from "../markdown";
import type { FeedbackItem, ReviewSource } from "../types";
import { FeedbackAddForm, FeedbackEditor, type FeedbackValues } from "./feedback-form";

const ROUTES = ["backlog-story"] as const;

/** One line of the feedback, as a backlog story's title. */
const asTitle = (text: string) => text.replace(/\s+/g, " ").trim();

export function FeedbackTab({ source }: { source: ReviewSource }) {
  const { doc, writer, sprint, example, stored } = source;
  const items = doc.feedbackItems;
  const { log } = useHistoryLogger("sprint-review");
  const announce = useAnnounce();
  const [editingId, setEditingId] = useState<string | null>(null);

  const updateItems = (fn: (list: readonly FeedbackItem[]) => FeedbackItem[]) =>
    writer.update((d) => ({ ...d, feedbackItems: fn(d.feedbackItems) }));

  function setMeetingDate(value: string) {
    if (value === doc.meetingDate) return;
    // Clearing the date of a review that doesn't exist yet isn't an edit.
    if (!value && !stored) return;
    writer.update((d) => ({ ...d, meetingDate: value }));
  }

  function add(values: FeedbackValues) {
    updateItems((list) => [...list, { id: crypto.randomUUID(), ...values }]);
    // Cross-tool consumers (the "Last 30 days" banner) read this event.
    if (!example) log(SPRINT_REVIEW_ACTIONS.FEEDBACK_ADDED, { category: values.category });
    announce(
      `Recorded ${CATEGORY_LABELS[values.category].toLowerCase()} feedback from ${values.stakeholder}.`
    );
  }

  function save(item: FeedbackItem, values: FeedbackValues) {
    setEditingId(null);
    updateItems((list) => list.map((f) => (f.id === item.id ? { ...f, ...values } : f)));
  }

  function remove(item: FeedbackItem) {
    removeWithUndo<FeedbackItem>({
      label: item.stakeholder.trim()
        ? `Deleted feedback from ${shortName(item.stakeholder)}`
        : "Deleted feedback",
      update: updateItems,
      match: (f) => f.id === item.id,
    });
  }

  /** Record where an item was sent (the send, or its Undo). */
  const setLinks =
    (item: FeedbackItem) =>
    (update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]) =>
      updateItems((list) =>
        list.map((f) => (f.id === item.id ? { ...f, sentTo: update(f.sentTo) } : f))
      );

  const handoff = (item: FeedbackItem): HandoffSource => ({
    title: asTitle(item.feedback),
    description: `${isFeedbackCategory(item.category) ? CATEGORY_LABELS[item.category] : "Feedback"} from ${item.stakeholder.trim() || "a stakeholder"} at the ${sprint ? `${sprint.name} ` : ""}review.`,
    sourceRef: { tool: "sprint-review", id: item.id, doc: doc.id },
  });

  const written = items.filter((f) => f.feedback.trim());
  const hint = sprint
    ? `${sprint.name} ends ${dayLabel(sprint.endDate) ?? "on its last day"}. Backdate it if the review has already happened.`
    : "Backdate it if the review has already happened.";

  return (
    <div className="space-y-6">
      <SectionCard title="Feedback" icon={MessageSquare} contentClassName="space-y-5">
        <Field label="Review date" hint={hint} className="max-w-xs">
          {(props) => (
            <Input
              {...props}
              type="date"
              value={doc.meetingDate}
              onChange={(e) => setMeetingDate(e.target.value)}
            />
          )}
        </Field>

        {items.length === 0 ? (
          <p className="text-sm text-sub">
            No feedback yet. Write down what stakeholders say as they see the increment.
          </p>
        ) : (
          <ul className="space-y-3" aria-label="Feedback">
            {items.map((item) => (
              <li key={item.id} className="rounded-lg border border-border bg-surface-deep/50 p-3">
                {editingId === item.id ? (
                  <FeedbackEditor
                    item={item}
                    onSave={(values) => save(item, values)}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <FeedbackRow
                    item={item}
                    stories={source.stories}
                    canSend={!example}
                    handoff={handoff(item)}
                    onLinksChange={setLinks(item)}
                    getLinks={() =>
                      writer.read().feedbackItems.find((f) => f.id === item.id)?.sentTo
                    }
                    onEdit={() => setEditingId(item.id)}
                    onRemove={() => remove(item)}
                  />
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="border-t border-border pt-4">
          <h3 className="mb-3 text-sm font-medium text-text">Add feedback</h3>
          <FeedbackAddForm onAdd={add} />
        </div>
      </SectionCard>

      {written.length > 0 && (
        <SectionCard title="Feedback by kind" contentClassName="space-y-5">
          {FEEDBACK_CATEGORIES.map((cat) => {
            const group = written.filter((f) => f.category === cat);
            if (group.length === 0) return null;
            return (
              <section key={cat} aria-label={CATEGORY_HEADINGS[cat]}>
                <div className="mb-2 flex items-center gap-2">
                  <Badge className={cn("border text-xs", CATEGORY_COLORS[cat])}>
                    {CATEGORY_HEADINGS[cat]}
                  </Badge>
                  <span className="text-xs text-sub">
                    {group.length} {group.length === 1 ? "item" : "items"}
                  </span>
                </div>
                <ul className="space-y-2 pl-1">
                  {group.map((item) => (
                    <li key={item.id} className={cn("border-l-2 py-1 pl-3", CATEGORY_RULE[cat])}>
                      <p className="mb-0.5 text-xs text-sub">
                        {item.stakeholder.trim() || "Unnamed stakeholder"}
                      </p>
                      <p className="break-words text-sm text-text">{item.feedback}</p>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </SectionCard>
      )}
    </div>
  );
}

/** One piece of feedback: kind, who and what, where it went, actions. */
function FeedbackRow({
  item,
  stories,
  canSend,
  handoff,
  onLinksChange,
  getLinks,
  onEdit,
  onRemove,
}: {
  item: FeedbackItem;
  stories: readonly Story[];
  canSend: boolean;
  handoff: HandoffSource;
  onLinksChange: (update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]) => void;
  getLinks: () => readonly HandoffLink[] | undefined;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const category = isFeedbackCategory(item.category) ? item.category : null;
  const who = item.stakeholder.trim() || "Unnamed stakeholder";
  const link = canSend ? liveLink(item.sentTo, "backlog-story") : undefined;
  const story = link ? stories.find((s) => s.id === link.targetId) : undefined;
  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
      <div className="min-w-0 flex-1 basis-56 space-y-1">
        <p className="flex flex-wrap items-center gap-2 text-xs text-sub">
          {category ? (
            <Badge className={cn("border text-xs", CATEGORY_COLORS[category])}>
              {CATEGORY_LABELS[category]}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs">
              Not categorised
            </Badge>
          )}
          <span className={item.stakeholder.trim() ? "text-text" : "italic"}>{who}</span>
        </p>
        <p
          className={cn(
            "break-words text-sm",
            item.feedback.trim() ? "text-text" : "italic text-sub"
          )}
        >
          {item.feedback.trim() || "Nothing written yet"}
        </p>
        {link && (
          <Link
            href={getHandoffRoute("backlog-story").targetHref(link.targetId)}
            className="inline-flex items-center gap-1 text-xs text-success underline-offset-2 hover:underline"
          >
            <BookCheck className="h-3.5 w-3.5" aria-hidden="true" />
            {story ? `On the backlog: “${shortName(story.title, 60)}”` : "On the backlog"}
            {story &&
              story.status !== "backlog" &&
              ` · ${STORY_STATUS_LABEL[story.status] ?? story.status}`}
          </Link>
        )}
      </div>
      <span className="flex shrink-0 flex-wrap items-center">
        {canSend && item.feedback.trim() && (
          <SendToMenu
            routes={ROUTES}
            item={handoff}
            sentTo={item.sentTo}
            onLinksChange={onLinksChange}
            getLinks={getLinks}
            itemLabels={{ "backlog-story": "Backlog story" }}
          />
        )}
        <IconButton
          label={`Edit feedback from ${who}`}
          icon={<Pencil className="h-4 w-4" />}
          className="text-sub hover:text-text"
          onClick={onEdit}
        />
        <IconButton
          label={`Delete feedback from ${who}`}
          icon={<Trash2 className="h-4 w-4" />}
          className="text-sub hover:text-danger"
          onClick={onRemove}
        />
      </span>
    </div>
  );
}
