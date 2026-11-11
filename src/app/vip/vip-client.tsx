"use client";

import { useEffect } from "react";
import Link from "@/components/motion/transition-link";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AmrPortrait } from "@/components/vip/amr-portrait";
import { VipLockedMessage } from "@/components/vip/vip-lock-panel";
import { ComicCard } from "@/app/(tools)/comics/components/comic-card";
import { ReplayIntro } from "@/app/(tools)/comics/components/intro/replay-intro";
import { VipIntro } from "@/app/(tools)/comics/components/intro/vip-intro";
import { releaseDayLabel } from "@/app/(tools)/comics/early/release-day";
import { EARLY_COMICS_ROUTE, earlyComicHref } from "@/lib/comics/entry";
import type { StorySummary } from "@/lib/comics/types";
import { getVipTools } from "@/lib/tools/catalog";
import { VIP_TITLE } from "@/lib/vip/constants";
import { readVipHint, setVipHint } from "@/lib/vip/hint";
import { vipArt } from "@/lib/ink/drawings/sections/vip";

export type VipAccess = "unlocked" | "locked" | "invalid-link";

/**
 * The VIP hub. The server page decided access from the cookie and only sends
 * early comics to an unlocked device; this renders the outcome.
 *
 * The intro goes to an unlocked device only, so a forged hint cookie plays
 * nothing: the head script finds no overlay to show. It sits beside the
 * wrapper, not in it, since the wrapper's entrance would trap a fixed overlay.
 */
export function VipClient({
  access,
  earlyComics = [],
}: {
  access: VipAccess;
  earlyComics?: readonly StorySummary[];
}) {
  const unlocked = access === "unlocked";

  return (
    <>
      {unlocked ? <VipIntro tools={getVipTools()} earlyComics={earlyComics} /> : null}
      <ToolPageWrapper
        art={vipArt}
        title={VIP_TITLE}
        description={
          unlocked
            ? "Welcome, reader of the book. This device has VIP access."
            : "For readers of the printed book."
        }
      >
        {unlocked ? (
          <VipHub earlyComics={earlyComics} />
        ) : (
          <VipLockedMessage invalidLink={access === "invalid-link"} />
        )}
      </ToolPageWrapper>
    </>
  );
}

function VipHub({ earlyComics }: { earlyComics: readonly StorySummary[] }) {
  // A device unlocked before the hint existed, or whose hint went with "Clear
  // data": the server has just vouched for it, so the menus can list the tools.
  useEffect(() => {
    if (!readVipHint()) setVipHint();
  }, []);

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <AmrPortrait />
        <p className="text-fluid-body text-text">
          <span className="font-semibold">Amr:</span> Would one of these help your team this week?
        </p>
      </div>

      <section aria-labelledby="vip-tools-heading" className="space-y-3">
        <h2 id="vip-tools-heading" className="font-display text-lg font-semibold text-text">
          Your tools
        </h2>
        <ul className="grid list-none gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {getVipTools().map((tool) => {
            const Icon = tool.icon;
            return (
              <li key={tool.id}>
                <Link
                  href={tool.path}
                  className="flex h-full items-start gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <Icon className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block font-medium text-text">{tool.name}</span>
                    <span className="mt-1 block text-sm text-sub">{tool.description}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="vip-early-heading" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="vip-early-heading" className="font-display text-lg font-semibold text-text">
            The next four weeks of comics
          </h2>
          <Link
            href={EARLY_COMICS_ROUTE}
            prefetch={false}
            className="text-sm font-medium text-text underline"
          >
            Read ahead
          </Link>
        </div>
        {earlyComics.length === 0 ? (
          <p className="text-sm text-sub">
            Nothing to read ahead just now. The next stories will appear here before they come out.
          </p>
        ) : (
          <ul className="grid list-none gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {earlyComics.map((story) => (
              <ComicCard
                key={story.ep}
                story={story}
                href={earlyComicHref(story.ep)}
                note={releaseDayLabel(story.releaseAt)}
              />
            ))}
          </ul>
        )}
      </section>

      <ReplayIntro kind="vip" />
    </div>
  );
}
