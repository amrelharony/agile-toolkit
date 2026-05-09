"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

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
    href: "https://books.amrelharony.com",
  },
];

/**
 * EcosystemNav — Persistent 32px bar connecting all ecosystem sites.
 *
 * Design decisions:
 * - Fixed top, z-index above everything else
 * - Glassmorphic treatment matching main site's navigation
 * - "AE" monogram uses gradient-text (spectrum gradient)
 * - Current app: accent color + underline indicator
 * - Other apps: muted text, hover → accent with glow
 * - Mobile: collapses to "AE" + dropdown
 *
 * Copy this component into each ecosystem app:
 * - Main site: <EcosystemNav currentApp="main" />
 * - Agile Toolkit: <EcosystemNav currentApp="agile" />
 * - Book App: <EcosystemNav currentApp="books" />
 */
export function EcosystemNav({ currentApp }: EcosystemNavProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <nav
      className="
        fixed top-0 left-0 right-0 z-[99999]
        h-8 flex items-center justify-center
        bg-[rgba(6,8,15,0.8)]
        backdrop-blur-[20px] saturate-[1.4]
        border-b border-[rgba(255,255,255,0.04)]
      "
      aria-label="Ecosystem navigation"
    >
      <div className="flex items-center gap-4 px-4 w-full max-w-[1200px]">
        {/* AE Monogram */}
        <a
          href="https://amrelharony.com"
          className="
            font-extrabold text-sm tracking-tight
            bg-gradient-to-r from-[#00e1ff] via-[#6366f1] to-[#a855f7]
            bg-clip-text text-transparent
            hover:opacity-80 transition-opacity duration-fast
            flex-shrink-0
          "
          aria-label="Amr El Harony — Main site"
        >
          AE
        </a>

        <div className="w-px h-4 bg-[rgba(255,255,255,0.08)]" />

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
                      ? "text-[#00e1ff] font-bold"
                      : "text-[#8a95a8] hover:text-[#f0f2f5] hover:bg-[rgba(255,255,255,0.04)]"
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
                      bg-gradient-to-r from-[#00e1ff] to-[#6366f1]
                      shadow-[0_0_6px_rgba(0,225,255,0.3)]
                    "
                  />
                )}
              </a>
            );
          })}
        </div>

        {/* Mobile dropdown */}
        <div className="sm:hidden relative ml-auto">
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="
              flex items-center gap-1
              font-mono text-[10px] tracking-wider text-[#8a95a8]
              hover:text-[#f0f2f5]
              transition-colors duration-fast
            "
            aria-expanded={mobileOpen}
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
                bg-[rgba(12,16,24,0.95)]
                backdrop-blur-[32px] saturate-[1.6]
                border border-[rgba(255,255,255,0.08)]
                shadow-[0_8px_32px_rgba(0,0,0,0.4)]
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
                        ? "text-[#00e1ff] bg-[rgba(0,225,255,0.08)]"
                        : "text-[#8a95a8] hover:text-[#f0f2f5] hover:bg-[rgba(255,255,255,0.04)]"
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
