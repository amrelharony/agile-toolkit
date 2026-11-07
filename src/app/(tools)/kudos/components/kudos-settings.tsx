"use client";

/**
 * Kudos settings modal (Phase 5).
 *
 * Two sections rendered inline (no tabs — the whole thing fits in one
 * comfortable column):
 *   - AI features:           sentiment / dedup / fairness toggles.
 *   - Beacon visibility:     ambient HUD / header beacon toggles.
 *
 * State persists to localStorage via `useKudosSettingsStore`. These are
 * device-local preferences — user comfort, not shared workspace state.
 * The cards themselves are the printed Agile at Work ones, so there is no
 * theme to set up here.
 */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useKudosSettingsStore } from "@/lib/stores/kudos-settings-store";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function KudosSettings({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl bg-surface border-border max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-text">Kudos settings</DialogTitle>
          <DialogDescription className="text-sub">
            Preferences for this device: which AI suggestions to use, and where the kudos beacon
            shows.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-6">
          <AiFeaturesSection />
          <BeaconSection />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SectionHeading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <h3 className="text-sm font-semibold text-text">{title}</h3>
      {hint && <p className="text-xs text-sub">{hint}</p>}
    </div>
  );
}

interface ToggleRowProps {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}
function ToggleRow({ label, hint, checked, onChange }: ToggleRowProps) {
  return (
    <label className="flex items-start justify-between gap-3 rounded-md border border-border bg-surface-deep/40 px-3 py-2.5 cursor-pointer">
      <span className="flex flex-col gap-0.5">
        <span className="text-sm text-text">{label}</span>
        {hint && <span className="text-xs text-sub">{hint}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function AiFeaturesSection() {
  const aiSentiment = useKudosSettingsStore((s) => s.aiSentiment);
  const aiDedup = useKudosSettingsStore((s) => s.aiDedup);
  const aiFairness = useKudosSettingsStore((s) => s.aiFairness);
  const setAiSentiment = useKudosSettingsStore((s) => s.setAiSentiment);
  const setAiDedup = useKudosSettingsStore((s) => s.setAiDedup);
  const setAiFairness = useKudosSettingsStore((s) => s.setAiFairness);

  return (
    <section className="flex flex-col gap-2">
      <SectionHeading
        title="AI features"
        hint="Uses your BYOK key. Turn off any feature you don't want sent to the LLM."
      />
      <ToggleRow
        label="Sentiment analysis"
        hint="Surfaces an inline 'sounds sarcastic?' warning while you type."
        checked={aiSentiment}
        onChange={setAiSentiment}
      />
      <ToggleRow
        label="Duplicate detection"
        hint="Folds near-duplicate kudos on the wall into one card."
        checked={aiDedup}
        onChange={setAiDedup}
      />
      <ToggleRow
        label="Fairness suggestions"
        hint="Highlights teammates who haven't been recognized recently."
        checked={aiFairness}
        onChange={setAiFairness}
      />
    </section>
  );
}

function BeaconSection() {
  const beaconAmbient = useKudosSettingsStore((s) => s.beaconAmbient);
  const beaconHeader = useKudosSettingsStore((s) => s.beaconHeader);
  const setBeaconAmbient = useKudosSettingsStore((s) => s.setBeaconAmbient);
  const setBeaconHeader = useKudosSettingsStore((s) => s.setBeaconHeader);

  return (
    <section className="flex flex-col gap-2">
      <SectionHeading
        title="Beacon visibility"
        hint="The kudos beacon nudges you when teammates are under-recognized."
      />
      <ToggleRow
        label="Ambient beacon"
        hint="A floating pill on the kudos page surfacing live fairness hints."
        checked={beaconAmbient}
        onChange={setBeaconAmbient}
      />
      <ToggleRow
        label="Header beacon"
        hint="A pulsing dot in the toolkit header when you receive new kudos."
        checked={beaconHeader}
        onChange={setBeaconHeader}
      />
    </section>
  );
}
