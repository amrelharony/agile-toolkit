import { SquadsClient } from "./squads-client";

export const metadata = {
  title: "Squads — Agile Toolkit",
  description: "Manage squad invite codes and guest profiles.",
};

export default function SquadsPage() {
  return (
    <div className="container-tool py-8">
      <header className="mb-6 space-y-2">
        <h1 className="text-fluid-h2 font-semibold text-text">Squads</h1>
        <p className="text-sub max-w-2xl">
          Invite squad members to join collaborative tool sessions as guests. Create a squad, share
          the code, and members join at <code className="font-mono text-text">/guest/join</code>.
          Each member picks a display name + color on first redeem and resumes the same identity on
          later visits.
        </p>
      </header>
      <SquadsClient />
    </div>
  );
}
