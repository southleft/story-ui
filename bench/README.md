# Benches

Four benches, deliberately separate. Conflating them meant paying LLM prices
to measure a filesystem property, badly.

| Bench | Measures | Cost | Run |
|---|---|---|---|
| `resolution.mjs` | what the engine **knows** about a design system: components found, import specifiers resolve, props/descriptions/examples known | free, seconds, deterministic | on every change |
| `fidelity.mjs` | what the engine **produces**: right components, right variants, inside the design system, minimal iterations, pins kept | LLM calls, minutes, noisy subject with deterministic scoring | when generation behaviour changes |
| `firstAttempt.mjs` | how often the **first** model output is already right, before healing, repair or regeneration | LLM calls, minutes | before and after a prevention change |
| `componentSelection.mjs` | judgement only | LLM | rarely |

## firstAttempt.mjs

The pipeline hides its own failure rate. Validation self-heals up to three
times, verification repairs, and the shippable gate regenerates up to three
times — so a story that cost four model calls and two rewrites reports exactly
what a story that was right immediately reports: "Verified". That is right for
the user and useless for judging PREVENTION work, which is about the first
output, not the recovery.

This bench drives the real server over `POST /mcp/generate-story-stream` and
records, per prompt, what happened *before* any healing.

```bash
node bench/firstAttempt.mjs --server http://localhost:4109 --storybook http://localhost:6109 --name carbon
node bench/firstAttempt.mjs --server http://localhost:4110 --suite 6          # 6 prompts, spread across the range
node bench/firstAttempt.mjs --server http://localhost:4110 --only c01,c05,w03 # named prompts
```

Flags: `--server`, `--storybook`, `--project` (a path, or a directory name
under `STORY_UI_TEST_PROJECTS` / `../test-storybooks`), `--name`, `--suite N`,
`--only id,id`, `--timeout SECONDS` (default 600), `--keep` (do not delete the
generated stories).

The prompt set — 10 "classic" and 10 "workspace", simple → complex — lives in
the script so two runs are comparable. `--suite N` takes N *evenly across* the
ordered set: taking the first N would take the three simple ones and call the
result a first-attempt rate.

### The metric

```
first-attempt clean: N/20 (X%) · median model calls M · median Ns
```

`firstAttemptClean` is true when **all three** hold:

| Leg | Read from |
|---|---|
| static validation passed on round 1 | the first `validation` SSE event of gate attempt 1 |
| verification found no story-authored blocker, **and no repair was needed** | no `verify_repairing` phase, plus `completion.gate.shippable` (fallback: `verification.findings`, filtered exactly as `gate.ts` `storyBlockers` does) |
| the gate spent one attempt | `completion.gate.attempts` (fallback: counting `gate_retry` progress events) |

The repair clause is load-bearing. The gate's verdict is computed on the
report taken *after* the repair pass, so `shippable` alone cannot tell a story
that was right from one that was made right — a repair having run is itself
proof that verification found a story-authored blocker in the first output.
On the first carbon run this was the difference between 4/6 and 2/6.

Also per prompt: `validationAttempts` and the classified errors of each
correction round, `repairRan` / `repairImproved`, `gateAttempts` with the
reason each earlier attempt failed, model calls (the server's own count across
every gate attempt), seconds, findings by severity/class, and the outcome.

### Absent is never zero

A leg the stream could not report is `null`, printed as `?` and as `UNKNOWN`,
and the run is counted in **neither** column — the percentage is over what was
*judged*, with the unjudged count printed beside it. A Storybook that stalls
mid-run therefore lowers confidence in a run instead of silently inflating or
deflating the score. A conjunction with one definitely-false leg is still
`false`, though, even when another leg is unknown.

`node_modules` note: verification needs the project's Playwright and a
reachable Storybook. **react-mantine (6101) cannot load newly created stories**
and every run there reports `not_verified`; use another environment.

### Output

`bench/results/first-attempt/<timestamp>/<id>.json` per prompt, plus
`summary.json`, a printed table, and the headline line. The table's last
column is the first round's error classes — the prevention targets.

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

Flags: `--server`, `--storybook`, `--project`, `--only id,id` (alias `--scenarios`), `--rounds N`,
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

### `--generic`: any React design system

The scenarios' `mustUseComponents` are Mantine's answer to each prompt, so on
Carbon, MUI or Atlassian they cannot be asked. `--generic` reports them as
n/a (never a failure) and scores catalog conformance and token conformance
instead; text, forbidden patterns, pins, divergence, verification and timing
are unchanged.

| Check | Passes when | n/a when |
|---|---|---|
| catalog | every capitalised named import from the design system is in `GET /mcp/components/inventory` (falls back to `/mcp/components`); a default import is matched by its specifier against the inventory's per-component `importPath`; at least 3 distinct catalog components are used as JSX. Lowercase imports (`xcss`, `token`) are utilities and are reported, not judged | no catalog; or default/namespace imports could not be verified and the floor was not reached |
| tokens | every `var(--x)` names a token the project declares, via `dist/` `readStylingFacts` + `checkTokenUsage` | the project declares no tokens (the report says whether any stylesheet was read), or dist is not built |

The "another design system" forbidden pattern is rebuilt around the project's
`importPath` (`defaultForbiddenFor`), so `@mui/` is forbidden on Mantine and
`@mantine/` on MUI. A hex colour inside a `var(--x, #hex)` fallback is the
token idiom, not a raw colour, and is not flagged.

```bash
node bench/fidelity.mjs --generic --server http://localhost:4109 --storybook http://localhost:6109 \
  --project ../test-storybooks/carbon --only pricing-page,data-table,settings-page
```

`bench/fidelity-rescore.mjs <run dir>` re-judges a finished run with the
current scorer; it reads importPath, `--generic` and the catalog from the
run's `summary.json`, and rewrites `summary.json` so a combined report stays
in step.

## durability.sh

`bench/durability.sh dir:mcpPort:sbPort ...` runs the generic bench across
several environments from the packed tarball: installs
`tpitre-story-ui-*.tgz` (`npm install --no-save`) when the project's copy is
missing, a `file:` symlink, or a different sha; runs `npx story-ui init --yes
--json` if there is no config; copies `ANTHROPIC_API_KEY` from
`react-mantine/.env` if absent (never printed); checks Playwright's Chromium;
starts the server and Storybook, waits for `/health` and `/index.json`, runs
the bench, stops both. Output: `bench/results/durability-<stamp>/README.md`
(one row per env × scenario: time to preview, outcome, verification, catalog
conformance, forbidden hits, invented tokens), `<env>.md`, `<env>.env.txt`
(setup facts), and the logs. A step that cannot run skips the environment
with the reason; it is not a failure.

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
