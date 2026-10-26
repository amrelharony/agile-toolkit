"use client";

import { Pencil, Trash2 } from "lucide-react";
import { BacklogRowLink } from "@/components/prioritization/backlog-link";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";
import { KANO_CATEGORY_LABEL, KANO_MIN_RESPONSES } from "@/lib/prioritization/methods/kano";
import { answersText, coefText, type FeatureView } from "./model";
import { CATEGORY_TONE } from "./results";

/**
 * One feature in its list: the title and backlog link, its category chip
 * ("Picked by hand" for an old pick, with "Add answers"), how it was
 * answered, Better and Worse once 3 answers are counted (until then, how
 * many more are needed), and Edit and Delete.
 */
export function FeatureRow({
  feature,
  onEdit,
  onRemove,
}: {
  feature: FeatureView;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { row } = feature.ranked;
  const counted = feature.reading.counts !== null;
  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
      <div className="min-w-0 flex-1 basis-48 space-y-1">
        <p className="inline-flex flex-wrap items-center gap-2 text-sm text-text">
          <span className="break-words">{row.title}</span>
          <BacklogRowLink row={row} />
        </p>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {feature.category && (
            <span
              className={cn("rounded-full border px-2 py-0.5", CATEGORY_TONE[feature.category])}
            >
              {KANO_CATEGORY_LABEL[feature.category]}
            </span>
          )}
          {feature.picked ? (
            <span className="rounded-full border border-dashed border-border px-2 py-0.5 text-sub">
              Picked by hand
            </span>
          ) : (
            <span className="text-sub">{answersText(feature)}</span>
          )}
          {feature.coefficients ? (
            <span className="font-mono text-text">
              Better {coefText(feature.coefficients.better)} · Worse{" "}
              {coefText(feature.coefficients.worse)}
            </span>
          ) : (
            counted && (
              <span className="text-sub">
                Better and Worse from {KANO_MIN_RESPONSES} answers ({feature.n} so far)
              </span>
            )
          )}
        </div>
      </div>
      <span className="flex shrink-0 items-center gap-1">
        {feature.picked && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onEdit}
            aria-label={`Add answers for ${row.title}`}
          >
            Add answers
          </Button>
        )}
        <IconButton
          label={`Edit ${row.title}`}
          icon={<Pencil className="h-4 w-4" />}
          className="text-sub hover:text-text"
          onClick={onEdit}
        />
        <IconButton
          label={`Delete ${row.title}`}
          icon={<Trash2 className="h-4 w-4" />}
          className="text-sub hover:text-danger"
          onClick={onRemove}
        />
      </span>
    </div>
  );
}
