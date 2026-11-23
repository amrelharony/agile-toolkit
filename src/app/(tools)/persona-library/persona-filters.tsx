"use client";

import { Field } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { PERSONA_EVIDENCE, PERSONA_TIERS } from "@/lib/stores/workspace-types";
import { EVIDENCE_LABEL, NO_FILTERS, TIER_LABEL, type PersonaFilters } from "@/lib/personas/model";

const SELECT_CLASS =
  "flex h-11 w-full min-w-0 rounded-md border border-input bg-transparent px-3 text-base text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring pointer-fine:md:h-9 pointer-fine:md:text-sm";

/** The library's filters: tier, evidence and tag, as labelled native selects. */
export function PersonaFiltersBar({
  filters,
  onChange,
  tags,
  shown,
  total,
}: {
  filters: PersonaFilters;
  onChange: (next: PersonaFilters) => void;
  /** Every tag the personas use. */
  tags: readonly string[];
  shown: number;
  total: number;
}) {
  const active = filters.tier !== "" || filters.evidence !== "" || filters.tag !== "";
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Tier">
          {(p) => (
            <select
              {...p}
              className={SELECT_CLASS}
              value={filters.tier}
              onChange={(e) =>
                onChange({ ...filters, tier: e.target.value as PersonaFilters["tier"] })
              }
            >
              <option value="">Every tier</option>
              {PERSONA_TIERS.map((t) => (
                <option key={t} value={t}>
                  {TIER_LABEL[t]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Evidence">
          {(p) => (
            <select
              {...p}
              className={SELECT_CLASS}
              value={filters.evidence}
              onChange={(e) =>
                onChange({ ...filters, evidence: e.target.value as PersonaFilters["evidence"] })
              }
            >
              <option value="">Any evidence</option>
              {PERSONA_EVIDENCE.map((x) => (
                <option key={x} value={x}>
                  {EVIDENCE_LABEL[x]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Tag">
          {(p) => (
            <select
              {...p}
              className={SELECT_CLASS}
              value={filters.tag}
              onChange={(e) => onChange({ ...filters, tag: e.target.value })}
            >
              <option value="">Every tag</option>
              {tags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      {active && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-sub">
          <p role="status">
            Showing {shown} of {total} personas.
          </p>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(NO_FILTERS)}>
            Clear filters
          </Button>
        </div>
      )}
    </div>
  );
}
