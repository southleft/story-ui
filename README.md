# Story UI

[![npm version](https://badge.fury.io/js/%40tpitre%2Fstory-ui.svg)](https://www.npmjs.com/package/@tpitre/story-ui)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Design screens in your own design system, by describing them.**

Story UI adds a workspace to the Storybook you already have. You type what you
want — "a settings page with a sidebar and a sticky save bar" — and it writes a
real Storybook story using the components your team actually ships. The result
appears in Storybook's own preview, with your providers, your theme and your
tokens. It is not a mockup and not a sandbox. It is a file in your repository
that a developer can open, review and keep.

![The workspace after a generation: the conversation and verification on the left, the story rendered in Storybook's preview on the right](docs/images/workspace-story.png)

---

## Why it exists

Design systems are full of components that nobody has time to assemble into
real screens. So exploration happens in a design tool, in a vocabulary the code
does not share, and every idea has to be rebuilt before anyone can judge it.

Story UI closes that gap from the other side.

- **It only uses what you have.** Components are discovered from your project:
  the package's type declarations, your local source, and Storybook's own
  index. It cannot invent a component you do not own, and every prop is checked
  against that component's real type.
- **It composes, so you can judge.** Buttons and cards in isolation tell you
  nothing. Whole screens do.
- **The output is real work.** Every generation is a `.stories.tsx` file in
  your repository, in your Storybook, ready for a pull request.
- **It checks itself before you see it.** Each story is rendered in a real
  browser and measured — content inside its box, nothing overlapping, nothing
  blank, nothing broken — and generated again if it fails. See
  [How Story UI checks its own work](#how-story-ui-checks-its-own-work).

**Who it is for.** Product designers who want to explore in the real system
without waiting on engineering. Design system teams who want their components
used correctly. Engineers who want a first draft that already imports the right
things.

---

## What you can do

**Start from a blank page or pick up where you left off.** Recent work shows
live thumbnails of every story you have made.

![The home screen: the composer, four starter prompts, and recent work with live thumbnails](docs/images/workspace-home.png)

**Describe a screen and watch it build.** The plan streams in as the model
thinks, then the code, then the story appears in the preview the moment the
file is written. Stop is the same button as Send.

![A generation in progress: the plan streaming in, the step list, and the preview waiting for the file](docs/images/workspace-generating.png)

**Attach references.** Text, up to five images, and files: a Markdown spec, a
CSV of the rows a table should show, a PDF brief. Or dictate with the
microphone.

**Change things two ways.**

|  | Example | What happens |
|---|---|---|
| **Ask for a change** | "add a filters panel", "make this three columns" | Goes back to the model as an edit of the existing file. You see exactly which lines moved. |
| **Edit a property directly** | "use the secondary button variant" | Click the element. No model involved: the inspector reads that component's real props and rewrites one attribute instantly. |

![The inspector docked beside the preview after selecting a button, showing its editable props](docs/images/workspace-inspector.png)

**See every change.** The Changes view shows the diff against the previous
version. Every version is kept, and any of them can be restored.

![The Changes view after "Center the page heading": the diff against the previous version](docs/images/workspace-changes.png)

**Hand it off.** One click commits the story to a new git branch and can open a
pull request. It never commits to the branch you are on.

---

## Requirements

| You need | Why |
|---|---|
| **Storybook 10 or newer** (10.5.10+ recommended) | Story UI lives inside it. |
| **Node 20 or newer** | To run the tools. |
| **A React + TypeScript design system** | An npm package or local source. Other frameworks get the classic panel — see [Framework support](#framework-support). |
| **An API key** | Anthropic, OpenAI or Google Gemini. One is enough. |
| **Playwright** (`npx playwright install chromium`) | So Story UI can render and check its own work. Optional, strongly recommended. |

Not sure what your project has? Install, then run `npx story-ui check`. It
tells you what works and gives you the command for anything that does not.

---

## Install

Two ways in. Pick one.

### Standard install

Run these three commands in your Storybook project. The first asks a few
questions, installs itself, and writes everything it needs.

```bash
npx @tpitre/story-ui@latest init   # a few questions, then it sets itself up
npx story-ui check                 # confirms it works, names anything to fix
npm run storybook-with-ui          # starts Storybook and Story UI together
```

Then open Storybook and click **Story UI** in the toolbar. Type a request and
press Enter.

That is the whole install. You do not need to install the package first —
`init` does that for you.

### Agentic install

If you use an AI coding assistant (Claude Code, Cursor, Copilot, or an agent in
your terminal), it can do the whole install for you. You only need to tell it
two things: which AI provider you have a key for, and the key itself.

**1. Find your provider in this table.**

| Your key is from | Say this to the assistant | Where to get a key |
|---|---|---|
| Anthropic (Claude) | `claude` | [console.anthropic.com](https://console.anthropic.com) |
| OpenAI (GPT) | `openai` | [platform.openai.com](https://platform.openai.com/api-keys) |
| Google (Gemini) | `gemini` | [aistudio.google.com](https://aistudio.google.com/apikey) |

**2. Paste this to your assistant**, replacing the two marked lines with your
own provider and key:

```text
Install Story UI into this Storybook project.

Provider: claude            <- claude, openai, or gemini
API key:  sk-ant-abc123...  <- paste your key here

Run these three commands, filling my provider and key into the second one:

  npm install --save-dev @tpitre/story-ui
  npx story-ui init --yes --provider PROVIDER --api-key "MY-KEY" --json
  npx story-ui check --json

init runs without asking any questions and prints a STORY_UI_INIT {…} line
describing what it wrote. check exits 0 when the install works and names a fix
for anything that does not. If check reports a problem, apply the fix it names
and run check again.

When you are done, tell me which port it chose and how to open the workspace.
```

**Would rather not paste a key into a chat?** Delete the `API key` line and
write "I will add the key myself" instead. Story UI writes a placeholder into
`.env`, and you replace it with your real key:

```bash
ANTHROPIC_API_KEY=sk-ant-your-real-key-here
```

Use `OPENAI_API_KEY` or `GEMINI_API_KEY` to match your provider. `check`
reports the placeholder as "not set" until you do.

Your key lives in `.env` in your project. If the project has a `.gitignore`,
`init` adds `.env` to it so the key is never committed; if it has none, create
one with a `.env` line in it.

Why this works: `init` never asks a question when there is no terminal (no TTY,
`CI=true`, or `STORY_UI_NONINTERACTIVE=true`). Every answer comes from flags and
from detection, so an agent cannot get stuck waiting on a prompt, and
`check --json` gives it a machine-readable pass or fail to act on.

<details>
<summary><strong>Flags for agents and scripts</strong></summary>

For CI or a setup script, where the key comes from a secret rather than being
typed. `"$ANTHROPIC_API_KEY"` here is shell syntax meaning "read the
`ANTHROPIC_API_KEY` environment variable" — if you are pasting a key by hand,
put the key itself in quotes instead.

```bash
npx story-ui init --yes \
  --provider claude --api-key "$ANTHROPIC_API_KEY" \
  --port 4001 \
  --import-path '@your-scope/ui' \
  --components-path ./src/components \
  --stories-path ./src/stories/generated \
  --json
```

**What `--yes` decides on its own:** the design system from `package.json`
(Mantine, MUI, Chakra, Carbon and others — see `--design-system`), or a local
component library found in the project's own stories and component directories
(`src/components`, `src/ui`, `components`, …) when no npm design system is
present; the Storybook framework; and a free port starting from 4001. Override
any of it with the flags above.

**What `--json` prints:** a `STORY_UI_INIT {…}` line describing what was
written. `ok` is false and the exit code non-zero when `problems` is not empty
(for example a `.storybook/main.*` that would no longer parse).
`installSkipped` explains when init did not run its own install: `"npm-link"`
when `node_modules/@tpitre/story-ui` is a symlink `npm install` would replace,
`"skip-install"` under `--skip-install`.

Re-running `init` keeps your existing config unless you pass `--force`.
</details>

<details>
<summary><strong>What init puts in your project</strong></summary>

| Path | What it is |
|---|---|
| `story-ui.config.js` | Where your components live and how to import them. |
| `.env` | Provider, API key, port. An existing file is merged, never overwritten. |
| `.storybook/manager-head.html` | Tells the workspace page which port to call. The Storybook manager cannot read `.env`, so the port goes here as a `<meta>` tag. |
| `story-ui-considerations.md` | Rules you write for how the model should use your system. |
| `story-ui-docs/` | Documentation about your design system, read on every generation. |
| `src/stories/generated/` | Where generated stories are written. |
| `src/stories/StoryUIV2/` | The workspace. |
| `src/stories/StoryUI/` | The classic panel, the Voice Canvas and the toolbar button. |

It also adds `story-ui` and `storybook-with-ui` scripts to `package.json` (with
`concurrently` for the second, and `react-live` for the Voice Canvas on React
projects — remove both along with `src/stories/StoryUI/voice/` if you do not
want it), and wires `.storybook/manager.ts`.

The port you choose is written to all three places that need it: `.env`,
`manager-head.html`, and the `story-ui` script. Paths in the config are
project-relative, so the file survives a clone.

It removes Storybook's own scaffold stories (`Button`/`Header`/`Page`,
`Configure.mdx`) only after confirming the file content really is that
scaffold, and never mistakes the scaffold for your component library. After
editing `.storybook/main.*` it re-parses the file and stops if the result would
not load.

**If your component library is its own package** (the stories import
`@your-scope/ui`, the source is `src/components`), it is configured as local
source: the import path becomes a relative path that resolves from the
generated stories directory. Your own package name is never used as an import
path, because nothing can install it. `check` fails the `import-path` item,
with the fix, whenever that path would not resolve.
</details>

The long-form walkthrough is in [docs/quick-start.md](docs/quick-start.md).

---

## Using Story UI

### Two ways in

**The workspace** — click **Story UI** in the Storybook toolbar, or go to
`?path=/workspace/`. This is the full experience: preview, inspector, diffs,
version history, handoff. Use this one on React projects.

**The classic panel** — `Story UI > Story Generator` in the sidebar. A simpler
chat interface with image attachments, the Voice Canvas, and an editor for the
design-system docs in `story-ui-docs/`. It works in every framework Storybook
can host, so Vue, Svelte, Angular and Web Components projects use this one.

Both talk to the same server and write the same files. A story made in one
shows up in the other.

### A first session

1. Type what you want. Start broad: "a pricing table with three tiers and the
   middle one highlighted".
2. Watch it build. The story appears in the preview as soon as the file exists.
3. Refine by asking: "make the middle tier's button full width".
4. Or refine by clicking: turn on Select, click an element, change a property
   in the inspector. That applies instantly, with no model call.
5. Open it in Storybook, or hand it off to a branch.

### Teaching it your design system

Two files raise output quality more than anything else:

- **`story-ui-docs/`** — what your design system *is*. Spacing scales, colour
  usage, component do's and don'ts. Markdown, MDX, JSON, YAML, XML, HTML or
  plain text. Code examples work better than prose. (8,000 characters per file,
  24,000 in total.)
- **`story-ui-considerations.md`** — rules for how the model must *use* it.
  This is also where you allow an extra package to be imported, for example
  `Allowed additional imports: @tabler/icons-react`.

You can edit both from the Design Context tab in the classic panel. See
[docs/CUSTOM_DOCUMENTATION.md](docs/CUSTOM_DOCUMENTATION.md).

Your design tokens are read automatically from your project's own stylesheets.
A token the model invents is rejected before the story is ever written.

---

## How Story UI checks its own work

A generated story you have to fix is worse than no story. So every generation
goes through the same gauntlet before you see it.

**Before anything renders**, the code is checked statically:

- It parses, and uses no forbidden patterns (no injected `<style>`, no
  `!important`, no `UNSAFE_*` props).
- It only imports from your design system, the framework, Storybook, your icon
  package, and anything you allowed in `story-ui-considerations.md`.
- Every prop exists on the component, checked against the type your project's
  own TypeScript computes for that element.
- Every `var(--token)` is a token your project actually declares.
- Spacing uses your system's scale and layout components, not hand-written
  pixel margins.

Anything wrong goes back to the model, up to three correction attempts.

**Then the story is rendered in a real browser** and measured:

| Check | What it catches |
|---|---|
| **Render** | The story mounts without an error, and is really in Storybook's index. |
| **Looks broken** | Content painting outside its box, text cut off, elements overlapping, a page wider than the screen, an empty tile where content was expected. Measured in pixels, not judged. |
| **Layout** | Grid rows that come up short, controls stretched by their container, toolbars spread across the page. Arithmetic. |
| **DOM census** | Fake fields, unnamed icon buttons, invisible icons, nothing focusable. |
| **Interaction** | Clicks each control and waits for something to change; opens menus and checks they float rather than shove the page around. |
| **Accessibility** | axe rules, when `axe-core` is installed in your project. |
| **Visual review** | A vision model looks at the screenshot and answers one question: is this shippable? Overflow, overlap, empty regions, misalignment, illegible text, missing pieces. Taste is discarded. |

**Then it fixes what it found.** A defect the story caused is repaired and
re-checked, and the repair is kept only if it genuinely reduced the problems. A
defect in the design system's own markup is reported but never "fixed", because
the only fix a model could make there is to stop using your component.

**And if it still is not right, it starts over.** A story that did not render,
or that still has a real problem after repair, is generated again with the
browser's measurements as requirements — same file, same name — up to three
attempts. The best attempt is kept, and the reply tells you plainly what
happened: "verified clean on attempt 2", or what is still wrong. You are never
handed a blank or broken story presented as finished.

The badge on each story reads `Verified · 7/7 checks`, `Issues`, or
`Not verified` with the reason. A check that could not run is listed as *not
run* — never as clean.

<details>
<summary><strong>Tuning verification</strong></summary>

| Variable | Effect |
|---|---|
| `STORY_UI_GATE_ATTEMPTS` | How many attempts before the best one is kept. Default 3. |
| `STORY_UI_VERIFY_BUDGET_MS` | Time budget for verify-and-repair. Default 180000. |
| `STORY_UI_VERIFY_ENFORCE=false` | Turn off the repair pass. |
| `STORY_UI_VISUAL_CRITIQUE=false` | Turn off the vision review. |

Verification resolves `playwright` and `axe-core` from **your project's**
`node_modules`, never its own. If Playwright's browser is missing, the badge
says so and names the command.

Verification also needs to reach your Storybook. From the workspace this is
automatic. From the API or an MCP client, set `STORYBOOK_URL` or
`STORYBOOK_PORT`; otherwise `localhost:6006` is assumed and logged as a guess.
</details>

---

## Framework support

Story UI is built and tested for **React + TypeScript**. Everything works
there. Other frameworks can generate stories through the classic panel, but the
click-to-edit inspector and attributed verification need React's internals.

| Framework | Surface | Discovery | Preview | Inspector | Attributed verification |
|---|---|---|---|---|---|
| **React + TypeScript** | Workspace and classic panel | npm types, local source, Storybook index | Yes | Yes | Yes |
| Vue | Classic panel | Yes | Mounts | No | Findings reported as warnings |
| Svelte | Classic panel | Yes | Mounts | No | Same |
| Web Components (Lit) | Classic panel | Yes, with `importExamples` | Mounts | No | Same |
| Angular | Classic panel | Limited (`@Component` classes, `NgModule` exports) | Mounts | No | Same |

React design systems are developed against in four shapes, because each one
exposed a different bug: barrel npm packages (Mantine, Carbon), subpath
packages (MUI), one package per component (Atlassian), and local source (Radix
+ Tailwind, and fully custom libraries). A React library shipped without type
declarations loses prop knowledge and editable props.

---

## Reference

<details>
<summary><strong>Configuration (story-ui.config.js)</strong></summary>

Looked for in the project root, then `.storybook/`, as `.js`, `.cjs` or `.ts`.

| Field | Meaning |
|---|---|
| `importPath` | The package or path components are imported from (`@mantine/core`, `../../components`). |
| `generatedStoriesPath` | Where stories are written. Default `./src/stories/generated/`. |
| `componentsPath` | Local component source directory, for libraries that are not an npm package. |
| `componentsMetadataPath` | A `custom-elements.json` manifest, read when nothing else is discovered. |
| `components` | Explicit component list (`name`, `importPath`, `props`, `examples`, `description`, `category`, `slots`). Declared fields win over discovered ones. |
| `excludeComponents` | Names discovery found that must never be offered. `components[].exclude: true` does the same per entry. |
| `layoutComponents` | Layout-specific components, same shape. |
| `allowedImports` | Extra packages a story may import. |
| `componentFramework` | `react`, `vue`, `angular`, `svelte` or `web-components`. |
| `framework` | Same values; story generation reads this one first. Set both the same. |
| `storybookFramework` | e.g. `@storybook/react-vite`; auto-detected when omitted. |
| `importStyle` | `barrel` (default) or `individual` for libraries without an index export. |
| `importExamples` | Example import lines shown to the model. |
| `additionalImports` | `[{ path, components }]` extra import sources. |
| `iconImports` | `{ package, importPath, commonIcons?, allowAllIcons? }`; auto-detected when omitted. |
| `componentPrefix` | Prefix prepended to discovered component names. |
| `storyPrefix` | Title prefix for generated stories. Default `Generated/`. |
| `layoutRules` | `multiColumnWrapper`, `columnComponent`, `containerComponent`, `layoutExamples`, `prohibitedElements`. |
| `designSystemGuidelines` | `name`, `preferredComponents`, `spacingTokens`, `colorTokens`, `prohibitedPatterns`, `enforcementRules`, `additionalNotes`. |
| `systemPrompt` | Replaces the framework adapter's system prompt. The only prompt override that is read. |
| `considerationsPath` | Path to the considerations file if not `./story-ui-considerations.md`. |
| `storybookMcpUrl`, `storybookMcpTimeout` | Your Storybook's URL, for the Storybook MCP addon and as the verification target. |
</details>

<details>
<summary><strong>Environment variables</strong></summary>

The server reads `.env` in the directory it is started from.

| Variable | Purpose |
|---|---|
| `CLAUDE_API_KEY` or `ANTHROPIC_API_KEY` | Anthropic key. |
| `OPENAI_API_KEY`, `OPENAI_ORG_ID` | OpenAI key and optional organisation. |
| `GEMINI_API_KEY` or `GOOGLE_API_KEY` | Google key. |
| `DEFAULT_PROVIDER` | `claude`, `openai` or `gemini`. |
| `DEFAULT_MODEL` | Model id. Defaults: `claude-opus-5`, `gpt-5.6-sol`, `gemini-3.1-pro`. |
| `CLAUDE_EFFORT` | `low`, `medium`, `high` (default) or `xhigh`. |
| `CLAUDE_STREAM_MAX_MS` | Hard cap on one streamed model call. Default 15 minutes. |
| `PORT` | Server port. Default 4001. |
| `VITE_STORY_UI_PORT` | Tells the docs-page workspace which port to call. Written by `init`. |
| `STORYBOOK_STORY_UI_PORT` | The same for the manager page. Normally unnecessary: `init` writes the port into `manager-head.html`. |
| `VITE_STORY_UI_EDGE_URL` | Full server URL when it is not on localhost. |
| `VITE_STORY_UI_TOKEN` | Token the workspace sends as a bearer header. |
| `STORY_UI_TOKEN`, `STORY_UI_HOST`, `STORY_UI_ALLOW_UNAUTHENTICATED` | Access control; see Security. |
| `STORY_UI_ALLOWED_ORIGINS` | Extra CORS origins, comma-separated. |
| `STORY_UI_MAX_BODY` | Request body ceiling. Default `25mb`. |
| `STORYBOOK_URL`, `STORYBOOK_PORT` | Where verification finds your Storybook. |
| `STORYBOOK_PROXY_ENABLED`, `STORYBOOK_PROXY_PORT` | Proxy non-API requests to a Storybook dev server (deployments). |
| `STORY_UI_GATE_ATTEMPTS` | Regeneration attempts before the best is kept. Default 3. |
| `STORY_UI_VERIFY_BUDGET_MS` | Verify-and-repair budget. Default 180000. |
| `STORY_UI_VISUAL_CRITIQUE`, `STORY_UI_VERIFY_ENFORCE` | `false` disables the vision pass / the repair pass. |
| `STORYBOOK_RUNTIME_VALIDATION` | `true` enables the older iframe-fetch check. Off by default. |
| `STORY_UI_LOG_LEVEL` | Server log level. |
| `STORY_UI_DUMP_PROMPT` | `1` writes each prompt to the temp directory, for debugging. |
</details>

<details>
<summary><strong>Commands</strong></summary>

| Command | Options |
|---|---|
| `story-ui init` | `-y, --yes`, `--provider <claude\|openai\|gemini>`, `--api-key <key>`, `--port <port>`, `--stories-path <path>`, `--import-path <specifier>`, `--components-path <path>`, `--component-prefix <prefix>`, `-d, --design-system <system>`, `--skip-install`, `--force`, `--json` |
| `story-ui check` | `--server <url>`, `--storybook <url>`, `--json`. Exit code 1 when something is broken. |
| `story-ui start` | `-p, --port <port>` (default 4001; if busy, the next free port is used and logged), `--mcp` |
| `story-ui mcp` | `--http-port <port>` (default: the port init configured) |
| `story-ui update` | `-y, --yes` / `-f, --force`, `--no-backup`, `-n, --dry-run`, `-v, --verbose`. Refreshes managed files and ports; leaves your config and `.env` alone. |
| `story-ui status` | Installed version and managed-file status. |
| `story-ui cleanup` | Remove Storybook's scaffold stories. |
| `story-ui config --generate [--type js\|json]` | Write a sample config. |
| `story-ui deploy` | `--live`, `--platform <railway\|render\|fly>`, `--dry-run`, `--backend`, `--app`, `--frontend`, `--backend-url <url>`, `--storybook-dir <dir>`, `--project-name <name>` |

**What `check` verifies:** the config loads; the import path resolves;
discovery finds components and how many have props; Playwright and its browser
actually launch; Storybook's file watcher is alive (it writes a probe story and
watches for it); the generated directory exists; `.storybook/main.*` parses;
Storybook's globs cover the Story UI entries; the manager addon is wired;
`manager-head.html`, `.env` and the `story-ui` script name the same port; a
provider key is set and is not a placeholder; and whether the server answers.
Each failed item carries the command that fixes it.
</details>

<details>
<summary><strong>Security and deployment</strong></summary>

The server writes files into your repository, spends your API keys and can run
`git` for you, so it has exactly two modes and refuses to be in neither:

- **Loopback (default).** Binds `127.0.0.1` and rejects any request whose
  `Host` header is not a loopback name, so a page you visit cannot reach it by
  DNS rebinding.
- **Token.** Set `STORY_UI_TOKEN` to a long random string. Every request must
  carry it as `Authorization: Bearer <token>` or `x-story-ui-token`, or a
  browser can open any URL once with `?token=<token>` and receive an HttpOnly
  cookie. `/health` is the only path that answers without it.

Public exposure without a token makes the server exit at startup with an
explanation. `STORY_UI_ALLOW_UNAUTHENTICATED=true` overrides that deliberately;
it is logged as a warning on every start and is not recommended.

For hosted deployments (Railway and similar): run Storybook in dev mode on an
internal port, run the server with `STORYBOOK_PROXY_ENABLED=true` and
`STORYBOOK_PROXY_PORT`, and set `STORY_UI_TOKEN`. Point the platform's health
check at `/health`. Details in [DEPLOYMENT.md](DEPLOYMENT.md).
</details>

<details>
<summary><strong>Claude Desktop and other MCP clients</strong></summary>

Story UI exposes eight tools over MCP: `test-connection`, `generate-story`,
`update-story`, `list-components`, `list-stories`, `get-story`, `delete-story`,
`get-component-props`. Both transports call the HTTP server, which must be
running from your project directory.

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

**Streamable HTTP** (remote): `POST <server>/mcp-remote/mcp`. In token mode the
client sends the bearer header:

```bash
claude mcp add --transport http story-ui <url>/mcp-remote/mcp --header "Authorization: Bearer <token>"
```

See [docs/MCP_INTEGRATION.md](docs/MCP_INTEGRATION.md).
</details>

<details>
<summary><strong>Troubleshooting</strong></summary>

**"Server unreachable" in the workspace header.** The server is not running on
the port the workspace resolved. Run `npx story-ui check` — it names the port
the config expects and whether anything answers there. Restart Storybook after
changing `.env` (Vite reads it at start).

**"Connected", but the stories are another project's.** The workspace page is
bound to a different server than the one you started. Hover the Connected dot:
the tooltip names the server and the project it writes to. `check` fails the
`manager-head` item when the port there differs from `.env`. Restart Storybook
after fixing it.

**`npm run story-ui` starts on a different port than the workspace expects.**
`npx story-ui check` fails the `script-port` item; `npx story-ui update`
rewrites the script to match `.env`.

**Story written but not in Storybook's sidebar.** Storybook's file watcher has
stopped noticing new files. On macOS this happens because that watcher shares
one system event stream rooted at your home folder, which silently drops
events. `init` and `update` write a polling setting into `.storybook/main` that
prevents it, and `npx story-ui check --storybook http://localhost:6006` proves
the watcher is alive by writing a probe story. If it reports the watcher dead,
restart Storybook.

**Badge says Playwright's browser is not installed.** Run `npx playwright
install chromium` in your project. Story UI resolves Playwright from your
`node_modules`, never its own. Add `axe-core` for the accessibility check.

**No provider available.** No key was found. Put `ANTHROPIC_API_KEY` (or
`CLAUDE_API_KEY`), `OPENAI_API_KEY` or `GEMINI_API_KEY` in the `.env` of the
directory you start the server from. `GET /mcp/providers` shows what the server
sees.

**The API key you typed is not in `.env`.** Older versions skipped an existing
`.env`. Current versions merge into it; re-run `npx story-ui init --api-key
<key>`. `check` reports a placeholder such as `your-api-key-here` as "not set".

**`check` says "install it: npm install @your-scope/ui" for your own package.**
An older `init` wrote your own package name as the import path. Re-run `npx
story-ui init --force`.

**Storybook fails to start after init with "Expected } but found viteFinal".**
An older `init` inserted that block without the comma the property above it
needed. Add the comma, or re-run `init --force` with a current version.

**401 from every endpoint.** The server is in token mode. Open Storybook once
with `?token=<STORY_UI_TOKEN>` or set `VITE_STORY_UI_TOKEN`.

**Changes to Story UI itself do not appear.** Test projects import the built
package. Run `npm run build` here, then in the project `rm -rf
node_modules/.vite node_modules/.cache/storybook`, restart Storybook and
hard-refresh. `story-ui status` shows the version in use.
</details>

<details>
<summary><strong>Testing and benches</strong></summary>

```bash
npm test                                        # vitest: pure functions, fixtures, route contracts
node bench/resolution.mjs --project ../your-storybook --import '@your/design-system'
node bench/fidelity.mjs --server http://localhost:4101 --storybook http://localhost:6101 --project ../test-storybooks/react-mantine
bench/durability.sh ../test-storybooks/carbon:4109:6109 ../test-storybooks/mui-material:4107:6107
```

- `bench/resolution.mjs` is deterministic and free: can the engine find your components, do the import specifiers resolve, are props and descriptions known. Run it on every change to discovery or knowledge.
- `bench/fidelity.mjs` calls a model: does a generated story use the right components and variants, stay inside the design system, and does an iteration change only what was asked. Records every SSE event, the code, scores and a screenshot per scenario under `bench/results/`. `--generic` scores by catalog conformance instead of one library's component names, so it runs anywhere.
- `bench/durability.sh` boots each project's server and Storybook and runs the generic scenarios across libraries, for a table of outcomes per design system.
</details>

---

## Contributing

```bash
git clone https://github.com/southleft/story-ui.git
cd story-ui
npm install
npm run build          # tsc, templates and the manager bundle into dist/
npm test
```

Commits follow Conventional Commits (`npm run commit`); releases and
`CHANGELOG.md` are produced by semantic-release. See
[CONTRIBUTING.md](CONTRIBUTING.md).

To run the server against a project from source:

```bash
cd /path/to/your-storybook-project
PORT=4001 node /path/to/story-ui/dist/mcp-server/index.js
```

## License

MIT. See [LICENSE](LICENSE).
