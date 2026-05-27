"use client";

import { useEffect, useMemo, useState } from "react";
import { Wifi, WifiOff } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { SessionShareButton } from "@/components/collab/session-share-button";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { useAuthOptional } from "@/lib/auth/auth-provider";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { KUDOS_ACTIONS } from "@/lib/history/event-actions";
import { emit } from "@/lib/sonification/emit";
import { exportPng } from "@/lib/whiteboard/export";
import { generateKudosPrompts } from "@/lib/ai-prompts/kudos";
import type { Kudos, Workspace } from "@/lib/stores/workspace-types";
import { KudosForm, type RecipientOption } from "./components/kudos-form";
import { KudosWall } from "./components/kudos-wall";
import { useKudosRoom } from "./use-kudos-room";
import { KUDOS_ENTITY_ID, KUDOS_TOOL_ID } from "./types";

/**
 * Owner-side Kudos client.
 *
 * Owns the realtime room (host=true). State source-of-truth lives in
 * `useKudosRoom` which reads from the workspace store; we never touch
 * `s.kudos` directly here so the persistence mode (workspace vs
 * ephemeral) stays the hook's concern.
 *
 * The recipient picker shows squad profiles + workspace team members
 * + free-text. Squad profiles are fetched on mount across ALL of the
 * owner's squads via `/api/squads` + `/api/squads/[id]/profiles`.
 */
interface SquadOption {
  id: string;
  name: string;
}
interface ProfileSummary {
  id: string;
  displayName: string;
  color?: string;
}

export function KudosClient() {
  const auth = useAuthOptional();

  // Per-field selectors — using a literal object in the selector body
  // defeats `useShallow` (the object is reference-inequal every call).
  // Subscribing to each field individually means we only re-render
  // when a field we actually read changes.
  const teamMembers = useWorkspaceStore((s) => s.teamMembers ?? EMPTY_TEAM_MEMBERS);
  const sprints = useWorkspaceStore((s) => s.sprints ?? EMPTY_SPRINTS);
  const stories = useWorkspaceStore((s) => s.stories ?? EMPTY_STORIES);
  const impediments = useWorkspaceStore((s) => s.impediments ?? EMPTY_IMPEDIMENTS);
  const risks = useWorkspaceStore((s) => s.risks ?? EMPTY_RISKS);
  const okrs = useWorkspaceStore((s) => s.okrs ?? EMPTY_OKRS);
  const decisions = useWorkspaceStore((s) => s.decisions ?? EMPTY_DECISIONS);
  const techDebt = useWorkspaceStore((s) => s.techDebt ?? EMPTY_TECH_DEBT);
  const maturityLevel = useWorkspaceStore((s) => s.maturityLevel);
  const teamName = useWorkspaceStore((s) => s.teamName);

  // Owner mode: persist via the workspace store (single source of
  // truth across reloads). Scope the realtime channel by the owner's
  // auth user id so different workspaces on the same Supabase project
  // don't share the channel.
  const ownerId = auth?.user?.id ?? null;
  const room = useKudosRoom({
    isHost: true,
    ownerId,
    persistence: "workspace",
    role: "editor",
  });
  const { log } = useHistoryLogger(KUDOS_TOOL_ID);

  // Sender identity for the form. The previous chain treated an empty
  // string `display_name` as falsy and fell through to email; we keep
  // that behaviour (a blank display_name shouldn't render as a blank
  // signature). When email is also missing we fall back to a label.
  const emailLocal = typeof auth?.user?.email === "string" ? auth.user.email.split("@")[0] : null;
  const fromName = auth?.profile?.display_name || emailLocal || "Workspace owner";

  // Fetch squad profiles across every squad the owner has. Each squad
  // gives its members; we aggregate + dedup by profile id so a person
  // who appears in multiple squads is offered once.
  const [squadProfiles, setSquadProfiles] = useState<ProfileSummary[]>([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const sqRes = await fetch("/api/squads");
        if (!sqRes.ok) return;
        const sqJson = (await sqRes.json()) as { squads?: SquadOption[] };
        const squads = Array.isArray(sqJson.squads) ? sqJson.squads : [];
        const perSquad = await Promise.all(
          squads.map(async (s) => {
            try {
              const r = await fetch(`/api/squads/${s.id}/profiles`);
              if (!r.ok) return [];
              const j = (await r.json()) as { profiles?: ProfileSummary[] };
              return Array.isArray(j.profiles) ? j.profiles : [];
            } catch {
              return [];
            }
          })
        );
        if (cancelled) return;
        const seen = new Set<string>();
        const flat: ProfileSummary[] = [];
        for (const list of perSquad) {
          for (const p of list) {
            if (seen.has(p.id)) continue;
            seen.add(p.id);
            flat.push(p);
          }
        }
        setSquadProfiles(flat);
      } catch {
        /* leave squad recipients empty — team-members + free-text remain */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const recipients = useMemo<RecipientOption[]>(() => {
    const out: RecipientOption[] = [];
    for (const p of squadProfiles) {
      out.push({
        id: `squad:${p.id}`,
        displayName: p.displayName,
        profileId: p.id,
        source: "squad",
      });
    }
    for (const m of teamMembers) {
      out.push({ id: `team:${m.id}`, displayName: m.name, source: "team" });
    }
    return out;
  }, [squadProfiles, teamMembers]);

  // Memoise the Workspace shape for AI-prompt generation. The deps
  // are all stable references (the workspace-store selectors return
  // the same identity across renders when the field hasn't changed),
  // so this only rebuilds when a relevant field actually shifts.
  const workspace = useMemo<Workspace>(
    () => ({
      teamMembers,
      sprints,
      stories,
      impediments,
      risks,
      okrs,
      decisions,
      techDebt,
      maturityLevel,
      teamName,
    }),
    [
      teamMembers,
      sprints,
      stories,
      impediments,
      risks,
      okrs,
      decisions,
      techDebt,
      maturityLevel,
      teamName,
    ]
  );

  const promptConfig = useMemo(
    () => ({ toolName: "Kudos", prompts: generateKudosPrompts(workspace) }),
    [workspace]
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
    // Phase 2 — fan out to sonification + haptics + gamification. The
    // emit module already routes by tool id; the signal-bridge emits
    // `kudos.sent` on the workspace-store add so the cloud-sync layer
    // independently picks it up.
    emit("kudos", "sent");
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
    <ToolPageWrapper
      toolId={KUDOS_TOOL_ID}
      title="Kudos Wall"
      description="Send themed recognition cards to your team. Live updates across all peers; downloadable as PNG for sharing outside the toolkit."
      category="Outcomes & Pulse"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-2 text-xs">
          {room.isLocalOnly ? (
            <span className="inline-flex items-center gap-1.5 text-amber-300/80">
              <WifiOff className="h-3 w-3" aria-hidden="true" />
              Local-only — set Supabase env vars to share live
            </span>
          ) : room.isConnected ? (
            <span className="inline-flex items-center gap-1.5 text-emerald-400/80">
              <Wifi className="h-3 w-3" aria-hidden="true" />
              Live
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-sub/60">Connecting…</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <AiPromptGenerator config={promptConfig} />
          <SessionShareButton
            toolId={KUDOS_TOOL_ID}
            entityId={KUDOS_ENTITY_ID}
            label="Invite squad"
          />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <KudosForm
          defaultFromName={fromName}
          defaultTeamName={teamName}
          recipients={recipients}
          onSubmit={handleSubmit}
          onDownload={handleDownload}
        />
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-text">Recent kudos</h2>
          <KudosWall kudos={room.kudos} />
        </div>
      </div>
    </ToolPageWrapper>
  );
}

// Stable empty-array references — `s.field ?? []` allocates a new array
// on every selector call when the underlying field is undefined, which
// defeats Zustand's referential-equality short-circuit and causes
// re-renders on every unrelated store mutation.
const EMPTY_TEAM_MEMBERS: Workspace["teamMembers"] = [];
const EMPTY_SPRINTS: Workspace["sprints"] = [];
const EMPTY_STORIES: Workspace["stories"] = [];
const EMPTY_IMPEDIMENTS: Workspace["impediments"] = [];
const EMPTY_RISKS: Workspace["risks"] = [];
const EMPTY_OKRS: Workspace["okrs"] = [];
const EMPTY_DECISIONS: Workspace["decisions"] = [];
const EMPTY_TECH_DEBT: Workspace["techDebt"] = [];
