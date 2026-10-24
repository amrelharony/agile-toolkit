"use client";

import type { ReactNode } from "react";

/** A toggle chip: pressed while its filter is on. */
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
      className={`min-touch-coarse inline-flex items-center justify-center px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 border ${
        active
          ? "bg-accent-cyan/20 text-accent border-accent-cyan shadow-neon-cyan"
          : "bg-card text-sub border-border hover:border-border hover:text-text"
      }`}
    >
      {label}
    </button>
  );
}

/** A labelled group of chips, announced by its label. */
export function ChipGroup({
  id,
  icon,
  label,
  children,
}: {
  id: string;
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2" role="group" aria-labelledby={id}>
      <span
        id={id}
        className="text-xs font-semibold text-sub uppercase tracking-wider flex items-center gap-1.5"
      >
        {icon}
        {label}
      </span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

/** One chip per choice, the one equal to `value` pressed. */
export function Choices<T>({
  choices,
  value,
  onChange,
}: {
  choices: readonly (readonly [T, string])[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <>
      {choices.map(([v, label]) => (
        <FilterChip key={label} label={label} active={value === v} onClick={() => onChange(v)} />
      ))}
    </>
  );
}
