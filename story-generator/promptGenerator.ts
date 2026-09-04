import { StoryUIConfig } from '../story-ui.config.js';
import { DiscoveredComponent } from './componentDiscovery.js';
import { loadConsiderations, considerationsToPrompt } from './considerationsLoader.js';
import { deriveIconVocabulary, formatIconRules } from './knowledge/iconFacts.js';
import { DocumentationLoader } from './documentationLoader.js';
import {
  getAdapterRegistry,
  FrameworkPrompt,
  StoryGenerationOptions,
  FrameworkType,
  FrameworkAdapter,
} from './framework-adapters/index.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Icon package information for smart detection
 */
/**
 * Icon instructions, derived from the project.
 *
 * Replaces a hard-coded list of four icon packages (which could not know that
 * `@carbon/icons-react` ships with `@carbon/react`, or that a local
 * `src/icons` module exists) and advice to "use Unicode symbols" when none of
 * the four was installed — the advice that produced ⋯ × ✓ as icons in six MUI
 * stories. See knowledge/iconFacts.ts.
 */
function generateIconInstructions(components: DiscoveredComponent[], config?: StoryUIConfig, options?: StoryGenerationOptions): string[] {
  const vocab = options?.icons ?? deriveIconVocabulary({
    projectRoot: process.cwd(),
    importPath: config?.importPath,
    configuredPackage: config?.iconImports?.package,
    components: components as any[],
  });
  return formatIconRules(vocab, options?.framework && options.framework !== 'react' ? 'html' : 'jsx');
}

/**
 * Extended prompt interface that includes framework information
 * Uses string[] for layoutInstructions instead of string
 */
export interface FrameworkAwarePrompt extends Omit<FrameworkPrompt, 'layoutInstructions'> {
  layoutInstructions: string[];
}


/**
 * Generates layout-specific instructions including MANDATORY vertical spacing rules
 * @param config - The StoryUI configuration object
 * @returns Array of layout instruction strings to be included in the prompt
 */
export function generateLayoutInstructions(config: StoryUIConfig, options?: StoryGenerationOptions): string[] {
  const instructions: string[] = [];
  const layoutRules = config.layoutRules;

  /**
   * When the design system states its own spacing mechanism, the adapter's
   * common rules carry it (knowledge/spacingFacts.ts) and the pixel doctrine
   * below is withheld: it taught `gap: "16px"` and `marginTop: "24px"` to
   * Carbon, Mantine and Tailwind projects alike, and the model copied it over
   * the `Stack.gap` sitting in its own catalog.
   */
  const derived = options?.spacing?.hasScale === true;
  if (derived) {
    instructions.push('SPACING: follow the "MANDATORY SPACING & LAYOUT RULES — DERIVED FROM THIS DESIGN SYSTEM" section. No inline pixel/rem margins, paddings or gaps.');
    instructions.push('');
  }

  // MANDATORY VERTICAL SPACING RULES - These are non-negotiable for professional UI quality
  if (!derived) {
  instructions.push('MANDATORY VERTICAL SPACING RULES (NON-NEGOTIABLE):');
  instructions.push('');
  instructions.push('** CRITICAL: Every component MUST have proper vertical spacing. Components without spacing look broken and unprofessional. **');
  instructions.push('');
  instructions.push('1. FORM FIELDS: Always wrap form fields in a container with vertical spacing:');
  instructions.push('   - Use flexbox column with gap: <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>');
  instructions.push('   - Or use your design system\'s spacing tokens if available');
  instructions.push('   - MINIMUM 16px gap between form fields, 24px for complex forms');
  instructions.push('');
  instructions.push('2. BUTTON SPACING: Buttons MUST have margin-top from content above:');
  instructions.push('   - Submit/action buttons: 24px margin-top from form fields');
  instructions.push('   - Button groups: wrap in <div style={{ marginTop: "24px" }}>');
  instructions.push('');
  instructions.push('3. SECTION SPACING: Logical sections need clear visual separation:');
  instructions.push('   - Between major sections: 32-48px');
  instructions.push('   - Between related content groups: 24px');
  instructions.push('   - Use dividers or significant whitespace between unrelated content');
  instructions.push('');
  instructions.push('4. HEADING SPACING: Headings need asymmetric spacing:');
  instructions.push('   - More space ABOVE headings (24-32px) than below (8-16px)');
  instructions.push('   - This creates visual hierarchy and groups content with its heading');
  instructions.push('');
  instructions.push('5. CARD/CONTAINER PADDING: Internal padding is mandatory:');
  instructions.push('   - Minimum 16px padding on all sides');
  instructions.push('   - Preferred 24px for cards with multiple elements');
  instructions.push('   - Use design system spacing tokens when available');
  instructions.push('');
  instructions.push('6. WRAPPER PATTERN (REQUIRED): The story render function MUST return a wrapper div with padding:');
  instructions.push('   - render: () => <div style={{ padding: "24px" }}>...content...</div>');
  instructions.push('   - This ensures content has breathing room within the Storybook canvas');
  instructions.push('');
  }

  // The config's wrapper/column names are stated only when the catalog
  // confirms they exist; a config naming `Grid` where no Grid is exported
  // (Sail Shelf) would otherwise instruct the model to import a phantom.
  const columns = options?.spacing?.columns;
  if (derived) {
    if (columns?.column) {
      instructions.push('MULTI-COLUMN LAYOUT RULES:');
      instructions.push(`- For ANY multi-column layout (2, 3, or more columns), use ${columns.wrapper} with each column in its own ${columns.column}`);
      instructions.push(`- Structure: <${columns.wrapper}><${columns.column}>column 1</${columns.column}><${columns.column}>column 2</${columns.column}></${columns.wrapper}>`);
      instructions.push(`- NEVER use CSS properties as props (like display="grid" or gridTemplateColumns) - these are not valid props`);
      instructions.push('');
    }
  } else if (layoutRules.multiColumnWrapper && layoutRules.columnComponent) {
    instructions.push('MULTI-COLUMN LAYOUT RULES:');
    instructions.push(`- For ANY multi-column layout (2, 3, or more columns), use ${layoutRules.multiColumnWrapper} components`);
    instructions.push(`- Each column must be wrapped in its own ${layoutRules.columnComponent} element`);
    instructions.push(`- Structure: <${layoutRules.multiColumnWrapper}><${layoutRules.columnComponent}>column 1</${layoutRules.columnComponent}><${layoutRules.columnComponent}>column 2</${layoutRules.columnComponent}></${layoutRules.multiColumnWrapper}>`);
    instructions.push(`- Use component library styling approach (className, style props, or design tokens as appropriate)`);
    instructions.push(`- NEVER use CSS properties as props (like display="grid" or gridTemplateColumns) - these are not valid props`);
    instructions.push(`- For grid-like layouts, use Flex with wrap prop and appropriate gap, NOT CSS Grid`);
    instructions.push(`- The ${layoutRules.multiColumnWrapper} should be the main component in your story for multi-column layouts`);
    instructions.push('');
  }

  if (layoutRules.prohibitedElements && layoutRules.prohibitedElements.length > 0) {
    instructions.push(`- NEVER use plain HTML ${layoutRules.prohibitedElements.join(', ')} elements - ALWAYS use the provided design system components`);
  }

  // Generic layout instructions for all design systems
  instructions.push('GENERAL LAYOUT BEST PRACTICES:');
  instructions.push(`- Use semantic heading components from your design system instead of raw <h1>-<h6> tags`);
  instructions.push(`- Use the design system's layout components and spacing tokens instead of inline styles when available`);
  instructions.push(`- Prefer design system components over plain HTML elements for consistent styling`);
  if (!derived) instructions.push(`- ALWAYS test mentally: "Does this component have enough visual breathing room?" If not, add spacing.`);

  return instructions;
}

/**
 * Generates a framework-aware prompt using the adapter system
 * This is the new multi-framework entry point
 */
export async function generateFrameworkAwarePrompt(
  config: StoryUIConfig,
  components: DiscoveredComponent[],
  options?: StoryGenerationOptions
): Promise<FrameworkAwarePrompt> {
  const registry = getAdapterRegistry();

  // Get the appropriate adapter (auto-detect or use specified framework)
  let adapter: FrameworkAdapter;
  if (options?.framework) {
    adapter = registry.getAdapter(options.framework);
  } else {
    adapter = await registry.autoDetect(process.cwd());
  }

  // Generate framework-specific prompt components
  const frameworkPrompt = await registry.generatePrompt(config, components, options);

  // Generate layout instructions (framework-agnostic)
  const layoutInstructions = generateLayoutInstructions(config, options);

  return {
    ...frameworkPrompt,
    layoutInstructions,
  };
}

/**
 * Builds a complete LLM prompt with framework awareness
 * This is the new multi-framework entry point for building complete prompts
 */
export async function buildFrameworkAwarePrompt(
  userPrompt: string,
  config: StoryUIConfig,
  components: DiscoveredComponent[],
  options?: StoryGenerationOptions
): Promise<string> {
  const generated = await generateFrameworkAwarePrompt(config, components, options);

  const promptParts = [
    generated.systemPrompt,
    '',
  ];

  // Load documentation - try new directory-based approach first
  const projectRoot = config.considerationsPath ?
    config.considerationsPath.replace(/\/story-ui-considerations\.(md|json)$/, '') :
    process.cwd();

  // Project documentation and considerations are the design system's OWN
  // rules — both sources load when present (they serve different purposes:
  // story-ui-docs/ holds reference docs, story-ui-considerations.md holds
  // generation rules), and both are marked authoritative for the model.
  const docLoader = new DocumentationLoader(projectRoot);
  let documentationAdded = false;
  let considerationsAdded = false;

  if (docLoader.hasDocumentation()) {
    const docs = await docLoader.loadDocumentation();
    if (docs.sources.length > 0) {
      const docPrompt = docLoader.formatForPrompt(docs);
      if (docPrompt) {
        promptParts.push('═══ PROJECT DOCUMENTATION (authoritative — follow these over general conventions) ═══');
        promptParts.push(docPrompt);
        promptParts.push('');
        documentationAdded = true;
      }
    }
  }

  // Considerations (the project's generation RULES) are injected LATE in the
  // prompt — see below, right before the <rules> block — because instructions
  // near the end of a long prompt are followed far more reliably than ones
  // buried early. Load them here so the log line reports both sources together.
  const considerations = loadConsiderations(config.considerationsPath);
  const considerationsPrompt = considerations ? considerationsToPrompt(considerations) : '';
  considerationsAdded = !!considerationsPrompt;

  console.log(`[Story UI] Prompt context: story-ui-docs ${documentationAdded ? 'loaded' : 'not found'}, considerations file ${considerationsAdded ? 'loaded' : 'not found'}`);

  promptParts.push(
    ...generated.layoutInstructions,
    '',
    'Available components:',
    generated.componentReference,
    '',
    generated.examples,
  );

  // Add additional imports information if configured
  if (config.additionalImports && config.additionalImports.length > 0) {
    promptParts.push('');
    promptParts.push('ADDITIONAL IMPORT EXAMPLES - COPY THESE EXACTLY:');
    config.additionalImports.forEach(additionalImport => {
      const componentExamples = additionalImport.components.map(componentName => {
        let componentConfig = config.components?.find(c => c.name === componentName);
        if (!componentConfig) {
          componentConfig = config.layoutComponents?.find(c => c.name === componentName);
        }

        if (componentConfig && (componentConfig as any).importType === 'default') {
          return `import ${componentName} from '${additionalImport.path}';`;
        } else {
          return `import { ${componentName} } from '${additionalImport.path}';`;
        }
      });

      componentExamples.forEach(example => {
        promptParts.push(`- ${example}`);
      });
    });
  }

  // Smart icon handling - detect installed icon packages or fall back to design system icons
  const iconInstructions2 = generateIconInstructions(components, config, options);
  promptParts.push(...iconInstructions2);

  // Add framework-specific rules
  const frameworkType = generated.framework.componentFramework;
  const frameworkRules = getFrameworkSpecificRules(frameworkType);
  if (frameworkRules.length > 0) {
    promptParts.push('');
    promptParts.push(`${frameworkType.toUpperCase()} SPECIFIC RULES:`);
    promptParts.push(...frameworkRules);
  }

  // Add import style specific rules for framework-aware prompts
  const importStyleRulesFramework: string[] = [];
  if (config.importStyle === 'individual') {
    importStyleRulesFramework.push(
      `- 🚫 INDIVIDUAL IMPORTS REQUIRED: Import each component from its own file (e.g., '${config.importPath}/button', NOT '${config.importPath}')`,
      // No path FORMULA here. The catalog lists each component's exact import
      // path, read from the project; a rule like "AlertDialog → alert-dialog"
      // invented paths that do not exist for every library that does not
      // kebab-case its files.
      '- The Available components catalog states the exact import path for each component — use it verbatim',
      '- A component with no import path listed in the catalog must not be imported at all'
    );
  }

  // Project rules land here — late in the prompt, adjacent to the final
  // instructions — where the model follows them most reliably.
  if (considerationsPrompt) {
    promptParts.push(
      '',
      '═══ AI CONSIDERATIONS (rules for how YOU must use this design system — these OVERRIDE any conflicting general guidance above) ═══',
      considerationsPrompt,
    );
  }

  promptParts.push(
    '',
    `Output a complete Storybook story file in TypeScript. Import components as shown in the sample template below. Use the following sample as a template.`,
    `Begin your reply with two to four plain sentences, addressed to the user, saying what you are about to build and which components from the list you will use and why — no headings, no lists, no code in them. This text is shown to the user while the code streams. Then output ONE code block containing the full file, and nothing after the block.`,
    '',
    '<rules>',
    'CRITICAL REMINDERS:',
    ...importStyleRulesFramework,
    '- FOLLOW the DESIGN SYSTEM DOCUMENTATION (what the system is) and AI CONSIDERATIONS (how you must use it) sections — they define this design system\'s required patterns and override generic guidance',
    '- Story title MUST always start with "Generated/" (e.g., title: "Generated/Recipe Card")',
    '- ONLY import components that are listed in the "Available components" section',
    '- NEVER import any other npm package (no Tailwind, no other UI kits, no utility libraries) — imports outside the component library are rejected by validation unless the AI CONSIDERATIONS file explicitly permits them',
    '- CUSTOM PROJECT COMPONENTS listed in the component reference ARE allowed — import them from the exact relative path shown next to each one',
    '- ALWAYS use the exact import path shown in parentheses after each component',
    '- NEVER use main package imports when specific subpath imports are shown',
    '- Do NOT import story exports - these are NOT real components',
    '- All images MUST have a src attribute with placeholder URLs (use https://picsum.photos/)',
    '- MUST use ES modules syntax: "export default meta;" NOT "module.exports = meta;"',
    '- The file MUST have a default export for the meta object',
    // Previously: "Keep the story concise and focused - avoid overly complex
    // layouts". That rule sat in the highest-adherence position in the prompt and
    // rewarded stopping at the visual shape — a real nav bar with state, menus and
    // a search field IS the "complex layout" it forbade. Measured result: stories
    // with zero inputs, zero links and no interactive states.
    '- The story MUST be operable, not a mockup: anything a user would click, type into, toggle or select MUST be the real interactive component from the design system, with real state and real handlers',
    '- NEVER render a visual stand-in for an interactive element (no text styled to look like an input, no bare icon standing in for a button, no static row standing in for tabs or a menu)',
    // "Prefer completeness of behavior over brevity" sat here, and it was
    // read as licence to build MORE: a request for a navigation bar came back
    // as a 327-line page with a hero and a feature grid. Measured across four
    // design systems, invented scope was the single largest preventable
    // defect class (41 findings, all four libraries) — instructed by this
    // prompt, not invented by the model.
    //
    // Completeness and scope are different axes. The rule above already
    // demands operability; this one bounds what is built, so the two cannot
    // be confused.
    '- Completeness means BEHAVIOUR, not scope: what the story does include must be fully operable, with real state and handlers. It does not mean adding more.',
    // Measured with bench/firstAttempt.mjs on Carbon: EVERY first-round
    // validation failure was a prop the library does not declare
    // (`ariaLabel` where it takes `aria-label`, `label` on a row that takes
    // none) or a value outside a prop's union. The catalog already lists the
    // props; what it never said is that anything else is rejected, so the
    // model had no reason not to guess. A retry costs a full model call.
    '- Use only the props this catalog lists for a component. A prop the component does not declare is REJECTED before the story is saved and the whole generation is retried — so do not invent one, do not guess a camelCase spelling of an HTML attribute (`aria-label` is written exactly that way, never `ariaLabel`), and do not carry a prop over from a different library. If the prop you want is not listed, use one that is, or leave it out.',
    '- The same applies to a prop\'s VALUE: when the catalog shows a prop\'s accepted values, use one of them exactly. A value outside that set is rejected the same way.',
    '- Build what was asked for, and what that plainly requires — nothing else. A request for a navigation bar is a navigation bar, not a page built around one. Do not add regions, panels or features the request did not ask for (a search field, a filter bar, a notification centre, an activity feed, a toast system). When a request is broad ("a dashboard"), build the parts it names or plainly implies and make those excellent, rather than adding others to look thorough.',
    // Verification blocks on this and the prompt never mentioned it, so the
    // model was being failed for a rule it was never given. Measured on one
    // loan-calculator generation: 7 blockers, 5 of them icon-only controls
    // with no accessible name. A reviewer rejects that PR outright, which is
    // the difference between a story that renders and one that ships.
    '- EVERY control whose visible content is only an icon MUST carry an accessible name — `aria-label` on the control, or the design system\'s equivalent prop. This applies to icon buttons, close buttons, sort toggles, overflow menus and icon-only tabs',
    '- Every input, select, slider, switch and checkbox MUST have a programmatically associated label — a real <label>/`htmlFor` pair, the design system\'s `label` prop, or `aria-label` when the design genuinely has no visible label',
    '- Decorative icons that sit beside their own text label are the exception: mark those `aria-hidden="true"` so they are not announced twice',
    // Observed: a Timeline whose `active` prop painted every bullet solid blue,
    // with a "light"-variant icon wrapper inside. The wrapper's 10%-alpha
    // background never covered the blue, and its foreground colour was tuned for
    // a plain surface — so teal and indigo icons sat on blue and vanished. The
    // code read as correct in isolation; only the composition was wrong.
    '- When a parent component paints its own background (a timeline bullet, a selected tab, a filled avatar, a status chip), any icon or text placed inside it MUST be given an explicitly contrasting colour. Do NOT nest a "light"/"subtle"/"outline" variant inside a filled parent: its translucent background will not cover the parent fill, and its foreground colour is chosen for a plain surface, so the content becomes invisible',
    '- Ensure all tags are properly closed and syntax is valid',
    '- Story must be complete and syntactically valid',
    '</rules>',
    '',
    'Sample story format:',
    generated.sampleStory,
    '',
    'User request:',
    userPrompt
  );

  return promptParts.join('\n');
}

/**
 * Get framework-specific rules to include in the prompt
 */
function getFrameworkSpecificRules(framework: FrameworkType): string[] {
  const rules: string[] = [];

  switch (framework) {
    case 'react':
      rules.push("- FIRST LINE MUST BE: import React from 'react';");
      rules.push('- Use JSX syntax for templates');
      rules.push('- NEVER pass children through args - use render functions');
      rules.push('- For layouts with multiple components, DO NOT set component in meta');
      rules.push('- 🚫 NEVER use Angular Material (MatCardModule, MatButtonModule, etc.)');
      rules.push('- 🚫 NEVER use Vue components (VCard, VBtn, etc.)');
      rules.push('- ✅ ONLY use React components from the configured import path');
      break;

    case 'vue':
      rules.push("- Import from '@storybook/vue3'");
      rules.push('- Use Vue 3 Composition API style');
      rules.push('- Use render functions with template for complex content');
      rules.push('- Event bindings use @event or v-on:event syntax');
      rules.push('- Slots use v-slot directive or # shorthand');
      rules.push("- 🚫 NEVER import React from 'react' - this is Vue, NOT React!");
      rules.push('- 🚫 NEVER use Angular Material (MatCardModule, MatButtonModule, etc.)');
      rules.push('- 🚫 NEVER use @angular/material or moduleMetadata');
      rules.push('- ✅ ONLY use Vue components from the configured import path');
      rules.push('- ✅ Use KEBAB-CASE in templates: <v-btn>, <v-card>, NOT <VBtn>, <VCard>');
      rules.push('- ✅ Vuetify components: v-btn, v-card, v-text-field, v-row, v-col, etc.');
      rules.push('- ✅ Import with PascalCase: import { VBtn } from "vuetify/components"');
      rules.push('- ✅ Use kebab-case in template: <v-btn v-bind="args">Click</v-btn>');
      break;

    case 'angular':
      rules.push("- Import from '@storybook/angular'");
      rules.push('- Use moduleMetadata or applicationConfig decorators');
      rules.push('- Property binding: [property]="value"');
      rules.push('- Event binding: (event)="handler($event)"');
      rules.push('- Use Angular template syntax in render functions');
      rules.push("- 🚫 NEVER import React from 'react' - this is Angular, NOT React!");
      rules.push('- 🚫 NEVER use Vue components (VCard, VBtn, etc.)');
      rules.push('- ✅ ONLY use Angular Material or configured library components');
      break;

    case 'svelte':
      rules.push("- Import from '@storybook/svelte'");
      rules.push('- Import .svelte files directly as default exports');
      rules.push('- Svelte 5 events use lowercase: onclick, onchange (NOT on:click which is Svelte 4)');
      rules.push('- Use bind: for two-way binding');
      rules.push("- 🚫 NEVER import React from 'react' - this is Svelte, NOT React!");
      rules.push('- 🚫 NEVER use Angular Material or Vue components');
      rules.push('- ✅ ONLY use Svelte components from the configured import path');
      break;

    case 'web-components':
      rules.push("- Import { html } from 'lit'");
      rules.push("- Import from '@storybook/web-components'");
      rules.push('- Use html`` template literal, NOT JSX');
      rules.push('- Use kebab-case for tag names (e.g., <my-button>)');
      rules.push('- Property binding: .property=${value}');
      rules.push('- Event binding: @event=${handler}');
      rules.push('- Boolean attributes: ?disabled=${true}');
      rules.push("- 🚫 NEVER import React from 'react' - this is Web Components, NOT React!");
      rules.push('- 🚫 NEVER use JSX syntax - use html`` template literals only');
      rules.push('- ✅ ONLY use Web Components from the configured import path');
      break;

    default:
      break;
  }

  return rules;
}

/**
 * Detect the framework for a given project
 */
export async function detectProjectFramework(projectRoot?: string): Promise<FrameworkType> {
  const registry = getAdapterRegistry();
  const adapter = await registry.autoDetect(projectRoot || process.cwd());
  return adapter.type;
}

/**
 * Get the adapter for a specific framework
 */
export function getFrameworkAdapter(framework: FrameworkType): FrameworkAdapter {
  const registry = getAdapterRegistry();
  return registry.getAdapter(framework);
}

/**
 * Get all available framework adapters
 */
export function getAvailableFrameworks(): FrameworkType[] {
  const registry = getAdapterRegistry();
  return registry.getAvailableFrameworks();
}
