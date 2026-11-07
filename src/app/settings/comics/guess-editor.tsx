"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { pickableTools } from "@/lib/comics/extras";
import {
  DEFAULT_GUESS_QUESTION,
  GUESS_LIMITS,
  TRY_ACTION_MAX,
  checkGuess,
  type GuessDraft,
  type StoryGuess,
} from "@/lib/comics/guess";
import { PortalError, errorMessage, portalApi, type GuessSave } from "./portal-api";

interface DraftGuess {
  question: string;
  options: string[];
  happened: number;
  note: string;
}

const blankGuess = (): DraftGuess => ({
  question: DEFAULT_GUESS_QUESTION,
  options: ["", "", ""],
  happened: 0,
  note: "",
});

const toForm = (g: StoryGuess): DraftGuess => ({ ...g, note: g.note ?? "" });

const fromForm = (g: DraftGuess): StoryGuess => ({
  question: g.question,
  options: g.options,
  happened: g.happened,
  ...(g.note.trim() ? { note: g.note } : {}),
});

/**
 * A saved story's guess and "Try it this week" line, above its quiz. An import
 * can leave a draft of both (and a suggested tool): it fills the form, and
 * nothing of it shows on the story until the owner saves, which is approving.
 * `onSaved` tells the portal a tool may have changed, so the quiz-and-tool form
 * below reloads instead of saving over it with what it read before.
 */
export function GuessEditor({
  ep,
  verified,
  onSaved,
}: {
  ep: number;
  verified: boolean;
  onSaved?: () => void;
}) {
  const toolNames = useMemo(() => new Map(pickableTools().map((t) => [t.id, t.name])), []);
  const [loaded, setLoaded] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [guess, setGuess] = useState<DraftGuess | null>(null);
  const [tryAction, setTryAction] = useState("");
  const [draft, setDraft] = useState<GuessDraft | null>(null);
  const [useDraftTool, setUseDraftTool] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!verified) return;
    let live = true;
    portalApi
      .storyGuess(ep)
      .then((body) => {
        if (!live) return;
        const shown = body.guess ?? body.draft?.guess ?? null;
        setGuess(shown ? toForm(shown) : null);
        setTryAction(body.tryAction ?? body.draft?.tryAction ?? "");
        setDraft(body.draft);
        setLoaded(true);
      })
      .catch((err) => {
        if (live) setUnavailable(errorMessage(err));
      });
    return () => {
      live = false;
    };
  }, [ep, verified]);

  const change = (update: Partial<DraftGuess>) => {
    setStatus(null);
    setGuess((current) => (current ? { ...current, ...update } : current));
  };

  const draftTool = draft?.tryTool ? toolNames.get(draft.tryTool) : undefined;

  const save = async () => {
    setError(null);
    setStatus(null);
    const body: GuessSave = {
      guess: guess ? fromForm(guess) : null,
      tryAction: tryAction.trim() ? tryAction : null,
      ...(draft?.tryTool && draftTool && useDraftTool ? { tryTool: draft.tryTool } : {}),
    };
    const checked = checkGuess(body);
    if (!checked.ok) {
      setError(
        checked.field === "guess"
          ? "The guess needs its question, two to four different options with none left blank, and the one panel 4 shows marked."
          : checked.field === "tryAction"
            ? `Keep Try it this week to ${TRY_ACTION_MAX} characters.`
            : "That tool can't be used under a story any more."
      );
      return;
    }
    setBusy(true);
    try {
      const saved = await portalApi.saveGuess(ep, body);
      setGuess(saved.guess ? toForm(saved.guess) : null);
      setTryAction(saved.tryAction ?? "");
      setDraft(saved.draft);
      setStatus(
        draft ? "Approved. The story's page shows it now." : "Saved. The story's page shows it now."
      );
      onSaved?.();
    } catch (err) {
      setError(err instanceof PortalError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-labelledby={`guess-${ep}`}
      className="mt-6 space-y-4 rounded-lg border border-border p-3"
    >
      <h3 id={`guess-${ep}`} className="font-semibold text-text">
        Guess and Try it this week
      </h3>
      {unavailable ? (
        <p role="alert" className="text-sm text-danger">
          {unavailable}
        </p>
      ) : !loaded ? (
        <p className="text-sm text-sub">Loading…</p>
      ) : (
        <>
          {draft ? (
            <div role="note" className="space-y-2 rounded-md border border-border p-3 text-sm">
              <p className="font-medium text-text">A draft is waiting for you</p>
              <p className="text-sub">
                It came in with the import. Check it against the panels, change anything, then Save
                and approve. Nothing of it shows on the story until you do.
              </p>
              {draftTool ? (
                <label className="flex min-h-11 items-center gap-2 text-text">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-accent"
                    checked={useDraftTool}
                    onChange={(e) => setUseDraftTool(e.target.checked)}
                  />
                  Use the suggested tool under the story: {draftTool}
                </label>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-sub">
              Both are optional. With a guess, readers see panels 1 to 3, pick what happens next,
              then the last panel shows with how other readers picked.
            </p>
          )}

          {guess ? (
            <fieldset className="space-y-3 rounded-md border border-border p-3">
              <legend className="px-1 text-sm font-medium text-text">The guess</legend>
              <Field label="Guess question">
                {(props) => (
                  <Input
                    {...props}
                    maxLength={GUESS_LIMITS.question}
                    value={guess.question}
                    onChange={(e) => change({ question: e.target.value })}
                  />
                )}
              </Field>
              <div role="radiogroup" aria-label="What the last panel shows" className="space-y-2">
                {guess.options.map((option, oi) => (
                  <div key={oi} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name={`guess-${ep}`}
                      aria-label={`The last panel shows option ${oi + 1}`}
                      className="h-5 w-5 shrink-0 accent-accent"
                      checked={guess.happened === oi}
                      onChange={() => change({ happened: oi })}
                    />
                    <Input
                      aria-label={`Option ${oi + 1}`}
                      maxLength={GUESS_LIMITS.option}
                      value={option}
                      onChange={(e) =>
                        change({
                          options: guess.options.map((o, i) => (i === oi ? e.target.value : o)),
                        })
                      }
                    />
                    {guess.options.length > GUESS_LIMITS.minOptions ? (
                      <Button
                        type="button"
                        variant="danger-ghost"
                        size="icon"
                        aria-label={`Remove option ${oi + 1}`}
                        onClick={() =>
                          change({
                            options: guess.options.filter((_, i) => i !== oi),
                            happened:
                              guess.happened === oi
                                ? 0
                                : guess.happened > oi
                                  ? guess.happened - 1
                                  : guess.happened,
                          })
                        }
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
              <p className="text-xs text-sub">Mark the option the last panel shows.</p>
              {guess.options.length < GUESS_LIMITS.maxOptions ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => change({ options: [...guess.options, ""] })}
                >
                  <Plus aria-hidden="true" />
                  Add an option
                </Button>
              ) : null}
              <Field label="After the reveal (optional)" hint="One line, shown with the results.">
                {(props) => (
                  <Textarea
                    {...props}
                    rows={2}
                    maxLength={GUESS_LIMITS.note}
                    value={guess.note}
                    onChange={(e) => change({ note: e.target.value })}
                  />
                )}
              </Field>
              <Button
                type="button"
                variant="danger-ghost"
                onClick={() => {
                  setStatus(null);
                  setGuess(null);
                }}
              >
                Remove the guess
              </Button>
            </fieldset>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setStatus(null);
                setGuess(blankGuess());
              }}
            >
              <Plus aria-hidden="true" />
              Add a guess
            </Button>
          )}

          <Field label="Try it this week" hint="One small thing a reader can do this week.">
            {(props) => (
              <Textarea
                {...props}
                rows={2}
                maxLength={TRY_ACTION_MAX}
                value={tryAction}
                onChange={(e) => {
                  setStatus(null);
                  setTryAction(e.target.value);
                }}
              />
            )}
          </Field>

          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          {status ? (
            <p role="status" className="text-sm text-sub">
              {status}
            </p>
          ) : null}
          <Button type="button" variant="toolkit" disabled={!verified || busy} onClick={save}>
            {draft ? "Save and approve" : "Save guess and action"}
          </Button>
        </>
      )}
    </section>
  );
}
