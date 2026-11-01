"use client";

/**
 * An item's name and description, edited in place: each saves when the
 * field is left (or on Enter for the name) and only after an edit. A name
 * can't be emptied: blanking it puts the name back and says so, instead of
 * quietly keeping a field that no longer matches what's saved. Escape
 * drops the edit.
 */

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { BlurTextarea } from "@/components/shared/blur-fields";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { NAME_MAX } from "../hub-form";
import { itemName } from "../method-text";

export function NameCell({
  name,
  description,
  onRename,
  onDescribe,
}: {
  name: string;
  description?: string;
  onRename: (name: string) => void;
  onDescribe: (description: string | undefined) => void;
}) {
  const announce = useAnnounce();
  const [draft, setDraft] = useState(name);
  const [note, setNote] = useState<string | null>(null);
  // Escape blurs the field too: the blur that follows must not save.
  const cancelled = useRef(false);
  useEffect(() => setDraft(name), [name]);
  const label = itemName(name);

  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const next = draft.trim().replace(/\s+/g, " ");
    if (next === name) return;
    if (!next) {
      setDraft(name);
      setNote("A name can't be empty, so it was kept.");
      announce(`A name can't be empty: kept “${label}”.`);
      return;
    }
    setNote(null);
    onRename(next.slice(0, NAME_MAX));
  };

  return (
    <div className="flex min-w-0 flex-col gap-1.5 md:min-w-[12rem]">
      <Input
        value={draft}
        maxLength={NAME_MAX}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            cancelled.current = true;
            setDraft(name);
            e.currentTarget.blur();
          }
        }}
        aria-label={`Name of ${label}`}
        className="h-8 bg-surface-deep text-sm"
      />
      {note && <p className="text-xs text-warning">{note}</p>}
      <BlurTextarea
        value={description ?? ""}
        onCommit={(v) => onDescribe(v.trim() ? v : undefined)}
        placeholder="Description (optional)"
        rows={2}
        className="resize-none bg-surface-deep text-xs"
        aria-label={`Description of ${label}`}
      />
    </div>
  );
}
