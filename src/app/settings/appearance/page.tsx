import { AppearanceClient } from "./appearance-client";
import { SettingsHeader } from "@/components/settings/settings-header";
import { paletteArt } from "@/lib/ink/drawings/pages/palette";

export const metadata = {
  title: "Appearance",
  description: "Theme (system, dark, light, high contrast) and holiday decorations.",
};

export default function AppearancePage() {
  return (
    <div className="container-tool py-8">
      <SettingsHeader title="Appearance" art={paletteArt}>
        Choose a colour theme, and control the holiday decorations: on Egyptian holidays (Eid,
        Ramadan, Coptic Easter, national days and a few global ones) the toolkit shifts colours and
        adds light particle animations.
      </SettingsHeader>
      <AppearanceClient />
    </div>
  );
}
