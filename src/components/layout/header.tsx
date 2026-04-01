"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { getToolByPath } from "@/lib/constants/tools";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Search, Moon, Sun } from "lucide-react";
import Image from "next/image";

interface HeaderProps {
  onOpenSearch: () => void;
}

export function Header({ onOpenSearch }: HeaderProps) {
  const pathname = usePathname();
  const tool = getToolByPath(pathname);
  const [scrolled, setScrolled] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    const saved = (localStorage.getItem("ae-theme") as "dark" | "light") || "dark";
    setTheme(saved);
    setIsMac(navigator.platform.toUpperCase().includes("MAC") || navigator.userAgent.includes("Mac"));
    setMounted(true);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
    document.documentElement.classList.toggle("dark", theme === "dark");
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
        flex items-center justify-between px-6
        h-14 sticky top-8 z-header
        transition-all duration-default ease-spring
        ${
          scrolled
            ? "glass-elevated border-b border-border"
            : "bg-transparent border-b border-transparent"
        }
      `}
    >
      {/* Left — AE monogram + breadcrumb */}
      <div className="flex items-center gap-3">
        <Image
          src="/ae.svg"
          alt="AE"
          width={28}
          height={28}
          className="rounded"
        />
        <span className="text-border mx-1">|</span>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/" className="text-sub hover:text-text">
                Home
              </BreadcrumbLink>
            </BreadcrumbItem>
            {tool && (
              <>
                <BreadcrumbSeparator className="text-sub" />
                <BreadcrumbItem>
                  <span className="text-sub text-sm">{tool.category}</span>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="text-sub" />
                <BreadcrumbItem>
                  <BreadcrumbPage className="text-text font-medium">
                    {tool.name}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </>
            )}
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      {/* Center — Search */}
      <button
        onClick={onOpenSearch}
        className="
          hidden md:flex items-center gap-2
          px-4 py-1.5 rounded-xl
          glass border border-border
          text-sub text-sm
          hover:border-accent/15 hover:text-text
          transition-all duration-default ease-spring
          max-w-[320px] w-full justify-between
        "
      >
        <div className="flex items-center gap-2">
          <Search className="w-3.5 h-3.5" />
          <span>Search tools...</span>
        </div>
        <kbd className="font-mono text-nano text-sub bg-[var(--card)] border border-border rounded px-1.5 py-0.5">
          {mounted && isMac ? "⌘K" : "Ctrl K"}
        </kbd>
      </button>

      {/* Right — Actions */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="
            w-8 h-8 rounded-lg flex items-center justify-center
            text-sub hover:text-accent hover:bg-accent/5
            transition-all duration-fast
          "
          aria-label="Toggle theme"
          aria-pressed={theme === "light"}
        >
          {!mounted ? (
            <div className="w-4 h-4" />
          ) : theme === "dark" ? (
            <Moon className="w-4 h-4" />
          ) : (
            <Sun className="w-4 h-4" />
          )}
        </button>
      </div>
    </header>
  );
}
