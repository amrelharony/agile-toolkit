"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpen, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getGuide, hasGuide, type ToolGuide } from "@/lib/tools/guides";

/**
 * Collapsible "How this works" panel under a tool's title.
 *
 * Tools named Cynefin, ADKAR or WSJF used to open as bare forms with no
 * explanation of the method. The header renders straight away (whether a
 * tool has a guide is known without loading it), and the guide text loads
 * on demand, so nothing below the panel moves when it arrives. It starts
 * collapsed: opening it by itself pushed the whole tool down after load.
 *
 * On a phone the open guide is one long column (about 1,300 px), so it ends
 * with a "Hide guide" button: closing it there doesn't mean scrolling back up
 * to the header. Focus goes back to the header, which brings it into view
 * with the tool right under it. The header's scroll margin keeps it clear of
 * the sticky app bar: Firefox scrolls a focused element to the nearest edge,
 * not the centre, so without it the header would land under the bar.
 */
export function HowItWorks({ toolId }: { toolId: string }) {
  const [guide, setGuide] = useState<ToolGuide | null>(null);
  const exists = hasGuide(toolId);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);

  const hideGuide = () => {
    if (detailsRef.current) detailsRef.current.open = false;
    summaryRef.current?.focus();
  };

  useEffect(() => {
    if (!exists) return;
    let cancelled = false;
    void getGuide(toolId).then((g) => {
      if (!cancelled) setGuide(g ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [toolId, exists]);

  if (!exists) return null;

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
          {guide ? `— ${guide.summary}` : ""}
        </span>
        <ChevronDown
          className="ml-auto h-4 w-4 shrink-0 text-sub transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      {guide && (
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
              there and closes from the header as before. */}
          <div className="flex justify-end md:col-span-2 lg:hidden">
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={hideGuide}
            >
              <ChevronUp aria-hidden="true" />
              Hide guide
            </Button>
          </div>
        </div>
      )}
    </details>
  );
}
