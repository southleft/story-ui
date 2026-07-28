/**
 * Component-selection bench.
 *
 * The question this answers is the one that decides whether a user commits
 * after one prompt or after six: did the model reach for the RIGHT components
 * from this project's design system, and use them correctly?
 *
 * Every other gate we have can pass while the answer is no. A composition that
 * hand-rolls pagination out of Card and Grid, when the library ships a
 * DataTable, renders correctly, verifies clean, passes a11y, and shows a
 * provenance panel full of real design system components — and reads as
 * not-of-this-design-system to the person who owns it.
 *
 * The first version of this bench scored 5/5 on its first run and therefore
 * measured nothing. These cases are deliberately harder: dense, stateful,
 * multi-region compositions of the kind a PM actually asks for, where the
 * library ships a composite that is easy to miss.
 *
 *   node bench/componentSelection.mjs --mcp http://localhost:4101
 *   node bench/componentSelection.mjs --no-manifest      # A/B the Storybook context
 *   node bench/componentSelection.mjs --cases 3 --only crm
 *
 * Deliberately not a unit test: it spends real LLM calls.
 */

import { extractProps } from '../dist/story-generator/knowledge/propExtractor.js';
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const flag = (n) => args.includes(`--${n}`);

const ONLY = arg('only', null);
const LIMIT = Number(arg('cases', '0')) || Infinity;
const USE_MANIFEST = !flag('no-manifest');
const SUITE = arg('suite', null);

/**
 * Where each suite runs.
 *
 * Selection was only ever measured on Mantine, housekit and college-town —
 * two barrel libraries and a local one. The knowledge layer was then improved
 * substantially for Carbon, MUI and Atlassian without any measurement of
 * whether it changed what the model CHOOSES on them, which left the most
 * expensive question of all answered by assumption.
 *
 * Each suite carries its own project, import path and server so a run needs
 * one flag rather than three that can silently disagree — pointing the MCP at
 * one project while resolving imports against another produced a bench that
 * measured neither.
 */
const SUITE_CONFIG = {
  mantine: { project: '/Users/tjpitre/Sites/test-storybooks/react-mantine', importPath: '@mantine/core', mcp: 'http://localhost:4101' },
  ct: { project: '/Users/tjpitre/Sites/college-town', importPath: '@/components', mcp: 'http://localhost:4106' },
  mui: { project: '/Users/tjpitre/Sites/test-storybooks/mui-material', importPath: '@mui/material', mcp: 'http://localhost:4107' },
  atlaskit: { project: '/Users/tjpitre/Sites/test-storybooks/atlaskit', importPath: '@atlaskit', mcp: 'http://localhost:4108' },
  carbon: { project: '/Users/tjpitre/Sites/test-storybooks/carbon', importPath: '@carbon/react', mcp: 'http://localhost:4109' },
};

const suiteDefaults = SUITE_CONFIG[SUITE] || SUITE_CONFIG.mantine;
// Explicit flags still win, so a one-off run against an unlisted project works.
const MCP = arg('mcp', suiteDefaults.mcp);
const PROJECT = arg('project', suiteDefaults.project);
const IMPORT_PATH = arg('import', suiteDefaults.importPath);

/**
 * expect     at least one of each group must appear — the composite that exists
 * avoidTags  raw HTML that means the model rebuilt something already shipped
 * minRegions rough density check: a dashboard that returns one card is not the
 *            thing that was asked for, and is the most common way a complex
 *            prompt quietly under-delivers
 */
/**
 * COLLEGE-TOWN — a real Radix + Tailwind design system.
 *
 * Different in every way that has previously hidden a bug: shadcn-style
 * compound components, path-alias individual imports (`@/components/x/x`)
 * rather than a barrel, Tailwind utility classes with no semantic markers, and
 * a `data-table` composite that is exactly the thing a model hand-rolls out of
 * primitives when it does not know the library ships one.
 *
 *   node bench/componentSelection.mjs --suite ct --mcp http://localhost:4106 \
 *     --project /Users/tjpitre/Sites/college-town --import '@/components'
 */
const CT_CASES = [
  {
    suite: 'ct', id: 'ct-alert-compound',
    prompt: 'A page section showing a success alert, a warning alert and an error alert, '
      + 'each with a heading and a description line',
    // The house Alert is compound; using the shell alone is the common miss.
    expect: [['Alert'], ['AlertTitle'], ['AlertDescription']],
    avoidTags: [],
    minRegions: 0,
  },
  {
    suite: 'ct', id: 'ct-data-table',
    prompt: 'A sortable table of students showing name, major, year and enrollment status, '
      + 'with a status badge in each row',
    expect: [['Table', 'DataTable'], ['TableHeader'], ['TableRow'], ['TableCell'], ['Badge']],
    avoidTags: ['table', 'thead', 'tbody'],
    minRegions: 0,
  },
  {
    suite: 'ct', id: 'ct-course-card',
    prompt: 'A grid of course cards, each with a title, description, an instructor avatar '
      + 'and a badge for the department',
    expect: [['Card'], ['CardHeader', 'CardTitle'], ['CardContent'], ['Avatar'], ['Badge']],
    avoidTags: [],
    minRegions: 0,
  },
  {
    suite: 'ct', id: 'ct-form',
    prompt: 'A student registration form with name and email fields, a major dropdown, '
      + 'a terms checkbox and a submit button',
    expect: [['Input'], ['Label'], ['Select', 'SelectTrigger'], ['Checkbox'], ['Button']],
    avoidTags: ['input', 'select', 'button'],
    minRegions: 0,
  },
  {
    suite: 'ct', id: 'ct-tabs-panel',
    prompt: 'A course detail view with tabs for Overview, Syllabus and Roster, '
      + 'and a card inside each tab',
    expect: [['Tabs'], ['TabsList'], ['TabsTrigger'], ['TabsContent'], ['Card']],
    avoidTags: [],
    minRegions: 0,
  },
];


/**
 * PUBLISHED ENTERPRISE DESIGN SYSTEMS — Carbon, MUI, Atlassian.
 *
 * Selection had only ever been measured on Mantine, housekit and
 * college-town. The knowledge layer was then improved substantially for these
 * three — Carbon to 98% props and 85 deprecations, Atlassian from 31 to 168
 * components — with no measurement of whether any of it changed what the model
 * CHOOSES. That left the most expensive question answered by assumption.
 *
 * Every name below was checked twice: that the installed package exports it,
 * and that OUR DISCOVERY surfaces it. The second check matters more. A case
 * demanding a component the model was never shown measures our catalog, not
 * its judgement, and would fail forever while looking like a selection defect.
 *
 *   node bench/componentSelection.mjs --suite carbon
 */
const LIBRARY_CASES = [
  {
    suite: 'mui', id: 'mui-material-invoices-sortable-paginated-table',
    prompt: 'Build the Invoices screen for our billing console: a header strip with a search field, '
      + 'status filter chips and a date-range button; beneath it a scrollable table of invoices '
      + '(number, customer, issued, due, amount, status) with a sticky header row, where Issued '
      + 'and Amount are click-to-sort with a visible ascending/descending indicator on the active '
      + 'column, each row ending in a right-aligned overflow icon action; and a footer bar with '
      + 'rows-per-page and page navigation showing \'1-10 of 248\'.',
    expect: [['TableContainer'], ['Table'], ['TableHead'], ['TableBody'], ['TableRow'], ['TableCell'], ['TableSortLabel'], ['TablePagination', 'Pagination']],
    avoidTags: ['table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td'],
    minRegions: 3,
  },
  {
    suite: 'mui', id: 'mui-material-onboarding-vertical-stepper-flow',
    prompt: 'Design the \'Add a payment method\' flow inside our merchant onboarding panel: a vertical '
      + 'progress tracker with four stages (Business details, Bank account, Verification, Review) '
      + 'where the active stage expands inline to reveal its own form fields rather than swapping '
      + 'the whole panel, a country field that filters a long list of countries as the user types '
      + 'and shows a clearable selection, Back/Continue actions under each stage\'s content, and a '
      + 'transient success toast pinned to the bottom-left after the final submit.',
    expect: [['Stepper'], ['Step'], ['StepLabel'], ['StepContent'], ['Autocomplete'], ['Snackbar']],
    avoidTags: ['ol', 'select', 'button', 'dialog'],
    minRegions: 4,
  },
  {
    suite: 'mui', id: 'mui-material-notification-prefs-accordion-list',
    prompt: 'Build the Notification Preferences page for our workspace admin: a navigational trail '
      + 'reading Settings / Workspace / Notifications across the top, then three collapsible '
      + 'panels (Email, In-app, Mobile push) that expand one at a time with a chevron in each '
      + 'header and a summary count beside the title, each panel containing a dense set of rows '
      + 'where every row has a leading channel icon, a bold title with a smaller description line '
      + 'underneath, and a switch pinned to the trailing edge; finally a floating action button '
      + 'anchored bottom-right that fans out on hover into Mute all, Export log and Send test.',
    expect: [['Breadcrumbs'], ['Accordion'], ['AccordionSummary'], ['AccordionDetails'], ['List'], ['ListItem', 'ListItemButton'], ['ListItemText'], ['SpeedDial'], ['SpeedDialAction']],
    avoidTags: ['ul', 'li', 'ol', 'details', 'summary'],
    minRegions: 4,
  },
  {
    suite: 'carbon', id: 'carbon-contained-list-row-actions',
    prompt: 'Build a "Data source connections" management panel for our admin console: a bordered list '
      + 'region titled "Connected sources" with an inline search affordance in its header that '
      + 'expands from an icon when clicked, plus an "Add source" button in that same header. Each '
      + 'row shows the source name, a status indicator, and a per-row kebab menu on the right with '
      + 'Edit, Test connection, and a destructive Remove. Below it, a second bordered list titled '
      + '"Archived sources" using the muted/disclosed treatment with just names and a Restore item '
      + 'in each row\'s kebab menu.',
    expect: [['ContainedList'], ['ContainedListItem'], ['OverflowMenu'], ['OverflowMenuItem'], ['ExpandableSearch', 'Search'], ['Tag']],
    avoidTags: ['ul', 'li', 'table'],
    minRegions: 3,
  },
  {
    suite: 'carbon', id: 'carbon-provision-review-step',
    prompt: 'Design the final "Review and provision" screen of a 4-step cluster provisioning wizard. '
      + 'Across the top, a horizontal step tracker showing Details / Networking / Review / '
      + 'Provision with Review as the current step, the first two complete, and Networking flagged '
      + 'with a warning caption. The main region is a read-only specification summary rendered as '
      + 'label/value rows under a two-column header ("Setting" / "Value") covering region, node '
      + 'type, node count, Kubernetes version, and encryption. To the right, a cost estimate card '
      + 'showing the monthly total up front that expands in place — not into a modal or an '
      + 'accordion — to reveal the per-line-item breakdown underneath. Footer has Back and '
      + 'Provision cluster actions.',
    expect: [['ProgressIndicator'], ['ProgressStep'], ['StructuredListWrapper'], ['StructuredListHead', 'StructuredListBody'], ['StructuredListRow'], ['StructuredListCell'], ['ExpandableTile'], ['TileAboveTheFoldContent'], ['TileBelowTheFoldContent']],
    avoidTags: ['dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'ol'],
    minRegions: 4,
  },
  {
    suite: 'carbon', id: 'carbon-access-review-batch-table',
    prompt: 'Build an "Access review" console for our security team. A filter bar sits above the grid '
      + 'with a type-ahead single-select for Workspace (several hundred workspaces, must narrow as '
      + 'the user types) and a multi-select for Roles with checkboxes and a selected-count badge. '
      + 'The grid below lists service accounts with columns Account, Owner, Last used, and Scopes '
      + 'count; it has a toolbar containing a search field and a Download action. Rows are '
      + 'checkbox-selectable, and selecting one or more swaps the toolbar for a batch action bar '
      + 'offering Approve, Rotate key, and a destructive Revoke with a live selected count and a '
      + 'cancel. Every row also expands to reveal that account\'s granted scopes as a nested '
      + 'detail region.',
    expect: [['DataTable'], ['Table'], ['TableContainer'], ['TableToolbar', 'TableToolbarContent'], ['TableToolbarSearch'], ['TableBatchActions'], ['TableBatchAction'], ['TableSelectRow'], ['TableSelectAll'], ['TableExpandRow'], ['TableExpandedRow'], ['TableExpandHeader'], ['ComboBox'], ['FilterableMultiSelect', 'MultiSelect']],
    avoidTags: ['table', 'thead', 'tbody', 'tr', 'th', 'td', 'select'],
    minRegions: 3,
  },
  {
    suite: 'atlaskit', id: 'atlaskit-metric-tiles-drilldown',
    prompt: 'Build the analytics overview strip that sits at the top of a Jira project dashboard: a '
      + 'row of four KPI cards (Open work items 128, Resolved this sprint 41, Median cycle time '
      + '3.2d, Escaped defects 6). Each card shows a small tinted icon container, the figure '
      + 'rendered in the design system\'s tabular metric type so the digits don\'t jitter while '
      + 'the number polls every 30s, a sub-label, and a coloured delta badge like "+12% vs last '
      + 'sprint". The entire card is one click target that drills through to the filtered board, '
      + 'and a fifth card is still fetching so it renders as a shimmering placeholder in the same '
      + 'footprint.',
    expect: [['MetricText'], ['Pressable'], ['Lozenge'], ['Skeleton', 'TileSkeleton'], ['Grid', 'Inline', 'Flex', 'Stack', 'Box']],
    avoidTags: ['button', 'h2', 'h3'],
    minRegions: 4,
  },
  {
    suite: 'atlaskit', id: 'atlaskit-work-item-header-split-actions',
    prompt: 'Compose the header region of a Jira work item detail view. Left side: the item title as a '
      + 'proper heading, an in-progress status pill, and a metadata line with the assignee. Below '
      + 'it, the item\'s labels as a wrapping row of chips. Right side, an action bar: the primary '
      + 'action is a split control — "Create branch" performs the default action while an attached '
      + 'chevron segment opens the other repo choices; next to it a grouped pair of secondary '
      + 'actions (Watch, Share); and finally an icon-only overflow control whose meaning is only '
      + 'conveyed on hover, so it needs a hover/focus label rather than a title attribute.',
    // SplitButton lives in the @atlaskit/button/new subpath entry point and IconButton is not 
    // in the installed version, so neither reaches the catalog. Demanding a component the model was never shown measures nothing.
    expect: [['Button'], ['Tooltip'], ['Lozenge'], ['Tag', 'SimpleTag', 'RemovableTag', 'AvatarTag']],
    avoidTags: ['button', 'h1', 'h2'],
    minRegions: 3,
  },
  {
    suite: 'atlaskit', id: 'atlaskit-invite-members-panel',
    prompt: 'Build the "People" panel of a team settings page. Top: an invite form with an email entry '
      + 'field and its helper text, a permission scope list of four independent toggles (Can view, '
      + 'Can comment, Can edit, Can administer) each with its own label, and a small info '
      + 'affordance next to "Can administer" that reveals an explanation on hover and keyboard '
      + 'focus. Below: the existing members list, where each row is an avatar paired with the '
      + 'member\'s name as primary text and their role as secondary text on one line, plus a '
      + 'dismissible team chip with an × on the right. The members list is still loading for the '
      + 'first render, so show four shimmering placeholder rows in the same row geometry before '
      + 'the data arrives.',
    expect: [['Textfield'], ['Checkbox'], ['Tooltip'], ['AvatarItem'], ['Skeleton'], ['RemovableTag', 'Tag']],
    avoidTags: ['input', 'img', 'h2'],
    minRegions: 3,
  },
];

const CASES = [
  /**
   * HOUSEKIT — a design system the model provably has no training data for.
   *
   * The Mantine cases cannot answer whether project-specific context helps,
   * because the model already knows Mantine; measured A/B on them showed no
   * effect. These use an in-repo system with invented names, where the only
   * way to choose correctly is to have read this project's Storybook. If the
   * manifest context is worth its tokens, it shows up here or nowhere.
   */
  {
    id: 'housekit-health',
    prompt: 'A service health dashboard: a row of metric tiles for uptime, open incidents '
      + 'and mean response time; a table of services showing region, status and p95 latency; '
      + 'and a status indicator on each row. Use this project\'s own design system.',
    expect: [['Statlet'], ['Datagrid'], ['Pillbox']],
    avoidTags: ['table'],
    minRegions: 0,
    houseComponents: ['Slab', 'Statlet', 'Datagrid', 'Pillbox'],
  },
  {
    id: 'housekit-panel',
    prompt: 'A deployment panel with a heading, a live status indicator in the header, '
      + 'and a list of recent deploys with their status. Use this project\'s own design system.',
    expect: [['Slab'], ['Pillbox']],
    avoidTags: [],
    minRegions: 0,
    houseComponents: ['Slab', 'Pillbox'],
  },
  {
    id: 'crm-contact',
    prompt: 'A CRM contact detail view: header with avatar, name, company and status; '
      + 'tabs for Activity, Notes and Deals; an activity timeline; and a right sidebar '
      + 'with contact fields and an owner assignment dropdown',
    expect: [['Tabs'], ['Timeline', 'List', 'Stack'], ['Avatar'], ['Select', 'NativeSelect']],
    avoidTags: ['table', 'select'],
    minRegions: 3,
  },
  {
    id: 'financial-calculator',
    prompt: 'A loan calculator with inputs for amount, interest rate and term, '
      + 'a slider for the down payment, a computed monthly payment summary, '
      + 'and an amortization table for the first twelve months',
    expect: [['NumberInput', 'TextInput'], ['Slider'], ['Table']],
    avoidTags: ['table', 'input'],
    minRegions: 3,
  },
  {
    id: 'monitoring',
    prompt: 'A service monitoring dashboard: four status tiles with uptime percentages, '
      + 'a filterable incident table with severity badges, and a side panel listing '
      + 'on-call engineers with an escalate button on each',
    /**
     * The HOUSE component counts as the right answer.
     *
     * This case failed three runs running, and every time the generation was
     * correct: it reached for `Datagrid`, `Pillbox` and `Statlet` — this
     * project's own design system — where the case demanded Mantine's `Table`
     * and `Badge`. Preferring the project's components over the npm library is
     * the behaviour this whole tool exists to produce, and the bench was
     * scoring it as a miss.
     */
    expect: [['Table', 'Datagrid'], ['Badge', 'Pillbox'], ['SimpleGrid', 'Grid']],
    // `<table>` is still hand-rolling: both Mantine and housekit ship a table.
    avoidTags: ['table'],
    minRegions: 3,
  },
  {
    id: 'inventory-bulk',
    prompt: 'A product inventory manager with row checkboxes for bulk selection, '
      + 'a bulk actions toolbar that appears when rows are selected, '
      + 'sortable columns, and pagination',
    expect: [['Table'], ['Checkbox'], ['Pagination']],
    avoidTags: ['table', 'input'],
    minRegions: 2,
  },
  {
    id: 'settings-accordion',
    prompt: 'An account settings page with collapsible sections for profile, security '
      + 'and billing, each containing a form, and a sticky save bar at the bottom',
    expect: [['Accordion'], ['TextInput'], ['Button']],
    avoidTags: ['input', 'details'],
    minRegions: 2,
  },
];

async function generate(prompt) {
  const res = await fetch(`${MCP}/mcp/generate-story-stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, provider: 'claude', useStorybookMcp: USE_MANIFEST }),
  });
  if (!res.ok) throw new Error(`generate failed: ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', completion = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const l of lines) {
      if (!l.startsWith('data: ')) continue;
      try { const e = JSON.parse(l.slice(6)); if (e.type === 'completion') completion = e.data; } catch { /* partial */ }
    }
  }
  return completion;
}

/**
 * Every name an import binds — DEFAULT imports included.
 *
 * Matching only braced imports made this bench blind to an entire class of
 * design system. Atlassian ships one package per component and most are
 * default exports, so `import Button from '@atlaskit/button/new'` was
 * invisible: the suite reported Button, Tooltip, Lozenge and Textfield as
 * MISSING from code that imported all four correctly, and scored 0/3 on
 * generations that had chosen exactly the right components.
 *
 * The same species of defect as the resolution bench's regex that could not
 * see default-export components — a measurement that quietly shrinks reads
 * exactly like a failure.
 */
function importsOf(code) {
  const out = [];
  // `import Default, { A, B as C } from 'x'` / `import * as NS from 'x'`
  const re = /import\s+(?:type\s+)?(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\*\s+as\s+([A-Za-z_$][\w$]*)\s*)?(?:{([^}]*)})?\s*from\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    const [, def, ns, braced, from] = m;
    const names = [];
    if (def) names.push(def);
    if (ns) names.push(ns);
    if (braced) {
      for (const part of braced.split(',')) {
        // The ALIAS is the name the code uses, and what a case should match.
        const bits = part.trim().split(/\s+as\s+/).map(x => x.trim()).filter(Boolean);
        const bound = bits[bits.length - 1];
        if (bound && /^[A-Za-z_$][\w$]*$/.test(bound)) names.push(bound);
      }
    }
    if (names.length) out.push({ from, names });
  }
  return out;
}

/**
 * Props React or the DOM accept anywhere; never a library's fault.
 *
 * Includes standard HTML attributes, because a component that renders a DOM
 * element passes them straight through. `Table.Td colSpan` was flagged as a
 * hallucination on the first hardened run; it is plain HTML.
 */
const UNIVERSAL = new Set([
  'key', 'ref', 'style', 'className', 'children', 'id', 'role', 'title', 'tabIndex',
  'component', 'renderRoot', 'href', 'target', 'rel', 'type', 'name', 'value',
  'onClick', 'onChange', 'onSubmit', 'onBlur', 'onFocus', 'onKeyDown', 'onMouseEnter', 'onMouseLeave',
  // HTML passthrough
  'colSpan', 'rowSpan', 'scope', 'headers', 'span', 'placeholder', 'disabled', 'checked',
  'readOnly', 'required', 'autoFocus', 'autoComplete', 'maxLength', 'minLength',
  'min', 'max', 'step', 'pattern', 'multiple', 'accept', 'alt', 'src', 'srcSet',
  'width', 'height', 'loading', 'defaultValue', 'defaultChecked', 'htmlFor', 'form',
  'colspan', 'rowspan',
]);

/** Every JSX attribute name used anywhere in a set of files. */
function propsUsedIn(files) {
  const used = new Set();
  for (const f of files) {
    let src;
    try { src = fs.readFileSync(f, 'utf8'); } catch { continue; }
    for (const m of src.matchAll(/<[A-Z][A-Za-z0-9.]*\s+([^/>]*?)\/?>/gs)) {
      for (const a of m[1].matchAll(/(?:^|\s)([a-zA-Z][a-zA-Z0-9]*)=/g)) used.add(a[1]);
    }
  }
  return used;
}

/**
 * Prop names declared in a project's own component source.
 *
 * Needed because a local design system has no package in node_modules for
 * propExtractor to read, and because a prop can be perfectly real without
 * appearing in any story. `DataTableColumnHeader.sortDirection` is declared in
 * data-table-column-header.tsx, used by nothing in the story set, and was
 * reported as a hallucination — a false accusation against a correct
 * generation, which is the worst kind of bench error.
 */
function propsDeclaredIn(projectRoot, componentsDir = 'src/components') {
  const names = new Set();
  const root = path.join(projectRoot, componentsDir);
  const walk = (dir, depth = 0) => {
    if (depth > 5) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!e.name.startsWith('.') && e.name !== 'node_modules') walk(full, depth + 1); continue; }
      if (!/\.[jt]sx?$/.test(e.name) || /\.stories\./.test(e.name)) continue;
      let src;
      try { src = fs.readFileSync(full, 'utf8'); } catch { continue; }
      // Property signatures inside type/interface bodies. Deliberately loose:
      // over-collecting props only makes the check more conservative.
      for (const m of src.matchAll(/^\s{2,}([a-zA-Z][a-zA-Z0-9]*)\??\s*:/gm)) names.add(m[1]);
      // VariantProps-style keys and destructured component params.
      for (const m of src.matchAll(/^\s{2,}([a-zA-Z][a-zA-Z0-9]*),?\s*$/gm)) names.add(m[1]);
    }
  };
  walk(root);
  return names;
}

/** Every .stories.* file in the project that we did not generate. */
function teamStoryFiles(projectRoot, generatedFragment = 'generated') {
  const out = [];
  const walk = (dir, depth = 0) => {
    if (depth > 6) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name.startsWith('.') || e.name === generatedFragment) continue;
        walk(full, depth + 1);
      } else if (/\.stories\.[jt]sx?$/.test(e.name)) {
        out.push(full);
      }
    }
  };
  walk(path.join(projectRoot, 'src'));
  return out;
}

/**
 * Props the design system does not appear to accept.
 *
 * A hallucinated prop is the most direct way a generation costs a round trip:
 * it renders, it looks almost right, and the value silently does nothing.
 *
 * Validated against a UNION vocabulary rather than per-component sets, because
 * per-component was measurably wrong. propExtractor reads only locally declared
 * props, so every prop a library inherits from a shared base is invisible to
 * it — for Mantine that is the entire style-prop system, and the first run
 * flagged `Text.c`, `Text.fw` and `Group.mb`, all of which are correct.
 *
 * The vocabulary is therefore: props the library declares anywhere, plus every
 * prop the team uses in their OWN stories. A prop the team writes is valid by
 * definition, which is the same principle the rest of this work relies on and
 * needs no knowledge of any particular library's inheritance scheme.
 */
function invalidProps(code, vocabulary, designSystemNames) {
  if (!vocabulary || vocabulary.size === 0) return [];
  const bad = [];
  for (const m of code.matchAll(/<([A-Z][A-Za-z0-9.]*)\s+([^/>]*?)\/?>/gs)) {
    const [, comp, attrs] = m;
    // Only design system components. A local project component defines its own
    // props, which this vocabulary knows nothing about — the first run flagged
    // `PriceTag.amount` on a component the project itself ships.
    const base = comp.split('.')[0];
    if (!designSystemNames.has(base)) continue;
    for (const a of attrs.matchAll(/(?:^|\s)([a-zA-Z][a-zA-Z0-9]*)=/g)) {
      const prop = a[1];
      if (UNIVERSAL.has(prop) || prop.startsWith('data-') || prop.startsWith('aria-')) continue;
      if (/^on[A-Z]/.test(prop)) continue;
      if (!vocabulary.has(prop)) bad.push(`${comp}.${prop}`);
    }
  }
  return [...new Set(bad)];
}

/**
 * Imports that do not resolve to a file on disk.
 *
 * The single most consequential defect a generation can have, and it passed
 * every other check here: on a project using path-alias individual imports,
 * 41% of generated imports pointed at modules that do not exist. Vite 404s the
 * module, the story never mounts, and the user sees a blank canvas after a
 * generation that scored full marks on component selection.
 *
 * Only project-relative aliases and relative paths are checked; a bare package
 * specifier is node_modules' business, and import isolation already covers it.
 */
function unresolvedImports(code, projectRoot, alias = '@/') {
  const bad = [];
  const exts = ['.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts', '/index.js'];
  for (const m of code.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    const spec = m[1];
    let base = null;
    if (spec.startsWith(alias)) base = path.join(projectRoot, 'src', spec.slice(alias.length));
    else if (spec.startsWith('.')) continue; // relative to the story dir; resolved by writeStory
    else continue;
    if (!exts.some(e => fs.existsSync(base + e))) bad.push(spec);
  }
  return [...new Set(bad)];
}

/**
 * Raw pixel and hex values in generated output.
 *
 * The most visible tell to a design system owner: `padding: 24px` in a system
 * with a spacing scale. Baseline before styling guidance was added — 48 stories
 * in college-town carried 607 raw px and 103 raw hex, with zero token uses.
 */
function rawStyleValues(code) {
  const px = code.match(/\b\d{1,4}px\b/g) || [];
  const hex = code.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  return { px: px.length, hex: hex.length };
}

/**
 * How many distinct visual regions the composition builds, as a density signal.
 *
 * The container vocabulary used to be a hardcoded list — Paper, Card, Section,
 * Fieldset, Accordion, Slab — which is a Mantine-and-housekit list wearing a
 * generic name. It undercounted every other design system by construction:
 * Carbon's regions are Tiles, MUI's are Papers and Accordions, and a house
 * component like `Statlet` was invisible, so a correct four-tile dashboard
 * scored as two regions and was failed for being thin.
 *
 * A region is now a component that CONTAINS other components. Counting every
 * non-self-closing component instead scored the same dashboard at 19, because
 * `<Text>label</Text>` and `<Title>Heading</Title>` are not regions — a
 * threshold nothing could ever fail is no more useful than one nothing can
 * pass. Containment is what separates a structural block from a leaf, it is
 * visible in the code, and it needs no per-library vocabulary.
 *
 * Measured on the monitoring dashboard that failed three runs for being thin:
 * hardcoded list 2, every-wrapper 19, contains-a-component 10.
 */
function regionCount(code, designSystemNames) {
  const known = designSystemNames instanceof Set ? designSystemNames : new Set(designSystemNames || []);
  let regions = 0;
  for (const m of code.matchAll(/<([A-Z][A-Za-z0-9]*)\b([^>]*)>/g)) {
    const [full, name, attrs] = m;
    if (attrs.trimEnd().endsWith('/')) continue;
    if (known.size > 0 && !known.has(name)) continue;
    // Look only as far as this element's own closing tag, so a sibling
    // further down the file cannot make a leaf look like a container.
    const after = code.slice(m.index + full.length, m.index + full.length + 400);
    const close = after.indexOf(`</${name}`);
    const body = close >= 0 ? after.slice(0, close) : after;
    if (/<[A-Z]/.test(body)) regions++;
  }
  return regions;
}

async function main() {
  // One registry, so a new suite is added in exactly one place. The old form
  // filtered CT_CASES alone, so `--suite carbon` would have silently matched
  // nothing and reported a clean run over zero cases.
  const ALL = [...CASES, ...CT_CASES, ...LIBRARY_CASES];
  let cases = SUITE ? ALL.filter(c => c.suite === SUITE) : CASES;
  if (SUITE && cases.length === 0) {
    console.error(`No cases for suite "${SUITE}". Known suites: ${[...new Set(ALL.map(c => c.suite).filter(Boolean))].join(', ')}`);
    process.exit(1);
  }
  if (ONLY) cases = cases.filter(c => c.id.includes(ONLY));
  cases = cases.slice(0, LIMIT);

  process.stdout.write('Building prop vocabulary… ');
  const vocabulary = new Set();
  try {
    const extracted = await extractProps(IMPORT_PATH, PROJECT);
    for (const c of Object.values(extracted?.components ?? {})) {
      for (const p of c.props || []) vocabulary.add(p.name);
    }
  } catch { /* declared props unavailable; team usage still carries it */ }
  const teamFiles = teamStoryFiles(PROJECT);
  for (const p of propsUsedIn(teamFiles)) vocabulary.add(p);
  const declared = propsDeclaredIn(PROJECT);
  for (const p of declared) vocabulary.add(p);
  console.log(`${vocabulary.size} prop names (${teamFiles.length} team stories, ${declared.size} declared locally)`);

  console.log(`\nBench — ${cases.length} case(s), Storybook context ${USE_MANIFEST ? 'ON' : 'OFF'}, ${MCP}\n`);

  const results = [];
  for (const c of cases) {
    process.stdout.write(`${c.id.padEnd(22)} `);
    let completion;
    try { completion = await generate(c.prompt); }
    catch (e) { console.log(`ERROR ${e.message}`); results.push({ id: c.id, ok: false, error: e.message }); continue; }
    if (!completion?.code) { console.log('no code'); results.push({ id: c.id, ok: false, error: 'no code' }); continue; }

    const code = completion.code;
    const imports = importsOf(code);
    const used = new Set(imports.flatMap(i => i.names));
    const dsNames = new Set(
      imports.filter(i => i.from === IMPORT_PATH || i.from.startsWith(`${IMPORT_PATH}/`))
        .flatMap(i => i.names),
    );

    const missing = c.expect.filter(g => !g.some(n => used.has(n))).map(g => g.join('|'));
    const handRolled = (c.avoidTags || []).filter(t => new RegExp(`<${t}[\\s>]`).test(code));
    const foreign = imports.map(i => i.from)
      .filter(f => !f.startsWith('.') && !/^(react|@storybook)/.test(f))
      .filter(f => !new RegExp(IMPORT_PATH.split('/')[0].replace('@', ''), 'i').test(f))
      .filter(f => !/icons/i.test(f));
    const bogus = invalidProps(code, vocabulary, dsNames);
    const unresolved = unresolvedImports(code, PROJECT);
    const raw = rawStyleValues(code);
    // `used` rather than `dsNames`: a house component imported by relative
    // path is a region too, and counting only the npm library's names was part
    // of why a house-built dashboard scored as thin.
    const regions = regionCount(code, used);
    const thin = regions < (c.minRegions || 0);

    const house = (c.houseComponents || []).filter(n => used.has(n));
    const ok = !missing.length && !handRolled.length && !foreign.length && !bogus.length
      && !thin && !unresolved.length;
    results.push({
      id: c.id, ok, missing, handRolled, foreign,
      houseUsed: c.houseComponents ? `${house.length}/${c.houseComponents.length}` : undefined,
      invalidProps: bogus.slice(0, 6), unresolvedImports: unresolved.slice(0, 6), regions,
      rawPx: raw.px, rawHex: raw.hex,
      verification: completion.verification?.outcome,
      blockers: completion.verification?.findings?.filter(f => f.severity === 'blocker').length ?? 0,
      // The COUNT alone cannot be acted on, and this suite has produced
      // verification false positives before — aria-hidden spinners, a
      // mid-render sort label, an unrendered tooltip target. Carry the text.
      blockerDetail: (completion.verification?.findings ?? [])
        .filter(f => f.severity === 'blocker')
        .map(f => `${f.probe ?? f.type ?? '?'}: ${String(f.message ?? f.detail ?? '').slice(0, 120)}`),
      lines: code.split('\n').length,
    });

    console.log([
      ok ? 'PASS' : 'FAIL',
      missing.length ? `missing:${missing.join(',')}` : '',
      handRolled.length ? `raw<${handRolled.join(',')}>` : '',
      bogus.length ? `badProps:${bogus.slice(0, 3).join(',')}` : '',
      unresolved.length ? `DEAD IMPORTS:${unresolved.slice(0, 3).join(',')}` : '',
      thin ? `thin:${regions}regions` : '',
      c.houseComponents ? `house:${house.length}/${c.houseComponents.length}(${house.join(',') || 'none'})` : '',
      foreign.length ? `foreign:${foreign.join(',')}` : '',
      (raw.px || raw.hex) ? `raw:${raw.px}px/${raw.hex}hex` : 'raw:0',
      `[${completion.verification?.outcome ?? '?'}]`,
    ].filter(Boolean).join(' '));
  }

  const pass = results.filter(r => r.ok).length;
  const verified = results.filter(r => r.verification === 'verified').length;
  console.log(`\nselection+usage: ${pass}/${results.length}`);
  console.log(`verified:        ${verified}/${results.length}`);
  console.log(`\n${JSON.stringify(results, null, 1)}`);
}

main().catch(e => { console.error(e); process.exit(1); });
