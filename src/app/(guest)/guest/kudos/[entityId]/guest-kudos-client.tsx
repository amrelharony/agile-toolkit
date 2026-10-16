"use client";

/**
 * Guest-mode Kudos client.
 *
 * Mounts the same form + wall the owner sees, sourcing kudos from the
 * shared realtime room. Identity comes from the squad profile via the
 * (guest)/layout.tsx `<PresenceIdentityProvider>` — no localStorage
 * clobbering, no extra fetch.
 *
 * The guest is NOT the room host: no heartbeat, no persistence
 * guarantees across reloads (refreshing the tab loses the wall until
 * the owner's next heartbeat re-populates it within ~10 s).
 *
 * Recipient picker fetches `/api/guest/squad-profiles` — added in
 * task #18 — to populate the "send kudos to" dropdown with the
 * guest's own squad members.
 */

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, AlertTriangle, Users, Wifi, WifiOff } from "lucide-react";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { KUDOS_ACTIONS } from "@/lib/history/event-actions";
import { emit } from "@/lib/sonification/emit";
import { exportPng } from "@/lib/whiteboard/export";
import type { Kudos } from "@/lib/stores/workspace-types";
import { KudosForm, type RecipientOption } from "@/app/(tools)/kudos/components/kudos-form";
import { KudosWall } from "@/app/(tools)/kudos/components/kudos-wall";
import { KudosBeacon } from "@/app/(tools)/kudos/components/kudos-beacon";
import { useKudosRoom } from "@/app/(tools)/kudos/use-kudos-room";
import { KUDOS_TOOL_ID } from "@/app/(tools)/kudos/types";

interface Props {
  entityId: string;
  role: "editor" | "viewer" | "commenter";
  profile: {
    id: string;
    displayName: string;
    color: string;
    squadId: string;
    squadOwnerId: string;
  };
}

interface SquadProfileSummary {
  id: string;
  displayName: string;
  color: string;
}

export function GuestKudosClient({ role, profile }: Props) {
  const isViewer = role === "viewer";
  // Guest mode:
  //   * Ephemeral state — DO NOT persist incoming kudos to the shared
  //     `agile-toolkit:workspace` localStorage slot. Without this, a
  //     guest session on a browser later used by an owner would
  //     contaminate the owner's dashboard with stray kudos.
  //   * Channel scoped by squadOwnerId so different workspaces on the
  //     same Supabase project don't share the kudos channel.
  //   * Role passed through so the hook can enforce the viewer-cannot-
  //     broadcast invariant at the broadcast layer (defence-in-depth
  //     against any client patch / hot-reload race that mounts the form
  //     for a viewer).
  const room = useKudosRoom({
    isHost: false,
    ownerId: profile.squadOwnerId,
    persistence: "ephemeral",
    role,
  });
  const { log } = useHistoryLogger(KUDOS_TOOL_ID);

  // Fetch the guest's squad members on mount so the To picker can
  // offer them. The endpoint enforces "your squad only" so we don't
  // expose other squads' profiles.
  const [squadProfiles, setSquadProfiles] = useState<SquadProfileSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Explicit loading flag — an empty `squadProfiles` is NOT a "still
  // fetching" signal. /api/guest/squad-profiles filters the caller out
  // server-side (`.neq("id", session.profileId)`), so the first guest in
  // a squad legitimately gets `[]`. Branching the render on emptiness
  // pinned them on "Loading squad…" forever, unable to send or read
  // kudos.
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/guest/squad-profiles");
        if (!res.ok) {
          if (!cancelled) setLoadError(`Squad members unavailable (${res.status})`);
          return;
        }
        const json = (await res.json()) as { profiles?: SquadProfileSummary[] };
        if (cancelled) return;
        setSquadProfiles(Array.isArray(json.profiles) ? json.profiles : []);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Failed to load squad");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const recipients = useMemo<RecipientOption[]>(
    () =>
      // Exclude the guest themselves from the list — sending kudos to
      // yourself is rarely intended and feels weird in a shared wall.
      squadProfiles
        .filter((p) => p.id !== profile.id)
        .map((p) => ({
          id: `squad:${p.id}`,
          displayName: p.displayName,
          profileId: p.id,
          source: "squad" as const,
        })),
    [squadProfiles, profile.id]
  );

  const handleSubmit = async (kudos: Kudos) => {
    room.sendKudos(kudos);
    log(KUDOS_ACTIONS.KUDOS_SENT, {
      kudosId: kudos.id,
      theme: typeof kudos.theme === "string" ? kudos.theme : kudos.theme.id,
      toName: kudos.toName,
      toProfileId: kudos.toProfileId,
      fromProfileId: kudos.fromProfileId,
      messageWords: kudos.message.split(/\s+/).filter(Boolean).length,
    });
    // Phase 2 — sonification + haptics + gamification fan-out. Guests
    // share the same emit surface as the owner so the audible/tactile
    // affordance is identical regardless of role.
    emit("kudos", "sent");
    // Persist guest-authored kudos to the owner's cloud via the
    // service-role-backed guest endpoint. Without this, a guest's
    // recognition relies on the owner being online to mirror via
    // realtime — once the broadcast TTL expires the row is lost.
    // POST is fire-and-forget: the realtime broadcast above already
    // covers the live-wall case, and the owner's backfill will pick
    // up any rows that landed cloud-side too.
    try {
      await fetch("/api/guest/kudos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(kudos),
      });
    } catch {
      // Network failure is non-fatal — the broadcast still went out.
    }
  };

  const handleDownload = async (kudos: Kudos, el: HTMLDivElement) => {
    const slug =
      kudos.toName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 32) || "recipient";
    await exportPng(el, `kudos-to-${slug}.png`);
  };

  return (
    <div className="min-h-screen px-4 py-4">
      <div className="mx-auto max-w-6xl space-y-3">
        <header className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <Link
            href="/guest"
            className="min-touch-coarse inline-flex items-center gap-1 -mx-1 px-1 rounded text-sub hover:text-text"
          >
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
            Back
          </Link>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: profile.color }}
                aria-hidden="true"
              />
              <span className="text-text">{profile.displayName}</span>
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
            {room.isLocalOnly ? (
              <span className="inline-flex items-center gap-1 text-warning/80">
                <WifiOff className="h-3 w-3" aria-hidden="true" /> Local-only
              </span>
            ) : room.isConnected ? (
              <span className="inline-flex items-center gap-1 text-success/80">
                <Wifi className="h-3 w-3" aria-hidden="true" /> Live
              </span>
            ) : (
              <span className="text-sub/60">Connecting…</span>
            )}
          </div>
        </header>

        {loadError && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning"
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{loadError}</span>
          </div>
        )}

        {isViewer ? (
          // Viewers can read but not send. Skip the form entirely.
          <div className="grid gap-4">
            <div className="rounded border border-border bg-surface/60 px-4 py-3 text-xs text-sub flex items-center gap-2">
              <Users className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              You&apos;re a viewer — kudos others send to the wall appear here live.
            </div>
            <KudosWall kudos={room.kudos} highlightToProfileId={profile.id} />
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sub text-sm">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            Loading squad…
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
            <KudosForm
              defaultFromName={profile.displayName}
              defaultFromProfileId={profile.id}
              recipients={recipients}
              onSubmit={handleSubmit}
              onDownload={handleDownload}
            />
            <div className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold text-text">Recent kudos</h2>
              <KudosWall kudos={room.kudos} highlightToProfileId={profile.id} />
            </div>
          </div>
        )}
      </div>
      <KudosBeacon />
    </div>
  );
}
