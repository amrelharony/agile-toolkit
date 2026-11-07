"use client";

import { useId } from "react";
import { BookOpen } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import { KUDOS_GUIDE } from "@/lib/kudos/guide";

/**
 * "How kudos cards work": the printed Scrum Master guide's words, for
 * everyone on the page. Only the line on what Send kudos does differs: the
 * owner's kudos go on the squad's wall, a visitor's leave as a link and an
 * image. The colours table is filled like the print, its own ink on each
 * habit's colour, and scrolls inside its own box on a narrow screen.
 */
export function KudosHowTo({ isOwner }: { isOwner: boolean }) {
  const coloursId = useId();
  const { give, scrumMasters, colours } = KUDOS_GUIDE;
  return (
    <SectionCard title={KUDOS_GUIDE.title} icon={BookOpen} contentClassName="space-y-5 text-sm">
      <p className="font-medium text-text">{KUDOS_GUIDE.intro}</p>

      <div className="space-y-2">
        <h3 className="font-semibold text-text">{give.heading}</h3>
        <ol className="list-decimal space-y-1.5 pl-5 text-text">
          {give.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="text-sub">{isOwner ? give.online.owner : give.online.visitor}</p>
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold text-text">{scrumMasters.heading}</h3>
        <ul className="list-disc space-y-1.5 pl-5 text-text">
          {scrumMasters.tips.map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>
      </div>

      <div className="space-y-2">
        <h3 id={coloursId} className="font-semibold text-text">
          {colours.heading}
        </h3>
        {/* Focusable so the keyboard can scroll it when it's wider than the screen. */}
        <div
          role="region"
          aria-labelledby={coloursId}
          tabIndex={0}
          className="overflow-x-auto rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <table className="w-full border-separate border-spacing-y-1 text-left">
            <thead>
              <tr className="text-xs text-sub">
                {colours.columns.map((col) => (
                  <th key={col} scope="col" className="px-3 py-1 font-medium">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {colours.rows.map((r) => {
                // Print colours, so inline: the same fill and ink in every page theme.
                const print = { backgroundColor: r.fill, color: r.ink };
                return (
                  <tr key={r.habit}>
                    <th scope="row" className="rounded-l-md px-3 py-2 font-bold" style={print}>
                      {r.colour}
                    </th>
                    <td className="px-3 py-2 font-bold" style={print}>
                      {r.habit}
                    </td>
                    <td className="rounded-r-md px-3 py-2" style={print}>
                      {r.thanks}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-text">{KUDOS_GUIDE.book}</p>
      <p className="text-text">{KUDOS_GUIDE.privacy}</p>
    </SectionCard>
  );
}
