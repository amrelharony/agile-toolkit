import type { Metadata } from "next";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { BOOK_EPISODES } from "@/lib/comics/book-episodes";
import { FLASHCARDS_ROUTE } from "@/lib/comics/entry";
import { posterCover } from "@/lib/comics/poster-panels";
import { listStudyCards } from "@/lib/comics/store";
import type { StudyCard } from "@/lib/comics/types";
import { comicMetadata } from "../comic-metadata";
import { FlashcardDeck } from "./flashcard-deck";
import { cardsArt } from "@/lib/ink/drawings/pages/cards";

/** Refreshed about every 10 minutes, like the gallery, so a Sunday's story joins the deck. */
export const revalidate = 600;

// Out of search, like the book's episodes: their lessons are all here together.
export const metadata: Metadata = comicMetadata({
  title: "Flashcards — Agile at Work",
  description: "Each story's lesson and question, one card at a time.",
  canonical: FLASHCARDS_ROUTE,
  index: false,
});

/**
 * /comics/flashcards: every story as a card, the book's 26 as printed on the
 * posters and then the weekly ones that are out, each with its first panel.
 * Static: the deck is in the page, and the cards turn in the browser.
 */
export default async function FlashcardsPage() {
  const book: StudyCard[] = BOOK_EPISODES.map(({ ep, title, lesson, question }) => ({
    ep,
    title,
    lesson,
    question,
    cover: posterCover(ep),
  }));
  const cards = [...book, ...(await listStudyCards())];
  return (
    <ToolPageWrapper
      art={cardsArt}
      title="Flashcards"
      description="Each story's lesson and question, one card at a time"
    >
      <FlashcardDeck cards={cards} />
    </ToolPageWrapper>
  );
}
