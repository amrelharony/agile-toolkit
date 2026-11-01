import type { Metadata } from "next";
import { bookEpisodeFor } from "@/lib/comics/book-episodes";
import { ComicsView } from "./comics-view";

const ROUTE = "/comics";
const TITLE = "Agile at Work — workplace comics";
const DESCRIPTION =
  "Capable colleagues, familiar workplace habits, and small choices that make work better.";

interface ComicsPageProps {
  searchParams: { ep?: string | string[] };
}

// Reading searchParams keeps the first paint right for someone scanning a
// poster, with no flash of the wrong page while JavaScript loads.
export function generateMetadata({ searchParams }: ComicsPageProps): Metadata {
  const episode = bookEpisodeFor(searchParams.ep);
  const title = episode ? `${episode.title} — Agile at Work` : TITLE;
  const description = episode ? episode.lesson : DESCRIPTION;
  return {
    title,
    description,
    alternates: { canonical: ROUTE },
    // A book episode is reached from its poster; only the section is listed.
    ...(episode ? { robots: { index: false, follow: true } } : {}),
    openGraph: { type: "website", siteName: "Agile Toolkit", url: ROUTE, title, description },
    twitter: { card: "summary", title, description },
  };
}

export default function ComicsPage({ searchParams }: ComicsPageProps) {
  return <ComicsView episode={bookEpisodeFor(searchParams.ep)} />;
}
