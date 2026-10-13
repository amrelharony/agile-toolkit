import { AccessTokensClient } from "./access-tokens-client";

export const metadata = {
  title: "Access Tokens — Agile Toolkit",
  description: "Manage personal access tokens for the MCP server.",
  // Owner-only page: keep it out of search results on the public site.
  robots: { index: false, follow: false },
};

export default function AccessTokensPage() {
  return (
    <div className="container-tool py-8">
      <header className="mb-6 space-y-2">
        <h1 className="text-fluid-h2 font-semibold text-text">Access tokens</h1>
        <p className="text-sub max-w-2xl">
          Generate personal access tokens (PATs) to authenticate the MCP server. External agents
          (Claude Desktop, Claude Code) use these to drive the toolkit over HTTP. Each token shows
          its raw value <strong>once</strong> at creation — copy it then. Revoke unused tokens.
        </p>
      </header>
      <AccessTokensClient />
    </div>
  );
}
