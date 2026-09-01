# Story UI

[![npm version](https://badge.fury.io/js/%40tpitre%2Fstory-ui.svg)](https://www.npmjs.com/package/@tpitre/story-ui)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Story UI is a workspace inside your Storybook for composing screens from the
design system that is actually installed in the project. You describe what you
want; the server discovers your components (from the package's type
declarations, from local source, and from Storybook's own index), asks a
model to write a `.stories.tsx` file with them, writes the file, and shows it
in Storybook's own preview iframe. The preview is not a sandbox: it is your
Storybook, your providers, your theme.

Once a story exists you iterate on it in two different ways. Compositional
changes ("add a filters panel") go back through the model. Parametric changes
("make this button the secondary variant") do not: you click the element in the
preview, the property panel reads the prop's legal values from the component's
own types, and the change is applied as an AST edit to one attribute with no
model in the path. Every generated story is then rendered in a real browser and
checked, and the result is reported as a verification badge that names which
checks ran and which did not.

## Requirements

- Node 20 or newer (the code uses global `fetch`, `AbortSignal.timeout` and `Array.prototype.at`).
- Storybook 8 or newer; 9 and 10 are what development runs against. The "Edit in Story UI" toolbar button needs Storybook 9+.
- A React + TypeScript design system for the full workspace. See [Framework support](#framework-support) for what other frameworks get.
- An API key for at least one of Anthropic, OpenAI or Google Gemini.
- For verification: `playwright` (or `playwright-core`) installed in your project, with a browser downloaded. `axe-core` is optional and enables the accessibility check.

## Quick start

```bash
npm install -D @tpitre/story-ui
npx story-ui init          # detects your framework and design system, writes config and the workspace entry
npm run story-ui           # Story UI server on http://127.0.0.1:4001 (loopback only)
npm run storybook          # your Storybook, in another terminal
```

Open Storybook and go to **Story UI > Workspace** in the sidebar. Type a
request, press Enter, and the story appears in the preview when the file has
been written. The story is also listed under `Generated/` in Storybook's sidebar.

`init` creates `story-ui.config.js`, `.env` (with `DEFAULT_PROVIDER`, your key
and `VITE_STORY_UI_PORT`), `story-ui-considerations.md`, a `story-ui-docs/`
directory, `src/stories/StoryUIV2/StoryUIV2.mdx` (the workspace) and
`src/stories/StoryUI/` (the classic panel), and adds `story-ui` and
`storybook-with-ui` scripts to `package.json`. It keeps an existing config and
panel files unless you pass `--force`, and it only removes Storybook's own
scaffold stories (`Button`, `Header`, `Page`) after checking the file content is
the scaffold. `npm run storybook-with-ui` starts both processes together.

The long-form walkthrough is in [docs/quick-start.md](docs/quick-start.md).

## What you get

In the order you meet it in the workspace (`Story UI > Workspace`):

1. **Prompt.** A composer with provider and model selection. You can attach up to four images (file picker, paste, or drag and drop; they are downscaled in the browser before upload) and dictate with the microphone button where the browser supports the Web Speech API.
2. **Live preview at write time.** The right pane is Storybook's `/iframe.html` showing the story that was just written. Fit, desktop (1280), tablet (834) and mobile (390) widths.
3. **Chat iteration.** Follow-up requests are sent with the current file so the model edits rather than regenerates. A rewrite that diverges structurally from the file is rejected.
4. **Click to edit.** Click an element in the preview. The component is identified from React's fiber tree (the name the source used, not a CSS class), and the property panel lists the props that component accepts, read from its type declarations. Deprecated props are withheld. Changing a value writes one attribute of one element through `POST /mcp/edit-prop`; no model is involved.
5. **Pinned props.** Property-panel edits are recorded as pins and re-applied after every model rewrite. A pin whose element no longer exists is reported as lost rather than dropped silently.
6. **Version history.** Every generation is kept. Restore any version from the list, or press Cmd/Ctrl+Z outside a text field to put the previous one back.
7. **Code view.** The story's source, read-only, with Copy and Download.
8. **Verification badge.** After the file is written the story is rendered in a browser and checked (see below). The badge reads `Verified · N/6 checks`, `Issues`, or `Not verified` with the reason, and the findings list lets you select the element a finding names.
9. **Handoff.** Commit the story to a new git branch, optionally push, optionally open a pull request with `gh`. It never commits on your current branch, stages only the one story file (and its sibling stylesheet if there is one), refuses to run when unrelated changes are already staged, and never force-pushes.
10. **Components drawer.** The inventory the server discovered: name, import path, category, prop count, whether a description was found, and whether it came from npm or local source.
11. **Story switcher.** The header lists your generated stories; switching one restores its conversation. **Open in Storybook** opens the story in a new tab; **Delete** removes the file and its conversation.
12. **Theme.** The workspace follows the host: `data-theme` on the document, then the docs container's painted background, then `prefers-color-scheme`. Pin it by passing `appearance="light"` or `"dark"` to `<Workspace>` in `StoryUIV2.mdx`.

The classic panel (`Story UI > Story Generator`) is still installed alongside
and is the surface non-React projects use. It has chat generation, image
attachments, the Voice Canvas (a `react-live` playground; React projects only),
and a design-context editor for `story-ui-docs/`.

## How generation is verified

Before anything renders, the generated code is checked statically: TypeScript
AST parsing, forbidden-pattern checks, and import isolation (a story may only
import from your design system, the framework runtime, Storybook, your
configured icon package, and packages you name in
`story-ui-considerations.md`). Failures go back to the model for up to three
correction attempts.

After the file is written, `verifyStory` renders it in a browser and runs, in
order:

| Check | What it measures |
|---|---|
| Render | The story appears in Storybook's index and mounts without an uncaught error. Waits for the DOM to stop changing. |
| DOM census | Fake fields, unnamed icon-only controls, invisible icons, clickable non-buttons, nothing focusable. |
| Layout probe | Grid coverage against the rendered `grid-template-columns`, and left-edge alignment. |
| Class effect | Class names the story wrote that no loaded stylesheet defines. |
| Interaction | Clicks each control and waits for a visible change; opens overlays and checks they float instead of pushing content. |
| axe | Accessibility rules, when `axe-core` resolves from your project. |
| Visual critique | A vision-model pass on a full-page screenshot, judged against your request. On by default; `STORY_UI_VISUAL_CRITIQUE=false` turns it off. |

Findings are attributed through React's fiber tree. A defect in markup the
library rendered is reported as a warning and never triggers repair, because the
only "fix" a model could make is to stop using the component. Findings the
story can fix are blockers, and by default (`STORY_UI_VERIFY_ENFORCE` not set
to `false`) one repair pass is attempted; the candidate is re-verified and kept
only if it reduces blockers. The whole verify-and-repair phase has one budget,
three minutes by default (`STORY_UI_VERIFY_BUDGET_MS`).

What you must install: verification resolves `playwright` (or
`playwright-core`) and `axe-core` from **your project's** `node_modules`, not
from Story UI. If Playwright is missing or its browser is not downloaded, the
badge says `Not verified` with that reason. It never reports a pass it could
not prove: a check that did not run is listed as not run, not as clean.

Verification needs to reach your Storybook. The server uses, in order,
`storybookMcpUrl` from the config, `STORYBOOK_URL`, the proxy port when
`STORYBOOK_PROXY_ENABLED=true`, `STORYBOOK_PORT`, and finally `http://localhost:6006`.
If your Storybook is not on 6006, set `STORYBOOK_PORT`.

## Framework support

| Framework | Generation | Component discovery | Live preview | Click-to-edit and pinned props | Attributed verification |
|---|---|---|---|---|---|
| React + TypeScript | Workspace and classic panel | npm types, local source, Storybook index | Yes | Yes | Yes |
| Vue | Classic panel | Yes | Workspace preview mounts, but see note | No (`POST /mcp/edit-prop` answers 501) | Findings reported at warning, unattributed |
| Svelte | Classic panel | Yes | Same | No | Same |
| Web Components (Lit) | Classic panel | Yes, with `importExamples` for local libraries | Same | No | Same |
| Angular | Classic panel | Limited: `@Component` classes and `NgModule` exports by regex; a fixed fallback list for `@angular/material` | Same | No | Same |

Notes. The workspace renders through Storybook's docs addon, which is always
React, so it mounts in any Storybook; but element targeting reads React's fiber
tree and the prop editor parses JSX, so outside React the click-to-edit path is
refused and verification cannot say who rendered a node, so every blocker is
downgraded to a warning and nothing is repaired. Use the classic panel for
those projects. React design systems that ship without type declarations lose
prop knowledge and editable props.

The four React shapes that are developed against, because each hid a distinct
bug: barrel npm packages (Mantine, Carbon), subpath npm packages (MUI), one
package per component (Atlassian), and local source (Radix + Tailwind).

## Configuration

`story-ui.config.js` is looked for in the project root and then in
`.storybook/`, as `.js`, `.cjs` or `.ts`. `init` writes it as
`module.exports = { ... }`. Fields, from `story-ui.config.ts`:

| Field | Meaning |
|---|---|
| `importPath` | The package or path components are imported from (`@mantine/core`, `@/components`). |
| `generatedStoriesPath` | Where stories are written. Default `./src/stories/generated/`. |
| `componentsPath` | Local component source directory, for libraries that are not an npm package. |
| `componentsMetadataPath` | A `custom-elements.json` manifest, read when nothing else is discovered. |
| `components` | Explicit component list (`name`, `importPath`, `props`, `examples`, `description`, `category`, `slots`). Declared fields are honoured over discovered ones. |
| `layoutComponents` | Layout-specific components, same shape. |
| `componentFramework` | `react`, `vue`, `angular`, `svelte` or `web-components`. Routes discovery and the prop editor. |
| `framework` | Same values; story generation reads this one first. Set both to the same value. |
| `storybookFramework` | e.g. `@storybook/react-vite`; auto-detected from `package.json` when omitted. |
| `importStyle` | `barrel` (default) or `individual` for libraries without an index export. |
| `importExamples` | Example import lines shown to the model, mainly for Web Components and unusual folder layouts. |
| `additionalImports` | `[{ path, components }]` extra import sources. |
| `iconImports` | `{ package, importPath, commonIcons?, allowAllIcons? }`; auto-detected from `package.json` when omitted. |
| `componentPrefix` | Prefix prepended to discovered component names, and used to filter re-exports. |
| `storyPrefix` | Title prefix for generated stories. Default `Generated/`. |
| `defaultAuthor` | Written into story metadata. |
| `layoutRules` | `multiColumnWrapper`, `columnComponent`, `containerComponent`, `layoutExamples`, `prohibitedElements`. |
| `designSystemGuidelines` | `name`, `preferredComponents`, `spacingTokens`, `colorTokens`, `prohibitedPatterns`, `enforcementRules`, `additionalNotes`. |
| `systemPrompt`, `layoutInstructions`, `examples`, `sampleStory` | Prompt overrides. |
| `considerationsPath` | Path to the considerations file if not `./story-ui-considerations.md`. |
| `storybookMcpUrl`, `storybookMcpTimeout` | Your Storybook's URL, used for the Storybook MCP addon and as the verification target. |

Two files teach the model your design system. `story-ui-docs/` holds what the
design system *is* (`.md`, `.mdx`, `.json`, `.yaml`, `.yml`, `.xml`, `.html`,
`.txt`; 8,000 characters per file, 24,000 in total, truncated beyond that).
`story-ui-considerations.md` holds rules for how the model must *use* it, and is
the only place an extra package can be allowed for import ("Allowed additional
imports: `@tabler/icons-react`"). See [docs/CUSTOM_DOCUMENTATION.md](docs/CUSTOM_DOCUMENTATION.md).

## Environment variables

From `.env.sample`. The server reads `.env` in the directory it is started from.

| Variable | Purpose |
|---|---|
| `CLAUDE_API_KEY` or `ANTHROPIC_API_KEY` | Anthropic key. |
| `OPENAI_API_KEY`, `OPENAI_ORG_ID` | OpenAI key and optional organisation. |
| `GEMINI_API_KEY` or `GOOGLE_API_KEY` | Google key. |
| `DEFAULT_PROVIDER` | `claude`, `openai` or `gemini`. |
| `DEFAULT_MODEL` | Model id. Provider defaults are `claude-sonnet-5`, `gpt-5.5`, `gemini-3.1-pro`. `CLAUDE_MODEL`, `OPENAI_MODEL`, `GEMINI_MODEL` are still read. |
| `ALLOWED_PROVIDERS`, `ALLOWED_MODELS`, `SINGLE_PROVIDER_MODE` | Restrict what the UI can select. |
| `PORT` | Server port. Default 4001. |
| `VITE_STORY_UI_PORT` | Tells the workspace which port to call. Written by `init`. |
| `VITE_STORY_UI_EDGE_URL` / `window.__STORY_UI_EDGE_URL__` | Full server URL when it is not on localhost. |
| `VITE_STORY_UI_TOKEN` / `window.__STORY_UI_TOKEN__` | Token the workspace sends as a bearer header. |
| `STORY_UI_TOKEN`, `STORY_UI_HOST`, `STORY_UI_ALLOW_UNAUTHENTICATED` | Access control; see below. |
| `STORY_UI_ALLOWED_ORIGINS` | Extra CORS origins, comma-separated. |
| `STORY_UI_MAX_BODY` | Request body ceiling. Default `25mb`. |
| `STORYBOOK_URL`, `STORYBOOK_PORT` | Where verification finds your Storybook. |
| `STORYBOOK_PROXY_ENABLED`, `STORYBOOK_PROXY_PORT` | Proxy non-API requests to a Storybook dev server (deployments). |
| `STORY_UI_VERIFY_BUDGET_MS` | Verify-and-repair budget. Default 180000. |
| `STORY_UI_VISUAL_CRITIQUE` | `false` disables the vision pass. |
| `STORY_UI_VERIFY_ENFORCE` | `false` disables the repair pass. |
| `STORYBOOK_RUNTIME_VALIDATION` | `true` enables the older iframe-fetch check. Off by default. |
| `STORY_UI_LOG_LEVEL` | Server log level. |

The workspace resolves the server URL in this order (`StoryUIV2.mdx`):
`VITE_STORY_UI_EDGE_URL`, `window.__STORY_UI_EDGE_URL__`, the page's own
origin when the hostname ends in `up.railway.app`, then
`http://localhost:<VITE_STORY_UI_PORT or window.__STORY_UI_PORT__ or 4001>`.

## Security and deployment

The server writes files into your repository, spends your API keys and can run
`git` for you, so it has exactly two modes and refuses to be in neither:

- **Loopback (default).** Binds `127.0.0.1` and rejects any request whose
  `Host` header is not a loopback name, so a page you visit cannot reach it by
  DNS rebinding.
- **Token.** Set `STORY_UI_TOKEN` to a long random string. Every request must
  carry it as `Authorization: Bearer <token>` or `x-story-ui-token`, or a
  browser can open any URL once with `?token=<token>` and receive an HttpOnly
  cookie. `/health` is the only path that answers without it.

Public exposure (`STORYBOOK_PROXY_ENABLED=true`, a non-loopback
`STORY_UI_HOST`, or a Railway environment) without a token makes the server
exit at startup with an explanation. `STORY_UI_ALLOW_UNAUTHENTICATED=true`
overrides that deliberately; it is logged as a warning on every start and is
not recommended.

Railway remains an option: run Storybook in dev mode on an internal port, run
the server with `STORYBOOK_PROXY_ENABLED=true` and `STORYBOOK_PROXY_PORT`, and
set `STORY_UI_TOKEN`. Point the platform's health check at `/health`, since
every other path requires the token. Details, including the repository's own
`Dockerfile` and `start-live.sh`, are in [DEPLOYMENT.md](DEPLOYMENT.md).

## Claude Desktop and other MCP clients

Story UI exposes eight tools over MCP: `test-connection`, `generate-story`,
`update-story`, `list-components`, `list-stories`, `get-story`,
`delete-story`, `get-component-props`. Both transports call the HTTP server,
which must be running from your project directory.

**stdio** (local):

```json
{
  "mcpServers": {
    "story-ui": {
      "command": "npx",
      "args": ["@tpitre/story-ui", "mcp"],
      "env": { "STORY_UI_CWD": "/path/to/your/project" }
    }
  }
}
```

The stdio process finds the HTTP server through `STORY_UI_HTTP_BASE_URL`, or
`VITE_STORY_UI_PORT` / `STORY_UI_HTTP_PORT` / `PORT` (default 4001).

**Streamable HTTP** (remote): `POST <server>/mcp-remote/mcp`. When the server
runs in token mode the client must send the bearer header, for example
`claude mcp add --transport http story-ui <url>/mcp-remote/mcp --header "Authorization: Bearer <token>"`.
The legacy SSE endpoints `/mcp-remote/sse` and `/mcp-remote/messages` are still
served. See [docs/MCP_INTEGRATION.md](docs/MCP_INTEGRATION.md).

## Commands

From `cli/index.ts`:

| Command | Options |
|---|---|
| `story-ui init` | `-d, --design-system <system>`, `-l, --llm-provider <claude\|openai\|gemini>`, `-y, --yes`, `--skip-install`, `--force` (overwrite an existing config and panel files) |
| `story-ui start` | `-p, --port <port>` (default 4001; if busy, the next free port is used and logged), `-c, --config <path>` (sets `STORY_UI_CONFIG_PATH`; not currently read by the config loader), `--mcp` (also start the stdio MCP server) |
| `story-ui mcp` | `--http-port <port>` |
| `story-ui update` | `-f, --force`, `--no-backup`, `-n, --dry-run`, `-v, --verbose`. Refreshes the managed panel files and `StoryUIV2.mdx`; leaves `story-ui.config.js` and `.env` alone. |
| `story-ui status` | Installed version and managed-file status. |
| `story-ui cleanup` | Remove Storybook's scaffold stories. |
| `story-ui config --generate [--type js\|json]` | Write a sample config. |
| `story-ui deploy` | `--live`, `--platform <railway\|render\|fly>`, `--dry-run`, `--backend`, `--app`, `--frontend`, `--backend-url <url>`, `--storybook-dir <dir>`, `--project-name <name>` |

There is no `registry` command.

## Troubleshooting

**"Server unreachable" in the workspace header.** The server is not running on
the port the workspace resolved. Check `VITE_STORY_UI_PORT` in `.env` matches
the `--port` in the `story-ui` script, restart Storybook after changing `.env`
(Vite reads it at start), and look at the server's first log line, which names
the bound address and port. If the server chose a different port because 4001
was busy, it says so.

**No provider available.** No key was found for any provider. Put
`CLAUDE_API_KEY` (or `ANTHROPIC_API_KEY`), `OPENAI_API_KEY` or
`GEMINI_API_KEY` in the `.env` of the directory you start the server from.
`GET /mcp/providers` shows what the server sees.

**Story written but not in Storybook's index.** Verification reports
"Storybook's index is behind the filesystem" when files on disk outnumber
indexed stories: Storybook's watcher has stopped. Restart Storybook. If the
generated directory is not covered by the `stories` globs in
`.storybook/main.*`, add it.

**Badge says "Playwright is not installed in this project".** Install
`playwright` in your project and run `npx playwright install chromium`.
Story UI resolves it from your `node_modules`, never from its own. Add
`axe-core` for the accessibility check.

**Verified against the wrong Storybook.** With no `STORYBOOK_PORT` or
`STORYBOOK_URL` the server verifies against `localhost:6006` and logs that it
guessed. Set `STORYBOOK_PORT`.

**401 from every endpoint.** The server is in token mode. Open Storybook once
with `?token=<STORY_UI_TOKEN>` or set `VITE_STORY_UI_TOKEN`.

**Changes to Story UI itself do not appear.** Test projects import the built
package. Run `npm run build` in this repository, then in the project
`rm -rf node_modules/.vite`, restart Storybook and hard-refresh. If the project
installed a tarball, rebuild and reinstall it; `story-ui status` shows the
version in use.

## Contributing

```bash
git clone https://github.com/southleft/story-ui.git
cd story-ui
npm install
npm run build          # tsc, then copies templates into dist/
npm test               # vitest
node bench/resolution.mjs --project ../your-storybook --import '@your/design-system'
```

`bench/resolution.mjs` is deterministic and free: can the engine find your
components, do the import specifiers resolve, are props and descriptions
known. Run it on every change to discovery or knowledge.
`bench/componentSelection.mjs` calls a model and measures judgement; run it
rarely. Commits follow Conventional Commits (`npm run commit`); releases and
`CHANGELOG.md` are produced by semantic-release. See
[CONTRIBUTING.md](CONTRIBUTING.md).

To run the server against a project from source:

```bash
cd /path/to/your-storybook-project
PORT=4001 node /path/to/story-ui/dist/mcp-server/index.js
```

## License

MIT. See [LICENSE](LICENSE).
