"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, BookImage, SearchX } from "lucide-react";
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
import { comicHref } from "@/lib/comics/entry";
import { themeLabel } from "@/lib/comics/themes";
import type { StorySummary } from "@/lib/comics/types";
import { ComicCard, ComicCover } from "./comic-card";
import { CountDisclosure, EntryBeacon } from "./entry-beacon";

/** Printed on the back cover; the wording belongs to the book. */
const BOOK_BLURB =
  "In a fictional Cairo workplace, competing priorities, circular approvals and busy colleagues make getting things done surprisingly complicated. Across 26 comic stories, Amr and a memorable cast turn everyday challenges into humour, reflection and practical conversations about working better together.";

const ALL = "all";

function sortedUnique(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
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
export function ComicsGallery({ stories }: { stories: readonly StorySummary[] }) {
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
      <EntryBeacon entry="direct" />
      <div className="space-y-6">
        {latest ? (
          <ThisWeek story={latest} />
        ) : (
          <EmptyState
            icon={BookImage}
            padding="lg"
            action={
              <Button asChild variant="toolkit" className="min-h-11 md:h-11">
                <Link href="/">
                  <ArrowLeft aria-hidden="true" />
                  Back to tools
                </Link>
              </Button>
            }
          >
            <p className="font-semibold text-text">The comics are coming soon</p>
            <p className="mt-1">{BOOK_BLURB}</p>
          </EmptyState>
        )}

        {stories.length > 1 ? (
          <section aria-labelledby="all-stories-heading" className="space-y-4">
            <h2 id="all-stories-heading" className="font-display text-lg font-semibold text-text">
              All stories
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

        <CountDisclosure />
      </div>
    </ToolPageWrapper>
  );
}
