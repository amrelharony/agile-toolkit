import { ImportClient } from "./import-client";

export const metadata = {
  title: "Import comics",
  description: "Import a batch of comics from a folder on this computer.",
  // Owner-only page: keep it out of search results on the public site.
  robots: { index: false, follow: false },
};

export default function ImportComicsPage() {
  return (
    <div className="container-tool py-8">
      <header className="mb-6 space-y-2">
        <h1 className="text-fluid-h2 font-semibold text-text">Import comics</h1>
        <p className="text-sub max-w-2xl">
          Choose an extracted folder on this computer. Each panel is converted here in your browser
          and uploaded under your session. If it stops, run it again: finished stories are skipped.
        </p>
      </header>
      <ImportClient />
    </div>
  );
}
