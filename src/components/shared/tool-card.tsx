"use client";

import { type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

interface ToolCardProps {
  href: string;
  icon: ReactNode;
  title: string;
  description: string;
  tags?: string[];
  accentColor?: string;
}

export function ToolCard({
  href,
  icon,
  title,
  description,
  tags,
  accentColor,
}: ToolCardProps) {
  return (
    <Link
      href={href}
      className="
        group relative flex flex-col gap-3
        p-5 rounded-2xl
        bg-[var(--card)] border border-border
        backdrop-blur-[20px] saturate-[1.4]
        overflow-hidden
        transition-all duration-medium ease-spring
        hover:bg-[var(--cardH)]
        hover:border-[rgba(0,225,255,0.15)]
        hover:shadow-glow
        hover:-translate-y-[3px]
        will-change-transform
      "
      style={
        accentColor
          ? ({ "--tool-accent": accentColor } as React.CSSProperties)
          : undefined
      }
    >
      {/* Inset top light */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[rgba(255,255,255,0.06)] to-transparent" />

      {/* Shimmer sweep overlay */}
      <div
        className="
          absolute inset-0 pointer-events-none z-0
          opacity-0 group-hover:opacity-100
        "
      >
        <div
          className="
            absolute inset-0
            bg-[linear-gradient(105deg,transparent_40%,var(--glow)_50%,transparent_60%)]
            -translate-x-full group-hover:animate-shimmer
          "
        />
      </div>

      {/* Content */}
      <div className="relative z-[1] flex items-start justify-between">
        <div
          className="
            w-11 h-11 rounded-xl
            bg-[var(--card)] border border-border
            flex items-center justify-center
            transition-border-color duration-default
            group-hover:border-[rgba(0,225,255,0.15)]
            text-accent text-lg
          "
        >
          {icon}
        </div>
        <ArrowRight
          className="
            w-4 h-4 text-sub opacity-40
            group-hover:opacity-100 group-hover:text-accent
            group-hover:translate-x-0.5
            transition-all duration-default ease-spring
          "
        />
      </div>

      <div className="relative z-[1]">
        <h3 className="text-sm font-semibold text-text">{title}</h3>
        <p className="text-caption text-sub mt-1 line-clamp-2">{description}</p>
      </div>

      {tags && tags.length > 0 && (
        <div className="relative z-[1] flex flex-wrap gap-1.5 mt-auto">
          {tags.map((tag) => (
            <span
              key={tag}
              className="
                font-mono text-nano tracking-wider uppercase
                px-2 py-0.5 rounded-xs
                bg-[var(--card)] border border-border text-sub
                transition-all duration-default
                group-hover:border-[rgba(0,225,255,0.1)]
                group-hover:text-accent
              "
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}
