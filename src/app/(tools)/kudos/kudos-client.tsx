"use client";

import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { Wifi, WifiOff } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { SessionShareButton } from "@/components/collab/session-share-button";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { useAuthOptional } from "@/lib/auth/auth-provider";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { KUDOS_ACTIONS } from "@/lib/history/event-actions";
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
 * Owns the realtime room (host=true). Sourced data:
 *   * `kudos` from the workspace store — owner is the persistent source
 *   * `teamMembers` from the workspace store — recipient picker
 *
 * The "From" identity comes from the auth profile (display_name → email
 * → fallback). Squad members joining the wall via /guest/kudos/workspace
 * will see kudos as they're sent live.
 */
export function KudosClient() {
  const auth = useAuthOptional();
  const { kudos, teamMembers, workspace } = useWorkspaceStore(
    useShallow((s) => ({
      kudos: s.kudos ?? [],
      teamMembers: s.teamMembers ?? [],
      // Buildable Workspace shape for the AI prompt context.
      workspace: {
        teamMembers: s.teamMembers ?? [],
        sprints: s.sprints ?? [],
        stories: s.stories ?? [],
        impediments: s.impediments ?? [],
        risks: s.risks ?? [],
        okrs: s.okrs ?? [],
        decisions: s.decisions ?? [],
        techDebt: s.techDebt ?? [],
        maturityLevel: s.maturityLevel,
        teamName: s.teamName,
      } satisfies Workspace,
    }))
  );

  const room = useKudosRoom({ isHost: true });
  const { log } = useHistoryLogger(KUDOS_TOOL_ID);

  // Sender identity for the form. Display name falls back through
  // auth.profile.display_name → email → a placeholder so the
  // read-only From field is never blank.
  const fromName =
    auth?.profile?.display_name ||
    (typeof auth?.user?.email === "string" ? auth.user.email.split("@")[0] : null) ||
    "Workspace owner";

  // Recipient options — workspace team members for now; squad profiles
  // are added in the next step (task #18 wires the picker for guests).
  // Owner-side, we focus on team-member recognition. Squad profile
  // routing happens via the realtime broadcast: a squad guest receives
  // the kudos in real time even when the sender picked a team member.
  const recipients = useMemo<RecipientOption[]>(
    () =>
      teamMembers.map((m) => ({
        id: `team:${m.id}`,
        displayName: m.name,
        source: "team" as const,
      })),
    [teamMembers]
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "Kudos",
      prompts: generateKudosPrompts(workspace),
    }),
    [workspace]
  );

  const handleSubmit = async (kudos: Kudos) => {
    room.sendKudos(kudos);
    log(KUDOS_ACTIONS.KUDOS_SENT, {
      kudosId: kudos.id,
      theme: kudos.theme,
      toName: kudos.toName,
      toProfileId: kudos.toProfileId,
      fromProfileId: kudos.fromProfileId,
      messageWords: kudos.message.split(/\s+/).filter(Boolean).length,
    });
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
          defaultTeamName={workspace.teamName}
          recipients={recipients}
          onSubmit={handleSubmit}
          onDownload={handleDownload}
        />
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-text">Recent kudos</h2>
          <KudosWall kudos={kudos} />
        </div>
      </div>
    </ToolPageWrapper>
  );
}
