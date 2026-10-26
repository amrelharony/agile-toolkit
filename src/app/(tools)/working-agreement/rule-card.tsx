"use client";

import { ChevronDown, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/icon-button";
import { ToggleGroup, type ToggleOption } from "@/components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InlineItemEditor, useInlineEdit } from "@/components/shared/inline-item-editor";
import { SendToMenu } from "@/components/handoff/send-to-menu";
import type { HandoffLink } from "@/lib/handoffs/types";
import type {
  CharterConsentVote,
  CharterRule,
  CharterRuleCategory,
} from "@/lib/stores/workspace-types";
import {
  RULE_DESCRIPTION_MAX,
  RULE_TEXT_MAX,
  WA_ID,
  consentLine,
  consentOf,
} from "@/lib/working-agreement/model";
import { cn } from "@/lib/utils";
import { CATEGORIES, CATEGORY_CLASS, CATEGORY_LABEL } from "./catalog";
import { ConsentPanel } from "./consent-panel";

type Mark = "unset" | "working" | "not_working";

const MARK_OPTIONS: ToggleOption<Mark>[] = [
  { value: "unset", label: "Not checked", description: "Not checked in this round" },
  { value: "working", label: "Working", description: "The team works this way in practice" },
  { value: "not_working", label: "Not working", description: "It slips, or nobody follows it" },
];

const markOf = (r: Pick<CharterRule, "stillWorking">): Mark =>
  r.stillWorking === true ? "working" : r.stillWorking === false ? "not_working" : "unset";

export interface RuleCardProps {
  rule: CharterRule;
  roster: readonly { id: string; name: string }[];
  /** The page shows the example: nothing is sent or added to the team. */
  preview: boolean;
  /** Latest rounds in a row that found it not working (notWorkingStreak). */
  notWorking: number;
  /** Where it was sent: the current retro's cards that point back at it. */
  sentTo: HandoffLink[];
  onText: (rule: CharterRule, text: string, description: string | undefined) => void;
  onCategory: (rule: CharterRule, category: CharterRuleCategory) => void;
  onMark: (rule: CharterRule, stillWorking: boolean | undefined) => void;
  onVote: (rule: CharterRule, name: string, vote: CharterConsentVote | null, note?: string) => void;
  onDelete: (rule: CharterRule) => void;
}

/**
 * One rule: its text and description (click to edit in place; an emptied
 * text reverts), its category, this round's check-in mark, everyone's
 * consent, and Delete (with Undo). A rule the last check-in found not
 * working can go to the retro as a topic.
 */
export function RuleCard({
  rule,
  roster,
  preview,
  notWorking,
  sentTo,
  onText,
  onCategory,
  onMark,
  onVote,
  onDelete,
}: RuleCardProps) {
  const edit = useInlineEdit();
  const consent = consentOf(rule, roster);
  const line = consentLine(consent);

  return (
    <li className="space-y-2 rounded-lg border border-border bg-surface p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {edit.editing ? (
            <InlineItemEditor
              label="Edit rule"
              title={rule.text}
              titleLabel="Rule text"
              titleMaxLength={RULE_TEXT_MAX}
              withDescription
              description={rule.description}
              descriptionLabel="Rule description"
              descriptionMaxLength={RULE_DESCRIPTION_MAX}
              onDone={(next, { refocus }) => {
                edit.stop({ refocus });
                if (next) onText(rule, next.title, next.description);
              }}
            />
          ) : (
            <button
              ref={edit.triggerRef}
              type="button"
              onClick={edit.start}
              title="Click to edit"
              className="block w-full cursor-text break-words rounded-sm text-left text-sm text-text transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
              <span className="font-medium">{rule.text}</span>
              {rule.description && (
                <span className="mt-0.5 block whitespace-pre-wrap text-xs text-sub">
                  {rule.description}
                </span>
              )}
              <span className="sr-only"> (edit)</span>
            </button>
          )}
        </div>
        <IconButton
          label={`Delete “${rule.text}”`}
          icon={<Trash2 className="h-4 w-4" />}
          className="h-9 w-9 shrink-0 text-sub hover:text-danger"
          onClick={() => onDelete(rule)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={rule.category}
          onValueChange={(v) => onCategory(rule, v as CharterRuleCategory)}
        >
          <SelectTrigger
            aria-label={`Category of “${rule.text}”`}
            className="h-8 w-auto min-w-[9rem] gap-2 text-xs"
          >
            <SelectValue>
              <Badge variant="outline" className={cn("text-xs", CATEGORY_CLASS[rule.category])}>
                {CATEGORY_LABEL[rule.category]}
              </Badge>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ToggleGroup
          label={`This round: “${rule.text}”`}
          size="sm"
          value={markOf(rule)}
          options={MARK_OPTIONS}
          onValueChange={(m) => onMark(rule, m === "unset" ? undefined : m === "working")}
        />
      </div>

      {notWorking > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-medium text-warning">
            {notWorking >= 2
              ? `Not working in the last ${notWorking} check-ins`
              : "Not working in the last check-in"}
          </span>
          <SendToMenu
            routes={["retro-topic"]}
            disabled={preview}
            item={{
              title: `Working agreement: “${rule.text}” isn't working`,
              tone: "concern",
              sourceRef: { tool: "working-agreement", id: rule.id, doc: WA_ID },
            }}
            sentTo={sentTo}
            // The link is read back from the retro card's sourceRef, so the
            // rule itself stores nothing.
            onLinksChange={() => undefined}
            itemLabels={{ "retro-topic": "Retro topic" }}
          />
        </div>
      )}

      <details className="group rounded-md border border-border bg-card">
        <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs [&::-webkit-details-marker]:hidden">
          <span
            className={cn(
              "min-w-0 flex-1",
              consent.objections.length > 0
                ? "text-danger"
                : consent.full
                  ? "text-success"
                  : "text-sub"
            )}
          >
            <span className="font-medium text-text">Consent: </span>
            {line}
          </span>
          <ChevronDown
            className="h-4 w-4 shrink-0 text-sub transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <div className="border-t border-border px-3 py-2">
          <ConsentPanel
            rule={rule}
            roster={roster}
            offerAddToRoster={!preview}
            onVote={(name, vote, note) => onVote(rule, name, vote, note)}
          />
        </div>
      </details>
    </li>
  );
}
