"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, HeartHandshake, SearchX } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Field } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useIsOwner } from "@/lib/auth/use-is-owner";
import { BOOK_PATH } from "@/lib/book/book";
import { FLASHCARDS_ROUTE, comicHref } from "@/lib/comics/entry";
import { PRINT_THEMES, printTheme, type PrintThemeName } from "@/lib/comics/print-themes";
import { GUESTBOOK_ROUTE } from "@/lib/comics/guestbook";
import { themeLabel } from "@/lib/comics/themes";
import type { StorySummary } from "@/lib/comics/types";
import { CountDisclosure, VisitRecorder } from "@/components/visits/visit-recorder";
import { ComicCard, ComicCover } from "./comic-card";
import { PrintThemeChip } from "./print-theme-chip";
import { ReplayIntro } from "./intro/replay-intro";

const ALL = "all";

/** A book episode, as the index lists it. */
export interface IndexEpisode {
  ep: number;
  title: string;
  theme: PrintThemeName;
}

function sortedUnique(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

/** Only the verified owner ever sees a way to the portal. */
function OwnerPortalLink() {
  const isOwner = useIsOwner();
  if (!isOwner) return null;
  return (
    <p>
      <Link className="text-sm text-accent underline" href="/settings/comics" prefetch={false}>
        Comics portal
      </Link>
    </p>
  );
}

function ThisWeek({ story }: { story: StorySummary }) {
  return (
    <section aria-labelledby="this-week-heading">
      <Card className="grid overflow-hidden md:grid-cols-2">
        {story.cover ? <ComicCover cover={story.cover} /> : null}
        <div className="space-y-3 p-4 sm:p-6">
          <Eyebrow>This week&apos;s story</Eyebrow>
          <h2 id="this-week-heading" className="font-display text-xl font-semibold text-text">
            {story.title}
          </h2>
          <p className="text-sub">{story.lesson}</p>
          <Button asChild variant="toolkit">
            <Link href={comicHref(story.ep)} prefetch={false}>
              Read this story
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </Card>
    </section>
  );
}

/**
 * The book's 26 episodes, colour-coded by habit as the posters are. Each opens
 * the episode's page: its lesson and question, and the book page it's on.
 */
function BookIndex({ episodes }: { episodes: readonly IndexEpisode[] }) {
  return (
    <section aria-labelledby="book-episodes-heading" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="book-episodes-heading" className="font-display text-lg font-semibold text-text">
          The 26 episodes in the book
        </h2>
        <Link href={BOOK_PATH} className="text-sm font-medium text-text underline">
          About the book
        </Link>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm text-sub">
        <span>Colour-coded by habit:</span>
        <ul className="flex list-none flex-wrap gap-2">
          {PRINT_THEMES.map((t) => (
            <li key={t.name}>
              <PrintThemeChip theme={t.name} />
            </li>
          ))}
        </ul>
      </div>
      <ol className="grid list-none gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {episodes.map((e) => {
          const { colour, ink } = printTheme(e.theme);
          return (
            <li key={e.ep}>
              <Link
                href={comicHref(e.ep)}
                prefetch={false}
                className="flex h-full items-center gap-3 rounded-lg border-2 border-border bg-card p-3 hover:border-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span
                  aria-hidden="true"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold"
                  style={{ backgroundColor: colour, color: ink }}
                >
                  {String(e.ep).padStart(2, "0")}
                </span>
                <span className="min-w-0">
                  <span className="sr-only">Episode {e.ep}: </span>
                  <span className="block font-medium text-text">{e.title}</span>
                  <span className="block text-xs text-sub">{e.theme}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** For the open kudos cards' QR, which lands here, and anyone else. */
function ThankSomeone() {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-sub">
      <span>Seen a colleague practise one of these habits?</span>
      <Button asChild variant="outline">
        <Link href="/kudos?src=comics" prefetch={false}>
          <HeartHandshake aria-hidden="true" />
          Thank someone
        </Link>
      </Button>
    </p>
  );
}

function FilterSelect({
  label,
  allLabel,
  value,
  options,
  onChange,
}: {
  label: string;
  allLabel: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label}>
      {(props) => (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger {...props}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{allLabel}</SelectItem>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </Field>
  );
}

/**
 * /comics. Filtering happens here in the browser, over the list the static page
 * already carries, so there's no endpoint that hands the stories out in bulk.
 */
export function ComicsGallery({
  stories,
  bookEpisodes,
}: {
  stories: readonly StorySummary[];
  bookEpisodes: readonly IndexEpisode[];
}) {
  const [theme, setTheme] = useState(ALL);
  const [character, setCharacter] = useState(ALL);

  const themes = useMemo(
    () =>
      sortedUnique(stories.flatMap((s) => s.themes)).map((code) => ({
        value: code,
        label: themeLabel(code),
      })),
    [stories]
  );
  const characters = useMemo(
    () =>
      sortedUnique(stories.flatMap((s) => s.castNames)).map((name) => ({
        value: name,
        label: name,
      })),
    [stories]
  );

  const [latest] = stories;
  const filtering = theme !== ALL || character !== ALL;
  const matches = stories.filter(
    (s) =>
      (theme === ALL || s.themes.includes(theme)) &&
      (character === ALL || s.castNames.includes(character))
  );
  // Unfiltered, the newest story is already on show just above the list.
  const shown = filtering ? matches : matches.slice(1);

  const clearFilters = () => {
    setTheme(ALL);
    setCharacter(ALL);
  };

  return (
    <ToolPageWrapper title="Agile at Work" description="Workplace comics by Amr Elharony">
      <VisitRecorder path="/comics" />
      <div className="space-y-6">
        <OwnerPortalLink />
        {latest ? (
          <ThisWeek story={latest} />
        ) : (
          <p className="text-sub">A new story comes out every week, starting soon.</p>
        )}

        <BookIndex episodes={bookEpisodes} />
        <ThankSomeone />

        {stories.length > 1 ? (
          <section aria-labelledby="all-stories-heading" className="space-y-4">
            <h2 id="all-stories-heading" className="font-display text-lg font-semibold text-text">
              Weekly stories
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
              <FilterSelect
                label="Theme"
                allLabel="All themes"
                value={theme}
                options={themes}
                onChange={setTheme}
              />
              <FilterSelect
                label="Character"
                allLabel="All characters"
                value={character}
                options={characters}
                onChange={setCharacter}
              />
            </div>
            <p className="sr-only" aria-live="polite">
              {matches.length === 1 ? "1 story" : `${matches.length} stories`}
            </p>
            {matches.length === 0 ? (
              <EmptyState
                icon={SearchX}
                padding="md"
                action={
                  <Button type="button" variant="toolkit" onClick={clearFilters}>
                    Clear filters
                  </Button>
                }
              >
                <p>No stories match these filters.</p>
              </EmptyState>
            ) : (
              <ul className="grid list-none gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {shown.map((story) => (
                  <ComicCard key={story.ep} story={story} />
                ))}
              </ul>
            )}
          </section>
        ) : null}

        <p className="text-sm text-sub">
          For readers:{" "}
          <Link href={FLASHCARDS_ROUTE} className="font-medium text-accent underline">
            flashcards
          </Link>{" "}
          of every story&apos;s lesson, and the{" "}
          <Link href={GUESTBOOK_ROUTE} className="font-medium text-accent underline">
            guestbook
          </Link>
          .
        </p>

        <div className="flex items-baseline gap-4">
          {/* The note gives way, so the button keeps its words on one line, and
              they sit on the note's first line, even in a 44px phone target. */}
          <div className="min-w-0 flex-1">
            <CountDisclosure />
          </div>
          <ReplayIntro kind="book" />
        </div>
      </div>
    </ToolPageWrapper>
  );
}
