# MCP integration

Story UI's server can be driven from an MCP client such as Claude Desktop or
Claude Code. Two transports exist; both are thin clients of the HTTP server,
which must be running from your project directory with your `.env` and
`story-ui.config.js`.

## Tools

The same eight tools on both transports (`mcp-server/mcp-stdio-server.ts`,
`mcp-server/routes/mcpRemote.ts`):

| Tool | Arguments | Does |
|---|---|---|
| `test-connection` | none | Confirms the HTTP server answers. |
| `generate-story` | `prompt`, optional `chatId` | Generates and writes a story. |
| `update-story` | `prompt`, optional `storyId` | Edits an existing story; without an id it uses the most recent one or infers from context. |
| `list-components` | optional `category` | The discovered component inventory. |
| `list-stories` | none | Generated stories. |
| `get-story` | `storyId` | A story's content. |
| `delete-story` | `storyId` | Removes the file. |
| `get-component-props` | `componentName` | Props for one component. |

Direct prop editing, version history, verification details and handoff are
workspace features and are not exposed as MCP tools.

## stdio (local)

The stdio server is started with `story-ui mcp` (or `story-ui start --mcp`,
which runs both processes). It speaks JSON-RPC on stdin/stdout and forwards
every call to the HTTP server.

Claude Desktop, `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "story-ui": {
      "command": "npx",
      "args": ["@tpitre/story-ui", "mcp"],
      "env": {
        "STORY_UI_CWD": "/path/to/your/storybook-project"
      }
    }
  }
}
```

`STORY_UI_CWD` (or a `--cwd=<dir>` argument) makes the process change into
your project before loading `.env` and the config; without it the process runs
wherever Claude Desktop started it. The API key is read from that `.env`, so it
does not need to be repeated in the client config.

The stdio process finds the HTTP server through, in order:
`STORY_UI_HTTP_BASE_URL` (a full URL), or `http://localhost:<port>` where the
port is `VITE_STORY_UI_PORT`, `STORY_UI_HTTP_PORT`, `PORT`, then 4001.
`story-ui mcp --http-port 4002` sets `STORY_UI_HTTP_PORT`.

Because the HTTP server is loopback-only by default and the stdio process runs
on the same machine, no token is needed for this setup.

## Streamable HTTP (remote)

The HTTP server mounts an MCP endpoint at `/mcp-remote/mcp` (and the same under
`/story-ui/mcp-remote/mcp`). `POST` carries the Streamable HTTP transport;
`GET /mcp-remote/sse` and `POST /mcp-remote/messages` are the legacy SSE
transport and are still served.

Claude Code:

```bash
# local server, no token needed
claude mcp add --transport http story-ui http://localhost:4001/mcp-remote/mcp

# a server that is reachable from other machines runs in token mode
claude mcp add --transport http story-ui https://your-host/mcp-remote/mcp \
  --header "Authorization: Bearer <STORY_UI_TOKEN>"
```

Access control applies to this endpoint exactly as to every other route: a
server exposed beyond loopback refuses to start without `STORY_UI_TOKEN`, and
then every request must carry the token as a bearer header, an
`x-story-ui-token` header, or the cookie set by visiting once with `?token=`.
A client that cannot attach a header cannot use a remote Story UI server;
that is deliberate, because the tools write files and spend API keys.

## Troubleshooting

- **Tools listed but every call fails.** The HTTP server is not running, or is
  on a different port than the stdio process expects. Start it with
  `npm run story-ui` in the project and check the port it logs.
- **Wrong project.** The stdio process loaded config from its own working
  directory. Set `STORY_UI_CWD`.
- **401 Unauthorized.** The server is in token mode. Send the bearer header.
- **Generated story does not appear in Storybook.** Confirm
  `generatedStoriesPath` in `story-ui.config.js` is inside the `stories` globs
  in `.storybook/main.*`.
