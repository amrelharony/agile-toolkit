"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Pencil, Plus, Trash2, User } from "lucide-react";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { PersonPicker } from "@/components/team/person-picker";
import { useReturnFocus } from "@/hooks/use-return-focus";
import type { DesignSprintTask } from "@/lib/stores/workspace-types";
import { cn } from "@/lib/utils";
import type { Validation } from "@/lib/utils/form";
import { PERSON_MAX, TASK_TEXT_MAX } from "./doc";

/**
 * A day's checklist: tick a task off, edit its text and owner in place
 * (the owner is picked from the team roster), delete it with Undo, and add
 * one through a form that saves nothing until there is text.
 */

interface TaskDraft {
  text: string;
  owner: string;
}

type TaskField = keyof TaskDraft;

export interface TaskValues {
  text: string;
  owner?: string;
}

export function validateTask(d: TaskDraft): Validation<TaskValues, TaskField> {
  const errors: Partial<Record<TaskField, string>> = {};
  const text = d.text.trim();
  const owner = d.owner.trim();
  if (!text) errors.text = "Describe the task.";
  else if (text.length > TASK_TEXT_MAX) errors.text = `Keep it under ${TASK_TEXT_MAX} characters.`;
  if (owner.length > PERSON_MAX) errors.owner = "That name is too long.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, values: { text, ...(owner ? { owner } : {}) } };
}

export function TaskList({
  tasks,
  dayLabel,
  offerAddToRoster,
  onToggle,
  onAdd,
  onSave,
  onRemove,
}: {
  tasks: readonly DesignSprintTask[];
  /** "Day 1 · Map", for the list's name. */
  dayLabel: string;
  offerAddToRoster: boolean;
  onToggle: (task: DesignSprintTask) => void;
  onAdd: (values: TaskValues) => void;
  onSave: (task: DesignSprintTask, values: TaskValues) => void;
  onRemove: (task: DesignSprintTask, index: number) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const { refFor, returnTo } = useReturnFocus();
  const done = tasks.filter((t) => t.done).length;

  const close = (task: DesignSprintTask) => {
    setEditingId(null);
    returnTo(`task:${task.id}`);
  };

  // The deleted row takes its buttons with it: focus moves on to the next
  // task (else the previous one), or to the add field once none are left.
  const remove = (task: DesignSprintTask, index: number) => {
    const neighbour = tasks[index + 1] ?? tasks[index - 1];
    returnTo(neighbour ? `task:${neighbour.id}` : "task:add");
    onRemove(task, index);
  };

  return (
    <section aria-label={`Tasks, ${dayLabel}`} className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-sub">
        Tasks{" "}
        <span className="font-data font-normal normal-case tracking-normal">
          ({done} of {tasks.length} done)
        </span>
      </h3>
      {tasks.length === 0 ? (
        <p className="text-sm text-sub">No tasks for this day.</p>
      ) : (
        <ul className="space-y-2">
          {tasks.map((task, i) => (
            <li key={task.id} className="rounded border border-border bg-bg p-2">
              {editingId === task.id ? (
                <TaskEditor
                  task={task}
                  offerAddToRoster={offerAddToRoster}
                  onSave={(values) => {
                    close(task);
                    onSave(task, values);
                  }}
                  onCancel={() => close(task)}
                />
              ) : (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={task.done}
                    aria-label={task.text}
                    onClick={() => onToggle(task)}
                    className={cn(
                      "min-touch-coarse flex h-5 w-5 shrink-0 items-center justify-center rounded border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                      task.done ? "border-accent bg-accent" : "border-border hover:border-accent/40"
                    )}
                  >
                    {task.done && <CheckCircle2 className="h-3 w-3 text-bg" aria-hidden="true" />}
                  </button>
                  <span
                    className={cn(
                      "min-w-0 flex-1 basis-40 break-words text-sm",
                      task.done ? "text-sub line-through" : "text-text"
                    )}
                  >
                    {task.text}
                  </span>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 text-xs",
                      task.owner ? "text-text" : "text-sub"
                    )}
                  >
                    <User className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="sr-only">Owner: </span>
                    {task.owner || "No owner"}
                  </span>
                  <span className="flex shrink-0 items-center">
                    <IconButton
                      ref={refFor(`task:${task.id}`)}
                      label={`Edit task: ${task.text}`}
                      icon={<Pencil className="h-4 w-4" />}
                      className="text-sub hover:text-text"
                      onClick={() => setEditingId(task.id)}
                    />
                    <IconButton
                      label={`Delete task: ${task.text}`}
                      icon={<Trash2 className="h-4 w-4" />}
                      className="text-sub hover:text-danger"
                      onClick={() => remove(task, i)}
                    />
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <TaskAddForm onAdd={onAdd} inputRef={refFor("task:add")} />
    </section>
  );
}

function TaskAddForm({
  onAdd,
  inputRef,
}: {
  onAdd: (values: TaskValues) => void;
  inputRef: (el: HTMLInputElement | null) => void;
}) {
  const form = useItemForm<TaskDraft, TaskValues, TaskField>({
    initial: { text: "", owner: "" },
    validate: validateTask,
    onSave: onAdd,
  });
  return (
    <ItemForm
      form={form}
      submitLabel="Add task"
      submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
      className="pt-1"
    >
      <Field label="New task" hideLabel error={form.errors.text}>
        {(props) => (
          <Input
            {...props}
            ref={inputRef}
            value={form.draft.text}
            onChange={(e) => form.update({ text: e.target.value })}
            placeholder="Add a task for this day"
          />
        )}
      </Field>
    </ItemForm>
  );
}

function TaskEditor({
  task,
  offerAddToRoster,
  onSave,
  onCancel,
}: {
  task: DesignSprintTask;
  offerAddToRoster: boolean;
  onSave: (values: TaskValues) => void;
  onCancel: () => void;
}) {
  const form = useItemForm<TaskDraft, TaskValues, TaskField>({
    initial: { text: task.text, owner: task.owner ?? "" },
    validate: validateTask,
    onSave,
    resetOnSave: false,
  });
  const { formRef } = form;
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>("input")?.focus();
  }, [formRef]);
  return (
    <ItemForm form={form} submitLabel="Save" onCancel={onCancel}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Field label="Task" error={form.errors.text} required>
          {(props) => (
            <Input
              {...props}
              value={form.draft.text}
              onChange={(e) => form.update({ text: e.target.value })}
            />
          )}
        </Field>
        <PersonPicker
          label="Owner"
          hint="Leave empty for no owner."
          value={form.draft.owner}
          onChange={(owner) => form.update({ owner })}
          error={form.errors.owner}
          placeholder="Name"
          offerAddToRoster={offerAddToRoster}
        />
      </div>
    </ItemForm>
  );
}
