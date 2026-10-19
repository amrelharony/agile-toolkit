"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Sparkles, Wifi, WifiOff, Settings } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { SessionShareButton } from "@/components/collab/session-share-button";
import { Button } from "@/components/ui/button";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { useAuthOptional } from "@/lib/auth/auth-provider";
import { useOwnerState } from "@/lib/auth/use-is-owner";
import { isRealtimeAvailable } from "@/lib/realtime/supabase-client";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { useHistoryStore } from "@/lib/history/history-store";
import { KUDOS_ACTIONS } from "@/lib/history/event-actions";
import { emit } from "@/lib/sonification/emit";
import { exportPng } from "@/lib/whiteboard/export";
import { generateKudosPrompts } from "@/lib/ai-prompts/kudos";
import { usePredictedDefault } from "@/lib/predictions/use-predicted-default";
import {
  analyseSentiment,
  detectDuplicate,
  computeFairness,
  installFairnessInvalidator,
  primeRecipientSuggestion,
  type FairnessResult,
} from "@/lib/kudos/llm";
import { dispatch as dispatchGamification } from "@/lib/gamification/engine";
import { useKudosSettingsStore } from "@/lib/stores/kudos-settings-store";
import type { Kudos, Workspace } from "@/lib/stores/workspace-types";
import { KudosForm, type RecipientOption } from "./components/kudos-form";
import { KudosWall } from "./components/kudos-wall";
import { KudosBeacon } from "./components/kudos-beacon";
import { KudosSettings } from "./components/kudos-settings";
import { useKudosRoom } from "./use-kudos-room";
import { useKudosReactions } from "./use-kudos-reactions";
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
 *
 * Visitors (anyone but the verified owner) get the same wall, kept in
 * this browser: no squad fetch, no realtime room, no reaction POSTs.
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
  const { isOwner, settled: authSettled } = useOwnerState();

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
  const ownerId = isOwner ? (auth?.user?.id ?? null) : null;
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
  // signature). When email is also missing we fall back to a label —
  // for the owner only: a visitor isn't the "Workspace owner".
  const emailLocal = typeof auth?.user?.email === "string" ? auth.user.email.split("@")[0] : null;
  const fromName = isOwner ? auth?.profile?.display_name || emailLocal || "Workspace owner" : "";
  // A visitor types their own name; it lives only in this component.
  const [visitorName, setVisitorName] = useState("");
  const senderName = isOwner ? fromName : visitorName;

  // Fetch squad profiles across every squad the owner has. Each squad
  // gives its members; we aggregate + dedup by profile id so a person
  // who appears in multiple squads is offered once. Squads are owner-only
  // (the API 401s for visitors), and a sign-out drops the owner's list.
  const [squadProfiles, setSquadProfiles] = useState<ProfileSummary[]>([]);
  useEffect(() => {
    if (!isOwner) {
      setSquadProfiles((prev) => (prev.length === 0 ? prev : []));
      return;
    }
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
  }, [isOwner]);

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

  // ── Phase 3: LLM intelligence wiring ─────────────────────────────────
  //
  // Owner-only. Guests never run any of this — they don't have the
  // history context (RLS limits what they see) and they're not the
  // audience for the fairness-driven nudges anyway.
  //
  // Install the cache invalidator once on mount so a fresh kudos.sent
  // signal flushes the fairness cache; the next consumer recomputes.
  useEffect(() => {
    const uninstall = installFairnessInvalidator();
    return uninstall;
  }, []);

  // Compute fairness in the background. Input is redacted (no message
  // bodies); the helper caches for 1 h and is invalidated by the
  // installer above when a new kudos lands. We keep the result in
  // state so the inline hint above the form re-renders when it lands.
  const [fairness, setFairness] = useState<FairnessResult | null>(null);
  const recentKudos = room.kudos;
  const events = useHistoryStore((s) => s.events);
  // Phase 5 — device-local "Fairness suggestions" toggle. Subscribed
  // (not read via getState) because flipping it must re-run this effect.
  const aiFairness = useKudosSettingsStore((s) => s.aiFairness);
  useEffect(() => {
    // Feature off → no redacted recognition history leaves the device,
    // and any hint already on screen is dropped.
    if (!aiFairness) {
      setFairness(null);
      return;
    }
    if (squadProfiles.length === 0) return;
    const controller = new AbortController();
    const now = Date.now();
    const thirtyDaysMs = 30 * 86_400_000;
    const fourteenDaysMs = 14 * 86_400_000;
    // Redacted projection — fairness MUST NOT see message bodies.
    const recentKudosRedacted = recentKudos
      .filter((k) => {
        const t = Date.parse(k.sentAt);
        if (!Number.isFinite(t)) return false;
        return now - t <= thirtyDaysMs;
      })
      .filter((k) => !!k.toProfileId)
      .map((k) => ({
        toProfileId: k.toProfileId!,
        fromProfileId: k.fromProfileId,
        theme: typeof k.theme === "string" ? k.theme : k.theme.id,
        sentAt: k.sentAt,
        messageLength: k.message.length,
      }));
    // Activity signals — impediment.resolved, story status changes,
    // decision.recorded. Coarse: kind + actor + at.
    const recentSignals = events
      .filter((e) => {
        const t = Date.parse(e.occurredAt);
        if (!Number.isFinite(t)) return false;
        return now - t <= fourteenDaysMs;
      })
      .filter((e) => {
        return (
          (e.toolId === "impediments" && e.action.includes("resolve")) ||
          (e.toolId === "stories" && e.action.includes("status")) ||
          (e.toolId === "decision-log" && e.action.includes("record"))
        );
      })
      .map((e) => ({
        kind: `${e.toolId}.${e.action}`,
        profileId: e.squadProfileId ?? undefined,
        at: e.occurredAt,
      }));

    void (async () => {
      const result = await computeFairness(
        {
          squadProfiles: squadProfiles.map((p) => ({ id: p.id, displayName: p.displayName })),
          recentKudos: recentKudosRedacted,
          recentSignals,
        },
        controller.signal
      );
      if (controller.signal.aborted) return;
      setFairness(result);
    })();
    return () => {
      controller.abort();
    };
  }, [squadProfiles, recentKudos, events, aiFairness]);

  // Prime the LLM-based recipient suggestion. Populates the cache the
  // predictor reads from — once it lands `usePredictedDefault` returns
  // the top suggestion and the form pre-fills the To select.
  useEffect(() => {
    if (squadProfiles.length === 0) return;
    const controller = new AbortController();
    const sevenDaysMs = 7 * 86_400_000;
    const now = Date.now();
    const redactedEvents = events
      .filter((e) => {
        const t = Date.parse(e.occurredAt);
        return Number.isFinite(t) && now - t <= sevenDaysMs;
      })
      .slice(-80)
      .map((e) => ({
        id: e.id,
        toolId: e.toolId,
        action: e.action,
        // Payload summary kept terse on purpose — values vary by tool
        // and we don't want to ship arbitrary user data into the prompt.
        payloadSummary: Object.keys(e.payload).slice(0, 4).join(", "),
        occurredAt: e.occurredAt,
        squadProfileId: e.squadProfileId,
      }));
    void primeRecipientSuggestion(
      {
        recentHistoryEvents: redactedEvents,
        squadProfiles: squadProfiles.map((p) => ({ id: p.id, displayName: p.displayName })),
      },
      controller.signal
    );
    return () => {
      controller.abort();
    };
  }, [squadProfiles, events]);

  // Pull the predicted recipient via the registry. The predictor reads
  // from the cache primed above; before the LLM lands it returns
  // `confidence: "none"` and we ignore the value.
  const predicted = usePredictedDefault<string>("kudos", "recipient", "");
  const predictedRecipientId =
    predicted.confidence !== "none" && predicted.value ? predicted.value : undefined;

  // Find the first under-recognised teammate that matches a recipient
  // we can actually pick — drops phantom ids the model produced for
  // people who aren't in the form's recipient list (race against a
  // squad-profile refresh).
  const fairnessHintTarget = useMemo(() => {
    if (!fairness || fairness.underRecognised.length === 0) return null;
    for (const u of fairness.underRecognised) {
      const opt = recipients.find((r) => r.profileId === u.profileId);
      if (opt) return { opt, suggestion: u };
    }
    return null;
  }, [fairness, recipients]);

  // Map the fairness target to its score so we can stamp
  // `fairnessScoreAtSend` when the sender picks an under-recognised
  // recipient (a click on the hint button, or a manual pick of the
  // same person before the hint disappears).
  const fairnessScoreByProfileId = useMemo(() => {
    const m = new Map<string, number>();
    if (fairness) {
      for (const u of fairness.underRecognised) m.set(u.profileId, u.score);
    }
    return m;
  }, [fairness]);

  // The hint button stamps the recipient and emits the gamification
  // event with the `suggested: true` meta flag so the `fair-witness`
  // achievement unlocks. `emit()` doesn't accept a meta arg, so we
  // dispatch the canonical event name directly into the engine.
  //
  // `forcedRecipient` is passed to the form as `{id, token}`. Bumping
  // the token (monotonic) signals the form to override its one-shot
  // latch and snap the picker to the hinted recipient.
  const [forcedRecipient, setForcedRecipient] = useState<{ id: string; token: number } | null>(
    null
  );
  const handleFairnessPick = useCallback(() => {
    if (!fairnessHintTarget) return;
    setForcedRecipient((prev) => ({
      id: fairnessHintTarget.opt.id,
      token: (prev?.token ?? 0) + 1,
    }));
    dispatchGamification({
      name: "tool:kudos:llm-suggested-pick",
      meta: { suggested: true, profileId: fairnessHintTarget.suggestion.profileId },
    });
  }, [fairnessHintTarget]);

  // Slot rendered above the compose form. Owner-only.
  const fairnessHintSlot = fairnessHintTarget ? (
    <div className="flex items-start gap-3 rounded-lg border border-accent/40 bg-accent/5 px-4 py-3">
      <Sparkles className="h-4 w-4 text-accent shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-text">
          <span className="font-semibold">{fairnessHintTarget.opt.displayName}</span>{" "}
          <span className="text-sub">
            {fairnessHintTarget.suggestion.reason || "looks under-recognised this month"}
          </span>
          {" — recognise them?"}
        </p>
      </div>
      <Button
        type="button"
        size="sm"
        onClick={handleFairnessPick}
        className="bg-accent text-bg hover:bg-accent/80 font-semibold"
      >
        Send to {fairnessHintTarget.opt.displayName.split(/\s+/)[0]}
      </Button>
    </div>
  ) : null;

  const handleSubmit = async (kudos: Kudos) => {
    // Phase 3 — sentiment + dedup BEFORE the room send so the stamped
    // values ride along with the optimistic write + broadcast. Both
    // helpers return null on any failure (no key, network, parse) so
    // missing AI never blocks the send.
    const recentForPair = room.kudos.filter(
      (k) =>
        k.toProfileId &&
        kudos.toProfileId &&
        k.toProfileId === kudos.toProfileId &&
        k.fromProfileId === kudos.fromProfileId
    );
    // Phase 5 — honour the device-local AI toggles. Read via getState so
    // the handler isn't re-created on every settings change; a disabled
    // feature resolves to `null`, which is the same value both helpers
    // return when there's no BYOK key, so everything downstream already
    // copes. Without this gate the message body was shipped to the
    // user's LLM provider even with the switches off.
    const { aiSentiment, aiDedup } = useKudosSettingsStore.getState();
    const [sentiment, dup] = await Promise.all([
      aiSentiment ? analyseSentiment({ message: kudos.message, theme: kudos.theme }) : null,
      aiDedup ? detectDuplicate({ candidate: kudos, recent: recentForPair }) : null,
    ]);
    const stamped: Kudos = { ...kudos };
    if (sentiment) stamped.sentiment = sentiment;
    if (dup?.isDup && dup.dupId) {
      // Reuse the existing dupId as the group key so the wall stacks
      // this card with the prior near-duplicate. A future row that the
      // model maps to the SAME prior joins the same group.
      stamped.llmDedupGroup = dup.dupId;
    }
    // Stamp fairness score at send time if the recipient was flagged.
    // Frozen on send so the audit log captures the signal that prompted
    // the sender, not its drift afterwards.
    if (kudos.toProfileId) {
      const score = fairnessScoreByProfileId.get(kudos.toProfileId);
      if (typeof score === "number") {
        stamped.fairnessScoreAtSend = score;
      }
    }

    room.sendKudos(stamped);
    log(KUDOS_ACTIONS.KUDOS_SENT, {
      kudosId: stamped.id,
      theme: typeof stamped.theme === "string" ? stamped.theme : stamped.theme.id,
      toName: stamped.toName,
      toProfileId: stamped.toProfileId,
      fromProfileId: stamped.fromProfileId,
      messageWords: stamped.message.split(/\s+/).filter(Boolean).length,
    });
    // Phase 2 — fan out to sonification + haptics + gamification. The
    // emit module already routes by tool id; the signal-bridge emits
    // `kudos.sent` on the workspace-store add so the cloud-sync layer
    // independently picks it up.
    emit("kudos", "sent");
  };

  const [settingsOpen, setSettingsOpen] = useState(false);
  // Subscribed: this one gates render, so it must re-render on change.
  const beaconAmbient = useKudosSettingsStore((s) => s.beaconAmbient);
  const { addReaction } = useKudosReactions();

  // Reply path piggybacks on the same realtime room — a reply is just
  // a Kudos with `replyTo` set. The wall builds the reply object; we
  // only forward to `room.sendKudos` and log it as a thread reply.
  const handleSendReply = async (reply: Kudos) => {
    room.sendKudos(reply);
    log(KUDOS_ACTIONS.KUDOS_REPLIED, {
      kudosId: reply.id,
      replyTo: reply.replyTo,
      toProfileId: reply.toProfileId,
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
      description={
        isOwner
          ? "Send themed recognition cards to your team. Live updates across all peers; downloadable as PNG for sharing outside the toolkit."
          : "Send themed recognition cards to your team. Saved in this browser; downloadable as PNG for sharing outside the toolkit."
      }
      category="Outcomes & Pulse"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-2 text-xs">
          {/* Nothing until auth settles, so the owner doesn't see the
              visitor label flash on load. */}
          {!authSettled ? null : !isOwner ? (
            <span className="inline-flex items-center gap-1.5 text-sub/70">
              <WifiOff className="h-3 w-3" aria-hidden="true" />
              Browser-only — saved on this device
            </span>
          ) : room.isLocalOnly ? (
            <span className="inline-flex items-center gap-1.5 text-amber-300/80">
              <WifiOff className="h-3 w-3" aria-hidden="true" />
              {isRealtimeAvailable()
                ? "Local-only"
                : "Local-only — set Supabase env vars to share live"}
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setSettingsOpen(true)}
            className="border-border text-sub hover:text-text gap-1.5"
            aria-label="Open kudos settings"
          >
            <Settings className="h-4 w-4" aria-hidden="true" />
            Settings
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <KudosForm
          defaultFromName={senderName}
          fromPlaceholder={isOwner ? undefined : "Your name"}
          onFromNameChange={isOwner ? undefined : setVisitorName}
          defaultTeamName={teamName}
          recipients={recipients}
          onSubmit={handleSubmit}
          onDownload={handleDownload}
          predictedRecipientId={predictedRecipientId}
          fairnessHintSlot={fairnessHintSlot}
          forcedRecipient={forcedRecipient ?? undefined}
        />
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-text">Recent kudos</h2>
          <KudosWall
            kudos={room.kudos}
            viewerProfileId={ownerId ?? undefined}
            onAddReaction={(id, emoji) => {
              void addReaction(id, emoji);
            }}
            onSendReply={handleSendReply}
            replyFromName={senderName.trim() || undefined}
          />
        </div>
      </div>

      <KudosSettings open={settingsOpen} onOpenChange={setSettingsOpen} />
      {/* Ambient beacon — the settings dialog's "Ambient beacon" switch
          is the only thing that hides it; before this it rendered
          unconditionally and the toggle did nothing. */}
      {beaconAmbient && <KudosBeacon />}
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
