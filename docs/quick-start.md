# Quick start

The long form of the README's quick start. It follows one project from
install to a handed-off story.

## Before you start

- Node 20 or newer.
- A project with Storybook 8 or newer already running (9 or 10 recommended).
- A React + TypeScript design system for the full workspace. Vue, Svelte,
  Angular and Web Components projects can generate stories through the classic
  panel; see "Framework support" in the [README](../README.md).
- An API key for Anthropic, OpenAI or Google Gemini.
- Optional but recommended: `playwright` installed in the project, with a
  browser downloaded (`npx playwright install chromium`), and `axe-core`.
  Without Playwright every story is reported as "Not verified".

## 1. Install

```bash
npm install -D @tpitre/story-ui
```

## 2. Initialise

```bash
npx story-ui init
```

`init` reads `package.json` and detects the framework and Storybook builder.
It then asks for:

- the design system (auto-detect, one of the known libraries, or custom with
  an import path and optional local `componentsPath`);
- whether to install that library if it is missing;
- the generated stories directory (default `./src/stories/generated/`);
- the server port (default 4001);
- the LLM provider and, optionally, the API key.

Pass `-y` to accept defaults, `-d <system>` and `-l <provider>` to answer
those two questions up front, and `--skip-install` to leave dependencies alone.

What it writes:

| File | Purpose |
|---|---|
| `story-ui.config.js` | Import path, paths, framework, layout rules. Kept as is on re-run unless `--force`. |
| `.env` | `DEFAULT_PROVIDER`, the provider's key variable, `VITE_STORY_UI_PORT`. Skipped if `.env` exists. |
| `story-ui-considerations.md` | Rules for how the model must use your design system. |
| `story-ui-docs/` | Where you put documentation about the design system. |
| `src/stories/StoryUIV2/StoryUIV2.mdx` | The workspace. One file; the UI itself is imported from the package. |
| `src/stories/StoryUI/` | The classic panel and the Voice Canvas. Existing files are kept unless `--force`. |
| `.storybook/preview.tsx` | Provider wrapper for the design system, when one is needed and can be derived. |
| `.storybook/manager.ts` | The "Edit in Story UI" toolbar button. Storybook 9+ only. |
| `package.json` | `story-ui` and `storybook-with-ui` scripts; `concurrently`, `react-live`, and `@storybook/react` on React hosts, when missing. |
| `.gitignore` | `.env`, the generated stories directory, `.story-ui-history/`. |

It also removes Storybook's scaffold stories (`Button`, `Header`, `Page`,
`Introduction`, `Configure` and their CSS) from `src/stories`, `stories` or
`.storybook/stories`, after confirming from the file content that they are the
scaffold and not your own component of the same name.

## 3. Start both processes

```bash
npm run story-ui      # server on http://127.0.0.1:4001, loopback only
npm run storybook     # Storybook, in a second terminal
```

Or `npm run storybook-with-ui` to run both. The server's first log lines say
which address and port it bound and which access mode it is in. If 4001 was
busy it picks the next free port and says so; update `VITE_STORY_UI_PORT` to
match and restart Storybook, because Vite reads `.env` at start.

## 4. Open the workspace

In Storybook's sidebar, open **Story UI > Workspace**. The header shows a
connection badge; "Connected" means the server answered. The **Components**
button opens the inventory the server discovered, with import paths and prop
counts, so you can see what the model has to work with before asking for
anything.

## 5. Generate

Type a request and press Enter. For example:

```
A settings page: a sidebar of sections on the left, and on the right a form with
name, email, a notifications toggle, and Save and Cancel buttons.
```

The rail on the left narrates each phase: discovery, the model call, static
validation, the write, then verification. The preview on the right shows the
story as soon as the file is on disk. The story also appears in Storybook's
sidebar under `Generated/`.

If the model imports a package that is not your design system, the import is
rejected before the file is written and sent back for correction. To permit a
package, name it in `story-ui-considerations.md`.

## 6. Iterate

**By chat.** Type a follow-up. The current file is sent with it, so the model
edits rather than starts over. Attach an image with the paperclip, by pasting,
or by dropping it on the composer. Click the microphone to dictate.

**By clicking.** Click any element in the preview. The composer chip names the
component the file uses (for example `Button`, even if you clicked a library
internal), and the property panel lists its props with the values the type
declares. Change one and it is written to the file immediately, without a model
call. A prop set this way is pinned: later chat edits that would overwrite it
are corrected after the model's rewrite, and the rail says which pins were
kept, re-applied or lost.

**Undo.** Press Cmd/Ctrl+Z outside a text field to restore the previous
version, or open the version list and restore any earlier one.

## 7. Read the verification badge

After each write the server renders the story in a browser from your project's
Playwright and runs up to six checks: DOM census, layout arithmetic, undefined
classes, interaction (it clicks things), axe, and a vision-model critique. The
badge reads `Verified · N/6 checks`, `Issues`, or `Not verified` with the
reason. Findings name the element and say whether the story or the design
system owns it; a finding on the library's own markup is a warning and is never
sent for repair. Blockers get one repair pass, kept only if it reduces them.

If the badge says Playwright is not installed, install it in the project. If it
says Storybook's index is behind the filesystem, restart Storybook. If it
verified against the wrong port, set `STORYBOOK_PORT` in `.env`.

## 8. Hand off

Open the code view to copy or download the file, or click **Handoff**. The
dialog shows the repository state, then commits the story file to a new branch.
Push and pull request are separate opt-in checkboxes; the pull request needs
the GitHub CLI (`gh`) logged in. Nothing is committed on your current branch.

## Next

- Put documentation in `story-ui-docs/` and rules in
  `story-ui-considerations.md`: [Custom documentation](./CUSTOM_DOCUMENTATION.md).
- Use the tools from Claude Desktop or Claude Code: [MCP integration](./MCP_INTEGRATION.md).
- Share a Storybook with the workspace in it: [Deployment](../DEPLOYMENT.md).
