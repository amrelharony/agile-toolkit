import Link from "@/components/motion/transition-link";
import { Card, CardContent } from "@/components/ui/card";
import { BOOK_PATH } from "@/lib/book/book";

interface EpisodeNotesProps {
  lesson: string;
  question: string;
  /** Book episodes only: where the full story is printed. */
  bookPage?: number | null;
}

/** The lesson and the question, worded as they are on the printed posters. */
export function EpisodeNotes({ lesson, question, bookPage }: EpisodeNotesProps) {
  return (
    <Card>
      <CardContent className="space-y-4 p-4 sm:p-6">
        <div>
          <h2 className="font-display font-semibold text-text">The lesson</h2>
          <p className="mt-1 text-sub">{lesson}</p>
        </div>
        <div>
          <h2 className="font-display font-semibold text-text">Ask your team:</h2>
          <p className="mt-1 text-sub">{question}</p>
        </div>
        {bookPage ? (
          <div>
            <h2 className="font-display font-semibold text-text">
              Read the full story: book page {bookPage}
            </h2>
            <p className="mt-1 text-sub">
              Borrow Agile at Work by Amr Elharony from your Scrum Master.
            </p>
            <p className="mt-2 text-sm">
              <Link href={BOOK_PATH} className="font-medium text-accent underline">
                About the book
              </Link>
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
