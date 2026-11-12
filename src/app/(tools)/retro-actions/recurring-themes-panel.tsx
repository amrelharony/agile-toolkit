"use client";

/**
 * Recurring themes across the past retros (up to 52): what came up in three
 * or more of them, and what came back after its action was marked done.
 * The words the cards share make the themes without AI; Ask Amr names them
 * by meaning instead, read against the boards the same way (three retros
 * or more, real cards only). Below three past retros there's nothing to
 * say yet. Nothing here changes a retro.
 */

import { useMemo, useRef, useState } from "react";
import { Repeat } from "lucide-react";
import { AiButton } from "@/components/ai";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { retroActionsThemesTask } from "@/lib/ai/tasks/retro-actions";
import type { AiSource } from "@/lib/ai/task-types";
import type { RetroBoard } from "@/lib/stores/workspace-types";
import {
  RECURRING_MIN_RETROS,
  archivedCards,
  archivedRetroCount,
  themesFromAi,
  themesInput,
  type RecurringTheme,
} from "@/lib/retro/recurring-themes";

/** "3 Nov" for a done date. */
function dayOf(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
    : iso.slice(0, 10);
}

export function RecurringThemesPanel({
  boards,
  themes: keywordThemes,
  retroName,
  preview = false,
}: {
  boards: readonly RetroBoard[];
  /** The shared-word themes (`recurringThemes(boards)`), which the page's export holds too. */
  themes: readonly RecurringTheme[];
  /** A retro's name for the list: its sprint, else its format and date. */
  retroName: (boardId: string) => string;
  /** The page shows its example: no AI on it. */
  preview?: boolean;
}) {
  const count = archivedRetroCount(boards);
  const [ai, setAi] = useState<{ themes: RecurringTheme[]; source: AiSource } | null>(null);
  const [showAi, setShowAi] = useState(true);
  const textOf = useMemo(
    () => new Map(archivedCards(boards).map(({ card, board }) => [card.id, { card, board }])),
    [boards]
  );
  // What Amr was sent, built when he's asked: its short ids map his answer
  // back, even if the boards change while he thinks.
  const asked = useRef<ReturnType<typeof themesInput> | null>(null);

  if (count < RECURRING_MIN_RETROS) {
    return (
      <section aria-label="Recurring themes">
        <SectionCard title="Recurring themes" icon={Repeat}>
          <NotEnoughData
            have={count}
            need={RECURRING_MIN_RETROS}
            unit={["past retro", "past retros"]}
            action="Hold"
            what="the themes that keep coming up"
          />
        </SectionCard>
      </section>
    );
  }

  const fromAi = ai !== null && showAi;
  const themes = fromAi ? ai.themes : keywordThemes;
  const cameBack = themes.filter((t) => t.cameBack).length;

  return (
    <section aria-label="Recurring themes">
      <SectionCard
        title="Recurring themes"
        icon={Repeat}
        actions={
          !preview && textOf.size > 0 ? (
            <AiButton
              task={retroActionsThemesTask}
              input={() => {
                asked.current = themesInput(boards);
                return asked.current.input;
              }}
              label="Ask Amr to name the themes"
              fallbackLabel="Find themes without AI"
              variant="outline"
              onResult={(data, meta) => {
                const ids = asked.current?.ids ?? themesInput(boards).ids;
                setAi({ themes: themesFromAi(boards, ids, data.themes), source: meta.source });
                setShowAi(true);
              }}
            />
          ) : undefined
        }
      >
        <div className="space-y-3">
          <p className="text-xs text-sub">
            {fromAi
              ? ai.source === "ai"
                ? `Grouped by Amr across your last ${count} retros, kept where the cards span ${RECURRING_MIN_RETROS} or more.`
                : `Words the cards share across your last ${count} retros (Amr wasn't available).`
              : `Words the cards share across your last ${count} retros, kept where they come up in ${RECURRING_MIN_RETROS} or more.`}
            {cameBack > 0 &&
              ` ${cameBack} came back after an action on ${cameBack === 1 ? "it" : "them"} was marked done.`}
          </p>
          {ai && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => setShowAi((s) => !s)}
            >
              {showAi ? "Show the shared words instead" : "Show Amr's themes"}
            </Button>
          )}
          {themes.length === 0 ? (
            <p role="status" className="text-sm text-sub">
              Nothing came up in {RECURRING_MIN_RETROS} or more retros. Each retro raised something
              different.
            </p>
          ) : (
            <ul className="space-y-2">
              {themes.map((t) => (
                <li
                  key={`${t.name}:${t.cardIds[0]}`}
                  className="rounded-lg border border-border bg-bg px-3 py-2"
                >
                  <p className="text-sm text-text">
                    <span className="font-semibold">{t.name}</span>{" "}
                    <span className="text-xs text-sub">
                      · {t.boardIds.length} retros · {t.cardIds.length}{" "}
                      {t.cardIds.length === 1 ? "card" : "cards"}
                    </span>
                  </p>
                  <p className="text-xs text-sub">{t.boardIds.map(retroName).join(", ")}</p>
                  {t.cameBack && (
                    <p className="mt-1 text-xs font-medium text-warning">
                      Came back after done: “{t.cameBack.actionText}” was done on{" "}
                      {dayOf(t.cameBack.doneAt)}, and it came up again in{" "}
                      {retroName(t.cameBack.boardId)}.
                    </p>
                  )}
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs font-medium text-accent">
                      The cards
                    </summary>
                    <ul className="mt-1 space-y-0.5 text-xs text-sub">
                      {t.cardIds.map((id) => {
                        const hit = textOf.get(id);
                        if (!hit) return null;
                        return (
                          <li key={id} className="break-words">
                            {hit.card.text}{" "}
                            <span className="opacity-80">· {retroName(hit.board.id)}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SectionCard>
    </section>
  );
}
