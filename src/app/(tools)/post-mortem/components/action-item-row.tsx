"use client";

/**
 * One action-item row inside a post-mortem editor: done checkbox, editable
 * text, status badge, and owner/due/status controls. Edits commit on blur;
 * unchecking "done" falls back to in_progress rather than open.
 */

import { useEffect, useState } from "react";
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
import { Trash2 } from "lucide-react";
import type { ActionItem, ActionStatus } from "../types";
import { ACTION_STATUS_BADGE } from "../constants";

export function ActionItemRow({
  action,
  overdue,
  onUpdate,
  onRemove,
}: {
  action: ActionItem;
  overdue: boolean;
  onUpdate: (patch: Partial<ActionItem>) => void;
  onRemove: () => void;
}) {
  const [textDraft, setTextDraft] = useState(action.text);
  const [ownerDraft, setOwnerDraft] = useState(action.owner ?? "");
  const [dueDraft, setDueDraft] = useState(action.dueDate ?? "");
  useEffect(() => setTextDraft(action.text), [action.text]);
  useEffect(() => setOwnerDraft(action.owner ?? ""), [action.owner]);
  useEffect(() => setDueDraft(action.dueDate ?? ""), [action.dueDate]);

  return (
    <li
      className={`p-2 rounded-md border ${
        overdue ? "border-danger/40 bg-danger/5" : "border-border bg-bg"
      } space-y-2`}
    >
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={action.status === "done"}
          onChange={(e) => {
            // Unchecking from done shouldn't drop work back to "open" — if
            // it had been in_progress before, prefer that. Use in_progress
            // as the safer fallback for "uncheck after marking done".
            if (e.target.checked) {
              onUpdate({ status: "done" });
            } else {
              onUpdate({
                status: action.status === "done" ? "in_progress" : "open",
              });
            }
          }}
          aria-label={`Toggle done for ${action.text}`}
          className="mt-1 shrink-0 accent-emerald-400 min-touch-coarse"
        />
        <Textarea
          value={textDraft}
          onChange={(e) => setTextDraft(e.target.value)}
          onBlur={() => {
            const next = textDraft.trim();
            if (next && next !== action.text) onUpdate({ text: next });
            else if (!next) setTextDraft(action.text);
          }}
          rows={2}
          className="bg-surface border-border resize-y text-xs flex-1 min-h-[44px]"
          aria-label="Action text"
        />
        <Badge variant="outline" className={ACTION_STATUS_BADGE[action.status]}>
          {action.status === "in_progress" ? "wip" : action.status}
        </Badge>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRemove}
          className="h-6 w-6 p-0 text-sub hover:text-danger min-touch-coarse"
          aria-label="Remove action"
        >
          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
        </Button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div>
          <Label className="text-xs uppercase tracking-wider text-sub">Owner</Label>
          <Input
            value={ownerDraft}
            onChange={(e) => setOwnerDraft(e.target.value)}
            onBlur={() => {
              const next = ownerDraft.trim();
              if (next !== (action.owner ?? "")) {
                onUpdate({ owner: next || undefined });
              }
            }}
            placeholder="@owner"
            className="bg-surface border-border h-8 text-xs"
            aria-label="Owner"
          />
        </div>
        <div>
          <Label className="text-xs uppercase tracking-wider text-sub">Due</Label>
          <Input
            type="date"
            value={dueDraft}
            onChange={(e) => setDueDraft(e.target.value)}
            onBlur={() => {
              if (dueDraft !== (action.dueDate ?? "")) {
                onUpdate({ dueDate: dueDraft || undefined });
              }
            }}
            className="bg-surface border-border font-data h-8 text-xs"
            aria-label="Due date"
          />
        </div>
        <div>
          <Label className="text-xs uppercase tracking-wider text-sub">Status</Label>
          <Select
            value={action.status}
            onValueChange={(v) => onUpdate({ status: v as ActionStatus })}
          >
            <SelectTrigger
              className="h-8 text-xs bg-surface border-border"
              aria-label="Action status"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="in_progress">In progress</SelectItem>
              <SelectItem value="done">Done</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </li>
  );
}
