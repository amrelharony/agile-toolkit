import Link from "@/components/motion/transition-link";
import { EARLY_COMICS_ROUTE } from "@/lib/comics/entry";

/**
 * The same link on every story. These pages are static and can't know who holds
 * the book, so it shows for everyone, and /comics/early does the checking. No
 * prefetch and no follow: that page is dynamic, and crawlers are kept out of it.
 */
export function ReadAheadLink() {
  return (
    <p className="text-sm text-sub">
      <Link
        href={EARLY_COMICS_ROUTE}
        prefetch={false}
        rel="nofollow"
        className="font-medium text-text underline"
      >
        Read ahead
      </Link>{" "}
      with your copy of the book.
    </p>
  );
}
