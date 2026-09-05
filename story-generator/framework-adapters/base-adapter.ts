/**
 * Base Framework Adapter
 *
 * Abstract base class that provides common functionality for all
 * framework-specific adapters. Subclasses implement framework-specific
 * prompt generation and story templates.
 */

import {
  FrameworkType,
  StoryFramework,
  FrameworkAdapter,
  StoryGenerationOptions, CatalogFocus } from './types.js';
import { StoryUIConfig } from '../../story-ui.config.js';
import { DiscoveredComponent } from '../componentDiscovery.js';
import { logger } from '../logger.js';
import { saysMoreThanName } from '../knowledge/descriptionQuality.js';
import { importSpecifierFor, localImportSpecifier } from '../knowledge/importSpecifier.js';
import { formatSpacingRules } from '../knowledge/spacingFacts.js';
import { formatImageRules } from '../knowledge/iconFacts.js';

/**
 * Abstract Base Framework Adapter
 */
/** How many props to show per component in the prompt catalog. */
const MAX_PROPS_IN_CATALOG = 12;
/** Character budget for full catalog entries when the request is known. */
const CATALOG_BUDGET_CHARS = 24_000;
/** Never fewer full entries than this, however terse the request. */
const CATALOG_MIN_FULL = 40;
/** The top of the ranking also gets prop descriptions. */
const CATALOG_DOC_TIER = 20;
const CATALOG_DOCS_PER_COMPONENT = 6;
const CATALOG_DOC_CHARS = 90;

/**
 * Order props so the ones that determine BEHAVIOR come first.
 *
 * The catalog is the model's only description of a component, and it is
 * truncated. Alphabetical or declaration order buries the props that decide
 * whether something is interactive — which is precisely the judgement we need
 * it to make. Handlers, state, and content-slot props rank above styling.
 */
function rankPropsByRelevance(props: string[]): string[] {
  const tier = (raw: string): number => {
    // Entries can be "name" or "name: type"; rank on the name.
    const p = String(raw).split(':')[0].trim();
    if (/^on[A-Z]/.test(p)) return 0;                                   // onClick, onChange
    if (/^(value|defaultValue|checked|active|selected|open|opened|disabled|loading|error)$/i.test(p)) return 1;
    if (/(section|icon|adornment|prefix|suffix|slot)/i.test(p)) return 2; // leftSection, rightSection
    if (/^(label|placeholder|title|description|children|href|name|type|id)$/i.test(p)) return 3;
    if (/^(variant|size|color|radius|shadow|position|orientation)$/i.test(p)) return 4;
    return 5;
  };
  return [...props].sort((a, b) => {
    const d = tier(a) - tier(b);
    return d !== 0 ? d : String(a).localeCompare(String(b));
  });
}

export abstract class BaseFrameworkAdapter implements FrameworkAdapter {
  abstract readonly type: FrameworkType;
  abstract readonly name: string;
  abstract readonly supportedStoryFrameworks: StoryFramework[];
  abstract readonly defaultExtension: string;

  /**
   * Get glob patterns for component files in this framework.
   * Used by component discovery to find relevant files.
   */
  abstract getComponentFilePatterns(): string[];

  /**
   * Extract component names from a source file.
   * Framework-specific implementation to detect component exports.
   */
  abstract extractComponentNamesFromFile(filePath: string, content: string): string[];

  /**
   * Generate the system prompt for this framework
   */
  abstract generateSystemPrompt(
    config: StoryUIConfig,
    options?: StoryGenerationOptions
  ): string;

  /**
   * Generate component reference documentation.
   *
   * Every component used to get a full entry — props, description, usage —
   * whether or not the request could possibly involve it. Measured: 244
   * entries and 65k chars on Mantine, 97k on college-town, two thirds of the
   * whole prompt, resent on every attempt. Relevance ranking already existed
   * for the exemplar section and was never applied here.
   *
   * With a `catalogFocus`, components are ranked against the request (and
   * anything the previous code already imports is kept), the top of the
   * ranking gets a full entry within a character budget, the next tier gets
   * prop DESCRIPTIONS as well — the facts that were extracted and withheld —
   * and everything else is listed by name and import path only, so the model
   * still knows it exists and how to import it. Small catalogs are unaffected:
   * below the budget everything is full.
   */
  generateComponentReference(
    components: DiscoveredComponent[],
    config: StoryUIConfig,
    options?: StoryGenerationOptions
  ): string {
    if (components.length === 0) {
      return 'No components discovered.';
    }

    const focus = options?.catalogFocus;
    const tiers = this.tierComponents(components, focus);
    const full = new Set(tiers.full.map(c => c.name));
    const withDocs = new Set(tiers.docs.map(c => c.name));

    const groupedComponents = this.groupComponentsByPackage(components);
    const sections: string[] = [];

    for (const [packageName, pkgComponents] of Object.entries(groupedComponents)) {
      const fullEntries = pkgComponents
        .filter(c => full.has(c.name))
        .map(comp => this.formatComponentEntry(comp, config, { withDocs: withDocs.has(comp.name) }));
      const compact = pkgComponents.filter(c => !full.has(c.name));
      const parts: string[] = [];
      if (fullEntries.length) parts.push(fullEntries.join('\n'));
      if (compact.length) {
        // Name + import only. Grouped by import path so the list stays one
        // line per path rather than one line per component.
        const byPath = new Map<string, string[]>();
        for (const c of compact) {
          const how = this.getImportPath(c, config);
          const key = (c as any).__defaultExport === true ? `${how} (default exports)` : how;
          byPath.set(key, [...(byPath.get(key) ?? []), c.name]);
        }
        const lines = [...byPath.entries()].map(([how, names]) => `  from '${how}': ${names.join(', ')}`);
        parts.push(`Also available (props not listed — prefer the components above unless the request needs one of these):\n${lines.join('\n')}`);
      }
      sections.push(`## ${packageName}\n${parts.join('\n\n')}`);
    }

    if (focus) {
      logger.log(
        `📚 Catalog: ${tiers.full.length} full entries (${tiers.docs.length} with prop docs), ` +
        `${components.length - tiers.full.length} by name only`,
      );
    }

    return `# Available Components\n\n${sections.join('\n\n')}`;
  }

  /**
   * Rank components against the request and split them into tiers.
   *
   * Scoring is by facts the catalog holds: the component's name, its
   * description and category against the words of the request. A component
   * the previous code imports scores above everything, because an update
   * must be able to keep using it. Ties break toward components with more
   * documented props, which is the closest available proxy for "commonly
   * used" that does not name a library.
   */
  protected tierComponents(
    components: DiscoveredComponent[],
    focus: CatalogFocus | undefined,
  ): { full: DiscoveredComponent[]; docs: DiscoveredComponent[] } {
    const budget = focus?.budgetChars ?? CATALOG_BUDGET_CHARS;
    if (!focus) return { full: components, docs: [] };

    const words = new Set(focus.prompt.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2));
    const must = new Set((focus.mustInclude ?? []).map(n => n.toLowerCase()));
    const score = (c: DiscoveredComponent): number => {
      const name = c.name.toLowerCase();
      let s = 0;
      if (must.has(name)) s += 100;
      if (words.has(name)) s += 10;
      for (const w of words) {
        if (w === name) continue;
        if (w.startsWith(name) || name.startsWith(w)) s += 4;
        else if (w.length > 3 && (w.includes(name) || name.includes(w))) s += 2;
      }
      const prose = `${c.description ?? ''} ${(c as any).category ?? ''}`.toLowerCase();
      if (prose) {
        let hits = 0;
        for (const w of words) if (prose.includes(w)) hits++;
        s += Math.min(hits, 3);
      }
      s += Math.min(c.props?.length ?? 0, 12) * 0.05;
      return s;
    };

    const ranked = [...components]
      .map(c => ({ c, s: score(c) }))
      .sort((a, b) => b.s - a.s || a.c.name.localeCompare(b.c.name))
      .map(x => x.c);

    // Fill the budget with full entries, in rank order, never fewer than the
    // floor so a terse request still sees a usable set.
    const full: DiscoveredComponent[] = [];
    let spent = 0;
    for (const c of ranked) {
      const cost = this.estimateEntryChars(c);
      if (full.length >= CATALOG_MIN_FULL && spent + cost > budget) break;
      full.push(c);
      spent += cost;
    }
    return { full, docs: full.slice(0, CATALOG_DOC_TIER) };
  }

  /** Rough size of a full entry, for the budget. Props dominate. */
  protected estimateEntryChars(c: DiscoveredComponent): number {
    const props = (c.props ?? []).slice(0, MAX_PROPS_IN_CATALOG).reduce((n, p) => n + String(p).length + 2, 0);
    return 60 + props + (c.description?.length ?? 0);
  }

  /**
   * The relative import path for a component discovered from local source.
   * Null for npm package components. See knowledge/importSpecifier.ts.
   */
  protected getLocalImportPath(
    component: DiscoveredComponent,
    config: StoryUIConfig
  ): string | null {
    return localImportSpecifier(component, config);
  }

  /**
   * Format a single component entry
   */
  protected formatComponentEntry(
    component: DiscoveredComponent,
    config: StoryUIConfig,
    opts: { withDocs?: boolean } = {}
  ): string {
    const importPath = this.getImportPath(component, config);
    const isLocal = !!this.getLocalImportPath(component, config);
    // A default export needs different import syntax, and getting it wrong
    // fails at runtime rather than at build: "does not provide an export named
    // 'Avatar'", with an empty story and no other clue.
    const defaultExport = (component as any).__defaultExport === true;
    const importHow = defaultExport
      ? `import ${component.name} from '${importPath}'  ← DEFAULT export, not a named one`
      : `import from '${importPath}'`;
    const pathUnknown = (component as any).__importPathUnknown === true;
    let entry = `- **${component.name}** (${importHow})${isLocal ? ' — CUSTOM PROJECT COMPONENT, fully allowed; use this exact relative import' : ''}${pathUnknown ? ' — exact module path not declared; only use if you know it' : ''}`;

    if (component.props && component.props.length > 0) {
      // Props are the only signal the model has for what a component can
      // actually do, so surface the ones that decide behavior first. Truncating
      // at an arbitrary 5 routinely cut exactly the props that distinguish an
      // interactive component from a presentational one (active, onChange,
      // leftSection, value), which is the choice we most need it to get right.
      const ranked = rankPropsByRelevance(component.props);
      /**
       * Prop descriptions, for the components the request is about.
       *
       * Extracted at 86–99% coverage and, until now, withheld from every
       * component because the full set costs ~28k tokens. For the top of the
       * ranking a clipped sentence on the first few props is a few hundred
       * chars per component, and it is the only place the model learns what
       * `withBorder` or `kind` actually does.
       */
      const docs: Record<string, string> | undefined = opts.withDocs ? (component as any).__propDocs : undefined;
      let docsAttached = 0;
      const shown = ranked.slice(0, MAX_PROPS_IN_CATALOG).map((p) => {
        if (!docs || docsAttached >= CATALOG_DOCS_PER_COMPONENT) return p;
        const name = String(p).match(/^([A-Za-z_$][\w$]*)/)?.[1];
        const doc = name ? docs[name] : undefined;
        if (!doc) return p;
        docsAttached++;
        const clipped = doc.length > CATALOG_DOC_CHARS ? `${doc.slice(0, CATALOG_DOC_CHARS - 1)}…` : doc;
        return `${p} — ${clipped}`;
      });
      /**
       * Never end the list with a bare invitation to guess.
       *
       * `…9 more` tells the model that nine props exist which it cannot see,
       * which licenses inventing a plausible one. Measured: Astryx's Switch was
       * truncated that way and the model bound state to `isSelected` — React
       * Aria's name, absent from the component — producing a switch pinned off.
       *
       * When the withheld tail contains no handler and no state-shaped prop, say
       * so: the model then knows the interactive contract is fully visible, which
       * is the fact that actually matters. That is computable, not a guess.
       */
      const hidden = ranked.slice(MAX_PROPS_IN_CATALOG);
      const hiddenHasBehaviour = hidden.some(p =>
        /^on[A-Z]/.test(p) || /^(value|checked|selected|toggled|open|expanded|active|disabled)\b/i.test(p));
      const tail = hidden.length === 0
        ? ''
        : hiddenHasBehaviour
          ? `, …${hidden.length} more`
          : `, …${hidden.length} more (styling and layout only — every state prop and handler this component has is listed above)`;
      /**
       * Say when the list is COMPLETE, and only then.
       *
       * A list of props reads as a sample, and a model weighing a sample
       * against a strong memory of a library's earlier major version picks the
       * memory. Measured on Material: 30 first-round validation errors across
       * 11 prompts, 19 of them one prop — `alignItems` on Stack — that the
       * library moved into `sx` and the catalog had correctly stopped listing.
       * Three separate prompt rules failed to move that number; none of them
       * said the list was exhaustive, because nothing knew that it was.
       *
       * The compiler knows: it resolves a definite prop set for a component
       * whose type has no index signature. Claimed only when nothing was
       * withheld from the entry — a truncated list is not a complete one — and
       * only for the components the request is about, where the docs are
       * rendered and the extra clause is affordable.
       */
      const complete = hidden.length === 0 && (component as any).__propsClosed
        ? ' — this is the COMPLETE list; any other prop is rejected before the story is saved, including one you remember from an earlier version of this library'
        : '';
      entry += docs
        ? `\n  Props${complete}:\n    ${shown.join('\n    ')}${tail ? `\n    ${tail.replace(/^, /, '')}` : ''}`
        : `\n  Props${complete}: ${shown.join(', ')}${tail}`;
    }

    // A description that only restates the name — discovery's `Chip component
    // from Material UI` — is a line per component that teaches nothing. Across
    // a 254-component system that is pure context cost.
    if (saysMoreThanName(component.name, component.description)) {
      entry += `\n  ${component.description}`;
    }

    // `extends HTMLAttributes<HTMLElement>`: every standard attribute passes
    // through. One line states it; enumerating them would spend the catalog
    // on what the model already knows.
    if (component.passthroughAttributes) {
      entry += `\n  Also accepts standard attributes (${component.passthroughAttributes})`;
    }

    // Where a compound part belongs, derived from the parent's own example.
    //
    // A design system documents `Alert`, not `AlertTitle`, so 187 of
    // college-town's 247 components have no usage of their own. The one fact
    // that keeps them from being misused is which parent they nest inside —
    // without it a model may render AlertTitle standalone, or invent
    // `Alert.Title`, which is the wrong convention for this library.
    if ((component as any).usedInside) {
      entry += `\n  Used inside <${(component as any).usedInside}>`;
    }

    return entry;
  }

  /**
   * The module a story imports a component from — the project's own answer,
   * shared with every other writer of import lines (knowledge/importSpecifier.ts).
   */
  protected getImportPath(
    component: DiscoveredComponent,
    config: StoryUIConfig
  ): string {
    return importSpecifierFor(component, config);
  }

  /**
   * Convert PascalCase to kebab-case
   */
  protected toKebabCase(str: string): string {
    return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
  }

  /**
   * Get the base component name (for sub-components like CardHeader, returns 'Card')
   */
  protected getBaseComponentName(componentName: string): string {
    // Common sub-component patterns in shadcn/ui and other design systems
    const subComponentPatterns = [
      // Card sub-components
      /^(Card)(Header|Footer|Title|Action|Description|Content)$/,
      // Dialog sub-components
      /^(Dialog)(Close|Content|Description|Footer|Header|Overlay|Portal|Title|Trigger)$/,
      // Alert Dialog sub-components
      /^(AlertDialog)(Portal|Overlay|Trigger|Content|Header|Footer|Title|Description|Action|Cancel)$/,
      // Dropdown Menu sub-components
      /^(DropdownMenu)(Portal|Trigger|Content|Group|Label|Item|CheckboxItem|RadioGroup|RadioItem|Separator|Shortcut|Sub|SubTrigger|SubContent)$/,
      // Context Menu sub-components
      /^(ContextMenu)(Trigger|Content|Item|CheckboxItem|RadioItem|Label|Separator|Shortcut|Group|Portal|Sub|SubContent|SubTrigger|RadioGroup)$/,
      // Navigation Menu sub-components
      /^(NavigationMenu)(List|Item|Content|Trigger|Link|Indicator|Viewport)$/,
      // Select sub-components
      /^(Select)(Content|Group|Item|Label|ScrollDownButton|ScrollUpButton|Separator|Trigger|Value)$/,
      // Menubar sub-components
      /^(Menubar)(Portal|Menu|Trigger|Content|Group|Separator|Label|Item|Shortcut|CheckboxItem|RadioGroup|RadioItem|Sub|SubTrigger|SubContent)$/,
      // Accordion sub-components
      /^(Accordion)(Item|Trigger|Content)$/,
      // Tabs sub-components
      /^(Tabs)(List|Trigger|Content)$/,
      // Sheet sub-components
      /^(Sheet)(Trigger|Close|Content|Header|Footer|Title|Description)$/,
      // Avatar sub-components
      /^(Avatar)(Image|Fallback)$/,
      // Breadcrumb sub-components
      /^(Breadcrumb)(List|Item|Link|Page|Separator|Ellipsis)$/,
      // Command sub-components
      /^(Command)(Dialog|Input|List|Empty|Group|Item|Shortcut|Separator)$/,
      // Hover Card sub-components
      /^(HoverCard)(Trigger|Content)$/,
      // Popover sub-components
      /^(Popover)(Trigger|Content|Anchor)$/,
      // Collapsible sub-components
      /^(Collapsible)(Trigger|Content)$/,
      // Drawer sub-components
      /^(Drawer)(Portal|Overlay|Trigger|Close|Content|Header|Footer|Title|Description)$/,
      // Radio Group sub-components
      /^(RadioGroup)(Item)$/,
      // Toggle Group sub-components
      /^(ToggleGroup)(Item)$/,
      // Tooltip sub-components
      /^(Tooltip)(Trigger|Content|Provider)$/,
      // Table sub-components
      /^(Table)(Header|Body|Footer|Head|Row|Cell|Caption)$/,
      // Input OTP sub-components
      /^(InputOTP)(Group|Slot|Separator)$/,
      // Resizable sub-components
      /^(Resizable)(PanelGroup|Panel|Handle)$/,
      // Scroll Area sub-components
      /^(ScrollArea|ScrollBar)$/,
      // Pagination sub-components
      /^(Pagination)(Content|Link|Item|Previous|Next|Ellipsis)$/,
      // Alert sub-components
      /^(Alert)(Title|Description)$/,
    ];

    for (const pattern of subComponentPatterns) {
      const match = componentName.match(pattern);
      if (match) {
        return match[1]; // Return the base component name
      }
    }

    // No match found, return original name
    return componentName;
  }

  /**
   * Group components by their category
   */
  protected groupComponentsByPackage(
    components: DiscoveredComponent[]
  ): Record<string, DiscoveredComponent[]> {
    const grouped: Record<string, DiscoveredComponent[]> = {};

    for (const component of components) {
      const category = component.category || 'other';
      if (!grouped[category]) {
        grouped[category] = [];
      }
      grouped[category].push(component);
    }

    return grouped;
  }

  /**
   * Generate example stories - framework specific
   */
  abstract generateExamples(config: StoryUIConfig): string;

  /**
   * Generate a sample story template - framework specific
   */
  abstract generateSampleStory(
    config: StoryUIConfig,
    components: DiscoveredComponent[]
  ): string;

  /**
   * Generate import statements for components
   */
  generateImports(
    components: DiscoveredComponent[],
    config: StoryUIConfig
  ): string {
    const importsByPath: Map<string, Set<string>> = new Map();

    for (const component of components) {
      const importPath = this.getImportPath(component, config);
      if (!importsByPath.has(importPath)) {
        importsByPath.set(importPath, new Set());
      }
      importsByPath.get(importPath)!.add(component.name);
    }

    const imports: string[] = [];
    for (const [path, names] of importsByPath) {
      const namedImports = Array.from(names).sort().join(', ');
      imports.push(`import { ${namedImports} } from '${path}';`);
    }

    return imports.join('\n');
  }

  /**
   * Post-process generated story content
   * Removes React imports for non-React frameworks as a safety net
   */
  postProcess(storyContent: string): string {
    let processed = storyContent
      .trim()
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n');

    // For non-React frameworks, remove any React imports that may have been generated
    // This is a safety net in case the LLM generates React imports for non-React frameworks
    if (this.type !== 'react') {
      processed = processed.replace(/import React from ['"]react['"];?\n?/g, '');
      processed = processed.replace(/import \* as React from ['"]react['"];?\n?/g, '');
      processed = processed.replace(/import { React } from ['"]react['"];?\n?/g, '');
      // Clean up any resulting empty lines at the start of the file
      processed = processed.replace(/^\n+/, '');
    }

    return processed;
  }

  /**
   * Validate generated story syntax
   */
  validate(storyContent: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!storyContent || storyContent.trim().length === 0) {
      errors.push('Story content is empty');
    }

    // Check for common issues
    if (!storyContent.includes('export')) {
      errors.push('Story missing exports');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get the story file template - framework specific
   */
  abstract getStoryTemplate(options?: StoryGenerationOptions): string;

  /**
   * Log adapter activity
   */
  protected log(message: string, data?: Record<string, unknown>): void {
    logger.debug(`[${this.name}Adapter] ${message}`, data);
  }

  /**
   * Get common story structure rules including MANDATORY spacing
   */
  protected getCommonRules(options?: StoryGenerationOptions): string {
    return `
GENERAL RULES:
- Follow the component library's design patterns
- Export ONE story (\`Default\`) unless the request asks for variants or states. The
  composition is the deliverable; a second and third story double the output for
  nothing the user asked to see (measured: three stories, 16k tokens, 141s to preview)
- Ensure accessibility by using proper ARIA attributes
- Use realistic placeholder content

INTERACTION FIDELITY (NON-NEGOTIABLE):
These stories are lifted directly into product code by engineers. A mockup that merely
looks right is a defect. Rules are written in terms of AFFORDANCES — map each one to the
component in THIS design system that owns that behavior (see the available components list
and any design-system considerations provided below).

1. NEVER fake an affordance. If a user would click it, type in it, toggle it, or select it,
   it MUST be the real interactive component, with a handler and an accessible name:
   - a search or text entry field -> the library's text input component, NEVER text or a
     box styled to look like an input
   - an icon-only control -> the library's icon-button component wrapping the icon, NEVER a
     bare icon element
   - a dropdown, chevron, overflow or "more" affordance -> the library's menu component with
     its trigger and content sub-components, NEVER a chevron glyph beside a label
   - a navigation item that can be current -> the library's nav/link component with its
     active or selected state, NEVER static text with a color applied
   - a tabbed region -> the library's tabs component, NEVER a row of labels with a border
   - any other clickable surface -> a real button element or the library's unstyled-button
     primitive, NEVER a div or box with an onClick

2. Decorative icons are fine. An icon is EITHER decorative, OR the leading/trailing slot of a
   real control, OR the child of an icon-button. It is never interactive on its own.

3. Icons must be aligned by the owning component. Use the component's built-in icon/section
   slot when one exists; otherwise use the library's inline flex primitive. Never place an
   icon as a bare child of a block-level element — it will sit on the text baseline and
   drift out of alignment.

4. State must be real and driven. When a composition renders several items and one is
   current/selected/open, drive it from a variable (component state), not a hardcoded
   literal, and wire the handler that changes it. Single-component variant stories that
   demonstrate one state in isolation should use story args instead.

   BIND THE STATE TO THE PROP THE CATALOG NAMES, spelled exactly as listed — not to the
   prop name you expect. A control's state prop and its change handler are ONE contract:
   if you write the handler, you must also write the state prop listed beside it in the
   catalog above. These names differ per design system — value / checked / toggled /
   isChecked, paired with onChange / onToggle / onCheckedChange — and there is no shared
   convention to fall back on. A plausible substitute is not ignored loudly: it lands in
   the component's rest props, the control stays pinned to its default, and it renders
   perfectly while being impossible to operate. If a state prop is marked REQUIRED, it is
   not optional even when the component appears to work without it.

5. Before emitting, self-check every element: is anything that looks interactive actually
   inert? is any icon unaligned or standing in for a button? is any hover/active appearance
   being faked with a static style? Fix all three before you output.

${formatImageRules(options?.icons, this.type === 'react' ? 'jsx' : 'html')}

SPACING & LAYOUT:

** SCOPE LIMIT — READ BEFORE COPYING THE EXAMPLES BELOW **
The inline style objects shown in this section are for STATIC LAYOUT SPACING ONLY.
An inline style object cannot express :hover, :focus-visible, :active, [data-active],
[aria-current] or any other state — it is structurally incapable of it.
Therefore: any element whose appearance CHANGES on hover, focus, selection, or because it
is the current item MUST get that appearance from the design system itself:
  1. a component prop that owns the state (active, selected, variant, color, disabled), or
  2. the component's documented state mechanism (data attributes, styles API, CSS variables).
If you cannot express a state with a prop, you have chosen the wrong component — pick the
component that owns that behavior. NEVER hand-roll a hover or active state inline, and never
substitute a styled static element for a component that already has the state built in.

** WHEN A COMPONENT PROP GENUINELY CANNOT EXPRESS THE STATE **
You may emit ONE additional fenced \`css\` code block after the story. Write it as a CSS
module and import it in the story with exactly this specifier:

    import classes from './styles.module.css';

(the import is rewritten to the real filename when the story is saved — always write
'./styles.module.css' verbatim). Use it for :hover, :focus-visible, :active,
[data-active] and media queries, and apply it through the design system's own
className/classNames prop.

Only do this when a prop truly cannot express the state. A component prop is always the
better answer, and a stylesheet that merely restates what a prop already does is worse
than not writing one. Reference design-system tokens/CSS variables inside it rather than
hardcoded colors, so the result still inherits theming and dark mode.

${formatSpacingRules(options?.spacing, this.type === 'react' ? 'jsx' : 'html', {
  wrapper: this.getSpacingExample('wrapper'),
  formGap: this.getSpacingExample('formGap'),
  buttonMargin: this.getSpacingExample('buttonMargin'),
})}
`;
  }

  /**
   * Framework-appropriate syntax for the FALLBACK spacing examples — used only
   * when the design system declares no gap primitive, no spacing tokens and no
   * utility scale (see knowledge/spacingFacts.ts). JSX style objects only make
   * sense for React; the other frameworks get examples in their own template
   * syntax.
   */
  protected getSpacingExample(kind: 'wrapper' | 'formGap' | 'buttonMargin'): string {
    switch (this.type) {
      case 'vue':
        return {
          wrapper: `template: '<div style="padding: 24px">...content...</div>'`,
          formGap: `<div style="display: flex; flex-direction: column; gap: 16px">`,
          buttonMargin: `<div style="margin-top: 24px"><v-btn>Submit</v-btn></div>`,
        }[kind];
      case 'angular':
        return {
          wrapper: `template: \`<div style="padding: 24px">...content...</div>\``,
          formGap: `<div style="display: flex; flex-direction: column; gap: 16px">`,
          buttonMargin: `<div style="margin-top: 24px"><button mat-raised-button>Submit</button></div>`,
        }[kind];
      case 'svelte':
        return {
          wrapper: `<Story name="..."><div style="padding: 24px">...content...</div></Story>`,
          formGap: `<div style="display: flex; flex-direction: column; gap: 16px">`,
          buttonMargin: `<div style="margin-top: 24px"><Button>Submit</Button></div>`,
        }[kind];
      case 'web-components':
        return {
          wrapper: 'render: () => html`<div style="padding: 24px">...content...</div>`',
          formGap: `<div style="display: flex; flex-direction: column; gap: 16px">`,
          buttonMargin: `<div style="margin-top: 24px"><sl-button>Submit</sl-button></div>`,
        }[kind];
      default: // react
        return {
          wrapper: `render: () => <div style={{ padding: "24px" }}>...content...</div>`,
          formGap: `<div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>`,
          buttonMargin: `<div style={{ marginTop: "24px" }}><Button>Submit</Button></div>`,
        }[kind];
    }
  }
}
