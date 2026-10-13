"use client";

/**
 * Reaction toggle hook (Phase 5).
 *
 * Returns an `addReaction(kudosId, emoji)` that:
 *   1. Optimistically appends `{ emoji, byProfileId, at }` to the kudos
 *      row's `reactions[]` in the workspace store. If the same emoji is
 *      already present from the same profile the optimistic step skips
 *      (idempotent client-side, mirroring the RPC's idempotency on
 *      `(profile, emoji)`).
 *   2. POSTs to `/api/kudos/[id]/reactions` with `{ emoji }`.
 *   3. On non-200 response: rolls back the optimistic append + surfaces
 *      a sonner toast. The wall stays responsive throughout; the row's
 *      reactions revert to whatever they were before the click.
 *
 * Identity: owners react under their auth user id (the Phase 1 route
 * normalises owner squad-profile attribution server-side). Without auth
 * we still construct an attribution string from the room's local userId
 * — defensive so the optimistic state is well-formed even pre-login.
 *
 * Visitors (anyone but the verified owner) stop after step 1: the
 * reactions API is owner-only, so their reaction lives in this browser's
 * workspace store and there is nothing to roll back.
 */

import { useCallback } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { useAuthOptional } from "@/lib/auth/auth-provider";
import { useIsOwner } from "@/lib/auth/use-is-owner";
import { toast } from "@/lib/utils/toast";
import type { Kudos, KudosReaction } from "@/lib/stores/workspace-types";

export interface UseKudosReactionsHook {
  /** Returns a stable promise — caller can `void`-ignore or await. */
  addReaction: (kudosId: string, emoji: string) => Promise<void>;
}

export function useKudosReactions(): UseKudosReactionsHook {
  const auth = useAuthOptional();
  const isOwner = useIsOwner();
  const kudosList = useWorkspaceStore((s) => s.kudos ?? EMPTY);
  const upsertKudos = useWorkspaceStore((s) => s.upsertKudos);

  const addReaction = useCallback(
    async (kudosId: string, emoji: string) => {
      const trimmed = emoji.trim();
      if (!trimmed) return;
      const target = kudosList.find((k) => k.id === kudosId);
      if (!target) return;

      const byProfileId = auth?.user?.id ?? "anon";
      const existing = target.reactions ?? [];
      // Client-side idempotency: if the local viewer already reacted
      // with this emoji, the click is a no-op (the RPC is idempotent
      // on (profile, emoji), but we don't even want the network round
      // trip — and we definitely don't want to add a duplicate row to
      // the optimistic state).
      const already = existing.some((r) => r.byProfileId === byProfileId && r.emoji === trimmed);
      if (already) return;

      const optimistic: KudosReaction = {
        emoji: trimmed,
        byProfileId,
        at: new Date().toISOString(),
      };
      const optimisticKudos: Kudos = {
        ...target,
        reactions: [...existing, optimistic],
      };
      upsertKudos(optimisticKudos);
      if (!isOwner) return;

      try {
        const res = await fetch(`/api/kudos/${encodeURIComponent(kudosId)}/reactions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emoji: trimmed }),
        });
        if (!res.ok) {
          // Roll back: reapply the original kudos state. The store's
          // upsert is dedup-by-id so passing the pre-click kudos puts
          // us back where we started.
          upsertKudos(target);
          if (res.status === 429) {
            toast.warning("Reaction limit reached on this kudos.");
          } else if (res.status === 404) {
            toast.error("Kudos not found.");
          } else {
            toast.error("Couldn't save reaction.");
          }
        }
      } catch {
        // Network failure — same rollback.
        upsertKudos(target);
        toast.error("Couldn't reach the server. Reaction reverted.");
      }
    },
    [auth?.user?.id, isOwner, kudosList, upsertKudos]
  );

  return { addReaction };
}

const EMPTY: Kudos[] = [];
