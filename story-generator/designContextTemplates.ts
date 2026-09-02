/**
 * Starter design-context documents.
 *
 * These are written into `story-ui-docs/` so they flow through
 * DocumentationLoader verbatim (code fences survive) and land immediately above
 * the user's request, framed as overriding generic guidance.
 *
 * They are intentionally written in terms of AFFORDANCES rather than component
 * names, because the core must stay design-system agnostic. The per-library
 * starter below is the one place concrete component names appear, and it exists
 * to be edited by the team that owns the design system.
 */

export const INTERACTION_FIDELITY_DOC = `# Interaction Fidelity

<!--
  Authoritative. Rules here override generic generation guidance, including any
  example code shown earlier in the prompt.

  Edit this file to teach the generator how YOUR design system expresses
  behavior. The generator reads it verbatim on every generation.
-->

These stories are lifted directly into product code. A composition that only
*looks* right is a defect.

## Never fake an affordance

If a user would click it, type into it, toggle it, or select it, it must be the
real interactive component from this design system — with a handler, a focusable
element, and an accessible name.

| The design shows          | Use                                             | Never |
|---------------------------|-------------------------------------------------|-------|
| a search / text field     | the library's text input                        | text or a box styled to look like one |
| an icon-only control      | the library's icon-button, wrapping the icon     | a bare icon element |
| a labelled action         | the library's button, with its icon slot         | a row of text + icon |
| a dropdown / chevron / "more" | the library's menu, with trigger + content   | a chevron glyph beside a label |
| a nav item that can be current | the library's nav or tab component with its active state | static text with a color applied |
| a tabbed region           | the library's tabs component                     | labels with a border underneath |
| any other clickable surface | a real button element or unstyled-button primitive | a div/box with onClick |

An icon is **either** decorative, **or** the leading/trailing slot of a real
control, **or** the child of an icon-button. It is never interactive on its own.

## Icons are aligned by the component, not by hand

Use the owning component's icon/section slot when one exists — it is positioned
by the design system's own CSS and cannot drift. When no slot exists, use the
library's inline flex primitive. Never place an icon as a bare child of a
block-level element; it will sit on the text baseline and misalign by a few
pixels.

## State must be real

- Anything with a hover, focus, active, selected, or current appearance gets it
  from a **component prop** or the library's documented state mechanism — never
  from an inline style object, which cannot express those states at all.
- When a composition renders several items and one is current, drive it from
  component state and wire the handler that changes it. Do not hardcode which
  one is selected.
- Single-component stories demonstrating one state in isolation should use story
  args instead — that is the correct Storybook idiom.

## Self-check before emitting

1. Is anything that looks interactive actually inert?
2. Is any icon unaligned, or standing in for a button?
3. Is any state being faked with a static style?

Fix all three before returning the story.
`;

export const COMPOSITION_DOC = `# Composition Patterns

<!--
  Teach the generator the shapes your team actually ships. Worked examples are
  the highest-leverage content in this folder: models imitate concrete code far
  more reliably than they follow prose.

  Replace the placeholders below with real code from your design system.
-->

## How to use this file

For each pattern your team uses often, give a short name, when it applies, and a
complete, correct code example. One accurate exemplar of a pattern you care
about outweighs several paragraphs of description.

## Application shell

_When: a full-page layout with a header, optional sidebar, and content region._

\`\`\`tsx
// Replace with your design system's real shell composition.
\`\`\`

## Utility / navigation bar

_When: a top bar with branding, navigation that tracks a current item, a search
affordance, and right-aligned utility actions._

Requirements for this pattern specifically:
- the search affordance is a real input, bound to state
- navigation uses the component that owns an active/current state
- utility icons are icon-buttons; any chevron opens a real menu
- the current item is driven by state, not hardcoded

\`\`\`tsx
// Replace with your design system's real utility bar.
\`\`\`

## Data table with actions

_When: tabular data where rows carry actions._

\`\`\`tsx
// Replace with your design system's real table composition.
\`\`\`

## Form

_When: collecting input, with validation and a submit action._

\`\`\`tsx
// Replace with your design system's real form composition.
\`\`\`
`;

/**
 * Optional third starter keyed to the detected library. Only concrete, verifiable
 * facts belong here — it is a head start for the team, not a substitute for
 * their own authoring, and it says so.
 */
export function starterDocFor(importPath?: string): { name: string; content: string } | null {
  if (!importPath) return null;
  const lib = importPath.toLowerCase();

  if (lib.includes('@mantine/core')) {
    return {
      name: 'mantine-affordances.md',
      content: `# Mantine — affordance bindings

<!--
  Starter mapping for Mantine. Verify against the version you have installed and
  edit freely — this file is yours.
-->

## Affordance → component

| Affordance | Component | Notes |
|---|---|---|
| text / search field | \`TextInput\` | \`leftSection\` for a leading icon; \`Autocomplete\` when it suggests |
| icon-only control | \`ActionIcon\` | \`aria-label\` is required |
| labelled action | \`Button\` | \`leftSection\` / \`rightSection\` for icons |
| dropdown / chevron | \`Menu\` | needs \`Menu.Target\` + \`Menu.Dropdown\` |
| nav item with current state | \`NavLink\` | \`active\` prop owns the highlight |
| tabbed region | \`Tabs\` | \`Tabs.List\` + \`Tabs.Tab\` + \`Tabs.Panel\` |
| bare clickable surface | \`UnstyledButton\` | never a \`Box\` with \`onClick\` |

## Compound components

The available-components list shows sub-components as flat sibling names
(\`MenuTarget\`, \`MenuDropdown\`, \`TabsTab\`). Both forms are exported, but prefer
dot notation for readability:

\`\`\`tsx
<Menu shadow="md" width={220} position="bottom-end">
  <Menu.Target>
    <ActionIcon variant="default" size="lg" aria-label="Create new">
      <IconPlus size={16} stroke={1.5} />
    </ActionIcon>
  </Menu.Target>
  <Menu.Dropdown>
    <Menu.Label>Create</Menu.Label>
    <Menu.Item leftSection={<IconBook size={14} />}>New repository</Menu.Item>
    <Menu.Divider />
    <Menu.Item component="a" href="/import">Import</Menu.Item>
  </Menu.Dropdown>
</Menu>
\`\`\`

\`Menu.Target\` needs a single ref-forwarding child — \`ActionIcon\`, \`Button\`, and
\`UnstyledButton\` all qualify; a plain \`div\` or bare icon does not.

Same shape: \`Card.Section\`, \`Tabs.List\`/\`Tabs.Tab\`/\`Tabs.Panel\`,
\`Accordion.Item\`/\`.Control\`/\`.Panel\`, \`Popover.Target\`/\`.Dropdown\`.

## Icon alignment

Use the section slot; it is positioned by Mantine's CSS:

\`\`\`tsx
<NavLink label="Repositories" leftSection={<IconBook size={16} stroke={1.5} />} />
<Button leftSection={<IconPlus size={16} stroke={1.5} />}>New</Button>
<TextInput placeholder="Search" leftSection={<IconSearch size={16} stroke={1.5} />} />
\`\`\`

Sizing: \`size={16} stroke={1.5}\` in sm/md controls, \`size={14}\` inside
\`Menu.Item\`. Never size an icon with \`style\`.

Note: \`leftSectionPointerEvents\` defaults to \`'none'\`. A clickable control in a
section needs \`rightSectionPointerEvents="all"\` or it is dead.

## Current-item state

\`\`\`tsx
const [active, setActive] = useState(0);

{links.map((link, i) => (
  <NavLink
    key={link.label}
    href="#"
    label={link.label}
    leftSection={<link.icon size={16} stroke={1.5} />}
    active={i === active}
    variant="subtle"
    onClick={(e) => { e.preventDefault(); setActive(i); }}
  />
))}
\`\`\`

Use Mantine props and theme values (\`c\`, \`bg\`, \`p\`, \`gap\`) rather than raw hex,
so output inherits theming and dark mode.
`,
    };
  }

  return null;
}
