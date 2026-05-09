"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Kanban,
  Timer,
  Users,
  BarChart3,
  Settings,
  ChevronLeft,
  Sparkles,
} from "lucide-react";

const navItems = [
  { href: "/", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/board", icon: Kanban, label: "Board" },
  { href: "/sprints", icon: Timer, label: "Sprints" },
  { href: "/retro", icon: Users, label: "Retrospective" },
  { href: "/metrics", icon: BarChart3, label: "Metrics" },
  { href: "/settings", icon: Settings, label: "Settings" },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={`
        fixed top-[var(--header-h)] left-0 bottom-0 z-nav
        flex flex-col
        glass-elevated
        border-r border-border
        transition-all duration-slow ease-spring
        ${collapsed ? "w-[64px]" : "w-[var(--sidebar-w)]"}
      `}
    >
      {/* Brand section */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-border">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent to-accent-2 flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-4 h-4 text-bg" />
        </div>
        {!collapsed && (
          <div className="animate-fade-in">
            <div className="text-sm font-semibold text-text">Agile Toolkit</div>
            <div className="font-mono text-micro text-sub tracking-wider uppercase">
              by amrelharony
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 px-2 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`
                group flex items-center gap-3 px-3 py-2.5 rounded-xl
                transition-all duration-default ease-spring
                relative overflow-hidden
                ${
                  isActive
                    ? "bg-[rgba(0,225,255,0.12)] text-accent shadow-[0_0_10px_rgba(0,225,255,0.15)_inset]"
                    : "text-sub hover:text-text hover:bg-[rgba(0,225,255,0.08)]"
                }
              `}
            >
              {/* Shimmer overlay on hover */}
              <div
                className="
                  absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100
                  bg-gradient-to-r from-transparent via-glow to-transparent
                  -translate-x-full group-hover:animate-shimmer
                "
              />
              <item.icon
                className={`w-[18px] h-[18px] flex-shrink-0 relative z-[1] transition-transform duration-default ease-spring
                  ${isActive ? "" : "group-hover:scale-110"}
                `}
              />
              {!collapsed && (
                <span className="text-sm font-medium relative z-[1]">
                  {item.label}
                </span>
              )}
              {isActive && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-accent shadow-[0_0_8px_rgba(0,225,255,0.3)]" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="
          flex items-center justify-center
          w-full py-3 border-t border-border
          text-sub hover:text-accent
          transition-all duration-default ease-spring
        "
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        <ChevronLeft
          className={`w-4 h-4 transition-transform duration-medium ease-spring ${
            collapsed ? "rotate-180" : ""
          }`}
        />
      </button>
    </aside>
  );
}
