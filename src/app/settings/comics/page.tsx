import { ComicsPortal } from "./comics-portal";
import { SettingsHeader } from "@/components/settings/settings-header";
import { comicsArt } from "@/lib/ink/drawings/pages/comics";

export const metadata = {
  title: "Comics portal",
  description: "Upload, schedule and review the Agile at Work comics.",
  // Owner-only page: keep it out of search results on the public site.
  robots: { index: false, follow: false },
};

export default function ComicsPortalPage() {
  return (
    <div className="container-tool py-8">
      <SettingsHeader title="Comics portal" art={comicsArt}>
        Upload and schedule stories, check what comes next, and answer licence requests.
      </SettingsHeader>
      <ComicsPortal />
    </div>
  );
}
