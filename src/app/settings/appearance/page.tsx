import { AppearanceClient } from "./appearance-client";

export const metadata = {
  title: "Appearance",
  description: "Theme (system, dark, light, high contrast) and holiday decorations.",
};

export default function AppearancePage() {
  return (
    <div className="container-tool py-8">
      <header className="mb-6 space-y-2">
        <h1 className="text-fluid-h2 font-semibold text-text">Appearance</h1>
        <p className="text-sub max-w-2xl">
          Choose a colour theme, and control the holiday decorations: on Egyptian holidays (Eid,
          Ramadan, Coptic Easter, national days and a few global ones) the toolkit shifts colours
          and adds light particle animations.
        </p>
      </header>
      <AppearanceClient />
    </div>
  );
}
