import type { Metadata } from "next";
import { COMIC_ROUTE } from "@/lib/comic/agile-at-work";
import { AgileAtWorkClient } from "./agile-at-work-client";

// The root layout's template appends " | Agile Toolkit" to `title` only;
// openGraph and twitter replace the root blocks wholesale, so they repeat
// type and siteName.
const title = "Agile at Work — Comic Book";
const description = "Read the Agile at Work comic free in your browser, or download the PDF.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: COMIC_ROUTE },
  openGraph: {
    type: "website",
    siteName: "Agile Toolkit",
    url: COMIC_ROUTE,
    title,
    description,
  },
  twitter: {
    card: "summary",
    title,
    description,
  },
};

export default function AgileAtWorkPage() {
  return <AgileAtWorkClient />;
}
