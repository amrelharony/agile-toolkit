"use client";

import type { ReactNode } from "react";

/** A toggle chip: pressed while its filter is on, a full touch target on phones. */
export function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-touch-coarse inline-flex items-center justify-center px-3 py-1.5 rounded-full text-xs font-semibold transition border ${
        active
          ? "bg-accent/15 text-accent border-accent/60"
          : "bg-surface text-sub border-border hover:border-accent/30 hover:text-text"
      }`}
    >
      {label}
    </button>
  );
}

/** A labelled group of chips: "All" plus one per choice, the one equal to `value` pressed. */
export function ChipFilter<T extends string>({
  id,
  icon,
  label,
  choices,
  labelOf,
  value,
  onChange,
}: {
  id: string;
  icon: ReactNode;
  label: string;
  choices: readonly T[];
  labelOf: (choice: T) => string;
  value: T | null;
  onChange: (next: T | null) => void;
}) {
  return (
    <div className="space-y-2" role="group" aria-labelledby={id}>
      <span
        id={id}
        className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-sub font-semibold"
      >
        {icon}
        {label}
      </span>
      <div className="flex flex-wrap gap-2">
        <FilterChip label="All" active={value === null} onClick={() => onChange(null)} />
        {choices.map((c) => (
          <FilterChip
            key={c}
            label={labelOf(c)}
            active={value === c}
            onClick={() => onChange(value === c ? null : c)}
          />
        ))}
      </div>
    </div>
  );
}
