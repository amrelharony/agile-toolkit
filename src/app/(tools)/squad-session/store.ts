"use client";

import { createPersistedStore } from "@/lib/stores/create-persisted-store";
import type { HandoffLink } from "@/lib/handoffs/types";
import type { Validation } from "@/lib/utils/form";

/**
 * What a session agreed, per episode, so changing the episode loses nothing. Kept
 * in this browser like every tool store (`agile-toolkit:squad-session`), which is
 * how it works for a visitor with no account, and "Clear data" removes it.
 */

export interface SquadAction {
  id: string;
  /** The book episode the session was on. */
  ep: number;
  title: string;
  /** Who will do it. Blank until someone does. */
  owner: string;
  /** Where it was sent, for "Sent · Open" and no second send. */
  sentTo?: HandoffLink[];
}

export interface SquadSessionState {
  actions: SquadAction[];
}

export const useSquadSessionStore = createPersistedStore<SquadSessionState>("squad-session", {
  actions: [],
});

/** The stored rows made safe to use: a synced or hand-edited value can hold anything. */
export function normalizeActions(raw: unknown): SquadAction[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const { id, ep, title, owner, sentTo } = row as Record<string, unknown>;
    if (typeof id !== "string" || typeof ep !== "number" || typeof title !== "string") return [];
    return [
      {
        id,
        ep,
        title,
        owner: typeof owner === "string" ? owner : "",
        ...(Array.isArray(sentTo) ? { sentTo: sentTo as HandoffLink[] } : {}),
      },
    ];
  });
}

export function setActions(fn: (list: readonly SquadAction[]) => SquadAction[]): void {
  useSquadSessionStore.setState((s) => ({ actions: fn(normalizeActions(s.actions)) }));
}

export const ACTION_TITLE_MAX = 200;
export const ACTION_OWNER_MAX = 80;

export interface ActionDraft {
  title: string;
  owner: string;
}

export const EMPTY_ACTION: ActionDraft = { title: "", owner: "" };

/** A title is what makes it an action. The owner can be settled later. */
export function validateAction(draft: ActionDraft): Validation<ActionDraft, keyof ActionDraft> {
  const title = draft.title.trim();
  const owner = draft.owner.trim();
  if (!title) return { ok: false, errors: { title: "Say what the team will do." } };
  if (title.length > ACTION_TITLE_MAX) {
    return { ok: false, errors: { title: `Keep it under ${ACTION_TITLE_MAX} characters.` } };
  }
  if (owner.length > ACTION_OWNER_MAX) {
    return { ok: false, errors: { owner: `Keep it under ${ACTION_OWNER_MAX} characters.` } };
  }
  return { ok: true, values: { title, owner } };
}
