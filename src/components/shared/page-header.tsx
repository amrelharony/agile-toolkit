"use client";

import { type ReactNode } from "react";

interface PageHeaderProps {
  label?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  gradient?: boolean;
}

export function PageHeader({ label, title, subtitle, actions, gradient = false }: PageHeaderProps) {
  return (
    <header
      className="
        mb-6 sm:mb-8
        flex flex-col gap-3
        sm:flex-row sm:items-start sm:justify-between sm:gap-4
      "
    >
      <div className="min-w-0 flex-1">
        {label && (
          <div className="label-mono mb-2" aria-hidden="true">
            {label}
            <div className="mt-1.5 w-8 h-0.5 rounded-full bg-gradient-to-r from-accent to-accent-2" />
          </div>
        )}
        <h1
          className={`
            font-bold tracking-tight text-fluid-h3 md:text-fluid-h2
            ${gradient ? "gradient-text-animated" : "text-text"}
          `}
        >
          {title}
        </h1>
        {subtitle && <p className="text-fluid-body text-sub mt-1 max-w-prose">{subtitle}</p>}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 sm:mt-1 shrink-0" role="toolbar">
          {actions}
        </div>
      )}
    </header>
  );
}
