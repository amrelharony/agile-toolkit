"use client";

/**
 * Editor card for one post-mortem: status select + delete, summary, contributing
 * factors, incident timeline, and action items. All mutations bubble up through
 * the parent-supplied callbacks (the parent owns the synced store).
 */

import { useEffect, useId, useMemo, useState } from "react";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, ScrollText, ListChecks, X } from "lucide-react";
import type { ActionItem, PMStatus, PostMortem } from "../types";
import { STATUS_BADGE } from "../constants";
import { isOverdue, sortByEventTime } from "../helpers";
import { ActionItemRow } from "./action-item-row";

export function PostMortemEditor({
  pm,
  onUpdate,
  onSetStatus,
  onRemove,
  onAddFactor,
  onRemoveFactor,
  onAddTimelineEntry,
  onRemoveTimelineEntry,
  onAddAction,
  onUpdateAction,
  onRemoveAction,
}: {
  pm: PostMortem;
  onUpdate: (patch: Partial<PostMortem>) => void;
  onSetStatus: (s: PMStatus) => void;
  onRemove: () => void;
  onAddFactor: (text: string) => void;
  onRemoveFactor: (idx: number) => void;
  /** `eventTime` is a `datetime-local` value; undefined means now. */
  onAddTimelineEntry: (author: string, text: string, eventTime?: string) => void;
  onRemoveTimelineEntry: (id: string) => void;
  onAddAction: (text: string) => void;
  onUpdateAction: (id: string, patch: Partial<ActionItem>) => void;
  onRemoveAction: (id: string) => void;
}) {
  const [summaryDraft, setSummaryDraft] = useState(pm.summary ?? "");
  const summaryId = useId();
  useEffect(() => setSummaryDraft(pm.summary ?? ""), [pm.summary]);

  const [factorDraft, setFactorDraft] = useState("");
  const [tlAuthor, setTlAuthor] = useState("");
  const [tlText, setTlText] = useState("");
  // When the event happened (datetime-local). Blank = now.
  const [tlTime, setTlTime] = useState("");
  const tlTimeHintId = useId();
  const [actionDraft, setActionDraft] = useState("");

  const openCount = pm.actions.filter((a) => a.status !== "done").length;
  const timeline = useMemo(() => sortByEventTime(pm.timeline), [pm.timeline]);

  const submitTimelineEntry = () => {
    if (!tlText.trim()) return;
    onAddTimelineEntry(tlAuthor, tlText, tlTime || undefined);
    setTlText("");
    setTlTime("");
  };

  return (
    <SectionCard
      title={pm.title}
      icon={ScrollText}
      titleSize="lg"
      titleSuffix={
        <Badge variant="outline" className={STATUS_BADGE[pm.status]}>
          {pm.status}
        </Badge>
      }
      actions={
        <div className="flex items-center gap-2">
          <Select value={pm.status} onValueChange={(v) => onSetStatus(v as PMStatus)}>
            <SelectTrigger
              className="h-8 w-32 text-xs bg-surface border-border"
              aria-label={`Status for ${pm.title}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="review">In review</SelectItem>
              <SelectItem value="published">Published</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="sm"
            onClick={onRemove}
            aria-label={`Delete ${pm.title}`}
            className="h-8 w-8 p-0 text-sub hover:text-danger min-touch-coarse"
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" />
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="text-xs text-sub flex items-center gap-3">
          <span>
            Incident date: <span className="font-data text-text">{pm.incidentDate}</span>
          </span>
          <span>
            {pm.actions.length} actions · {openCount} open
          </span>
        </div>
        {pm.description && (
          <p className="text-xs text-sub whitespace-pre-wrap break-words">{pm.description}</p>
        )}

        <div>
          <Label htmlFor={summaryId} className="text-xs text-sub">
            Summary
          </Label>
          <Textarea
            id={summaryId}
            value={summaryDraft}
            onChange={(e) => setSummaryDraft(e.target.value)}
            onBlur={() => {
              if (summaryDraft.trim() !== (pm.summary ?? "")) {
                onUpdate({ summary: summaryDraft.trim() || undefined });
              }
            }}
            placeholder="What happened, in plain language. Skip blame."
            rows={4}
            className="bg-surface border-border resize-y text-xs min-h-[100px]"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs uppercase tracking-wider text-sub flex items-center gap-1">
              <ListChecks className="w-3.5 h-3.5" aria-hidden="true" />
              Contributing factors
            </span>
          </div>
          {pm.contributingFactors.length === 0 ? (
            <p className="text-xs text-sub italic mb-2">
              Add at least 2-3 factors. A single &apos;root cause&apos; usually means the real story
              isn&apos;t told yet.
            </p>
          ) : (
            <ul className="space-y-1.5 mb-2">
              {pm.contributingFactors.map((f, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 p-2 rounded-md border border-border bg-bg text-xs"
                >
                  <span className="font-data text-sub shrink-0">{i + 1}.</span>
                  <span className="flex-1 text-text whitespace-pre-wrap break-words">{f}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRemoveFactor(i)}
                    className="h-6 w-6 p-0 text-sub hover:text-danger min-touch-coarse"
                    aria-label={`Remove factor ${i + 1}`}
                  >
                    <X className="w-3 h-3" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              value={factorDraft}
              onChange={(e) => setFactorDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onAddFactor(factorDraft);
                  setFactorDraft("");
                }
              }}
              placeholder="A contributing factor…"
              className="bg-surface border-border flex-1"
              aria-label="New contributing factor"
            />
            <Button
              onClick={() => {
                onAddFactor(factorDraft);
                setFactorDraft("");
              }}
              variant="outline"
              className="border-border text-sub hover:text-accent hover:border-accent/40"
            >
              <Plus className="w-4 h-4 mr-1" aria-hidden="true" /> Factor
            </Button>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs uppercase tracking-wider text-sub">
              Timeline ({pm.timeline.length})
            </span>
          </div>
          {pm.timeline.length === 0 && (
            <p className="text-xs text-sub italic mb-2">
              Reconstruct the incident timeline. One line per significant event.
            </p>
          )}
          {timeline.length > 0 && (
            <ul className="space-y-1.5 mb-2 max-h-48 overflow-y-auto pr-2">
              {timeline.map((e) => (
                <li
                  key={e.id}
                  className="text-xs border-l-2 border-accent/40 pl-2 flex items-start gap-2"
                >
                  <div className="flex-1">
                    <span className="font-data text-sub mr-2">
                      {new Date(e.ts).toLocaleString()}
                    </span>
                    <span className="text-accent mr-2">{e.author}:</span>
                    <span className="text-text whitespace-pre-wrap break-words">{e.text}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRemoveTimelineEntry(e.id)}
                    className="h-6 w-6 p-0 text-sub hover:text-danger min-touch-coarse"
                    aria-label={`Remove timeline entry: ${e.text}`}
                  >
                    <X className="w-3 h-3" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              value={tlAuthor}
              onChange={(e) => setTlAuthor(e.target.value)}
              placeholder="Author"
              className="bg-surface border-border sm:w-32"
              aria-label="Timeline entry author"
            />
            <Input
              type="datetime-local"
              value={tlTime}
              onChange={(e) => setTlTime(e.target.value)}
              className="bg-surface border-border font-data sm:w-52"
              aria-label="Event time"
              aria-describedby={tlTimeHintId}
            />
            <Input
              value={tlText}
              onChange={(e) => setTlText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitTimelineEntry();
              }}
              placeholder="What happened…"
              className="bg-surface border-border flex-1"
              aria-label="Timeline entry text"
            />
            <Button
              onClick={submitTimelineEntry}
              variant="outline"
              className="border-border text-sub hover:text-accent hover:border-accent/40"
            >
              <Plus className="w-4 h-4 mr-1" aria-hidden="true" /> Entry
            </Button>
          </div>
          <p id={tlTimeHintId} className="text-xs text-sub mt-1">
            Event time is when it happened. Leave it blank to use the current time. The timeline
            sorts by event time.
          </p>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs uppercase tracking-wider text-sub">
              Action items ({pm.actions.length})
            </span>
          </div>
          {pm.actions.length > 0 && (
            <ul className="space-y-2 mb-2">
              {pm.actions.map((a) => (
                <ActionItemRow
                  key={a.id}
                  action={a}
                  overdue={isOverdue(a)}
                  onUpdate={(patch) => onUpdateAction(a.id, patch)}
                  onRemove={() => onRemoveAction(a.id)}
                />
              ))}
            </ul>
          )}
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              value={actionDraft}
              onChange={(e) => setActionDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onAddAction(actionDraft);
                  setActionDraft("");
                }
              }}
              placeholder="A follow-up action…"
              className="bg-surface border-border flex-1"
              aria-label="New action item"
            />
            <Button
              onClick={() => {
                onAddAction(actionDraft);
                setActionDraft("");
              }}
              variant="outline"
              className="border-border text-sub hover:text-accent hover:border-accent/40"
            >
              <Plus className="w-4 h-4 mr-1" aria-hidden="true" /> Action
            </Button>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}
