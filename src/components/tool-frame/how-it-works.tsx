"use client";

import { useRef } from "react";
import { BookOpen, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToolGuide } from "./tool-guide-context";

/**
 * Collapsible "How this works" panel under a tool's title.
 *
 * Tools named Cynefin, ADKAR or WSJF used to open as bare forms with no
 * explanation of the method. The guide comes from the tool's route layout as
 * data (components/tool-frame/tool-guide.tsx), so the whole panel is in the
 * server's HTML: a search engine or an assistant reads the method text without
 * running any JavaScript, and nothing below the panel moves, because nothing
 * arrives later. It starts collapsed: opening it by itself pushed the whole
 * tool down.
 *
 * On a phone the open guide is one long column (about 1,300 px), so it ends
 * with a "Hide guide" button: closing it there doesn't mean scrolling back up
 * to the header. Focus goes back to the header, which brings it into view
 * with the tool right under it. The header's scroll margin keeps it clear of
 * the sticky app bar: Firefox scrolls a focused element to the nearest edge,
 * not the centre, so without it the header would land under the bar.
 */
export function HowItWorks({ toolId }: { toolId: string }) {
  const provided = useToolGuide();
  // A page that names another tool than its route's never shows that route's
  // guide under its own title.
  const guide = provided?.toolId === toolId ? provided : null;
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);

  const hideGuide = () => {
    if (detailsRef.current) detailsRef.current.open = false;
    summaryRef.current?.focus();
  };

  if (!guide) return null;

  return (
    <details
      ref={detailsRef}
      className="group mb-4 rounded-lg border border-border bg-card sm:mb-6"
    >
      <summary
        ref={summaryRef}
        className="flex scroll-mt-20 cursor-pointer select-none list-none items-center gap-2 px-4 py-3 text-sm [&::-webkit-details-marker]:hidden"
      >
        <BookOpen className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
        <h2 className="text-sm font-medium text-text">How this works</h2>
        <span className="hidden min-w-0 flex-1 truncate text-sub sm:inline sm:group-open:hidden">
          {`— ${guide.summary}`}
        </span>
        <ChevronDown
          className="ml-auto h-4 w-4 shrink-0 text-sub transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="grid gap-5 border-t border-border px-4 py-4 text-sm md:grid-cols-2">
        <div className="space-y-4">
          <p className="text-text">{guide.summary}</p>
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-sub">
              When to use it
            </h3>
            <ul className="list-disc space-y-1 pl-5 text-text">
              {guide.whenToUse.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
          {guide.timebox && (
            <p className="text-sub">
              <span className="font-medium text-text">Timebox:</span> {guide.timebox}
            </p>
          )}
        </div>
        <div className="space-y-4">
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-sub">
              How to run it
            </h3>
            <ol className="list-decimal space-y-1 pl-5 text-text">
              {guide.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </div>
          {guide.scales?.map((scale) => (
            <div key={scale.name}>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-sub">
                {scale.name}
              </h3>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                {scale.values.map((v) => (
                  <div key={v.value} className="contents">
                    <dt className="font-data font-semibold text-text">{v.value}</dt>
                    <dd className="text-sub">{v.meaning}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
          {guide.tips && guide.tips.length > 0 && (
            <div>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-sub">
                Tips
              </h3>
              <ul className="list-disc space-y-1 pl-5 text-sub">
                {guide.tips.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
        {/* Desktop (lg up) keeps its look: the guide is two short columns
            there and closes from the header as before. Button shrinks to
            36 px from md, but a landscape phone or a tablet is md and still
            touch, so it keeps 44 px there. The md is in the variant on
            purpose: a bare pointer-coarse: rule is emitted before md: rules
            and would lose to Button's md:min-h-9. */}
        <div className="flex justify-end md:col-span-2 lg:hidden">
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto pointer-coarse:md:min-h-11"
            onClick={hideGuide}
          >
            <ChevronUp aria-hidden="true" />
            Hide guide
          </Button>
        </div>
      </div>
    </details>
  );
}
