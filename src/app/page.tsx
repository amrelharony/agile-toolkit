"use client";

import { categories, getToolsByCategory } from "@/lib/constants/tools";
import { PageHeader } from "@/components/shared/page-header";
import { ToolCard } from "@/components/shared/tool-card";
import { ArrowRight, Zap } from "lucide-react";
import Link from "next/link";

export default function Home() {
  return (
    <div className="p-6 md:p-8 max-w-[1200px] mx-auto">
      {/* Hero */}
      <div className="py-12 animate-slide-up">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-border bg-[rgba(0,225,255,0.05)] mb-6">
          <Zap className="w-3.5 h-3.5 text-accent" />
          <span className="font-mono text-micro text-accent tracking-wider uppercase">
            Free & Open Source
          </span>
        </div>
        <PageHeader
          title="Agile Toolkit"
          subtitle="25+ interactive tools for Scrum Masters and Agile practitioners. Plan sprints, track metrics, run ceremonies, and build better teams."
          gradient
        />
        <div className="flex gap-4 mt-2">
          <Link
            href="/capacity-planner"
            className="
              inline-flex items-center gap-2 px-6 py-3 rounded-xl
              bg-accent text-bg font-mono text-sm font-semibold uppercase tracking-wider
              hover:shadow-glow-strong active-press
              transition-all duration-default ease-spring
            "
          >
            Get Started
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>

      {/* Impact Metrics */}
      <div className="flex gap-8 mb-12 animate-slide-up delay-1 stagger-item" style={{ animationFillMode: "forwards" }}>
        {[
          { value: "25+", label: "Tools" },
          { value: "4", label: "Categories" },
          { value: "100%", label: "Free" },
        ].map((stat, i) => (
          <div key={stat.label} className={`text-center animate-fade-in delay-${i + 1}`} style={{ animationFillMode: "forwards", opacity: 0 }}>
            <div className="font-mono text-h5 font-bold text-accent text-glow">
              {stat.value}
            </div>
            <div className="font-mono text-nano text-sub tracking-wider uppercase mt-1">
              {stat.label}
            </div>
          </div>
        ))}
      </div>

      {/* Tool Grid by Category */}
      {categories.map((category, categoryIndex) => {
        const categoryTools = getToolsByCategory(category);
        return (
          <section
            key={category}
            className="mb-12 animate-slide-up"
            style={{ animationDelay: `${0.2 + categoryIndex * 0.1}s`, animationFillMode: "forwards", opacity: 0 }}
          >
            <PageHeader
              label={category}
              title={category}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {categoryTools.map((tool) => {
                const Icon = tool.icon;
                return (
                  <ToolCard
                    key={tool.id}
                    href={tool.path}
                    icon={<Icon className="w-5 h-5" />}
                    title={tool.name}
                    description={tool.description}
                    tags={tool.badge ? [tool.badge] : undefined}
                  />
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
