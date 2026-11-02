import { ComicsPortal } from "./comics-portal";

export const metadata = {
  title: "Comics portal",
  description: "Upload, schedule and review the Agile at Work comics.",
  // Owner-only page: keep it out of search results on the public site.
  robots: { index: false, follow: false },
};

export default function ComicsPortalPage() {
  return (
    <div className="container-tool py-8">
      <header className="mb-6 space-y-2">
        <h1 className="text-fluid-h2 font-semibold text-text">Comics portal</h1>
        <p className="text-sub max-w-2xl">
          Upload and schedule stories, check what comes next, and answer licence requests.
        </p>
      </header>
      <ComicsPortal />
    </div>
  );
}
