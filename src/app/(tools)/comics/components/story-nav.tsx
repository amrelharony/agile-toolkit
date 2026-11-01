"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { COMICS_ROUTE, comicHref } from "@/lib/comics/entry";
import { copyToClipboard } from "@/lib/utils/export";
import { toast } from "@/lib/utils/toast";

/** Share the address only: never the poster's building, never a file. */
async function shareStory(ep: number, title: string): Promise<void> {
  const url = `${window.location.origin}${comicHref(ep)}`;
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title, url });
    } catch {
      // Dismissing the share sheet is a choice, not a failure.
    }
    return;
  }
  if (await copyToClipboard(url)) toast.success("Link copied");
  else toast.error("Couldn't copy the link");
}

/** Arrow keys belong to whatever is open or being typed in, not to the story. */
function arrowsAreTaken(target: EventTarget | null): boolean {
  if (document.querySelector('[role="dialog"]')) return true;
  return (
    target instanceof Element &&
    target.closest('input, textarea, select, [contenteditable="true"], [role="listbox"]') !== null
  );
}

interface StoryNavProps {
  ep: number;
  title: string;
  prevEp: number | null;
  nextEp: number | null;
}

/** Previous, next and share under a story. The arrow keys do the same. */
export function StoryNav({ ep, title, prevEp, nextEp }: StoryNavProps) {
  const router = useRouter();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (arrowsAreTaken(e.target)) return;
      if (e.key === "ArrowLeft" && prevEp !== null) router.push(comicHref(prevEp));
      else if (e.key === "ArrowRight" && nextEp !== null) router.push(comicHref(nextEp));
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [prevEp, nextEp, router]);

  return (
    <nav aria-label="Stories" className="flex flex-wrap items-center gap-2">
      {prevEp !== null ? (
        <Button asChild variant="outline">
          <Link href={comicHref(prevEp)} prefetch={false} rel="prev">
            <ArrowLeft aria-hidden="true" />
            Previous story
          </Link>
        </Button>
      ) : null}
      {nextEp !== null ? (
        <Button asChild variant="outline">
          <Link href={comicHref(nextEp)} prefetch={false} rel="next">
            Next story
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      ) : null}
      <Button asChild variant="ghost">
        <Link href={COMICS_ROUTE} prefetch={false}>
          All comics
        </Link>
      </Button>
      <Button type="button" variant="ghost" onClick={() => void shareStory(ep, title)}>
        <Share2 aria-hidden="true" />
        Share a link
      </Button>
    </nav>
  );
}
