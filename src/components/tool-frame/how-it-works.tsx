"use client";

import { useEffect, useState } from "react";
import { BookOpen, ChevronDown } from "lucide-react";
import { getGuide, type ToolGuide } from "@/lib/tools/guides";

const SEEN_KEY = "agile-toolkit:guides-seen";

/** Whether this browser has opened `toolId` before; records the visit. */
function firstVisit(toolId: string): boolean {
  try {
    const seen: unknown = JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? "[]");
    const ids = Array.isArray(seen) ? seen.filter((x): x is string => typeof x === "string") : [];
    if (ids.includes(toolId)) return false;
    window.localStorage.setItem(SEEN_KEY, JSON.stringify([...ids, toolId]));
    return true;
  } catch {
    return false; // storage blocked: stay collapsed rather than open every time
  }
}

/**
 * Collapsible "How this works" panel under a tool's title.
 *
 * Tools named Cynefin, ADKAR or WSJF used to open as bare forms with no
 * explanation of the method. The guide loads lazily, opens on the first
 * visit to a tool and stays collapsed after that, and the panel renders
 * nothing for tools that don't have one.
 */
export function HowItWorks({ toolId }: { toolId: string }) {
  const [guide, setGuide] = useState<ToolGuide | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getGuide(toolId).then((g) => {
      if (cancelled) return;
      setGuide(g ?? null);
      if (g && firstVisit(toolId)) setOpen(true);
    });
    return () => {
      cancelled = true;
    };
  }, [toolId]);

  if (!guide) return null;

  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="group mb-4 rounded-lg border border-border bg-card sm:mb-6"
    >
      <summary className="flex cursor-pointer select-none list-none items-center gap-2 px-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
        <BookOpen className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
        <span className="font-medium text-text">How this works</span>
        <span className="hidden min-w-0 flex-1 truncate text-sub sm:inline sm:group-open:hidden">
          — {guide.summary}
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
      </div>
    </details>
  );
}
