"use client";

/**
 * Team and sprint names: draw from a themed list (planets, rivers, cities…),
 * or ask Amr for names on any theme (with the built-in lists standing in
 * when AI is off), keep the ones the team likes on a shortlist, then vote on
 * it in Quick Vote or spin it on the wheel.
 *
 * AI only suggests: nothing reaches the shortlist until someone adds it, and
 * a name taken off the shortlist comes back with Undo (the page's).
 */

import { useState } from "react";
import Link from "next/link";
import { Disc3, Shuffle, Trash2, Vote } from "lucide-react";
import { AiButton, AiSuggestions } from "@/components/ai";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup } from "@/components/ui/toggle-group";
import type { AiSource } from "@/lib/ai/task-types";
import { THEME_TEXT_CHARS, themeNamesTask } from "@/lib/ai/tasks/picker";
import { PICKER_LIMITS } from "@/lib/picker/model";
import { MAX_THEME_DRAW, NAME_THEMES, drawThemeNames, themeById } from "@/lib/picker/themes";
import { nameKey } from "@/lib/team/names";
import { validateCount } from "./forms";

export interface NamesPanelProps {
  shortlist: readonly string[];
  onShortlist: (names: string[]) => void;
  onRemoveShortlist: (name: string) => void;
  onSpinShortlist: () => void;
}

interface Suggestions {
  items: string[];
  source: AiSource;
  title: string;
}

/** Quick Vote's poll, filled in from the shortlist. */
export function quickVoteHref(shortlist: readonly string[]): string {
  const params = new URLSearchParams({
    preset: "poll",
    question: "Which name should we pick?",
    options: shortlist.join("\n"),
  });
  return `/quick-vote?${params.toString()}`;
}

const THEME_OPTIONS = NAME_THEMES.map((t) => ({ value: t.id, label: t.label }));

export function NamesPanel({
  shortlist,
  onShortlist,
  onRemoveShortlist,
  onSpinShortlist,
}: NamesPanelProps) {
  const [theme, setTheme] = useState(NAME_THEMES[0].id);
  const [countText, setCountText] = useState("8");
  const [own, setOwn] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);
  const [countError, setCountError] = useState<string | undefined>();
  const shortlisted = new Set(shortlist.map(nameKey));
  const full = shortlist.length >= PICKER_LIMITS.maxShortlist;

  const readCount = (): number | null => {
    const checked = validateCount(countText, MAX_THEME_DRAW);
    if (!checked.ok) {
      setCountError(checked.errors.count);
      return null;
    }
    setCountError(undefined);
    return checked.values;
  };

  const show = (items: readonly string[], source: AiSource, title: string) => {
    const seen = new Set<string>();
    const fresh = items.filter((n) => {
      const key = nameKey(n);
      if (!key || seen.has(key) || shortlisted.has(key)) return false;
      seen.add(key);
      return true;
    });
    setSuggestions({ items: fresh, source, title });
  };

  const ownTheme = own.replace(/\s+/g, " ").trim();
  const countCheck = validateCount(countText, MAX_THEME_DRAW);

  return (
    <section aria-labelledby="picker-names-heading" className="space-y-4">
      <div className="space-y-1">
        <h2 id="picker-names-heading" className="text-base font-semibold text-text">
          Team and sprint names
        </h2>
        <p className="text-sm text-sub">
          Draw ideas, shortlist the ones the team likes, then vote on them.
        </p>
      </div>

      <div className="space-y-3 rounded-lg border border-border bg-card p-3 sm:p-4">
        <ToggleGroup
          label="Theme"
          options={THEME_OPTIONS}
          value={theme}
          onValueChange={setTheme}
          size="sm"
        />
        <Field
          label="How many names"
          hint={`1 to ${MAX_THEME_DRAW}.`}
          error={countError}
          className="max-w-40"
        >
          {(p) => (
            <Input
              {...p}
              inputMode="numeric"
              value={countText}
              onChange={(e) => {
                setCountText(e.target.value);
                // Once shown, the message follows the typing; it goes when the number is fixed.
                if (countError && validateCount(e.target.value, MAX_THEME_DRAW).ok) {
                  setCountError(undefined);
                }
              }}
            />
          )}
        </Field>
        <Button
          type="button"
          variant="toolkit"
          className="gap-1.5"
          onClick={() => {
            const n = readCount();
            if (n === null) return;
            show(drawThemeNames(theme, n), "fallback", themeById(theme)?.label ?? "Name ideas");
          }}
        >
          <Shuffle aria-hidden="true" />
          Draw names
        </Button>

        <div className="space-y-2 border-t border-border pt-3">
          <Field
            label="Or your own theme"
            hint="Such as jazz legends, famous ships or sea creatures."
          >
            {(p) => (
              <Input
                {...p}
                value={own}
                maxLength={THEME_TEXT_CHARS}
                onChange={(e) => setOwn(e.target.value)}
              />
            )}
          </Field>
          <AiButton
            task={themeNamesTask}
            input={() => ({
              theme: ownTheme,
              count: countCheck.ok ? countCheck.values : 8,
              seed: Math.floor(Math.random() * 4_294_967_295),
            })}
            label="Ask Amr for names"
            fallbackLabel="Suggest names"
            disabledReason={
              ownTheme.length < 2
                ? "Type a theme first."
                : !countCheck.ok
                  ? countCheck.errors.count
                  : null
            }
            onResult={(data, meta) => show(data.names, meta.source, `Names on “${ownTheme}”`)}
          />
        </div>
      </div>

      {suggestions &&
        (suggestions.items.length > 0 ? (
          <AiSuggestions
            items={suggestions.items}
            source={suggestions.source}
            title={suggestions.title}
            acceptLabel="Shortlist"
            onAccept={(name) => onShortlist([name])}
            onAcceptAll={(names) => onShortlist(names)}
            onDismiss={() => setSuggestions(null)}
          />
        ) : (
          <p role="status" className="text-sm text-sub">
            Those names are all on the shortlist already. Try another theme.
          </p>
        ))}

      <div className="space-y-3 rounded-lg border border-border bg-card p-3 sm:p-4">
        <h3 className="text-sm font-semibold text-text">Shortlist</h3>
        {shortlist.length === 0 ? (
          <p className="text-sm text-sub">Nothing shortlisted yet.</p>
        ) : (
          <>
            <ul className="divide-y divide-rule">
              {shortlist.map((name) => (
                <li key={nameKey(name)} className="flex items-center justify-between gap-2 py-1">
                  <span className="min-w-0 truncate text-sm text-text">{name}</span>
                  <Button
                    type="button"
                    size="icon"
                    variant="danger-ghost"
                    aria-label={`Take ${name} off the shortlist`}
                    onClick={() => onRemoveShortlist(name)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
            {full && (
              <p className="text-xs text-sub">
                The shortlist holds {PICKER_LIMITS.maxShortlist} names. Take some off to add more.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {shortlist.length >= 2 && (
                <Button asChild size="sm" variant="toolkit" className="gap-1.5">
                  <Link href={quickVoteHref(shortlist)}>
                    <Vote aria-hidden="true" />
                    Vote in Quick Vote
                  </Link>
                </Button>
              )}
              {shortlist.length >= 2 && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={onSpinShortlist}
                >
                  <Disc3 aria-hidden="true" />
                  Spin the shortlist
                </Button>
              )}
              <CopyButton text={shortlist.join("\n")} label="Copy the list" />
            </div>
          </>
        )}
      </div>
    </section>
  );
}
