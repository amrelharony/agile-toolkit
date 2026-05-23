# @agile-toolkit/mcp

Local stdio MCP relay for the Agile Toolkit. Forwards Claude Desktop / Claude Code tool calls to your deployed Agile Toolkit instance over HTTPS.

This package is a thin relay — it doesn't contain any of the toolkit's business logic. The available tools always reflect what your deployed server exposes, so updating the toolkit auto-updates the action surface.

## Install

```bash
npm install -g @agile-toolkit/mcp
```

## Configure Claude Desktop

1. Mint a personal access token at `<your-toolkit-url>/settings/access-tokens`.
2. Copy the raw token (shown once).
3. Add to your Claude Desktop MCP config (e.g. `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, `%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "agile-toolkit": {
      "command": "agile-toolkit-mcp",
      "env": {
        "AGILE_TOOLKIT_PAT": "pat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "AGILE_TOOLKIT_URL": "https://agile.amrelharony.com"
      }
    }
  }
}
```

4. Restart Claude Desktop. The toolkit's actions appear as `workspace.sprint.create`, `tool.canvas.add_sticky`, `intent.start_retro_for_sprint`, etc.

## Configure Claude Code

```bash
claude mcp add agile-toolkit \
  -e AGILE_TOOLKIT_PAT=pat_xxxx \
  -e AGILE_TOOLKIT_URL=https://agile.amrelharony.com \
  -- agile-toolkit-mcp
```

## Env vars

| Var | Default | Required |
|---|---|---|
| `AGILE_TOOLKIT_PAT` | — | yes |
| `AGILE_TOOLKIT_URL` | `https://agile.amrelharony.com` | no |

## Troubleshooting

- **401 from the upstream**: PAT is missing, revoked, or expired. Mint a new one.
- **No tools appear**: the deployed server's registry is empty — check that `src/lib/actions/register-all.ts` is imported in the API route.
- **Relay logs**: stderr from this process is shown in Claude Desktop's developer console.

## Build from source

```bash
cd mcp-server
npm install
npm run build
```

Output lands in `dist/index.js` and is set executable for use as the `agile-toolkit-mcp` bin.
