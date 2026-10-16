"use client";

/**
 * Guest-mode canvas renderer.
 *
 * Why this exists separately from canvas-client.tsx: the owner-side
 * canvas pulls in 30+ chrome components (template gallery, AI panels,
 * activity stream, import/export, etc.) that either don't apply or
 * actively leak owner-only data. This thin wrapper mounts only the
 * `WhiteboardCanvas` surface itself, with role-based read-only gating.
 *
 * Identity threading:
 *   * The (guest)/layout.tsx mounts a `<PresenceIdentityProvider>` with
 *     the guest profile, which `useRoom` reads when no explicit identity
 *     is passed. No localStorage clobbering of the shared
 *     `agile-toolkit:user` slot — that would contaminate any other tab
 *     on the same browser (e.g. the owner signed in elsewhere).
 *
 * Initial sync:
 *   * Whiteboard objects never persist to Supabase — they live purely
 *     in the realtime channel. A fresh guest sees an empty board until
 *     the owner's next heartbeat (≤10 s). We display a hint instead of
 *     a broken-looking empty state.
 *
 * Persistence isolation:
 *   * The workspace store's persist slot (`agile-toolkit:workspace`) is
 *     shared with every owner-mode tab on the same browser. Before the
 *     guest seeds board metadata we swap the persist storage to an
 *     in-memory no-op so the seeded row, inbound activity events, and
 *     any guest-side workspace mutations never leak to localStorage.
 *     The original storage is restored on unmount.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Users, AlertTriangle } from "lucide-react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { useCanvasStore } from "@/app/(tools)/canvas/use-canvas-store";
import { WhiteboardCanvas } from "@/app/(tools)/canvas/components/whiteboard-canvas";
import { ZoomControls } from "@/app/(tools)/canvas/components/zoom-controls";
import { ToolbarLeft } from "@/app/(tools)/canvas/components/toolbar-left";
import { isRealtimeAvailable } from "@/lib/realtime/supabase-client";

interface Props {
  boardId: string;
  role: "editor" | "viewer" | "commenter";
  profile: { id: string; displayName: string; color: string };
}

export function GuestCanvasClient({ boardId, role, profile }: Props) {
  const [ready, setReady] = useState(false);
  const [realtimeOn, setRealtimeOn] = useState(false);
  const readOnly = role !== "editor";
  const canComment = role !== "viewer";

  useEffect(() => {
    // Rehydrate persisted stores (workspace + canvas UI). On a fresh
    // guest tab these are no-ops, but we still need to trigger them
    // once because both opt out of automatic hydration.
    //
    // Capture the original persist storage BEFORE rehydrate so the
    // cleanup can put it back. We swap to a no-op storage immediately
    // after rehydrate so the board-metadata seed below (and any
    // subsequent guest-side writes — inbound activity events, etc.)
    // never touch the shared `agile-toolkit:workspace` localStorage
    // slot. Without this the seeded `"Shared board"` row appears in the
    // owner's dashboard the next time they open a tab on this browser.
    const originalStorage = useWorkspaceStore.persist.getOptions().storage;
    // PersistStorage<S> shape — getItem returns StorageValue<S> | null,
    // not a raw string (createJSONStorage wraps a StateStorage into this
    // higher-level interface). A no-op getItem returning null leaves the
    // store at its in-memory defaults; setItem / removeItem are inert.
    const noopStorage: NonNullable<typeof originalStorage> = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    };

    void Promise.resolve(useWorkspaceStore.persist.rehydrate())
      .catch(() => {})
      .finally(() => {
        useWorkspaceStore.persist.setOptions({ storage: noopStorage });
        // Seed the board metadata so WhiteboardCanvas can find it.
        // Whiteboard objects are NOT seeded — they arrive via the
        // realtime room's drift-recovery heartbeat (≤10 s). With the
        // no-op storage installed above, this write is in-memory only.
        const st = useWorkspaceStore.getState();
        const existing = (st.whiteboards ?? []).some((b) => b.id === boardId);
        if (!existing) {
          const now = new Date().toISOString();
          st.upsertWhiteboard({
            id: boardId,
            name: "Shared board",
            createdAt: now,
            updatedAt: now,
          });
        }
        void Promise.resolve(useCanvasStore.persist.rehydrate())
          .catch(() => {})
          .finally(() => setReady(true));
      });

    setRealtimeOn(isRealtimeAvailable());

    return () => {
      // Restore the original storage so subsequent (non-guest) tabs on
      // the same module instance — e.g. HMR reloads in dev — see their
      // real persist storage again.
      useWorkspaceStore.persist.setOptions({ storage: originalStorage });
    };
  }, [boardId, profile.id, profile.displayName]);

  if (!ready) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-2 text-sub text-sm">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          Loading session…
        </div>
      </main>
    );
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-bg">
      <header className="flex items-center justify-between gap-3 px-3 py-2 border-b border-border bg-surface/80 backdrop-blur">
        <div className="flex items-center gap-2 min-w-0">
          <Link
            href="/guest"
            className="min-touch-coarse inline-flex items-center gap-1 -mx-1 px-1 rounded text-xs text-sub hover:text-text"
            aria-label="Back to guest home"
          >
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
            Back
          </Link>
          <span className="text-sub">·</span>
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: profile.color }}
              aria-hidden="true"
            />
            <span className="text-xs text-text truncate">{profile.displayName}</span>
            <span
              className={`text-[10px] uppercase font-bold ${
                role === "editor"
                  ? "text-warning"
                  : role === "commenter"
                    ? "text-success"
                    : "text-cyan-300"
              }`}
            >
              {role}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-sub">
          <Users className="w-3 h-3" aria-hidden="true" />
          {realtimeOn ? "Live" : "Local-only"}
        </div>
      </header>

      <div className="relative flex-1 min-h-0">
        {!readOnly && (
          <div className="absolute left-2 top-2 z-overlay">
            <ToolbarLeft />
          </div>
        )}
        <div className="absolute right-2 top-2 z-overlay">
          <ZoomControls />
        </div>
        <div className="absolute inset-0">
          <WhiteboardCanvas
            boardId={boardId}
            readOnly={readOnly}
            canComment={canComment}
            presenceName={profile.displayName}
            presenceColor={profile.color}
            isGuest
          />
        </div>
        {!realtimeOn && (
          <div
            role="alert"
            className="absolute left-1/2 bottom-[max(1rem,calc(env(safe-area-inset-bottom)+0.5rem))] -translate-x-1/2 flex items-center gap-2 border border-warning/40 bg-warning/10 rounded px-3 py-1.5 text-xs text-warning shadow-lg max-w-[calc(100vw-1rem)]"
          >
            <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
            Realtime is not configured. You won&apos;t see other participants&apos; edits.
          </div>
        )}
      </div>
    </div>
  );
}
