import { Card, CardContent } from "@/components/ui/card";

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
            <h2 className="font-display font-semibold text-text">Read the full story.</h2>
            <p className="mt-1 text-sub">Book page {bookPage}</p>
            <p className="mt-1 text-sub">Borrow the book from your Scrum Master.</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
