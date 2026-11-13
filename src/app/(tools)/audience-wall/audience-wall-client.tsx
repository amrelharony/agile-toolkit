"use client";

/**
 * Audience Wall: ask the whole room one question and see the answers on a
 * wall. Five kinds of wall (open answers with a word cloud, questions with
 * upvotes and Answered, a raise-hand queue, brainwriting with "Yes, and…",
 * 25/10 rounds), run live on people's phones through the wall-room kit, or
 * typed in by hand. A saved wall keeps the prompt and the posts, anonymous,
 * and offers themes, duplicates and backlog items, each a draft the host
 * accepts, with Undo.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { MessagesSquare, PenLine } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ActionRow } from "@/components/shared/action-row";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { SectionCard } from "@/components/shared/section-card";
import { ExampleNotice, LoadExampleButton } from "@/components/tool-frame/example-data";
import { Button } from "@/components/ui/button";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { generateAudienceWallPrompts } from "@/lib/ai-prompts/audience-wall";
import {
  WALL_KINDS,
  WALL_KIND_HINT,
  WALL_KIND_LABEL,
  normalizeWallData,
  sessionFromDraft,
  type WallDraft,
  type WallKind,
} from "@/lib/audience-wall/model";
import { hydrateAudienceWall, updateWalls, useAudienceWallStore } from "@/lib/audience-wall/store";
import { AUDIENCE_WALL_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import type { WallRoundResult } from "@/lib/realtime/wall-room/protocol";
import { hasExampleItems, isExampleId } from "@/lib/utils/example-id";
import { cn } from "@/lib/utils";
import { buildExample } from "./example";
import { LiveWall } from "./live-wall";
import { ManualWallForm } from "./manual-wall-form";
import { toMarkdown } from "./markdown";
import { SavedWalls } from "./saved-walls";
import { saveWallRound } from "./save";

const newWallId = () => `wall_${nanoid(10)}`;

export function AudienceWallClient() {
  const { log } = useHistoryLogger("audience-wall");
  const announce = useAnnounce();
  const raw = useAudienceWallStore();
  const [ready, setReady] = useState(false);
  const [kind, setKind] = useState<WallKind>("answers");
  const [live, setLive] = useState(false);
  const [byHand, setByHand] = useState(false);
  // The kind the live room opened with: a save after it closed still uses it.
  const liveKindRef = useRef<WallKind | null>(null);
  const kindName = useId();
  const savedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    void hydrateAudienceWall().finally(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const sessions = ready ? normalizeWallData(raw).sessions : [];
  const own = sessions.filter((s) => !isExampleId(s.id));
  const example = hasExampleItems(sessions);

  const onLiveChange = useCallback(
    (on: boolean) => {
      setLive(on);
      if (on) liveKindRef.current = kind;
    },
    [kind]
  );

  const saveRound = useCallback(
    (result: WallRoundResult) => saveWallRound(result, liveKindRef.current ?? kind, { log }),
    [kind, log]
  );

  const saveDraft = (draft: WallDraft) => {
    const session = sessionFromDraft(draft, kind, {
      id: newWallId(),
      savedAt: new Date().toISOString(),
    });
    if (!session) return;
    updateWalls((list) => [session, ...list]);
    log(AUDIENCE_WALL_ACTIONS.WALL_SAVED, {
      kind,
      mode: "manual",
      posts: session.posts.length,
    });
    announce(`Saved the wall with ${session.posts.length} posts. It's under Saved walls.`);
  };

  const loadExample = () => {
    updateWalls((list) => [...buildExample(), ...list.filter((s) => !isExampleId(s.id))]);
  };
  const clearExample = () => updateWalls((list) => list.filter((s) => !isExampleId(s.id)));

  return (
    <ToolPageWrapper
      toolId="audience-wall"
      title="Audience Wall"
      description="Ask the room an open question and see the answers on a wall."
    >
      {example && <ExampleNotice onClear={clearExample} />}

      <ActionRow>
        <AiPromptGenerator
          config={{ toolName: "Audience Wall", prompts: generateAudienceWallPrompts(own) }}
        />
        <ExportButton filename="audience-wall" markdown={toMarkdown(sessions)} />
      </ActionRow>

      <div className="space-y-6">
        <SectionCard title="Run a wall" icon={MessagesSquare} contentClassName="space-y-4">
          <fieldset className="min-w-0 space-y-2" disabled={live}>
            <legend className="text-sm font-medium text-text">Kind of wall</legend>
            {live && (
              <p className="text-xs text-sub">
                The live wall is set up as {WALL_KIND_LABEL[kind].toLowerCase()}. End it to change
                the kind.
              </p>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              {WALL_KINDS.map((k) => (
                <label
                  key={k}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border bg-surface-deep px-3 py-2",
                    kind === k && "border-accent",
                    live && "cursor-not-allowed opacity-70"
                  )}
                >
                  <input
                    type="radio"
                    name={kindName}
                    className="mt-1 h-4 w-4 shrink-0"
                    checked={kind === k}
                    onChange={() => setKind(k)}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm text-text">{WALL_KIND_LABEL[k]}</span>
                    <span className="block text-xs text-sub">{WALL_KIND_HINT[k]}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <LiveWall kind={kind} onSave={saveRound} onLiveChange={onLiveChange} />

          {/* A raise-hand queue has nothing to type in. */}
          {kind !== "hands" && (
            <div className="space-y-3 border-t border-border pt-4">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1.5"
                aria-expanded={byHand}
                onClick={() => setByHand((v) => !v)}
              >
                <PenLine className="h-4 w-4" aria-hidden="true" />
                Add a wall by hand
              </Button>
              {byHand && (
                <>
                  <p className="text-xs text-sub">
                    For sticky notes on a real wall, or answers from a chat: type the question and
                    one answer per line.
                  </p>
                  <ManualWallForm kind={kind} onSave={saveDraft} />
                </>
              )}
            </div>
          )}
        </SectionCard>

        <div ref={savedRef}>
          {ready && sessions.length === 0 ? (
            <EmptyState
              icon={MessagesSquare}
              action={<LoadExampleButton onLoad={loadExample} className="mt-4" />}
            >
              No saved walls yet. Open a live wall above and save its round, or add one by hand.
            </EmptyState>
          ) : (
            ready && (
              <SectionCard
                title={`Saved walls (${sessions.length})`}
                icon={MessagesSquare}
                contentClassName="space-y-3"
              >
                <SavedWalls
                  sessions={sessions}
                  log={log}
                  onEmptied={() => savedRef.current?.querySelector<HTMLElement>("button")?.focus()}
                />
              </SectionCard>
            )
          )}
        </div>
      </div>
    </ToolPageWrapper>
  );
}
