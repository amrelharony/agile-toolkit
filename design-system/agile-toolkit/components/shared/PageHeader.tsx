"use client";

import { type ReactNode } from "react";

interface PageHeaderProps {
  /** Label above title — uses JetBrains Mono, 11px, uppercase, accent color */
  label?: string;
  /** Main title */
  title: string;
  /** Optional subtitle */
  subtitle?: string;
  /** Right-aligned actions */
  actions?: ReactNode;
  /** Apply gradient text to title */
  gradient?: boolean;
}

/**
 * PageHeader — Matches the main site's section header pattern.
 *
 * Pattern from main site:
 * - Label: JetBrains Mono, 11px, uppercase, letter-spacing 2px, color accent
 * - Title: Inter, 20px, weight 700, color text
 * - Decoration: 2px accent underline below label
 */
export function PageHeader({
  label,
  title,
  subtitle,
  actions,
  gradient = false,
}: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4 mb-8">
      <div>
        {label && (
          <div className="label-mono mb-2">
            {label}
            {/* Accent underline decoration */}
            <div className="mt-1.5 w-8 h-0.5 rounded-full bg-gradient-to-r from-accent to-accent-2" />
          </div>
        )}
        <h1
          className={`
            text-h5 md:text-h4 font-bold tracking-tight
            ${gradient ? "gradient-text-animated" : "text-text"}
          `}
        >
          {title}
        </h1>
        {subtitle && (
          <p className="text-body text-sub mt-1 max-w-lg">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 mt-1">{actions}</div>}
    </div>
  );
}
