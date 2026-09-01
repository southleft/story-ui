# Deployment

Story UI is built to run on a developer's machine next to Storybook. This
document is for the case where you want the workspace in a Storybook that other
people open in a browser. Read the security section first; it is not optional.

## What the server is

One Express process (`mcp-server/index.ts`) that:

- discovers components and generates stories into `generatedStoriesPath`;
- serves the API under `/mcp/*` and `/story-ui/*`, and MCP under `/mcp-remote/*`;
- optionally proxies every non-API request to a Storybook dev server
  (`STORYBOOK_PROXY_ENABLED=true`, `STORYBOOK_PROXY_PORT`, default 6006),
  including the WebSocket HMR channel, so one public port serves both.

It writes files into the repository it runs in, spends the API keys in its
environment, and can run `git commit`, `git push` and `gh pr create` for the
handoff feature. Treat it accordingly.

## Access control

`mcp-server/auth.ts` gives the server two modes and refuses to be in neither.

**Loopback (default).** Binds `127.0.0.1` and answers only requests whose
`Host` header is a loopback name. Nothing outside the machine can reach it.

**Token.** With `STORY_UI_TOKEN` set, every request must carry the token as
`Authorization: Bearer <token>`, as `x-story-ui-token`, or as the HttpOnly
cookie the server sets when a browser opens any path once with
`?token=<token>` (the query parameter is then removed by redirect). Tokens are
compared in constant time. `/health` answers without a token so a platform can
probe it; nothing else does.

**Refusal.** If the server detects it is meant to be public, that is
`STORYBOOK_PROXY_ENABLED=true`, a non-loopback `STORY_UI_HOST`, or a Railway
environment (`RAILWAY_ENVIRONMENT` or `RAILWAY_PROJECT_ID`), and no token is
set, it exits at startup with a message saying why. The only way past that is
`STORY_UI_ALLOW_UNAUTHENTICATED=true`, which is logged as a warning on every
start. Do not run a public server that way: anyone who finds the URL can write
files into your repository and spend your keys.

The workspace sends the token when it can find one: `window.__STORY_UI_TOKEN__`
set by the host page, `VITE_STORY_UI_TOKEN` at build time, or the cookie from
the `?token=` visit. Sharing a link of the form
`https://your-host/?token=<token>` is the simplest way to let a reviewer in.

CORS allows `localhost`, `*.up.railway.app`, `*.pages.dev` and anything in
`STORY_UI_ALLOWED_ORIGINS` (comma-separated).

## Live mode

The intended shape: Storybook in dev mode on an internal port, the Story UI
server on the public port proxying to it. Storybook must be in dev mode
because the server writes story files and Storybook has to index them; a
static build cannot.

Environment:

| Variable | Value |
|---|---|
| `STORY_UI_TOKEN` | A long random string. Required. |
| `STORYBOOK_PROXY_ENABLED` | `true` |
| `STORYBOOK_PROXY_PORT` | The internal Storybook port, default `6006` |
| `PORT` | The public port; Railway sets it |
| `CLAUDE_API_KEY` / `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` | At least one |
| `DEFAULT_PROVIDER`, `DEFAULT_MODEL` | Optional |
| `ALLOWED_PROVIDERS`, `ALLOWED_MODELS`, `SINGLE_PROVIDER_MODE` | Optional cost controls |
| `STORY_UI_ALLOWED_ORIGINS` | Only if the page is served from a domain not covered above |

A start script, adapted from this repository's `start-live.sh`:

```bash
#!/bin/bash
STORYBOOK_PORT=6006
MCP_PORT=${PORT:-4001}

npm run storybook -- --port "$STORYBOOK_PORT" --host 0.0.0.0 --ci --no-open &
STORYBOOK_PID=$!

# wait until Storybook answers
until wget -q --spider "http://localhost:${STORYBOOK_PORT}/"; do sleep 2; done

export STORYBOOK_PROXY_ENABLED=true
export STORYBOOK_PROXY_PORT=$STORYBOOK_PORT
npx story-ui start --port "$MCP_PORT" &
MCP_PID=$!

trap 'kill $STORYBOOK_PID $MCP_PID' SIGTERM SIGINT
wait $STORYBOOK_PID $MCP_PID
```

Run it from the Storybook project so the server finds `story-ui.config.js`
and `.env` there. `story-ui start` sets `--max-old-space-size=8192` on the
child process unless `NODE_OPTIONS` already contains one.

Health check: use `/health`. This repository's own `railway.json` and
`Dockerfile` probe `/story-ui/providers`, which requires the token and will
fail in token mode; change it when you copy them.

The workspace on that page resolves the server URL to the page's own origin
when the hostname ends in `up.railway.app`. On another host set
`VITE_STORY_UI_EDGE_URL` at build time or `window.__STORY_UI_EDGE_URL__` on
the page.

Verification runs on the server and needs `playwright` installed in the
Storybook project with a browser available in the container. Without it every
story is reported as "Not verified"; generation still works.

## Railway

Railway is supported and detected: the presence of `RAILWAY_ENVIRONMENT` or
`RAILWAY_PROJECT_ID` puts the server in public mode, which means it will not
start without `STORY_UI_TOKEN`.

```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

Set the variables above in the Railway dashboard. Generated stories are files;
a Railway container's filesystem is replaced on each deploy, so mount a volume
at the generated stories path (for example `/app/src/stories/generated`) if
they need to survive. The manifest (`.story-ui-manifest.json`) is written
inside that directory and is covered by the same volume; version history is
written to `.story-ui-history/` at the project root and needs its own mount if
you want restore to work across deploys.

This repository's `Dockerfile` and `start-live.sh` build the demo: they install
the package from source and run a bundled Mantine test Storybook from
`test-storybooks/mantine-storybook`. They are a reference, not a template for
your project.

## `story-ui deploy`

The CLI has a `deploy` command (`--live`, `--platform railway|render|fly`,
`--dry-run`, `--backend`, `--app`, `--frontend`, `--backend-url`,
`--storybook-dir`, `--project-name`). `--dry-run` writes the deployment files
without deploying, which is the recommended way to use it: review what it
produced, then add `STORY_UI_TOKEN` and the health check path yourself.

## Handoff in a deployment

The handoff feature runs `git` in the server's working directory. In a
container that means the checked-out copy of your repository, so it needs a
remote it can push to and, for pull requests, an authenticated `gh`. If neither
is present the dialog says so and the push and PR options are disabled;
committing to a local branch still works.

## Checklist

- `STORY_UI_TOKEN` set, and given to reviewers as `?token=` links.
- `STORY_UI_ALLOW_UNAUTHENTICATED` not set.
- Health check on `/health`.
- At least one provider key; `ALLOWED_MODELS` if cost matters.
- Storybook in dev mode, proxied, not a static build.
- A volume at the generated stories path if stories must persist.
- `playwright` in the project if you want verification.
