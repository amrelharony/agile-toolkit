import { SquadsClient } from "./squads-client";
import { SettingsHeader } from "@/components/settings/settings-header";
import { squadArt } from "@/lib/ink/drawings/pages/squad";

export const metadata = {
  title: "Squads",
  description: "Manage squad invite codes and guest profiles.",
  // Owner-only page: keep it out of search results on the public site.
  robots: { index: false, follow: false },
};

export default function SquadsPage() {
  return (
    <div className="container-tool py-8">
      <SettingsHeader title="Squads" art={squadArt}>
        Invite squad members to join collaborative tool sessions as guests. Create a squad, share
        the code, and members join at <code className="font-mono text-text">/guest/join</code>. Each
        member picks a display name + color on first redeem and resumes the same identity on later
        visits.
      </SettingsHeader>
      <SquadsClient />
    </div>
  );
}
