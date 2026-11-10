"use client";

/**
 * The lobby: name the session, pick a deck, say who you are, then start a
 * session on this screen, one with the queued stories, or a visitor's live
 * room. Where a live room is offered, the two starts sit side by side as
 * the two named ways to run it ("One screen", "Everyone on their own
 * device", see components/collab/run-modes). Every start goes through the
 * same checks (./lobby), so a bad deck says so here instead of being
 * dropped by the room.
 */

import { useRef } from "react";
import { ListChecks, Loader2, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { SectionCard } from "@/components/shared/section-card";
import { useItemForm } from "@/components/shared/item-form";
import { LoadExampleButton } from "@/components/tool-frame/example-data";
import { RunModeChoice } from "@/components/collab/run-modes";
import { cn } from "@/lib/utils";
import { SCALE_LABELS, type ScaleType } from "./types";
import {
  DISPLAY_NAME_MAX,
  INITIAL_LOBBY,
  SESSION_NAME_MAX,
  deckFor,
  validateLobby,
  type LobbyDraft,
  type LobbyField,
  type StartValues,
} from "./lobby";

export interface StartData extends StartValues {
  /** Open the session with the queued stories already in it. */
  fromQueue?: boolean;
}

type StartMode = "plain" | "queue" | "live";

export function LobbyScreen({
  onStart,
  onLoadExample,
  isOwner,
  queuedCount = 0,
  onStartLive,
  liveRoomPending = false,
  onCancelLive,
}: {
  onStart: (data: StartData) => void;
  /** Omitted until auth settles, so the example can't beat a stored
   *  session to the restore. */
  onLoadExample?: () => void;
  isOwner: boolean;
  /** Stories other tools queued for estimation (Story Mapper). */
  queuedCount?: number;
  /** Visitors with live rooms switched on: start a visitor live room with
   *  this form's settings (asks for consent first). Omitted otherwise. */
  onStartLive?: (data: StartData) => void;
  /** A live room is opening and hasn't connected yet. */
  liveRoomPending?: boolean;
  onCancelLive?: () => void;
}) {
  // Which start button was pressed; Enter in a field is a plain start.
  const mode = useRef<StartMode>("plain");
  const form = useItemForm<LobbyDraft, StartValues, LobbyField>({
    initial: INITIAL_LOBBY,
    validate: validateLobby,
    resetOnSave: false,
    onSave: (values) => {
      const how = mode.current;
      mode.current = "plain";
      if (how === "live") onStartLive?.(values);
      else onStart({ ...values, fromQueue: how === "queue" });
    },
  });
  const { draft, update, errors } = form;
  const startAs = (how: StartMode) => {
    mode.current = how;
    if (!form.submit()) mode.current = "plain";
  };
  const preview = deckFor(draft);
  // A plain start, on this screen. Enter in a field does the same.
  const startButton = (
    <Button type="submit" className="font-semibold h-11">
      Start Session
    </Button>
  );

  return (
    <div className="max-w-xl mx-auto flex flex-col gap-6">
      <SectionCard
        title="Start a Session"
        className="border-border bg-surface"
        headerClassName="pb-4"
        contentClassName="flex flex-col gap-5"
      >
        <form
          ref={form.formRef}
          onSubmit={(e) => {
            mode.current = "plain";
            form.submit(e);
          }}
          noValidate
          className="flex flex-col gap-5"
        >
          <Field label="Session name" error={errors.sessionName}>
            {(props) => (
              <Input
                {...props}
                value={draft.sessionName}
                maxLength={SESSION_NAME_MAX}
                onChange={(e) => update({ sessionName: e.target.value })}
                placeholder="e.g. Sprint 42 Planning"
                className="bg-surface-deep border-border text-text"
              />
            )}
          </Field>

          <div className="flex flex-col gap-2">
            <span id="estimation-scale-label" className="text-sm font-medium leading-none text-sub">
              Estimation scale
            </span>
            <div role="group" aria-labelledby="estimation-scale-label" className="flex gap-2">
              {(["fibonacci", "tshirt", "custom"] as ScaleType[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => update({ scaleType: s })}
                  aria-pressed={draft.scaleType === s}
                  className={cn(
                    "flex-1 rounded-lg border py-2 px-3 text-sm font-medium transition-colors",
                    draft.scaleType === s
                      ? "border-accent/60 bg-accent/10 text-accent"
                      : "border-border bg-surface-deep text-sub hover:text-text"
                  )}
                >
                  {SCALE_LABELS[s]}
                </button>
              ))}
            </div>
            {draft.scaleType === "custom" && (
              <Field
                label="Card values"
                hint="Comma-separated, lowest first. Add ? for “can't estimate”."
                error={errors.customInput}
              >
                {(props) => (
                  <Input
                    {...props}
                    value={draft.customInput}
                    onChange={(e) => update({ customInput: e.target.value })}
                    placeholder="e.g. 1, 2, 4, 8"
                    className="bg-surface-deep border-border text-text text-sm"
                  />
                )}
              </Field>
            )}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {preview.map((v, i) => (
                <span
                  key={`${v}-${i}`}
                  className="rounded-md border border-border bg-surface-deep px-2 py-0.5 text-xs text-sub"
                >
                  {v}
                </span>
              ))}
            </div>
          </div>

          <Field label="Your display name" error={errors.displayName}>
            {(props) => (
              <Input
                {...props}
                value={draft.displayName}
                maxLength={DISPLAY_NAME_MAX}
                onChange={(e) => update({ displayName: e.target.value })}
                placeholder="e.g. Alice"
                className="bg-surface-deep border-border text-text"
              />
            )}
          </Field>

          {onStartLive ? (
            <RunModeChoice
              oneScreen={{
                description: "You run it here and share your screen. Add your team once it starts.",
                action: startButton,
              }}
              ownDevice={{
                description:
                  "Everyone votes from their own phone or laptop, through a link or a QR code.",
                action: liveRoomPending ? (
                  <div className="flex flex-wrap items-center gap-2" role="status">
                    <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden="true" />
                    <span className="text-sm text-text">Opening the live room…</span>
                    {onCancelLive && (
                      <Button type="button" variant="ghost" size="sm" onClick={onCancelLive}>
                        Cancel
                      </Button>
                    )}
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="toolkit"
                    onClick={() => startAs("live")}
                    className="gap-2"
                  >
                    <Radio className="h-4 w-4" aria-hidden="true" />
                    Start a live room
                  </Button>
                ),
              }}
            />
          ) : (
            startButton
          )}
        </form>
        {queuedCount > 0 && (
          <div className="flex flex-col gap-2 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2 text-sm text-text">
              <ListChecks className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
              {queuedCount} {queuedCount === 1 ? "story" : "stories"} queued for estimation
            </p>
            <Button type="button" variant="toolkit" size="sm" onClick={() => startAs("queue")}>
              Start with the queue
            </Button>
          </div>
        )}
        {onLoadExample && <LoadExampleButton onLoad={onLoadExample} className="self-center" />}
      </SectionCard>

      <SectionCard
        title={isOwner ? "Invite your squad" : "Running it with your team"}
        className="border-border bg-surface"
        headerClassName="pb-4"
        contentClassName="flex flex-col gap-2"
      >
        <p className="text-sm text-sub">
          {isOwner
            ? "Guest joiners use a squad invite (Settings → Squads). Once you start a session you can invite your squad from the header."
            : onStartLive
              ? "On one screen: share it in your meeting and add your team once it starts. Read each story aloud, record everyone's card face down or pass the screen round, then reveal together and agree the estimate. In a live room everyone picks their own card, and the room closes when you end it."
              : "This session runs on your screen. Share it in your meeting and add your team once it starts. Read each story aloud, record everyone's card face down or pass the screen round, then reveal together and agree the estimate."}
        </p>
      </SectionCard>
    </div>
  );
}
