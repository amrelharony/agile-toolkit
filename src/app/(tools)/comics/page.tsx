import type { Metadata } from "next";
import { COMICS_ROUTE } from "@/lib/comics/entry";
import { listReleasedWeekly } from "@/lib/comics/store";
import { comicMetadata } from "./comic-metadata";
import { ComicsGallery } from "./components/comics-gallery";

/**
 * Static, refreshed about every 10 minutes, which is also how a Monday's story
 * goes live with no scheduler. A /comics address with a valid number never gets
 * here: the middleware rewrites it to ep/[n] or poster/[n].
 */
export const revalidate = 600;

export const metadata: Metadata = comicMetadata({
  title: "Agile at Work — workplace comics",
  description:
    "Capable colleagues, familiar workplace habits, and small choices that make work better.",
  canonical: COMICS_ROUTE,
});

export default async function ComicsPage() {
  return <ComicsGallery stories={await listReleasedWeekly()} />;
}
