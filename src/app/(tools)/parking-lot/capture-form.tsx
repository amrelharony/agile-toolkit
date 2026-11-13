"use client";

import { forwardRef } from "react";
import { SquareParking } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { PersonPicker } from "@/components/team/person-picker";
import { TOOL_TEXT_MAX } from "@/lib/stores/workspace-types";
import {
  validateParkingDraft,
  type ParkingDraft,
  type ParkingField,
  type ParkingValues,
} from "@/lib/parking-lot/model";

/**
 * Quick capture: the point on one line, Enter parks it. The meeting starts
 * as the one the last point was parked in (`meeting()` is read when the form
 * starts and after each park), so a run of points in one meeting needs it
 * typed once; who raised it is cleared each time. Nothing is saved until the
 * point has words.
 */
export const CaptureForm = forwardRef<
  HTMLInputElement,
  {
    onPark: (values: ParkingValues) => void;
    /** The meeting to start with: the last one used. */
    meeting: () => string;
    /** Offer "Add to the team" for a name off the roster; never while the example is shown. */
    offerAddToRoster?: boolean;
  }
>(function CaptureForm({ onPark, meeting, offerAddToRoster = true }, ref) {
  const form = useItemForm<ParkingDraft, ParkingValues, ParkingField>({
    initial: () => ({ text: "", meeting: meeting(), raisedBy: "" }),
    validate: validateParkingDraft,
    onSave: onPark,
  });
  const { draft, update, errors } = form;
  return (
    <ItemForm
      form={form}
      submitLabel="Park it"
      submitIcon={<SquareParking className="h-4 w-4" aria-hidden="true" />}
    >
      <Field label="Point to park" error={errors.text} required>
        {(props) => (
          <Input
            {...props}
            ref={ref}
            value={draft.text}
            maxLength={TOOL_TEXT_MAX.text}
            // Enter parks it; on a phone the return key says so.
            enterKeyHint="done"
            autoComplete="off"
            onChange={(e) => update({ text: e.target.value })}
            placeholder="e.g. Who owns the release checklist?"
          />
        )}
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Meeting" error={errors.meeting} hint="Remembered for the next point.">
          {(props) => (
            <Input
              {...props}
              value={draft.meeting}
              maxLength={TOOL_TEXT_MAX.short}
              enterKeyHint="done"
              autoComplete="off"
              onChange={(e) => update({ meeting: e.target.value })}
              placeholder="e.g. Daily Scrum"
            />
          )}
        </Field>
        <PersonPicker
          label="Raised by"
          value={draft.raisedBy}
          onChange={(raisedBy) => update({ raisedBy })}
          error={errors.raisedBy}
          placeholder="Who raised it"
          offerAddToRoster={offerAddToRoster}
        />
      </div>
    </ItemForm>
  );
});
