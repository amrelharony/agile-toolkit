"use client";

import { useCallback, useEffect, useRef } from "react";
import { nanoid } from "nanoid";
import { useHistoryStore } from "./history-store";
import { sanitizePayload } from "./sanitize";
import { isMilestoneAction } from "./event-actions";
import { useAuthOptional } from "@/lib/auth/auth-provider";
import { useGuestProfile } from "@/lib/auth/guest-profile-provider";
import { timeTravelRegistry } from "@/lib/stores/with-time-travel";
import type { HistoryEvent, ToolId } from "./types";

interface LogOptions {
  /** Force a milestone flag regardless of catalog default. */
  milestone?: boolean;
  /** Optional snapshots used by `/insights` and replay. */
  beforeState?: unknown;
  afterState?: unknown;
  /** Override the timestamp (defaults to now). Useful for backfill/imports. */
  occurredAt?: Date;
}

export interface HistoryLogger {
  log: (action: string, payload?: Record<string, unknown>, opts?: LogOptions) => void;
  /** Per-mount nanoid — for tools that want to correlate events themselves. */
  toolRunId: string;
}

/**
 * Per-tool logger hook. Each tool calls this once at the top of its client
 * component:
 *
 *     const { log } = useHistoryLogger("retro");
 *     log(RETRO_ACTIONS.CARD_ADDED, { cardId, columnKey, text });
 *
 * The hook stamps every event with the user's id (when signed in), the
 * per-browser clientId, and a per-mount toolRunId so analytics can group
 * events by session.
 */
/**
 * Per-browser client id for guest-mode logging. Reused across tabs so
 * the owner's history page can group bursts from the same guest browser.
 * Distinct from the owner's `agile-toolkit:history.clientId` to avoid
 * cross-contamination when the same browser hosts both roles.
 */
function ensureGuestClientId(): string {
  if (typeof window === "undefined") return "ssr";
  const KEY = "agile-toolkit:guest-client-id";
  try {
    const existing = window.localStorage.getItem(KEY);
    if (existing && /^[A-Za-z0-9_-]{1,32}$/.test(existing)) return existing;
  } catch {
    /* private mode — derive per-call */
  }
  const fresh = nanoid(16);
  try {
    window.localStorage.setItem(KEY, fresh);
  } catch {
    /* private mode — fine, the value is short-lived anyway */
  }
  return fresh;
}

export function useHistoryLogger(toolId: ToolId): HistoryLogger {
  // Use the optional auth hook so this logger keeps working in trees
  // that don't mount AuthProvider (guest routes). When no provider is
  // present we behave as if the visitor is anonymous — events get
  // stamped with userId=null exactly as they would pre-sign-in.
  const auth = useAuthOptional();
  const guest = useGuestProfile();
  const user = auth?.user ?? null;
  const status = auth?.status ?? "anonymous";
  // Two refs initialised synchronously (not in a useEffect) so the
  // FIRST log() call sees populated values. useState's lazy initialiser
  // runs exactly once per mount and locks the value in.
  const toolRunIdRef = useRef<string>("");
  if (!toolRunIdRef.current) toolRunIdRef.current = nanoid();
  const guestClientIdRef = useRef<string>("");
  if (!guestClientIdRef.current && guest) {
    guestClientIdRef.current = ensureGuestClientId();
  }

  const ensureClientId = useHistoryStore((s) => s.ensureClientId);
  const addEvent = useHistoryStore((s) => s.addEvent);

  // Make sure owner-mode clientId exists once on mount. Skipped for
  // guests — they don't touch the local history store.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (guest) return;
    ensureClientId();
  }, [ensureClientId, guest]);

  const log = useCallback(
    (action: string, payload: Record<string, unknown> = {}, opts: LogOptions = {}) => {
      if (typeof window === "undefined") return;
      const id = nanoid();
      const undoIndex = timeTravelRegistry.get(toolId)?.pastLength();
      const occurredAtSafe =
        opts.occurredAt instanceof Date && Number.isFinite(opts.occurredAt.getTime())
          ? opts.occurredAt
          : new Date();
      const sanitizedPayload = sanitizePayload(payload);
      const isMilestone = opts.milestone ?? isMilestoneAction(toolId, action);

      if (guest) {
        // Guest mode: POST to the squad-scoped endpoint so the event
        // lands in the owner's history with squad_profile_id set. We do
        // NOT write to the local store — that would pollute the
        // browser's persisted history slot, and if the same browser is
        // later used by the owner the ghost events would surface in
        // their own /history page.
        const clientId = guestClientIdRef.current || ensureGuestClientId();
        guestClientIdRef.current = clientId;
        void fetch("/api/guest/log", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            toolId,
            action,
            payload: sanitizedPayload,
            clientEventId: id,
            clientId,
            toolRunId: toolRunIdRef.current,
            occurredAt: occurredAtSafe.toISOString(),
            isMilestone,
          }),
        }).catch((err) => {
          // eslint-disable-next-line no-console
          console.warn("[history-logger] guest log POST failed", err);
        });
        return;
      }

      // Owner mode: existing local-store path.
      const clientId = ensureClientId();
      const event: HistoryEvent = {
        id,
        clientEventId: id,
        clientId,
        toolRunId: toolRunIdRef.current,
        userId: status === "authenticated" ? (user?.id ?? null) : null,
        toolId,
        action,
        payload: sanitizedPayload,
        beforeState: sanitizePayload(opts.beforeState),
        afterState: sanitizePayload(opts.afterState),
        isMilestone,
        occurredAt: occurredAtSafe.toISOString(),
        syncedAt: null,
        undoIndex,
      };
      addEvent(event);
    },
    [toolId, status, user?.id, addEvent, ensureClientId, guest]
  );

  return { log, toolRunId: toolRunIdRef.current };
}
