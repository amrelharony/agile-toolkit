"use client";

/**
 * A wall typed in by hand: for sticky notes on a real wall, answers from a
 * chat, or a room without live rooms. The question, then one answer per
 * line. Nothing is saved until both are there and within the caps.
 */

import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { focusFirstInvalid } from "@/lib/utils/form";
import {
  WALL_KIND_LABEL,
  WALL_PROMPT_MAX,
  draftLines,
  validateWallDraft,
  type WallDraft,
  type WallDraftErrors,
  type WallKind,
} from "@/lib/audience-wall/model";

const EMPTY: WallDraft = { prompt: "", posts: "" };

export function ManualWallForm({
  kind,
  onSave,
}: {
  kind: WallKind;
  /** Store the draft; it's valid. */
  onSave: (draft: WallDraft) => void;
}) {
  const [draft, setDraft] = useState<WallDraft>(EMPTY);
  const [errors, setErrors] = useState<WallDraftErrors>({});
  const lines = draftLines(draft.posts).length;

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const found = validateWallDraft(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      // Once the errors are on screen.
      const form = e.currentTarget;
      window.setTimeout(() => focusFirstInvalid(form), 0);
      return;
    }
    onSave(draft);
    setDraft(EMPTY);
  };

  const set = (key: keyof WallDraft, value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
    if (errors[key]) setErrors((x) => ({ ...x, [key]: undefined }));
  };

  return (
    <form noValidate onSubmit={submit} className="space-y-3">
      <Field label="Question" error={errors.prompt} required>
        {(props) => (
          <Input
            {...props}
            value={draft.prompt}
            maxLength={WALL_PROMPT_MAX + 20}
            onChange={(e) => set("prompt", e.target.value)}
          />
        )}
      </Field>
      <Field label="Answers" hint={`One per line. ${lines} so far.`} error={errors.posts} required>
        {(props) => (
          <Textarea
            {...props}
            rows={5}
            value={draft.posts}
            onChange={(e) => set("posts", e.target.value)}
          />
        )}
      </Field>
      <Button type="submit" variant="outline" className="gap-1.5">
        <Plus className="h-4 w-4" aria-hidden="true" />
        Save as {WALL_KIND_LABEL[kind].toLowerCase()}
      </Button>
    </form>
  );
}
