"use client";

/**
 * An Improvement Kata's storyboard, phone first: the challenge, the next
 * target (Reached it keeps it as a past one, with Undo), where things are
 * with the readings, the obstacles (one worked on at a time) and the
 * experiments, each a Plan-Do-Check-Act record. Coach me walks the short
 * coaching talk over it. Ask Amr suggests the next experiment against the
 * obstacle being worked on; the person picks one. Example Katas show no AI
 * buttons.
 */

import { useEffect, useId, useRef, useState } from "react";
import {
  CalendarClock,
  CircleAlert,
  FlaskConical,
  Flag,
  Map as MapIcon,
  MapPin,
  MessagesSquare,
  Mountain,
  Trash2,
  Trophy,
} from "lucide-react";
import { AiButton, AiSuggestions } from "@/components/ai";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { BlurTextarea } from "@/components/shared/blur-fields";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { improveNextExperimentTask } from "@/lib/ai/tasks/improve.lite";
import { experimentBlocker, experimentInput } from "@/lib/improve/ai-input";
import {
  STEP_REFUSAL_TEXT,
  coachingDue,
  composeCondition,
  hasCondition,
  kataChecks,
  workingObstacle,
  type StepDone,
} from "@/lib/improve/model";
import { todayIso } from "@/lib/sprints/series";
import { TOOL_LIST_MAX, TOOL_TEXT_MAX, type Improvement } from "@/lib/stores/workspace-types";
import { CoachWalk } from "./coach-walk";
import { ConditionFields, FieldLabel, ItemStatusSelect, PersonField } from "./fields";
import { ObstacleList } from "./obstacle-list";
import { Readings } from "./readings";
import { StepList } from "./step-list";
import type { ItemActions } from "./use-item-actions";
import { useStepIdeas } from "./use-step-ideas";

/** Ask Amr's ideas for the next step, and the ones picked (exported for its tests). */
export function NextExperimentIdeas({
  item,
  actions,
}: {
  item: Improvement;
  actions: ItemActions;
}) {
  const askRef = useRef<HTMLDivElement>(null);
  const announce = useAnnounce();
  const ideas = useStepIdeas<{ step: string; expect: string }>();
  const { suggested } = ideas;
  const input = experimentInput(item);
  const working = workingObstacle(item);
  const full = item.steps.length >= TOOL_LIST_MAX.improveSteps;
  return (
    <div className="space-y-2">
      <div ref={askRef}>
        <AiButton
          task={improveNextExperimentTask}
          input={() =>
            input ?? {
              challenge: "",
              target: "",
              current: "",
              metric: "",
              obstacle: "",
              past: [],
            }
          }
          disabledReason={full ? STEP_REFUSAL_TEXT.list_full : experimentBlocker(item)}
          label="Ask Amr for the next experiment"
          fallbackLabel="Suggest without AI"
          onResult={(data, meta) => {
            ideas.show(data.experiments, meta.source);
            const n = data.experiments.length;
            announce(
              `${n} possible next ${n === 1 ? "experiment" : "experiments"} below. Pick one.`
            );
          }}
        />
      </div>
      {suggested && suggested.items.length > 0 && (
        <AiSuggestions
          items={suggested.items}
          itemKey={ideas.itemKey}
          source={suggested.source}
          title="Possible next experiments"
          acceptLabel="Plan"
          pickOne
          render={(e) => ({ title: e.step, detail: `Expect: ${e.expect}` })}
          onAccept={(e) => {
            const why = actions.addStep(
              {
                text: e.step,
                expect: e.expect,
                status: "planned",
                ...(working ? { obstacleId: working.id } : {}),
              },
              { fromAi: true }
            );
            // Refused: the ideas stay, with the reason beside them.
            if (!ideas.settle(e, why)) return;
            ideas.close();
            requestAnimationFrame(() =>
              askRef.current?.querySelector<HTMLElement>("button")?.focus()
            );
          }}
          onDismiss={ideas.close}
          returnFocus={() => askRef.current?.querySelector<HTMLElement>("button")}
        />
      )}
      {ideas.refusal && (
        <p role="alert" className="text-xs text-danger">
          {ideas.refusal}
        </p>
      )}
    </div>
  );
}

export function KataView({
  item,
  done,
  actions,
}: {
  item: Improvement;
  done: StepDone;
  actions: ItemActions;
}) {
  const today = todayIso();
  const ids = useId();
  const [coaching, setCoaching] = useState(false);
  const coachRef = useRef<HTMLButtonElement>(null);
  const backToCoach = useRef(false);
  const targetRef = useRef<HTMLDivElement>(null);
  const reachedRef = useRef<HTMLButtonElement>(null);
  /** After a past target's delete: the row to focus, or Reached it ("reached"). */
  const [pastFocus, setPastFocus] = useState<number | "reached" | null>(null);
  const checks = kataChecks(item, today);
  const due = coachingDue(item, today);
  const past = item.pastTargets ?? [];

  useEffect(() => {
    if (coaching || !backToCoach.current) return;
    backToCoach.current = false;
    coachRef.current?.focus();
  }, [coaching]);

  // After a past target's delete, focus goes to the next one's delete, else to
  // Reached it (or, while there is no target to reach, the target's words).
  useEffect(() => {
    if (pastFocus === null) return;
    setPastFocus(null);
    if (pastFocus !== "reached") {
      document.getElementById(`${ids}-past-${pastFocus}`)?.focus();
      return;
    }
    const reached = reachedRef.current;
    if (reached && !reached.disabled) reached.focus();
    else targetRef.current?.querySelector<HTMLElement>("textarea")?.focus();
  }, [pastFocus, ids]);

  const removePast = (at: number) => {
    actions.removePastTarget(at);
    const left = past.length - 1;
    setPastFocus(left > 0 ? Math.min(at, left - 1) : "reached");
  };

  return (
    <div className="space-y-4">
      <SectionCard title="Coaching" icon={MessagesSquare}>
        {coaching ? (
          <CoachWalk
            item={item}
            onSave={actions.saveCoaching}
            onClose={() => {
              backToCoach.current = true;
              setCoaching(false);
            }}
          />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                ref={coachRef}
                type="button"
                onClick={() => setCoaching(true)}
                className="gap-1.5"
              >
                <MessagesSquare aria-hidden="true" />
                Coach me
              </Button>
              <p className="flex items-center gap-1.5 text-sm text-sub">
                <CalendarClock className="h-4 w-4" aria-hidden="true" />
                {item.nextCoachingAt
                  ? due
                    ? `The talk is due (${item.nextCoachingAt}).`
                    : `Next talk: ${item.nextCoachingAt}.`
                  : "No talk planned yet."}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <PersonField
                label="Coach"
                value={item.coach ?? ""}
                onCommit={(name) => actions.setPerson("coach", name)}
              />
              <ItemStatusSelect value={item.status} onChange={actions.setStatus} />
            </div>
          </div>
        )}
      </SectionCard>

      {checks.length > 0 && (
        <ul
          aria-label="Checks"
          className="space-y-1 rounded-lg border border-warning/40 bg-warning/10 px-4 py-2"
        >
          {checks.map((c) => (
            <li key={c.id} className="flex items-start gap-2 text-sm text-text">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
              {c.text}
            </li>
          ))}
        </ul>
      )}

      <SectionCard title="Challenge" icon={Mountain}>
        <FieldLabel htmlFor={`kata-challenge-${item.id}`}>
          Where the team wants to be in the long run
        </FieldLabel>
        <BlurTextarea
          id={`kata-challenge-${item.id}`}
          rows={2}
          value={item.background}
          maxLength={TOOL_TEXT_MAX.text}
          placeholder="Every change reviewed within a working day."
          onCommit={(text) => actions.setText("background", text)}
        />
      </SectionCard>

      <SectionCard title="Next target" icon={Flag}>
        <div ref={targetRef} className="space-y-3">
          <ConditionFields
            condition={item.target}
            wordsLabel="The next target, a few weeks away"
            wordsPlaceholder="The median first review starts within 8 hours."
            dateLabel="By when"
            onChange={(patch) => actions.setCondition("target", patch)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              ref={reachedRef}
              type="button"
              variant="outline"
              size="sm"
              onClick={actions.reachTarget}
              disabled={!hasCondition(item.target)}
              className="gap-1.5"
            >
              <Trophy aria-hidden="true" />
              Reached it
            </Button>
            <p className="text-xs text-sub">
              {hasCondition(item.target)
                ? "Keeps it as a past target; where you are becomes the start of the next one."
                : "Set the next target."}
            </p>
          </div>
          {past.length > 0 && (
            <section aria-labelledby={`kata-past-${item.id}`} className="space-y-1">
              <h3 id={`kata-past-${item.id}`} className="text-xs font-medium text-sub">
                Past targets
              </h3>
              <ol className="space-y-1">
                {past.map((t, i) => (
                  <li
                    key={`${t.reachedAt}-${i}`}
                    className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-1 text-sm"
                  >
                    <span className="min-w-0 flex-1 break-words text-text">
                      {composeCondition(t) || "A target with no words"}
                    </span>
                    <span className="text-xs text-sub">reached {t.reachedAt.slice(0, 10)}</span>
                    <Button
                      id={`${ids}-past-${i}`}
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removePast(i)}
                      aria-label={`Delete the past target ${i + 1}`}
                      className="text-sub hover:text-danger"
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Where we are" icon={MapPin}>
        <div className="space-y-4">
          <ConditionFields
            condition={item.current}
            wordsLabel="Where things stand"
            wordsPlaceholder="Reviews wait most of a working day."
            dateLabel="As of"
            onChange={(patch) => actions.setCondition("current", patch)}
          />
          <Readings item={item} actions={actions} />
        </div>
      </SectionCard>

      <SectionCard title="Obstacles" icon={MapIcon}>
        <ObstacleList item={item} actions={actions} />
      </SectionCard>

      <SectionCard title="Experiments" icon={FlaskConical}>
        <StepList
          item={item}
          done={done}
          actions={actions}
          heading="Each one: what we'll try, what we expect, what happened, what we learned"
          ai={actions.example ? undefined : <NextExperimentIdeas item={item} actions={actions} />}
        />
      </SectionCard>
    </div>
  );
}
