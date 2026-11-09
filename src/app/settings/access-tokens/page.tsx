import { AccessTokensClient } from "./access-tokens-client";
import { SettingsHeader } from "@/components/settings/settings-header";
import { keyArt } from "@/lib/ink/drawings/pages/key";

export const metadata = {
  title: "Access Tokens",
  description: "Manage personal access tokens for the MCP server.",
  // Owner-only page: keep it out of search results on the public site.
  robots: { index: false, follow: false },
};

export default function AccessTokensPage() {
  return (
    <div className="container-tool py-8">
      <SettingsHeader title="Access tokens" art={keyArt}>
        Generate personal access tokens (PATs) to authenticate the MCP server. External agents
        (Claude Desktop, Claude Code) use these to drive the toolkit over HTTP. Each token shows its
        raw value <strong>once</strong> at creation — copy it then. Revoke unused tokens.
      </SettingsHeader>
      <AccessTokensClient />
    </div>
  );
}
