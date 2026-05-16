"use client";

import { useState, useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";
import Image from "next/image";

type AppId = "main" | "agile" | "books";

interface EcosystemNavProps {
  currentApp: AppId;
}

const apps: { id: AppId; label: string; shortLabel: string; href: string }[] = [
  {
    id: "main",
    label: "amrelharony.com",
    shortLabel: "Main",
    href: "https://amrelharony.com",
  },
  {
    id: "agile",
    label: "agile.",
    shortLabel: "Agile",
    href: "https://agile.amrelharony.com",
  },
  {
    id: "books",
    label: "books.",
    shortLabel: "Books",
    href: "https://bilingualexecutive.amrelharony.com",
  },
];

export function EcosystemNav({ currentApp }: EcosystemNavProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on click-outside + Escape. Escape was missing originally, which
  // forced keyboard-only users to tab back to the trigger to dismiss — a
  // WCAG 2.1.2 (No Keyboard Trap) regression. Mousedown is preferred over
  // click so the dropdown closes before the next click can refocus the
  // trigger, eliminating a flicker on rapid double-clicks.
  useEffect(() => {
    if (!mobileOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setMobileOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", onKey);
    };
  }, [mobileOpen]);

  return (
    <nav
      className="
        fixed top-0 left-0 right-0 z-[99999]
        h-8 flex items-center justify-center
        bg-[rgba(var(--bg2-rgb),0.8)]
        backdrop-blur-[20px] saturate-[1.4]
        border-b border-border
      "
      aria-label="Ecosystem navigation"
    >
      <div className="flex items-center gap-4 px-4 w-full max-w-[1200px]">
        {/* AE Logo */}
        <a
          href="https://amrelharony.com"
          className="
            hover:opacity-80 transition-opacity duration-fast
            flex-shrink-0
          "
          aria-label="Amr El Harony — Main site"
        >
          <Image
            src="/ae.svg"
            alt="AE"
            width={22}
            height={22}
            className="rounded"
          />
        </a>

        <div className="w-px h-4 bg-border" />

        {/* Desktop links */}
        <div className="hidden sm:flex items-center gap-1">
          {apps.map((app) => {
            const isActive = app.id === currentApp;
            return (
              <a
                key={app.id}
                href={app.href}
                className={`
                  relative px-2.5 py-1 rounded-md
                  font-mono text-[10px] tracking-wider
                  transition-all duration-default
                  ${
                    isActive
                      ? "text-accent font-bold"
                      : "text-sub hover:text-text hover:bg-card-hover"
                  }
                `}
                aria-current={isActive ? "page" : undefined}
              >
                {app.label}
                {isActive && (
                  <div
                    className="
                      absolute bottom-0 left-1/2 -translate-x-1/2
                      w-4 h-0.5 rounded-full
                      bg-gradient-to-r from-accent to-accent-2
                      shadow-[0_0_6px_var(--glow)]
                    "
                  />
                )}
              </a>
            );
          })}
        </div>

        {/* Mobile dropdown */}
        <div className="sm:hidden relative ml-auto" ref={dropdownRef}>
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="
              flex items-center gap-1
              font-mono text-[10px] tracking-wider text-sub
              hover:text-text
              transition-colors duration-fast
            "
            aria-expanded={mobileOpen}
            aria-haspopup="true"
          >
            {apps.find((a) => a.id === currentApp)?.shortLabel}
            <ChevronDown
              className={`w-3 h-3 transition-transform duration-default ${
                mobileOpen ? "rotate-180" : ""
              }`}
            />
          </button>
          {mobileOpen && (
            <div
              className="
                absolute top-full right-0 mt-1
                py-1 rounded-lg min-w-[140px]
                bg-[rgba(var(--bg2-rgb),0.95)]
                backdrop-blur-[32px] saturate-[1.6]
                border border-border
                shadow-lg
                animate-scale-in
              "
            >
              {apps.map((app) => (
                <a
                  key={app.id}
                  href={app.href}
                  className={`
                    block px-3 py-1.5
                    font-mono text-[10px] tracking-wider
                    transition-colors duration-fast
                    ${
                      app.id === currentApp
                        ? "text-accent bg-accent/10"
                        : "text-sub hover:text-text hover:bg-card-hover"
                    }
                  `}
                >
                  {app.label}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
