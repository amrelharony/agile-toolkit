"use client";

import { type ReactNode } from "react";

interface PageHeaderProps {
  label?: string;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

/** The page's title, framed as a comic panel and lettered by hand. */
export function PageHeader({ label, title, subtitle, actions }: PageHeaderProps) {
  return (
    <header
      className="
        panel mb-6 sm:mb-8 px-4 py-4 sm:px-6 sm:py-5
        flex flex-col gap-3
        sm:flex-row sm:items-start sm:justify-between sm:gap-4
      "
    >
      <div className="min-w-0 flex-1">
        {label && (
          <div className="label-mono mb-2" aria-hidden="true">
            {label}
            <div className="mt-1.5 w-8 h-0.5 bg-accent" />
          </div>
        )}
        <h1 className="font-display font-bold text-text text-fluid-h3 md:text-fluid-h2">{title}</h1>
        {subtitle && <p className="text-fluid-body text-sub mt-1 max-w-prose">{subtitle}</p>}
      </div>
      {actions && (
        // A plain labelled group: role="toolbar" promises arrow-key
        // navigation between the actions, which this row doesn't provide.
        <div
          className="flex flex-wrap items-center gap-2 sm:mt-1 shrink-0"
          role="group"
          aria-label="Page actions"
        >
          {actions}
        </div>
      )}
    </header>
  );
}
