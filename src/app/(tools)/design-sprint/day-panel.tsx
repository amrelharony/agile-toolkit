"use client";

import { Lightbulb } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import type {
  DesignSprintDayNumber,
  DesignSprintOutput,
  DesignSprintPlan,
} from "@/lib/stores/workspace-types";
import { DESIGN_SPRINT_ACTIONS } from "@/lib/history/event-actions";
import { DESIGN_SPRINT_DAY_NAMES, DESIGN_SPRINT_DAY_PURPOSE } from "@/lib/design-sprint/plan";
import { QuestionAnswers } from "./answers";
import { dayOutputs, dayTasks, planDay, sprintQuestions } from "./doc";
import { OutputSlotSection } from "./output-slot";
import { ANSWER_LABEL, DAY_SLOTS, outputsIn, type OutputSlot } from "./outputs";
import { TaskList } from "./tasks";
import {
  addOutput,
  addTask,
  outputLinks,
  removeOutput,
  removeTask,
  saveOutput,
  saveTask,
  setAnswer,
  setOutputLinks,
  toggleTask,
} from "./writes";

/** Log a history event; the page skips it for the example. */
export type RecordEvent = (action: string, payload?: { [key: string]: unknown }) => void;

const short = (text: string, max = 60) => {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

/**
 * One day of the sprint: what it's for, its checklist, and a place for each
 * thing it produces. Test day also answers the Map day's sprint questions.
 * Remount it per day (key) so an open editor doesn't follow the user to
 * another day.
 */
export function DayPanel({
  plan,
  day,
  date,
  isToday,
  example,
  record,
  announce,
  onOpenDay,
}: {
  plan: DesignSprintPlan;
  day: DesignSprintDayNumber;
  /** "Wed 21 Oct", or "" without a valid start date. */
  date: string;
  isToday: boolean;
  /** The example: no hand-offs, and no "Add to the team" for its names. */
  example: boolean;
  record: RecordEvent;
  announce: (message: string) => void;
  onOpenDay: (day: DesignSprintDayNumber) => void;
}) {
  const current = planDay(plan, day);
  const outputs = dayOutputs(current);
  const name = DESIGN_SPRINT_DAY_NAMES[day];
  const label = `Day ${day} · ${name}`;
  const slots = DAY_SLOTS[day];
  const notes = slots.filter((s) => s.kind === "note");
  const typed = slots.filter((s) => s.kind !== "note");

  const section = (slot: OutputSlot) => (
    <OutputSlotSection
      key={slot.kind}
      slot={slot}
      outputs={outputsIn(day, slot, outputs)}
      canSend={!example}
      planId={plan.id}
      onAdd={(values) => {
        const added = addOutput(day, slot.kind, values);
        if (added) {
          record(DESIGN_SPRINT_ACTIONS.OUTPUT_ADDED, { day, kind: slot.kind, outputId: added.id });
          announce(`Added the ${slot.noun} “${short(added.text)}”.`);
        }
        return added;
      }}
      onSave={(o, values) => {
        if (saveOutput(day, slot, o, values)) announce(`Saved the ${slot.noun}.`);
      }}
      onRemove={(o) => {
        removeOutput(day, o, slot.noun);
        record(DESIGN_SPRINT_ACTIONS.OUTPUT_REMOVED, { day, kind: o.kind, outputId: o.id });
      }}
      onLinksChange={(o, update) => {
        for (const link of setOutputLinks(day, o.id, update)) {
          record(DESIGN_SPRINT_ACTIONS.FINDING_SENT, {
            day,
            findingId: o.id,
            route: link.route,
            targetId: link.targetId,
          });
        }
      }}
      getLinks={(o) => outputLinks(day, o.id)}
    />
  );

  const answer = (q: DesignSprintOutput, value: keyof typeof ANSWER_LABEL | null) => {
    setAnswer(q.id, value);
    announce(
      value
        ? `Answered “${short(q.text)}”: ${ANSWER_LABEL[value].toLowerCase()}.`
        : `Cleared the answer to “${short(q.text)}”.`
    );
  };

  return (
    <SectionCard
      title={label}
      icon={Lightbulb}
      titleSuffix={
        <span className="text-sm font-normal text-sub">
          {date}
          {isToday && <span className="ml-2 text-accent">Today</span>}
        </span>
      }
      contentClassName="space-y-6"
      className="mb-4"
    >
      <p className="text-sm text-sub">{DESIGN_SPRINT_DAY_PURPOSE[day]}</p>
      <TaskList
        tasks={dayTasks(current)}
        dayLabel={label}
        offerAddToRoster={!example}
        onToggle={(task) => {
          const done = toggleTask(day, task.id);
          if (done === null) return;
          record(DESIGN_SPRINT_ACTIONS.TASK_TOGGLED, {
            day,
            taskId: task.id,
            text: task.text,
            done,
          });
        }}
        onAdd={(values) => {
          const task = addTask(day, values.text);
          if (task) announce(`Added the task “${short(task.text)}” to ${label}.`);
        }}
        onSave={(task, values) => {
          if (!saveTask(day, task, values)) return;
          if ((task.owner || undefined) !== values.owner) {
            record(DESIGN_SPRINT_ACTIONS.TASK_OWNER_ASSIGNED, {
              day,
              taskId: task.id,
              text: values.text,
              owner: values.owner ?? null,
            });
          }
          announce("Saved the task.");
        }}
        onRemove={(task) => removeTask(day, task)}
      />
      {typed.map(section)}
      {day === 5 && (
        <QuestionAnswers
          questions={sprintQuestions(plan)}
          onAnswer={answer}
          onOpenMap={() => onOpenDay(1)}
        />
      )}
      {notes.map(section)}
    </SectionCard>
  );
}
