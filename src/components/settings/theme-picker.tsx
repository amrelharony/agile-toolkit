"use client";

import { Contrast, Monitor, Moon, Sun } from "lucide-react";
import { ToggleGroup } from "@/components/ui/toggle-group";
import {
  setThemePreference,
  useAppliedTheme,
  useThemePreference,
  type ThemePreference,
} from "@/lib/theme/theme";

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Comic", icon: Sun },
  { value: "dark", label: "Night", icon: Moon },
  { value: "hc", label: "High contrast", icon: Contrast },
  { value: "system", label: "System", icon: Monitor },
];

/** Theme choice for Settings → Appearance. */
export function ThemePicker() {
  const preference = useThemePreference();
  const applied = useAppliedTheme();
  return (
    <section className="panel p-5" aria-labelledby="theme-heading">
      <h2 id="theme-heading" className="font-medium text-text">
        Theme
      </h2>
      <p className="mt-1 max-w-xl text-sm text-sub">
        Comic is warm paper and ink. Night is the same comic on dark paper. High contrast uses
        black, white and yellow with solid borders, strong focus rings and plain lettering. System
        picks Comic or Night from your device&apos;s light or dark setting.
      </p>
      <ToggleGroup
        className="mt-4"
        label="Theme"
        value={preference}
        onValueChange={setThemePreference}
        options={OPTIONS.map(({ value, label, icon: Icon }) => ({
          value,
          label: (
            <span className="inline-flex items-center gap-2">
              <Icon className="h-4 w-4" aria-hidden="true" />
              {label}
            </span>
          ),
          ariaLabel: label,
        }))}
      />
      {preference === "system" && (
        <p className="mt-3 text-xs text-sub" aria-live="polite">
          Currently {applied === "light" ? "Comic" : "Night"}, from your device.
        </p>
      )}
    </section>
  );
}
