"use client";

import { useState } from "react";
import { Tags } from "lucide-react";
import { AiButton, AiSuggestions } from "@/components/ai";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { AiSource } from "@/lib/ai/task-types";
import { MIXER_LIMITS } from "@/lib/team-mixer/model";
import { suggestGroupNames, themeFor } from "@/lib/team-mixer/names";
import { GROUP_NAME_AI } from "./group-name-task";

const THEME_MAX = 60;
/** The shortest theme Picker's task takes. */
const THEME_MIN = 2;

interface Suggestion {
  name: string;
  /** The group it would name, from 0. */
  index: number;
}

export interface GroupNamerProps {
  /** How many groups there are to name. */
  count: number;
  /** "Group", "Pair" or "Table", for the words. */
  unit: string;
  /** Name groups by place: null leaves one as it is (Undo is the caller's). */
  onApply: (names: (string | null)[]) => void;
}

/**
 * Fun names for the groups. "Suggest names" picks from short built-in
 * lists (no AI); where Amr's AI is on, "Ask Amr for names" asks it for a
 * theme. Either way the names are only suggestions: they reach the groups
 * when the person uses them, with Undo. The AI gets the theme and a count,
 * never who is in a group.
 */
export function GroupNamer({ count, unit, onApply }: GroupNamerProps) {
  const [theme, setTheme] = useState("");
  const [suggested, setSuggested] = useState<{
    items: Suggestion[];
    source: AiSource;
    /** The list the names came from, for the title ("Trees"). */
    list?: string;
    /** Said when the typed theme has no list of its own. */
    note?: string;
  } | null>(null);
  const ai = GROUP_NAME_AI;
  const wanted = Math.min(count, MIXER_LIMITS.groups);

  // Each suggestion keeps its group's place, so "Use all" after one "Use"
  // still names the right groups.
  const show = (
    names: readonly string[],
    source: AiSource,
    about: { list?: string; note?: string } = {}
  ) => setSuggested({ items: names.map((name, index) => ({ name, index })), source, ...about });
  // The built-in lists: a theme they don't know gets one at random, and
  // the page says which instead of passing it off as the theme asked for.
  const suggestBuiltIn = () => {
    const typed = theme.trim();
    const r = suggestGroupNames(typed, wanted);
    show(r.names, "fallback", {
      list: r.theme.label,
      ...(typed && !themeFor(typed)
        ? { note: `No list for that theme, so here are ${r.theme.label.toLowerCase()}.` }
        : {}),
    });
  };
  const apply = (items: readonly Suggestion[]) => {
    const names: (string | null)[] = Array.from({ length: wanted }, () => null);
    for (const it of items) names[it.index] = it.name;
    onApply(names);
  };

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="flex items-center gap-2">
        <Tags className="h-4 w-4 text-sub" aria-hidden="true" />
        <p className="text-sm font-medium text-text">Name the {unit.toLowerCase()}s</p>
      </div>
      <Field label="Theme (optional)" hint="Planets, rivers, trees, birds, colours, spices…">
        {(props) => (
          <Input
            {...props}
            value={theme}
            maxLength={THEME_MAX}
            onChange={(e) => setTheme(e.target.value)}
          />
        )}
      </Field>
      <div className="flex flex-wrap items-start gap-2">
        <Button type="button" size="sm" variant="outline" onClick={suggestBuiltIn}>
          Suggest names
        </Button>
        {/* No fallbackLabel: "Suggest names" beside it is the no-AI path, and
            works with no theme too, so AI being off shows one button, not two. */}
        {ai && (
          <AiButton
            task={ai.task}
            input={() => ai.input(theme.trim(), Math.min(wanted, ai.max))}
            disabledReason={
              theme.trim().length >= THEME_MIN
                ? null
                : "Type a theme first, such as planets or rivers."
            }
            label="Ask Amr for names"
            onResult={(data, meta) =>
              show(
                ai
                  .names(data)
                  .map((n) => n.trim().slice(0, MIXER_LIMITS.groupName))
                  .filter(Boolean)
                  .slice(0, wanted),
                meta.source
              )
            }
          />
        )}
      </div>
      {suggested?.note && <p className="text-sm text-sub">{suggested.note}</p>}
      {suggested && suggested.items.length > 0 && (
        <AiSuggestions
          items={suggested.items}
          source={suggested.source}
          title={suggested.list ? `Suggested names: ${suggested.list}` : "Suggested names"}
          acceptLabel="Use"
          render={(it) => ({ title: it.name, detail: `For ${unit} ${it.index + 1}` })}
          onAccept={(it) => apply([it])}
          // The list stays: it hides what was used, says "All added." and
          // takes focus on its heading; Dismiss clears it.
          onAcceptAll={(items) => apply(items)}
          onDismiss={() => setSuggested(null)}
        />
      )}
    </div>
  );
}
