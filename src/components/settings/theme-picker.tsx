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
  { value: "system", label: "System", icon: Monitor },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "light", label: "Light", icon: Sun },
  { value: "hc", label: "High contrast", icon: Contrast },
];

/** Theme choice for Settings → Appearance. */
export function ThemePicker() {
  const preference = useThemePreference();
  const applied = useAppliedTheme();
  return (
    <section
      className="rounded-lg border border-border bg-card p-5"
      aria-labelledby="theme-heading"
    >
      <h2 id="theme-heading" className="font-medium text-text">
        Theme
      </h2>
      <p className="mt-1 max-w-xl text-sm text-sub">
        System follows your device&apos;s light or dark setting. High contrast uses black, white and
        yellow with solid borders and strong focus rings.
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
          Currently {applied === "light" ? "light" : "dark"}, from your device.
        </p>
      )}
    </section>
  );
}
