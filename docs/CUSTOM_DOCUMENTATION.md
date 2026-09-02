# Teaching the model your design system

Story UI reads two things you write before every generation. They answer
different questions and are loaded by different code, so keep them separate.

| File | Answers | Loaded by |
|---|---|---|
| `story-ui-docs/` | What the design system *is*: tokens, component usage, patterns, brand rules. | `story-generator/documentationLoader.ts` |
| `story-ui-considerations.md` | How the model must *use* it: do's, don'ts, and permissions. | `story-generator/considerationsLoader.ts` |

Most of what the model knows does not come from either file. Component names,
import paths, props, legal prop values, defaults and descriptions are read from
the installed package's type declarations, from `propTypes` in the package's
JavaScript, from local component source (`cva()` and `tv()` variant maps,
JSDoc, story prose and `argTypes`), and from Storybook's own index. The files
below add what the code cannot state: intent, conventions and taste.

## `story-ui-docs/`

`init` creates the directory with a README. Put files in it; sub-directories
are fine. These extensions are read:

```
.md  .mdx  .json  .yaml  .yml  .xml  .html  .txt
```

Markdown and text are passed through. JSON, YAML and XML are passed verbatim,
since the model reads them natively, so exported design tokens can go in
unchanged.

Budgets: each file is truncated to 8,000 characters and the whole set to
24,000 characters, with a note in the server log when either happens. Keep
files focused; a 400-line component reference will be cut off. The loader
caches the set and invalidates when any file inside the directory changes.

A layout that has worked:

```
story-ui-docs/
├── README.md
├── guidelines/
│   ├── accessibility.md
│   └── responsive-design.md
├── tokens/
│   ├── colors.yaml
│   └── spacing.json
├── components/
│   ├── button.md
│   └── forms.mdx
└── patterns/
    ├── cards.md
    └── data-tables.md
```

The classic panel (`Story UI > Story Generator`) has a design-context editor
that reads and writes these files through `/story-ui/design-context`; editing
them on disk works the same.

## `story-ui-considerations.md`

`init` writes this from `templates/story-ui-considerations.md` with your import
path filled in. It is rules, not reference: "use `size="sm"` for buttons inside
forms", "never use raw hex colours", "prefer `Stack` over nested `Group`s".

It is also the only way to allow an import from outside your design system.
Static validation rejects any import that is not your configured library (and
its scoped siblings and subpaths), the framework runtime, Storybook, or the
icon package detected in `package.json`. To permit another package, name its
import path in this file:

```
Allowed additional imports: `@tabler/icons-react`, `recharts`
```

A package not named here is rejected before the file is written and the model
is asked to correct it.

If the file lives somewhere else, set `considerationsPath` in
`story-ui.config.js`.

## Config-level guidance

`story-ui.config.js` also carries prompt material that `init` fills for the
libraries it knows: `designSystemGuidelines.additionalNotes`,
`layoutRules.layoutExamples`, `importExamples`, and the `systemPrompt`,
`layoutInstructions` and `examples` overrides. For a library `init` did not
recognise, these are the place for short, structural facts (which component is
the grid, how columns are declared) that the model would otherwise guess.

## Checking what the model knows

```bash
node bench/resolution.mjs --project /path/to/your-project --import '@your/design-system'
```

This is free and takes seconds. It reports how many components were found,
whether each import specifier resolves to a real file, and what fraction have
props and descriptions. If a component you expect is missing here, no amount
of documentation will make the model use it correctly.
