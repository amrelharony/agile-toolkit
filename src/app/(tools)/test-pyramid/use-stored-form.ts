"use client";

import { useEffect, useRef } from "react";
import {
  useItemForm,
  type ItemFormState,
  type UseItemFormOptions,
} from "@/components/shared/item-form";

/**
 * useItemForm for a form that stays on screen and edits a stored value in
 * place: the pyramid's counts and minutes, Code Review's working hours.
 *
 * Keying such a form on the stored value remounted it on every save, its
 * own included, so the focused Save button went with it and a keyboard or
 * screen-reader user was dropped on the page body; a save by an agent or
 * another device also threw away what the person was typing. Here the form
 * stays mounted and its draft follows the stored value when that changes,
 * but only while the draft holds nothing unsaved (it is what was stored
 * before, or what this form just saved). Unsaved typing is never replaced.
 */
export function useStoredItemForm<D extends object, V, K extends string>(
  stored: D,
  options: Omit<UseItemFormOptions<D, V, K>, "initial" | "resetOnSave">
): ItemFormState<D, K> {
  const savedDraft = useRef<string | null>(null);
  const form = useItemForm<D, V, K>({
    initial: () => stored,
    validate: options.validate,
    onSave: (values, draft) => {
      savedDraft.current = JSON.stringify(draft);
      options.onSave(values, draft);
    },
    resetOnSave: false,
  });

  const key = JSON.stringify(stored);
  const seen = useRef(key);
  const { draft, reset } = form;
  useEffect(() => {
    if (key === seen.current) return;
    const now = JSON.stringify(draft);
    const clean = now === seen.current || now === savedDraft.current;
    seen.current = key;
    savedDraft.current = null;
    if (clean) reset(stored);
  }, [key, stored, draft, reset]);

  return form;
}
