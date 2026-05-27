import { AppearanceClient } from "./appearance-client";

export const metadata = {
  title: "Appearance — Agile Toolkit",
  description: "Holiday themes, seasonal animations, and decorative overlays.",
};

export default function AppearancePage() {
  return (
    <div className="container-tool py-8">
      <header className="mb-6 space-y-2">
        <h1 className="text-fluid-h2 font-semibold text-text">Appearance</h1>
        <p className="text-sub max-w-2xl">
          The toolkit shifts colors and adds light particle animations on Egyptian holidays (Eid,
          Ramadan, Coptic Easter, national days, and a few global ones). Turn that off here, or
          clear the list of themes you&rsquo;ve dismissed this year so they show again on their next
          window.
        </p>
      </header>
      <AppearanceClient />
    </div>
  );
}
