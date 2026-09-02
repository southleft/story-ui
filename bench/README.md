# Benches

Two benches, deliberately separate. Conflating them meant paying LLM prices
to measure a filesystem property, badly.

| Bench | Measures | Cost | Run |
|---|---|---|---|
| `resolution.mjs` | what the engine **knows** about a design system: components found, import specifiers resolve, props/descriptions/examples known | free, seconds, deterministic | on every change |
| `fidelity.mjs` | what the engine **produces**: right components, right variants, inside the design system, minimal iterations, pins kept | LLM calls, minutes, noisy subject with deterministic scoring | when generation behaviour changes |
| `componentSelection.mjs` | judgement only | LLM | rarely |

## fidelity.mjs

Runs a fixed set of scenarios against a **running** Story UI server and
Storybook for one project, captures the full SSE stream, scores the returned
code, screenshots the rendered story, and writes a report a person can read.

```bash
# What would run, without touching the server
node bench/fidelity.mjs --plan

# One scenario, end to end
node bench/fidelity.mjs --only pricing-page

# The suite against react-mantine (both servers must be up)
node bench/fidelity.mjs --server http://localhost:4101 --storybook http://localhost:6101 \
  --project ../test-storybooks/react-mantine --image ./some-screenshot.png

# Repeat everything twice, fail the process on any failed step
node bench/fidelity.mjs --rounds 2 --strict
```

Flags: `--server`, `--storybook`, `--project`, `--only id,id`, `--rounds N`,
`--provider`, `--model`, `--image PNG`, `--out DIR` (default `bench/results`),
`--timeout SECONDS` per generation (default 720), `--strict`, `--reverify`
(also run `dist/` `verifyStory` standalone), `--fresh-bases`, `--no-screenshot`,
`--check` (config + preflight only, no generation), `--verbose` (print the
model's `llm_text` narration events; they are always stored in the JSON).

Prerequisites: `npm run build` (the bench imports `editDivergence` and the
render harness from `dist/`), the MCP server started **from the project
directory** (`PORT=4101 node ../story-ui/dist/mcp-server/index.js`), and that
project's Storybook. Playwright is resolved from the project's own
`node_modules`, as verification does; the bench adds no dependency.

### Output

`bench/results/<timestamp>/`

| File | Contents |
|---|---|
| `report.md` | one row per step: pass/fail per check, tPreview / tTotal, blockers, divergence; then "Issues observed" and links to screenshots |
| `<scenario>[.rN].json` | every SSE event with timestamps, the request, the completion, the code (disk and completion), previous code and divergence for updates, screenshot metadata, the scorecard and issues |
| `<scenario>[.rN][.step].png` | the rendered story, full page, 1280 wide |
| `run.log` | everything printed |
| `summary.json` | per-step verdicts, for diffing runs |

### Scenarios

`bench/fidelity/scenarios.mjs`. Four kinds:

- **new** — one prompt. Nine complex Mantine compositions: pricing page with
  FAQ, data table with filters/sorting/row actions, settings page with tabs,
  analytics dashboard, onboarding checklist, kanban board, multi-step wizard,
  notification centre, inventory dashboard with pagination.
- **update** — a follow-up on a `base` scenario's story that must be
  *minimal*: "Center the pagination" (divergence ≤ 0.15, Pagination still
  present), "Make the primary button say Start free trial" (divergence ≤ 0.1,
  text present).
- **prop-edit** — `POST /mcp/edit-prop` sets `Button[0].variant="outline"` on
  the base (after `GET /mcp/editable-props` confirms the prop and value are
  offered), then a chat follow-up runs and the attribute must still be in the
  code (and the server's `pins.lost` must be empty).
- **image** — the PNG from `--image`, base64'd. Skipped (not failed) without
  one; only asserts design-system layout primitives were used.

Derived scenarios reuse the base story generated earlier in the same run
(`--fresh-bases` regenerates it). When a base is not selected by `--only` it
is generated on demand and recorded as its own result.

### Checks, per step

| Check | Passes when | n/a when |
|---|---|---|
| completion | a `completion` event arrived, `success` true, action not `failed`, no `error` event | never |
| adherence | every capitalised JSX root is imported from the design system, a local module, another package, or declared in the file. Unknown tags fail. Foreign tags (icons) are reported, not failed | no code |
| mustUse | `mustUseComponents` all used as JSX **and** imported from the design system; each `mustUseAnyOf` group has one member used; `mustNotUseComponents` absent | no code |
| forbidden | no `forbiddenPatterns` match. `DEFAULT_FORBIDDEN` (raw hex colours, inline `px` spacing, `!important`, competing libraries, Tailwind utilities) applies to every step | no code |
| verification | the completion's `verification.outcome` is `verified`, or `issues` with zero blockers | `not_verified`, or no verification block |
| divergence | `editDivergence(previous, next)` ≤ `maxDivergence` — the engine's own measure, imported from `dist/` | not an update, no threshold, or dist not built |
| text | `mustContainText` all present | none specified |
| pins | every pinned prop still reads the pinned value on the same occurrence (AST-free scan of the opening tag) | no pins in play |
| timing | `preview_ready` within `maxTimeToPreviewMs` | no budget set |

Absent and zero must look different: a check that could not run is `n/a`
and never a failure. `--strict` fails only on `FAIL`.

The scoring functions live in `bench/fidelity/score.mjs` and are covered by
`__tests__/fidelity-score.test.ts` (`npx vitest run fidelity-score`).

### Reading the report

- A FAIL in **adherence** is a runtime crash waiting to happen: a tag nobody imported.
- A FAIL in **mustUse** with "present but not imported from it" means the model declared its own `Card` instead of using the library's.
- A FAIL in **divergence** means a request to change one thing returned a different page.
- **verify n/a** means verification did not run — check `reverify` or the `not_verified` reason in Issues; it is not a pass.
- No screenshot is reported with a reason; it is never silently omitted.
