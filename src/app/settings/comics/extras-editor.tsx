"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { QUIZ_LIMITS, checkExtras, pickableTools, type QuizQuestion } from "@/lib/comics/extras";
import { PortalError, errorMessage, portalApi } from "./portal-api";

/** "From the story's theme": the Select can't hold an empty value. */
const THEME = "theme";

interface DraftQuestion {
  question: string;
  options: string[];
  answer: number;
  explain: string;
}

const blankQuestion = (): DraftQuestion => ({
  question: "",
  options: ["", ""],
  answer: 0,
  explain: "",
});

const toDraft = (q: QuizQuestion): DraftQuestion => ({ ...q, explain: q.explain ?? "" });

const fromDraft = (q: DraftQuestion): QuizQuestion => ({
  question: q.question,
  options: q.options,
  answer: q.answer,
  ...(q.explain.trim() ? { explain: q.explain } : {}),
});

/**
 * A saved story's quiz and own tool, under its editor. They save on their own,
 * through their own route: the story's fields don't wait on them, and before
 * migration 0033 runs this says so instead of failing the story's save.
 */
export function ExtrasEditor({ ep, verified }: { ep: number; verified: boolean }) {
  const tools = useMemo(() => pickableTools(), []);
  const [loaded, setLoaded] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [quiz, setQuiz] = useState<DraftQuestion[]>([]);
  const [tool, setTool] = useState(THEME);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!verified) return;
    let live = true;
    portalApi
      .storyExtras(ep)
      .then(({ extras }) => {
        if (!live) return;
        setQuiz((extras.quiz ?? []).map(toDraft));
        setTool(extras.tryTool ?? THEME);
        setLoaded(true);
      })
      .catch((err) => {
        if (!live) return;
        setUnavailable(errorMessage(err));
      });
    return () => {
      live = false;
    };
  }, [ep, verified]);

  const change = (i: number, update: Partial<DraftQuestion>) => {
    setStatus(null);
    setQuiz((current) => current.map((q, qi) => (qi === i ? { ...q, ...update } : q)));
  };

  const save = async () => {
    setError(null);
    setStatus(null);
    const body = {
      quiz: quiz.length > 0 ? quiz.map(fromDraft) : null,
      tryTool: tool === THEME ? null : tool,
    };
    const checked = checkExtras(body);
    if (!checked.ok) {
      setError(
        checked.field === "quiz"
          ? "Each question needs its wording, two to four answers with none left blank, and one marked right."
          : "Pick a tool from the list."
      );
      return;
    }
    setBusy(true);
    try {
      const { extras } = await portalApi.saveExtras(ep, checked.extras);
      setQuiz((extras.quiz ?? []).map(toDraft));
      setTool(extras.tryTool ?? THEME);
      setStatus("Saved. The story's pages show it now.");
    } catch (err) {
      setError(err instanceof PortalError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-labelledby={`extras-${ep}`}
      className="mt-6 space-y-4 rounded-lg border border-border p-3"
    >
      <h3 id={`extras-${ep}`} className="font-semibold text-text">
        Quiz and tool
      </h3>
      {unavailable ? (
        <p role="alert" className="text-sm text-danger">
          {unavailable}
        </p>
      ) : !loaded ? (
        <p className="text-sm text-sub">Loading…</p>
      ) : (
        <>
          <p className="text-sm text-sub">
            Both are optional. A quiz shows under the story once it has a question.
          </p>
          {quiz.map((q, qi) => (
            <fieldset key={qi} className="space-y-3 rounded-md border border-border p-3">
              <legend className="px-1 text-sm font-medium text-text">Question {qi + 1}</legend>
              <Field label="Question">
                {(props) => (
                  <Input
                    {...props}
                    maxLength={QUIZ_LIMITS.question}
                    value={q.question}
                    onChange={(e) => change(qi, { question: e.target.value })}
                  />
                )}
              </Field>
              <div
                role="radiogroup"
                aria-label={`Question ${qi + 1}'s right answer`}
                className="space-y-2"
              >
                {q.options.map((option, oi) => (
                  <div key={oi} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name={`extras-${ep}-${qi}`}
                      aria-label={`Answer ${oi + 1} is right`}
                      className="h-4 w-4 accent-accent"
                      checked={q.answer === oi}
                      onChange={() => change(qi, { answer: oi })}
                    />
                    <Input
                      aria-label={`Answer ${oi + 1}`}
                      maxLength={QUIZ_LIMITS.option}
                      value={option}
                      onChange={(e) =>
                        change(qi, {
                          options: q.options.map((o, i) => (i === oi ? e.target.value : o)),
                        })
                      }
                    />
                    {q.options.length > QUIZ_LIMITS.minOptions ? (
                      <Button
                        type="button"
                        variant="danger-ghost"
                        size="icon"
                        aria-label={`Remove answer ${oi + 1}`}
                        onClick={() =>
                          change(qi, {
                            options: q.options.filter((_, i) => i !== oi),
                            answer: q.answer === oi ? 0 : q.answer > oi ? q.answer - 1 : q.answer,
                          })
                        }
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
              {q.options.length < QUIZ_LIMITS.maxOptions ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => change(qi, { options: [...q.options, ""] })}
                >
                  <Plus aria-hidden="true" />
                  Add an answer
                </Button>
              ) : null}
              <Field label="Why (optional)" hint="Shown once the reader has checked.">
                {(props) => (
                  <Textarea
                    {...props}
                    rows={2}
                    maxLength={QUIZ_LIMITS.explain}
                    value={q.explain}
                    onChange={(e) => change(qi, { explain: e.target.value })}
                  />
                )}
              </Field>
              <Button
                type="button"
                variant="danger-ghost"
                size="sm"
                onClick={() => setQuiz((current) => current.filter((_, i) => i !== qi))}
              >
                Remove question {qi + 1}
              </Button>
            </fieldset>
          ))}
          {quiz.length < QUIZ_LIMITS.questions ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setQuiz((current) => [...current, blankQuestion()])}
            >
              <Plus aria-hidden="true" />
              Add a question
            </Button>
          ) : null}

          <Field label="Try this with your team" hint="The tool under the story.">
            {(props) => (
              <Select value={tool} onValueChange={(value) => setTool(value)}>
                <SelectTrigger {...props}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={THEME}>From the story&apos;s theme</SelectItem>
                  {tools.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            Save quiz and tool
          </Button>
        </>
      )}
    </section>
  );
}
