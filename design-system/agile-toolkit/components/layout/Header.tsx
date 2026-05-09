"use client";

import { useState, useEffect } from "react";
import { Moon, Sun, Search, Bell } from "lucide-react";

export function Header() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("ae-theme") as "dark" | "light" | null;
    if (saved) setTheme(saved);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
    localStorage.setItem("ae-theme", theme);
  }, [theme]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`
        fixed top-0 left-0 right-0 z-header
        h-[var(--header-h)] flex items-center justify-between
        px-6 transition-all duration-default ease-spring
        ${
          scrolled
            ? "glass-elevated border-b border-border"
            : "bg-transparent border-b border-transparent"
        }
      `}
    >
      {/* Left — Branding */}
      <div className="flex items-center gap-2">
        <span className="gradient-text font-extrabold text-lg tracking-tight">
          AE
        </span>
        <span className="text-border mx-2">|</span>
        <span className="font-mono text-micro text-sub tracking-wider uppercase">
          Agile Toolkit
        </span>
      </div>

      {/* Center — Search (Cmd+K style) */}
      <button
        className="
          hidden md:flex items-center gap-2
          px-4 py-1.5 rounded-xl
          glass border border-border
          text-sub text-sm
          hover:border-[rgba(0,225,255,0.15)] hover:text-text
          transition-all duration-default ease-spring
          max-w-[320px] w-full justify-between
        "
      >
        <div className="flex items-center gap-2">
          <Search className="w-3.5 h-3.5" />
          <span>Search tools...</span>
        </div>
        <kbd className="font-mono text-nano text-sub bg-[var(--card)] border border-border rounded px-1.5 py-0.5">
          Ctrl K
        </kbd>
      </button>

      {/* Right — Actions */}
      <div className="flex items-center gap-1">
        {/* Notifications */}
        <button
          className="
            w-8 h-8 rounded-lg flex items-center justify-center
            text-sub hover:text-accent hover:bg-[rgba(0,225,255,0.08)]
            transition-all duration-fast relative
          "
          aria-label="Notifications"
        >
          <Bell className="w-4 h-4" />
          <div className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-accent animate-glow-pulse" />
        </button>

        {/* Theme toggle */}
        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="
            w-8 h-8 rounded-lg flex items-center justify-center
            text-sub hover:text-accent hover:bg-[rgba(0,225,255,0.08)]
            transition-all duration-fast
          "
          aria-label="Toggle theme"
          aria-pressed={theme === "light"}
        >
          {theme === "dark" ? (
            <Moon className="w-4 h-4" />
          ) : (
            <Sun className="w-4 h-4" />
          )}
        </button>
      </div>
    </header>
  );
}
