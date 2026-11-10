"use client";

/**
 * "Which method?" — one line per prioritization method on when to pick it,
 * linking to its tool. Built from the framework registry's `pickWhen`.
 */

import Link from "@/components/motion/transition-link";
import { Compass } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import { FRAMEWORKS } from "@/lib/prioritization/frameworks";

export function WhichMethod() {
  return (
    <SectionCard title="Which method?" icon={Compass} titleSize="sm">
      <ul className="space-y-2 text-sm">
        {FRAMEWORKS.map((f) => (
          <li key={f.id}>
            <Link
              href={f.path}
              className="font-medium text-accent underline-offset-2 hover:underline"
            >
              {f.label}
            </Link>
            <span className="text-sub">: pick it when {f.pickWhen}.</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-sub">
        Scores you add in these tools from the backlog link back here.
      </p>
    </SectionCard>
  );
}
