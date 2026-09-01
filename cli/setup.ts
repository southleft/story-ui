import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { autoDetectDesignSystem } from '../story-generator/configLoader.js';
import { deriveHostContract, type HostContract } from '../story-generator/knowledge/hostContract.js';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import net from 'net';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Get the Story UI package version for version tracking
 */
function getStoryUIVersion(): string {
  try {
    // Walk up from wherever this file was compiled to (cli/ in source,
    // dist/cli/ in a build) until the package's own manifest is found. The
    // old `__dirname/..` resolved to dist/package.json, which does not exist
    // in a clean build and was stale when it did.
    let dir = __dirname;
    for (let i = 0; i < 4; i++) {
      const candidate = path.join(dir, 'package.json');
      if (fs.existsSync(candidate)) {
        const pkg = JSON.parse(fs.readFileSync(candidate, 'utf-8'));
        if (pkg.name === '@tpitre/story-ui') return pkg.version || 'unknown';
      }
      dir = path.dirname(dir);
    }
    const packageJsonPath = path.join(path.resolve(__dirname, '..', '..'), 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      return packageJson.version || 'unknown';
    }
  } catch (error) {
    // Fallback
  }
  return 'unknown';
}

// FIRST_EDIT: helper functions to check for free ports
async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', () => {
        tester.close();
        resolve(true);
      })
      .listen(port);
  });
}

async function findAvailablePort(startPort: number): Promise<number> {
  let port = startPort;
  // eslint-disable-next-line no-await-in-loop
  while (!(await isPortAvailable(port))) {
    port += 1;
  }
  return port;
}

/**
 * Storybook's scaffold files all carry its name: `storybook-button` class
 * names in the components and CSS, `storybook.js.org` links in the stories and
 * MDX. A file that does not mention Storybook is not its scaffold.
 */
export function isStorybookScaffold(content: string): boolean {
  return /storybook/i.test(content);
}

/**
 * Remove Storybook's own scaffold components, which otherwise show up in
 * component discovery. Never removes a file it cannot prove is the scaffold.
 */
export function cleanupDefaultStorybookComponents() {
  const possibleDirs = [
    path.join(process.cwd(), 'src', 'stories'),
    path.join(process.cwd(), 'stories'),
    path.join(process.cwd(), '.storybook', 'stories')
  ];
  
  // Comprehensive list of default Storybook files that cause conflicts
  const defaultFiles = [
    // Component files
    'Button.stories.ts', 'Button.stories.tsx', 'Button.stories.js', 'Button.stories.jsx',
    'Header.stories.ts', 'Header.stories.tsx', 'Header.stories.js', 'Header.stories.jsx', 
    'Page.stories.ts', 'Page.stories.tsx', 'Page.stories.js', 'Page.stories.jsx',
    'Introduction.stories.ts', 'Introduction.stories.tsx', 'Introduction.stories.js', 'Introduction.stories.jsx',
    'Configure.stories.ts', 'Configure.stories.tsx', 'Configure.stories.js', 'Configure.stories.jsx',
    // Component implementation files
    'Button.tsx', 'Button.ts', 'Button.jsx', 'Button.js',
    'Header.tsx', 'Header.ts', 'Header.jsx', 'Header.js',
    'Page.tsx', 'Page.ts', 'Page.jsx', 'Page.js',
    // CSS files
    'button.css', 'header.css', 'page.css', 'introduction.css',
    // MDX files
    'Introduction.stories.mdx', 'Configure.stories.mdx'
  ];

  let cleanedFiles = 0;
  const kept: string[] = [];

  for (const storiesDir of possibleDirs) {
    if (!fs.existsSync(storiesDir)) continue;

    for (const fileName of defaultFiles) {
      const filePath = path.join(storiesDir, fileName);
      if (!fs.existsSync(filePath)) continue;
      // Only Storybook's own scaffold goes. A project's own Button.tsx that
      // happens to share the name is the user's code and stays.
      let content = '';
      try { content = fs.readFileSync(filePath, 'utf-8'); } catch { kept.push(filePath); continue; }
      if (!isStorybookScaffold(content)) { kept.push(filePath); continue; }
      try {
        fs.unlinkSync(filePath);
        cleanedFiles++;
      } catch (error) {
        console.warn(`Could not remove ${fileName}: ${error}`);
      }
    }
  }

  if (cleanedFiles > 0) {
    console.log(chalk.green(`✅ Removed ${cleanedFiles} Storybook scaffold file(s) so they do not appear in component discovery`));
  }
  if (kept.length > 0) {
    console.log(chalk.yellow(`ℹ️  Left ${kept.length} file(s) that share a scaffold name but are not Storybook's scaffold:`));
    for (const f of kept) console.log(chalk.yellow(`   ${path.relative(process.cwd(), f)}`));
  }
}


/**
 * Wire the Story UI manager addon (the "Edit in Story UI" toolbar button on
 * generated stories) into .storybook/manager.ts(x). Creates the file when
 * missing, prepends the import when the file exists without it.
 *
 * Skipped on Storybook <9 — the addon imports 'storybook/manager-api', which
 * only exists in the consolidated 9+ package, and a broken import would take
 * down the whole manager UI.
 */
export function ensureManagerAddonWiring(storyUITargetDir: string): void {
  const storybookDir = path.join(process.cwd(), '.storybook');
  if (!fs.existsSync(storybookDir)) return;

  let sbMajor = 0;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const version = deps['storybook']
      || Object.entries(deps).find(([name]) => name.startsWith('@storybook/'))?.[1]
      || '';
    sbMajor = parseInt(String(version).replace(/^[^\d]*/, ''), 10) || 0;
  } catch { /* unknown version — treat as unsupported */ }
  if (sbMajor < 9) {
    console.log(chalk.gray('   Skipping "Edit in Story UI" toolbar button (requires Storybook 9+)'));
    return;
  }

  let relImport = path
    .relative(storybookDir, path.join(path.resolve(storyUITargetDir), 'manager'))
    .split(path.sep)
    .join('/');
  if (!relImport.startsWith('.')) relImport = './' + relImport;
  const importLine = `import '${relImport}';`;

  const existing = ['manager.tsx', 'manager.ts', 'manager.js']
    .map(f => path.join(storybookDir, f))
    .find(p => fs.existsSync(p));

  if (existing) {
    const content = fs.readFileSync(existing, 'utf-8');
    if (content.includes('StoryUI/manager')) return; // already wired
    fs.writeFileSync(existing, `${importLine}\n${content}`);
    console.log(chalk.green(`✅ Added the "Edit in Story UI" toolbar button to .storybook/${path.basename(existing)}`));
  } else {
    fs.writeFileSync(
      path.join(storybookDir, 'manager.ts'),
      `// Storybook manager customizations\n${importLine}\n`
    );
    console.log(chalk.green('✅ Created .storybook/manager.ts with the "Edit in Story UI" toolbar button'));
  }
}

/**
 * Ask whether `.mdx` is actually covered, not whether a substring appears.
 *
 * The V2 workspace is an MDX docs page — that is how it stays React in a
 * Vue, Angular or Svelte project. A `stories` glob that ends in
 * `.stories.tsx` satisfies a `src/stories` substring check while matching
 * no `.mdx` at all, so the workspace installs correctly and never appears
 * in the sidebar. Observed on a Carbon project, where the panel was
 * silently absent until the glob was widened by hand.
 */
export function storiesGlobCoversMdx(mainContent: string): boolean {
  return mainContent.includes('.mdx') || mainContent.includes('mdx|');
}

export interface StoriesGlobResult {
  /** false when no .storybook/main.ts or main.js exists — coverage is UNKNOWN, not fine */
  checked: boolean;
  /** the stories globs reach .mdx under the stories dir (after any addition) */
  covered: boolean;
  /** the glob that was appended, when one was */
  added: string | null;
}

/**
 * Ensure Storybook's `stories` globs reach the MDX workspace under storiesDir,
 * appending a derived glob when they do not. The glob is computed from the
 * ACTUAL stories directory relative to `.storybook` — a hardcoded
 * `../src/stories` left any project with a custom generatedStoriesPath
 * uncovered. Shared by init and update so the two cannot drift.
 */
export function ensureStoriesGlobCoversMdx(storiesDir: string, cwd: string = process.cwd()): StoriesGlobResult {
  const storybookDir = path.join(cwd, '.storybook');
  const mainPath = ['main.ts', 'main.js']
    .map(f => path.join(storybookDir, f))
    .find(p => fs.existsSync(p));
  if (!mainPath) return { checked: false, covered: false, added: null };

  let mainContent = fs.readFileSync(mainPath, 'utf-8');
  const relStoriesDir = path
    .relative(storybookDir, path.resolve(cwd, storiesDir))
    .split(path.sep)
    .join('/');
  if (mainContent.includes(`${relStoriesDir}/**/*`) && storiesGlobCoversMdx(mainContent)) {
    return { checked: true, covered: true, added: null };
  }

  const storyUIStoriesPath = `'${relStoriesDir}/**/*.@(mdx|stories.@(js|jsx|ts|tsx))'`;

  // Find the stories array's opening bracket and walk to its MATCHING close,
  // tracking bracket depth and skipping string literals. A lazy regex that
  // stopped at the FIRST `]` corrupted any glob with a character class
  // ('*.stories.[tj]sx' was severed mid-string) and turned an empty
  // `stories: []` into a sparse array by always inserting a leading comma.
  const arrayStart = /stories\s*:\s*\[/.exec(mainContent);
  if (!arrayStart) {
    return { checked: true, covered: false, added: null };
  }
  const openIdx = arrayStart.index + arrayStart[0].length - 1;
  let closeIdx = -1;
  let depth = 0;
  let quote: string | null = null;
  for (let i = openIdx; i < mainContent.length; i++) {
    const ch = mainContent[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '[' || ch === '{' || ch === '(') { depth++; continue; }
    if (ch === ']' || ch === '}' || ch === ')') {
      depth--;
      if (depth === 0) {
        if (ch === ']') closeIdx = i;
        break;
      }
    }
  }
  if (closeIdx === -1) {
    // Unbalanced or unparseable — leave the file alone rather than guess.
    return { checked: true, covered: false, added: null };
  }

  const inner = mainContent.slice(openIdx + 1, closeIdx).trim();
  const needsComma = inner.length > 0 && !inner.endsWith(',');
  const insertion = `${needsComma ? ',' : ''}\n    ${storyUIStoriesPath}\n  `;
  mainContent = mainContent.slice(0, closeIdx) + insertion + mainContent.slice(closeIdx);
  fs.writeFileSync(mainPath, mainContent);
  return { checked: true, covered: true, added: storyUIStoriesPath };
}

/**
 * The host's Storybook major version — from the installed package when it can
 * be resolved, the declared range otherwise, null when no Storybook dependency
 * is found at all. Used to pin companion packages (@storybook/react) to the
 * SAME major; a mismatched major is a peer conflict waiting to happen.
 */
export function hostStorybookMajor(cwd: string = process.cwd()): number | null {
  const hostRequire = createRequire(path.join(cwd, 'package.json'));
  for (const pkg of ['storybook', '@storybook/react-vite', '@storybook/react-webpack5']) {
    try {
      const installed = JSON.parse(fs.readFileSync(hostRequire.resolve(`${pkg}/package.json`), 'utf-8'));
      const major = parseInt(String(installed.version).replace(/^[^\d]*/, ''), 10);
      if (major > 0) return major;
    } catch { /* not installed, or exports hide package.json — declared range below */ }
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const declared = deps['storybook']
      || Object.entries(deps).find(([name]) => name.startsWith('@storybook/'))?.[1]
      || '';
    const major = parseInt(String(declared).replace(/^[^\d]*/, ''), 10);
    return major > 0 ? major : null;
  } catch {
    return null;
  }
}

/**
 * Does a React host still need '@storybook/react' installed?
 *
 * Generated React stories all begin `import type { Meta, StoryObj } from
 * '@storybook/react'`, but the package is an OPTIONAL peer of @tpitre/story-ui
 * so non-React hosts never pull React's renderer in. pnpm's auto-install-peers
 * SKIPS optional peers, so a React project on pnpm can end up unable to
 * resolve the one import every generated story starts with. Check resolution,
 * not just declaration (same approach as the react/react-dom check), and pin
 * to the host's own Storybook major. Returns null when nothing is missing.
 */
export function missingReactStorybookDep(
  cwd: string,
  allDeps: Record<string, unknown>,
  componentFramework?: string,
): { name: string; range: string } | null {
  if (componentFramework !== 'react') return null;
  if (allDeps['@storybook/react']) return null;
  const hostRequire = createRequire(path.join(cwd, 'package.json'));
  try {
    hostRequire.resolve('@storybook/react');
    return null;
  } catch { /* declared nowhere and not resolvable — install it */ }
  return { name: '@storybook/react', range: `^${hostStorybookMajor(cwd) ?? 9}.0.0` };
}

/**
 * CommonJS-only packages reachable ONLY through '@tpitre/story-ui' once it is
 * excluded from Vite's dependency optimization.
 *
 * Excluding a package makes Vite serve its ESM — and everything that ESM
 * imports — unbundled, and the optimizer never scans inside an excluded
 * package, so a CJS-only dep on that path reaches the browser as raw CommonJS
 * and the import fails with "does not provide an export named 'default'".
 * That failure took the whole V2 workspace down on every Vite consumer,
 * reproduced deterministically on react-mantine. Vite's `>`-chain include
 * syntax exists for exactly this case: pre-bundle a dep reachable only
 * through an excluded package.
 *
 * Verified against a real install by walking every package reachable from
 * @radix-ui/themes (classnames, @radix-ui/colors, radix-ui,
 * react-remove-scroll-bar, and their transitive dependency closure) and
 * checking each for an ESM build (`type: "module"`, a `module` field, or an
 * `import` export condition): only `classnames` ships none. If the workspace
 * ever gains another CJS-only transitive dep, add its chain here — the
 * emitted config and the existing-config warning both read this list.
 */
export const STORY_UI_VITE_CJS_INCLUDES = [
  '@tpitre/story-ui > @radix-ui/themes > classnames',
];

/** The viteFinal block `init` writes into .storybook/main for Vite projects. */
export function viteFinalConfigSnippet(): string {
  return `viteFinal: async (config) => {
    // Story UI: Exclude from dependency optimization to handle CSS imports correctly
    config.optimizeDeps = {
      ...config.optimizeDeps,
      exclude: [
        ...(config.optimizeDeps?.exclude || []),
        '@tpitre/story-ui'
      ],
      // Excluding '@tpitre/story-ui' means Vite serves it (and everything it
      // imports) unbundled and never interops the CommonJS-only packages on
      // that path — '@radix-ui/themes' imports CJS-only 'classnames', which
      // otherwise fails in the browser with "does not provide an export named
      // 'default'" and the Story UI workspace never mounts. The '>' chains
      // tell Vite to pre-bundle those packages anyway.
      include: [
        ...(config.optimizeDeps?.include || []),
${STORY_UI_VITE_CJS_INCLUDES.map(chain => `        '${chain}'`).join(',\n')}
      ]
    };
    return config;
  },`;
}

/**
 * Chain includes an EXISTING viteFinal is missing, given that it excludes
 * '@tpitre/story-ui' from optimizeDeps. Empty when the exclude is absent
 * (nothing is needed) or when every required chain is already present.
 * Setup never rewrites a user-authored viteFinal, so the caller can only
 * warn — but the warning names the exact strings to add.
 */
export function missingViteCjsIncludes(mainContent: string): string[] {
  // "optimizeDeps ... exclude ... '@tpitre/story-ui'" within a bounded window,
  // so an unrelated mention elsewhere in the file cannot trigger it.
  const excludesStoryUi =
    /optimizeDeps[\s\S]{0,600}?exclude[\s\S]{0,400}?['"`]@tpitre\/story-ui['"`]/.test(mainContent);
  if (!excludesStoryUi) return [];
  return STORY_UI_VITE_CJS_INCLUDES.filter(chain => !mainContent.includes(chain));
}

/** Marks a preview file this tool authored, so a hand-edited one is never clobbered. */
export const PREVIEW_MARKER = 'GENERATED by story-ui from the derived host contract';

/**
 * Root providers, the one part of the host contract that is not yet derived.
 *
 * Kept deliberately small and honest about being a table. Which export is a
 * design system's root provider cannot be read from any manifest: Fluent's
 * `FluentProviderProps.theme` is declared OPTIONAL and omitting it silently
 * yields an unthemed tree, while every prop of `MantineProvider` is optional
 * and it genuinely works bare. Selecting one by name shape is how `/Provider$/`
 * deleted Shopify Polaris's mandatory AppProvider, and Astryx's provider is
 * called `Theme`.
 *
 * The principled replacement is a differential render — wrap the canary story
 * in each candidate and keep whichever makes computed styles change — which
 * needs a browser and belongs with the verification stack. Until then a system
 * absent from this table still gets its stylesheets and theme gate derived,
 * which is strictly more than the previous table gave anyone.
 */
const DESIGN_SYSTEM_PREVIEW_PROVIDERS: Record<string, { imports: string[]; open: string; close: string }> = {
  mantine: {
    imports: ["import { MantineProvider } from '@mantine/core';"],
    open: '<MantineProvider>', close: '</MantineProvider>',
  },
  chakra: {
    imports: ["import { ChakraProvider, defaultSystem } from '@chakra-ui/react';"],
    open: '<ChakraProvider value={defaultSystem}>', close: '</ChakraProvider>',
  },
  fluent: {
    imports: ["import { FluentProvider, webLightTheme } from '@fluentui/react-components';"],
    open: '<FluentProvider theme={webLightTheme}>', close: '</FluentProvider>',
  },
};

/**
 * Write `.storybook/preview.tsx` from what the design system STATES about itself.
 *
 * The table this replaces had exactly two entries — chakra and mantine — and
 * returned early for everything else, writing no preview file at all and saying
 * nothing. Measured on this repo's own test beds: Carbon, Fluent, Astryx and
 * Atlassian all fell through it. Atlassian has no preview file to this day; the
 * other four were written by hand, and the Astryx one was wrong twice.
 *
 * Everything emitted here RESOLVED first. A specifier that did not is reported,
 * never written — which makes the failure that took a whole Storybook preview
 * down (a real file the package's exports map refuses) structurally impossible.
 *
 * Providers are still table-driven, deliberately. Deriving which export is the
 * root provider needs a value test and a render measurement; guessing by name is
 * how `/Provider$/` once deleted Shopify Polaris's mandatory AppProvider.
 */
export function renderPreviewFromContract(
  contract: HostContract,
  providerBlock: { imports: string[]; open: string; close: string } | null,
): string {
  const lines: string[] = [
    '/**',
    ` * ${PREVIEW_MARKER}.`,
    ' *',
    ' * Every specifier below was resolved against this project\'s node_modules',
    ' * before being written. Re-run `story-ui init` to regenerate.',
    ' */',
    "import React from 'react';",
  ];

  for (const req of contract.css.requirements) {
    const note = req.declaredProperties > 0
      ? ` // ${req.declaredProperties} design tokens`
      : ' // no tokens; required for component styling';
    lines.push(`import '${req.specifier}';${note}`);
  }
  for (const imp of providerBlock?.imports ?? []) lines.push(imp);

  // A scoped theme gates its tokens behind an attribute; without the ancestor,
  // components render structurally correct and completely untokenized.
  const gate = contract.gates.required[0];
  const openGate = gate ? `<div ${gate.attribute}="${gate.value}">` : '';
  const closeGate = gate ? '</div>' : '';

  const inner = providerBlock
    ? `${providerBlock.open}<Story />${providerBlock.close}`
    : '<Story />';
  const body = gate ? `${openGate}${inner}${closeGate}` : inner;

  lines.push('');
  if (gate) {
    lines.push(`// ${gate.attribute}="${gate.value}" gates ${gate.propertiesBehindGate} custom properties.`);
    lines.push('// Without this ancestor every token resolves to nothing.');
  }
  lines.push('export default {');
  lines.push('  parameters: { layout: \'padded\' },');
  lines.push('  decorators: [');
  lines.push(`    (Story: any) => (${body}),`);
  lines.push('  ],');
  lines.push('};');
  return lines.join('\n') + '\n';
}

/**
 * Set up Storybook preview file with appropriate providers for design systems
 */
function setupStorybookPreview(designSystem: string, importPath?: string) {
  const storybookDir = path.join(process.cwd(), '.storybook');
  const previewTsPath = path.join(storybookDir, 'preview.ts');
  const previewTsxPath = path.join(storybookDir, 'preview.tsx');

  if (!fs.existsSync(storybookDir)) {
    console.log(chalk.yellow('⚠️  .storybook directory not found. Please run storybook init first.'));
    return;
  }

  /**
   * Derive first, for ANY design system — not only the two in the table.
   *
   * The table is consulted afterwards, and only for the provider, which is the
   * one part of the contract that is not yet derivable.
   */
  if (importPath) {
    try {
      const contract = deriveHostContract(process.cwd(), importPath);

      // Never overwrite a preview a human wrote.
      const existing = fs.existsSync(previewTsxPath) ? fs.readFileSync(previewTsxPath, 'utf-8')
        : fs.existsSync(previewTsPath) ? fs.readFileSync(previewTsPath, 'utf-8') : null;
      if (existing !== null && !existing.includes(PREVIEW_MARKER)) {
        console.log(chalk.yellow('⚠️  .storybook/preview already exists and was not generated by story-ui — leaving it alone.'));
        console.log(chalk.gray(`   Derived contract for reference: ${contract.css.requirements.map((r: any) => r.specifier).join(', ') || 'no stylesheet required'}`));
        return;
      }

      const tableEntry = (DESIGN_SYSTEM_PREVIEW_PROVIDERS as any)[designSystem] ?? null;
      const hasSomething = contract.css.requirements.length > 0 || contract.gates.required.length > 0 || tableEntry;

      if (hasSomething) {
        if (fs.existsSync(previewTsPath)) fs.unlinkSync(previewTsPath);
        fs.writeFileSync(previewTsxPath, renderPreviewFromContract(contract, tableEntry));
        const parts: string[] = [];
        if (contract.css.requirements.length) parts.push(`${contract.css.requirements.length} stylesheet import(s)`);
        if (contract.gates.required.length) parts.push(`theme gate ${contract.gates.required[0].attribute}`);
        if (tableEntry) parts.push('provider');
        console.log(chalk.green(`✅ Created .storybook/preview.tsx — ${parts.join(', ')}`));
      } else {
        // Say so. Silence here is what made this invisible for four systems.
        console.log(chalk.blue(
          `ℹ️  ${importPath} declares no stylesheet and needs no theme attribute — no preview file required.`,
        ));
      }

      /**
       * Report what was considered and refused. FORBIDDEN_BUT_PRESENT is the
       * one worth a human's attention: the file is really there and the package
       * forbids that spelling, which is exactly the mistake made by reading
       * `ls dist/` instead of the manifest.
       */
      for (const r of contract.css.rejected) {
        if (r.reason === 'FORBIDDEN_BUT_PRESENT') {
          console.log(chalk.yellow(`   note: ${r.specifier} exists but is not exported by the package — not imported.`));
        }
      }
      return;
    } catch (error) {
      console.log(chalk.yellow(`⚠️  Could not derive the host contract (${error}); falling back to the built-in table.`));
    }
  }

  // Verify required packages are installed before creating preview
  if (['mantine', 'chakra'].includes(designSystem)) {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      const allDeps = { ...packageJson.dependencies, ...packageJson.devDependencies };
      const config = DESIGN_SYSTEM_CONFIGS[designSystem as keyof typeof DESIGN_SYSTEM_CONFIGS];
      
      if (config) {
        const missingDeps = config.packages.filter(pkg => !allDeps[pkg]);
        if (missingDeps.length > 0) {
          console.log(chalk.red(`❌ Cannot create preview.tsx - missing dependencies: ${missingDeps.join(', ')}`));
          console.log(chalk.yellow(`Please install them first: npm install ${missingDeps.join(' ')}`));
          
          // Clean up existing preview.tsx if it has broken imports
          if (fs.existsSync(previewTsxPath)) {
            fs.unlinkSync(previewTsxPath);
            console.log(chalk.yellow('⚠️  Removed existing preview.tsx with broken imports'));
          }
          
          return;
        }
      }
    }
  }

  const designSystemConfigs = {
    chakra: {
      imports: [
        "import React from 'react'",
        "import type { Preview } from '@storybook/react-vite'",
        "import * as ChakraUI from '@chakra-ui/react'",
      ],
      globals: `
const { ChakraProvider, defaultSystem } = ChakraUI;

// Expose all Chakra components for Voice Canvas live preview.
// Voice Canvas uses these globals to render components without import statements.
(window as any).__STORY_UI_DESIGN_SYSTEM__ = ChakraUI;
(window as any).__STORY_UI_CANVAS_PROVIDER__ = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);`,
      decorator: `(Story) => (
      <ChakraProvider value={defaultSystem}>
        <Story />
      </ChakraProvider>
    )`
    },
    mantine: {
      imports: [
        "import React from 'react'",
        "import type { Preview } from '@storybook/react-vite'",
        "import * as MantineCore from '@mantine/core'",
        "import '@mantine/core/styles.css'",
      ],
      globals: `
const { MantineProvider } = MantineCore;

// Expose all Mantine components for Voice Canvas live preview.
// Voice Canvas uses these globals to render components without import statements.
(window as any).__STORY_UI_DESIGN_SYSTEM__ = MantineCore;
(window as any).__STORY_UI_CANVAS_PROVIDER__ = ({ children }: { children: React.ReactNode }) => (
  <MantineProvider>{children}</MantineProvider>
);`,
      decorator: `(Story) => (
      <MantineProvider>
        <Story />
      </MantineProvider>
    )`
    }
  };

  const config = designSystemConfigs[designSystem as keyof typeof designSystemConfigs];
  if (!config) return;

  // Create the preview content
  const previewContent = `${config.imports.join('\n')}
${(config as any).globals || ''}

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
       color: /(background|color)$/i,
       date: /Date$/i,
      },
    },
  },
  decorators: [
    ${config.decorator},
  ],
};

export default preview;
`;

  // Remove existing preview.ts if it exists
  if (fs.existsSync(previewTsPath)) {
    fs.unlinkSync(previewTsPath);
  }

  // Create preview.tsx with JSX support
  fs.writeFileSync(previewTsxPath, previewContent);
  
  console.log(chalk.green(`✅ Created .storybook/preview.tsx with ${designSystem} provider setup`));
}

interface SetupAnswers {
  designSystem: string; // 'auto', 'custom', or any key from DESIGN_SYSTEM_CONFIGS
  installDesignSystem?: boolean;
  importPath?: string;
  componentPrefix?: string;
  generatedStoriesPath?: string;
  componentsPath?: string;
  llmProvider?: 'claude' | 'openai' | 'gemini';
  hasApiKey?: boolean;
  apiKey?: string;
  mcpPort?: string;
}

// LLM Provider configurations — model lists come from the provider registry
// (story-generator/llm-providers) so the CLI can never drift from the server.
import { CLAUDE_MODELS, OPENAI_MODELS, GEMINI_MODELS } from '../story-generator/llm-providers/index.js';

const LLM_PROVIDERS = {
  claude: {
    name: 'Claude (Anthropic)',
    envKey: 'ANTHROPIC_API_KEY',
    models: CLAUDE_MODELS.map(m => m.id),
    docsUrl: 'https://console.anthropic.com/',
    description: 'Recommended - Best for complex reasoning and code quality'
  },
  openai: {
    name: 'OpenAI (GPT)',
    envKey: 'OPENAI_API_KEY',
    models: OPENAI_MODELS.map(m => m.id),
    docsUrl: 'https://platform.openai.com/api-keys',
    description: 'Versatile and fast'
  },
  gemini: {
    name: 'Google Gemini',
    envKey: 'GEMINI_API_KEY',
    models: GEMINI_MODELS.map(m => m.id),
    docsUrl: 'https://aistudio.google.com/app/apikey',
    description: 'Cost-effective with good performance'
  }
};

// Design system installation configurations (organized by framework)
const DESIGN_SYSTEM_CONFIGS: Record<string, {
  packages: string[];
  name: string;
  importPath: string;
  additionalSetup?: string;
  framework: 'react' | 'angular' | 'vue' | 'svelte' | 'web-components';
}> = {
  // React design systems
  mantine: {
    packages: ['@mantine/core', '@mantine/hooks', '@mantine/notifications'],
    name: 'Mantine',
    importPath: '@mantine/core',
    additionalSetup: 'import "@mantine/core/styles.css";',
    framework: 'react'
  },
  chakra: {
    packages: ['@chakra-ui/react', '@emotion/react', '@emotion/styled', 'framer-motion'],
    name: 'Chakra UI',
    importPath: '@chakra-ui/react',
    additionalSetup: 'import { ChakraProvider } from "@chakra-ui/react";',
    framework: 'react'
  },
  mui: {
    packages: ['@mui/material', '@emotion/react', '@emotion/styled'],
    name: 'Material UI',
    importPath: '@mui/material',
    additionalSetup: 'import { ThemeProvider } from "@mui/material/styles";',
    framework: 'react'
  },
  // Angular design systems
  'angular-material': {
    packages: ['@angular/material', '@angular/cdk'],
    name: 'Angular Material',
    importPath: '@angular/material',
    additionalSetup: 'import { MatModule } from "@angular/material";',
    framework: 'angular'
  },
  primeng: {
    packages: ['primeng', 'primeicons'],
    name: 'PrimeNG',
    importPath: 'primeng',
    additionalSetup: 'import "primeng/resources/themes/lara-light-blue/theme.css";',
    framework: 'angular'
  },
  'ng-zorro': {
    packages: ['ng-zorro-antd'],
    name: 'NG-ZORRO',
    importPath: 'ng-zorro-antd',
    additionalSetup: 'import "ng-zorro-antd/ng-zorro-antd.min.css";',
    framework: 'angular'
  },
  // Vue design systems
  primevue: {
    packages: ['primevue', 'primeicons'],
    name: 'PrimeVue',
    importPath: 'primevue',
    additionalSetup: 'import "primevue/resources/themes/lara-light-blue/theme.css";',
    framework: 'vue'
  },
  vuetify: {
    packages: ['vuetify', '@mdi/font', '@fontsource/roboto'],
    name: 'Vuetify',
    importPath: 'vuetify',
    additionalSetup: `import "vuetify/styles";
import "@mdi/font/css/materialdesignicons.css";
// Roboto font required for proper Vuetify typography
import "@fontsource/roboto/300.css";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";`,
    framework: 'vue'
  },
  'element-plus': {
    packages: ['element-plus'],
    name: 'Element Plus',
    importPath: 'element-plus',
    additionalSetup: 'import "element-plus/dist/index.css";',
    framework: 'vue'
  },
  // Svelte design systems
  'skeleton-ui': {
    packages: ['@skeletonlabs/skeleton'],
    name: 'Skeleton UI',
    importPath: '@skeletonlabs/skeleton',
    framework: 'svelte'
  },
  smui: {
    packages: ['svelte-material-ui'],
    name: 'Svelte Material UI',
    importPath: 'svelte-material-ui',
    framework: 'svelte'
  },
  // Web Components design systems
  shoelace: {
    packages: ['@shoelace-style/shoelace'],
    name: 'Shoelace',
    importPath: '@shoelace-style/shoelace',
    additionalSetup: 'import "@shoelace-style/shoelace/dist/themes/light.css";',
    framework: 'web-components'
  },
  lit: {
    packages: ['lit'],
    name: 'Lit',
    importPath: 'lit',
    framework: 'web-components'
  },
  vaadin: {
    packages: ['@vaadin/vaadin-core'],
    name: 'Vaadin',
    importPath: '@vaadin',
    additionalSetup: 'import "@vaadin/vaadin-lumo-styles/all-imports.js";',
    framework: 'web-components'
  }
};

async function installDesignSystem(systemKey: keyof typeof DESIGN_SYSTEM_CONFIGS) {
  const config = DESIGN_SYSTEM_CONFIGS[systemKey];
  const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8'));
  
  // Check if packages are already installed
  const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
  const missingPackages = config.packages.filter(pkg => !dependencies[pkg]);
  
  if (missingPackages.length === 0) {
    console.log(chalk.green(`✅ ${config.name} packages already installed`));
    return true;
  }

  console.log(chalk.blue(`\n📦 Installing ${config.name} packages...`));
  console.log(chalk.gray(`Packages: ${missingPackages.join(', ')}`));
  
  // Detect package manager
  const npmLock = fs.existsSync(path.join(process.cwd(), 'package-lock.json'));
  const yarnLock = fs.existsSync(path.join(process.cwd(), 'yarn.lock'));
  const pnpmLock = fs.existsSync(path.join(process.cwd(), 'pnpm-lock.yaml'));
  
  let installCommand = `npm install ${missingPackages.join(' ')}`;
  if (yarnLock) {
    installCommand = `yarn add ${missingPackages.join(' ')}`;
  } else if (pnpmLock) {
    installCommand = `pnpm add ${missingPackages.join(' ')}`;
  }
  
  try {
    console.log(chalk.gray(`Running: ${installCommand}`));
    execSync(installCommand, { stdio: 'inherit' });
    
    // Verify installation was successful by re-checking package.json
    const updatedPackageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8'));
    const updatedDeps = { ...updatedPackageJson.dependencies, ...updatedPackageJson.devDependencies };
    const stillMissingPackages = config.packages.filter(pkg => !updatedDeps[pkg]);
    
    if (stillMissingPackages.length > 0) {
      throw new Error(`Installation failed: packages still missing: ${stillMissingPackages.join(', ')}`);
    }
    
    console.log(chalk.green(`✅ ${config.name} installed successfully!`));
    
    if (config.additionalSetup) {
      // Try to automatically add CSS import for Mantine
      if (systemKey === 'mantine') {
        const cssFiles = [
          path.join(process.cwd(), 'src', 'index.css'),
          path.join(process.cwd(), 'src', 'main.css'),
          path.join(process.cwd(), 'src', 'App.css')
        ];
        
        let cssAdded = false;
        for (const cssFile of cssFiles) {
          if (fs.existsSync(cssFile)) {
            try {
              const cssContent = fs.readFileSync(cssFile, 'utf-8');
              if (!cssContent.includes('@mantine/core/styles.css')) {
                const newContent = `@import "@mantine/core/styles.css";\n\n${cssContent}`;
                fs.writeFileSync(cssFile, newContent);
                console.log(chalk.green(`✅ Added Mantine CSS import to ${path.relative(process.cwd(), cssFile)}`));
                cssAdded = true;
                break;
              } else {
                console.log(chalk.blue(`ℹ️ Mantine CSS already imported in ${path.relative(process.cwd(), cssFile)}`));
                cssAdded = true;
                break;
              }
            } catch (error) {
              console.warn(chalk.yellow(`⚠️ Could not modify ${cssFile}:`, error));
            }
          }
        }
        
        if (!cssAdded) {
          console.log(chalk.blue('\n📋 Manual setup required:'));
          console.log(chalk.gray(`Add this import to your main CSS file:`));
          console.log(chalk.cyan(`${config.additionalSetup}`));
        }
      } else {
        console.log(chalk.blue('\n📋 Additional setup required:'));
        console.log(chalk.gray(`Add this import to your main CSS/index file:`));
        console.log(chalk.cyan(`${config.additionalSetup}`));
      }
    }
    
    return true;
  } catch (error) {
    console.error(chalk.red(`❌ Failed to install ${config.name}:`), error);
    console.log(chalk.yellow(`\n💡 You can install manually with: ${installCommand}`));
    return false;
  }
}

// CLI options interface
export interface SetupOptions {
  designSystem?: string;
  llmProvider?: 'claude' | 'openai' | 'gemini';
  yes?: boolean;
  skipInstall?: boolean;
  /** Overwrite an existing config and panel files. Without it, init keeps what is there. */
  force?: boolean;
}

export async function setupCommand(options: SetupOptions = {}) {
  console.log(chalk.blue.bold('\n🎨 Story UI Setup\n'));

  // Non-interactive mode indicator
  if (options.yes || options.designSystem) {
    console.log(chalk.gray('Running in non-interactive mode...\n'));
  } else {
    console.log('This will help you configure Story UI for your design system.\n');
  }

  // Check if we're in a valid project
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    console.error(chalk.red('❌ No package.json found. Please run this command in your project root.'));
    process.exit(1);
  }

  // Check if Storybook is installed (any framework)
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  const devDeps = packageJson.devDependencies || {};
  const deps = packageJson.dependencies || {};

  // Check for any Storybook framework
  const storybookPackages = [
    '@storybook/react', '@storybook/react-vite', '@storybook/react-webpack5', '@storybook/nextjs',
    '@storybook/angular', '@storybook/vue3', '@storybook/vue3-vite',
    '@storybook/svelte', '@storybook/svelte-vite',
    '@storybook/web-components', '@storybook/web-components-vite', '@storybook/web-components-webpack5'
  ];
  const hasStorybook = storybookPackages.some(pkg => devDeps[pkg] || deps[pkg]) ||
                      fs.existsSync(path.join(process.cwd(), '.storybook'));

  if (!hasStorybook) {
    console.warn(chalk.yellow('⚠️  Storybook not detected. Story UI works best with Storybook installed.'));
    console.log('Install Storybook first: npx storybook@latest init\n');
  }

  // Detect Storybook framework and component framework type
  let storybookFramework = '@storybook/react'; // default
  let componentFramework: 'react' | 'angular' | 'vue' | 'svelte' | 'web-components' = 'react';

  // Check for React Storybook variants
  if (devDeps['@storybook/react-vite'] || deps['@storybook/react-vite']) {
    storybookFramework = '@storybook/react-vite';
    componentFramework = 'react';
    console.log(chalk.green('✅ Detected Vite-based React Storybook'));
  } else if (devDeps['@storybook/react-webpack5'] || deps['@storybook/react-webpack5']) {
    storybookFramework = '@storybook/react-webpack5';
    componentFramework = 'react';
    console.log(chalk.green('✅ Detected Webpack 5-based React Storybook'));
  } else if (devDeps['@storybook/nextjs'] || deps['@storybook/nextjs']) {
    storybookFramework = '@storybook/nextjs';
    componentFramework = 'react';
    console.log(chalk.green('✅ Detected Next.js Storybook'));
  }
  // Check for Angular Storybook
  else if (devDeps['@storybook/angular'] || deps['@storybook/angular']) {
    storybookFramework = '@storybook/angular';
    componentFramework = 'angular';
    console.log(chalk.green('✅ Detected Angular Storybook'));
  }
  // Check for Vue Storybook (vite variant first)
  else if (devDeps['@storybook/vue3-vite'] || deps['@storybook/vue3-vite']) {
    storybookFramework = '@storybook/vue3-vite';
    componentFramework = 'vue';
    console.log(chalk.green('✅ Detected Vite-based Vue 3 Storybook'));
  } else if (devDeps['@storybook/vue3'] || deps['@storybook/vue3']) {
    storybookFramework = '@storybook/vue3';
    componentFramework = 'vue';
    console.log(chalk.green('✅ Detected Vue 3 Storybook'));
  }
  // Check for Svelte Storybook (vite variant first)
  else if (devDeps['@storybook/svelte-vite'] || deps['@storybook/svelte-vite']) {
    storybookFramework = '@storybook/svelte-vite';
    componentFramework = 'svelte';
    console.log(chalk.green('✅ Detected Vite-based Svelte Storybook'));
  } else if (devDeps['@storybook/svelte'] || deps['@storybook/svelte']) {
    storybookFramework = '@storybook/svelte';
    componentFramework = 'svelte';
    console.log(chalk.green('✅ Detected Svelte Storybook'));
  }
  // Check for Web Components Storybook (webpack5 first, then vite, then generic)
  else if (devDeps['@storybook/web-components-webpack5'] || deps['@storybook/web-components-webpack5']) {
    storybookFramework = '@storybook/web-components-webpack5';
    componentFramework = 'web-components';
    console.log(chalk.green('✅ Detected Webpack 5-based Web Components Storybook'));
  } else if (devDeps['@storybook/web-components-vite'] || deps['@storybook/web-components-vite']) {
    storybookFramework = '@storybook/web-components-vite';
    componentFramework = 'web-components';
    console.log(chalk.green('✅ Detected Vite-based Web Components Storybook'));
  } else if (devDeps['@storybook/web-components'] || deps['@storybook/web-components']) {
    storybookFramework = '@storybook/web-components';
    componentFramework = 'web-components';
    console.log(chalk.green('✅ Detected Web Components Storybook'));
  }
  // Check for generic @storybook/react (old setup)
  else if (devDeps['@storybook/react'] || deps['@storybook/react']) {
    storybookFramework = '@storybook/react';
    componentFramework = 'react';
    console.log(chalk.green('✅ Detected React Storybook'));
  }

  // Auto-detect design system
  const autoDetected = autoDetectDesignSystem();
  if (autoDetected) {
    console.log(chalk.green(`✅ Auto-detected design system:`));
    console.log(`   📦 Import path: ${autoDetected.importPath}`);
    if (autoDetected.componentPrefix) {
      console.log(`   🏷️  Component prefix: ${autoDetected.componentPrefix}`);
    }
    if (autoDetected.componentsPath) {
      console.log(`   📁 Components path: ${autoDetected.componentsPath}`);
    }
  }

  // Build design system choices based on detected framework
  // Simplified to show only the most popular option per framework
  const getDesignSystemChoices = () => {
    const baseChoice = { name: '🤖 Auto-detect from package.json', value: 'auto' };
    const customChoice = { name: '🔧 Custom/Other', value: 'custom' };

    switch (componentFramework) {
      case 'angular':
        return [
          baseChoice,
          { name: '🅰️ Angular Material (@angular/material) - Most Popular', value: 'angular-material' },
          customChoice
        ];
      case 'vue':
        return [
          baseChoice,
          { name: '🎯 Vuetify (vuetify) - Most Popular', value: 'vuetify' },
          customChoice
        ];
      case 'svelte':
        return [
          baseChoice,
          { name: '🟠 Skeleton UI (@skeletonlabs/skeleton) - Most Popular', value: 'skeleton-ui' },
          customChoice
        ];
      case 'web-components':
        return [
          baseChoice,
          { name: '👟 Shoelace (@shoelace-style/shoelace) - Most Popular', value: 'shoelace' },
          customChoice
        ];
      case 'react':
      default:
        return [
          baseChoice,
          { name: '🎯 Mantine (@mantine/core) - Most Popular', value: 'mantine' },
          { name: '⚡ Chakra UI (@chakra-ui/react)', value: 'chakra' },
          { name: '🎨 Material UI (@mui/material)', value: 'mui' },
          customChoice
        ];
    }
  };;

  // Non-interactive mode: build answers from CLI options
  let answers: SetupAnswers;

  if (options.yes || options.designSystem) {
    // Non-interactive mode
    const designSystem = options.designSystem || (autoDetected ? 'auto' : 'custom');
    const mcpPort = String(await findAvailablePort(4001));

    // Validate design system choice
    const validSystems = ['auto', 'custom', ...Object.keys(DESIGN_SYSTEM_CONFIGS)];
    if (!validSystems.includes(designSystem)) {
      console.error(chalk.red(`❌ Invalid design system: ${designSystem}`));
      console.log(chalk.yellow(`Valid options: ${validSystems.join(', ')}`));
      process.exit(1);
    }

    const llmProvider = options.llmProvider || 'claude';

    answers = {
      designSystem,
      installDesignSystem: !options.skipInstall && Object.keys(DESIGN_SYSTEM_CONFIGS).includes(designSystem),
      generatedStoriesPath: './src/stories/generated/',
      llmProvider,
      mcpPort,
      hasApiKey: false,
    };

    console.log(chalk.blue(`📦 Design system: ${designSystem}`));
    console.log(chalk.blue(`🤖 AI Provider: ${LLM_PROVIDERS[llmProvider]?.name || llmProvider}`));
    console.log(chalk.blue(`📁 Generated stories: ${answers.generatedStoriesPath}`));
    console.log(chalk.blue(`🔌 MCP port: ${mcpPort}`));
    if (options.skipInstall) {
      console.log(chalk.yellow('⏭️  Skipping package installation'));
    }
  } else {
    // Interactive mode - use inquirer prompts
    answers = await inquirer.prompt<SetupAnswers>([
      {
        type: 'list',
        name: 'designSystem',
        message: `Which design system are you using? (${componentFramework} detected)`,
        choices: getDesignSystemChoices(),
        default: autoDetected ? 'auto' : 'custom'
      },
      {
        type: 'confirm',
        name: 'installDesignSystem',
        message: (promptAnswers) => {
          const config = DESIGN_SYSTEM_CONFIGS[promptAnswers.designSystem as keyof typeof DESIGN_SYSTEM_CONFIGS];
          const systemName = config?.name || 'the design system';
          return `🚨 IMPORTANT: Would you like to install ${systemName} packages now?\n   Required packages: ${config?.packages.join(', ') || 'unknown'}\n   (Without these packages, Story UI and Storybook will not work properly)`;
        },
        when: (promptAnswers) => Object.keys(DESIGN_SYSTEM_CONFIGS).includes(promptAnswers.designSystem),
        default: true
      },
      {
        type: 'input',
        name: 'importPath',
        message: 'What is the import path for your components?',
        when: (promptAnswers) => promptAnswers.designSystem === 'custom',
        validate: (input) => input.trim() ? true : 'Import path is required'
      },
      {
        type: 'input',
        name: 'componentPrefix',
        message: 'Do your components have a prefix? (e.g., "AL" for ALButton)',
        when: (promptAnswers) => promptAnswers.designSystem === 'custom',
        default: ''
      },
      {
        type: 'input',
        name: 'generatedStoriesPath',
        message: 'Where should generated stories be saved?',
        default: './src/stories/generated/',
        validate: (input) => input.trim() ? true : 'Path is required'
      },
      {
        type: 'input',
        name: 'componentsPath',
        message: 'Where are your component files located?',
        default: './src/components',
        when: (promptAnswers) => promptAnswers.designSystem === 'custom'
      },
      {
        type: 'input',
        name: 'mcpPort',
        message: 'Port for the Story UI MCP server',
        default: async () => {
          const port = await findAvailablePort(4001);
          return String(port);
        },
        validate: async (input) => {
          const value = parseInt(input, 10);
          if (isNaN(value) || value <= 0) return 'Enter a valid port number';
          const available = await isPortAvailable(value);
          return available ? true : `Port ${value} is already in use`;
        }
      },
      {
        type: 'list',
        name: 'llmProvider',
        message: 'Which AI provider would you like to use?',
        choices: [
          { name: `${chalk.green('Claude (Anthropic)')} - ${chalk.gray('Recommended for complex reasoning and code quality')}`, value: 'claude' },
          { name: `${chalk.blue('OpenAI (GPT-5)')} - ${chalk.gray('Versatile and fast')}`, value: 'openai' },
          { name: `${chalk.yellow('Google Gemini')} - ${chalk.gray('Cost-effective with good performance')}`, value: 'gemini' }
        ],
        default: 'claude'
      },
      {
        type: 'confirm',
        name: 'hasApiKey',
        message: (promptAnswers) => {
          const provider = LLM_PROVIDERS[promptAnswers.llmProvider as keyof typeof LLM_PROVIDERS];
          return `Do you have a ${provider?.name || 'provider'} API key? (You can add it later)`;
        },
        default: false
      },
      {
        type: 'password',
        name: 'apiKey',
        message: (promptAnswers) => {
          const provider = LLM_PROVIDERS[promptAnswers.llmProvider as keyof typeof LLM_PROVIDERS];
          return `Enter your ${provider?.name || 'provider'} API key:`;
        },
        when: (promptAnswers) => promptAnswers.hasApiKey,
        validate: (input) => input.trim() ? true : 'API key is required'
      }
    ]);
  }

  // Install design system if requested
  if (answers.installDesignSystem && Object.keys(DESIGN_SYSTEM_CONFIGS).includes(answers.designSystem)) {
    const installSuccess = await installDesignSystem(answers.designSystem as keyof typeof DESIGN_SYSTEM_CONFIGS);
    if (!installSuccess) {
      console.log(chalk.red('❌ Installation failed! Cannot continue without required dependencies.'));
      console.log(chalk.yellow('Please install manually and run setup again:'));
      const config = DESIGN_SYSTEM_CONFIGS[answers.designSystem as keyof typeof DESIGN_SYSTEM_CONFIGS];
      console.log(chalk.cyan(`npm install ${config.packages.join(' ')}`));
      
      // Clean up any existing preview.tsx that might cause issues
      const previewTsxPath = path.join(process.cwd(), '.storybook', 'preview.tsx');
      if (fs.existsSync(previewTsxPath)) {
        fs.unlinkSync(previewTsxPath);
        console.log(chalk.yellow('⚠️  Removed preview.tsx to prevent import errors'));
      }
      
      process.exit(1);
    }
    
    // Set up Storybook preview file after successful installation
    setupStorybookPreview(answers.designSystem);
  } else if (Object.keys(DESIGN_SYSTEM_CONFIGS).includes(answers.designSystem)) {
    // User declined installation - verify dependencies exist
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      const allDeps = { ...packageJson.dependencies, ...packageJson.devDependencies };
      const dsConfig = DESIGN_SYSTEM_CONFIGS[answers.designSystem as keyof typeof DESIGN_SYSTEM_CONFIGS];
      const missingDeps = dsConfig.packages.filter(pkg => !allDeps[pkg]);

      if (missingDeps.length > 0) {
        // If --skip-install was explicitly passed, just warn but continue with config generation
        if (options.skipInstall) {
          console.log(chalk.yellow('⚠️  Dependencies not installed (--skip-install used):'), missingDeps.join(', '));
          console.log(chalk.yellow('   Install them later with:'));
          console.log(chalk.cyan(`   npm install ${missingDeps.join(' ')}`));
          // Don't set up Storybook preview since deps are missing
        } else {
          // Interactive mode: user declined installation
          console.log(chalk.red('❌ Required dependencies missing:'), missingDeps.join(', '));
          console.log(chalk.yellow('Please install them manually:'));
          console.log(chalk.cyan(`npm install ${missingDeps.join(' ')}`));

          // Clean up any existing preview.tsx that might cause issues
          const previewTsxPath = path.join(process.cwd(), '.storybook', 'preview.tsx');
          if (fs.existsSync(previewTsxPath)) {
            fs.unlinkSync(previewTsxPath);
            console.log(chalk.yellow('⚠️  Removed preview.tsx to prevent import errors'));
          }

          process.exit(1);
        }
      } else {
        // Dependencies exist, set up Storybook preview
        setupStorybookPreview(answers.designSystem);
      }
    }
  }

  // Generate configuration
  let config: any = {};

  if (answers.designSystem === 'auto' && autoDetected) {
    config = autoDetected;
  } else if (answers.designSystem === 'chakra') {
    config = {
      importPath: '@chakra-ui/react',
      componentPrefix: '',
      layoutRules: {
        multiColumnWrapper: 'SimpleGrid',
        columnComponent: 'Box',
        containerComponent: 'Container',
        layoutExamples: {
          twoColumn: `<SimpleGrid columns={2} spacing={6}>
  <Box>
    <Card>
      <CardHeader>
        <Heading size="md">Left Card</Heading>
      </CardHeader>
      <CardBody>
        <Text>Left content goes here</Text>
      </CardBody>
    </Card>
  </Box>
  <Box>
    <Card>
      <CardHeader>
        <Heading size="md">Right Card</Heading>
      </CardHeader>
      <CardBody>
        <Text>Right content goes here</Text>
      </CardBody>
    </Card>
  </Box>
</SimpleGrid>`
        }
      }
    };
  } else if (answers.designSystem === 'mantine') {
    config = {
      importPath: '@mantine/core',
      componentPrefix: '',
      layoutRules: {
        multiColumnWrapper: 'SimpleGrid',
        columnComponent: 'div',
        containerComponent: 'Container',
        layoutExamples: {
          twoColumn: `<SimpleGrid cols={2} spacing="md">
  <div>
    <Card shadow="sm" padding="lg" radius="md" withBorder>
      <Text fw={500} size="lg" mb="xs">Left Card</Text>
      <Text size="sm" c="dimmed">
        Left content goes here
      </Text>
    </Card>
  </div>
  <div>
    <Card shadow="sm" padding="lg" radius="md" withBorder>
      <Text fw={500} size="lg" mb="xs">Right Card</Text>
      <Text size="sm" c="dimmed">
        Right content goes here
      </Text>
    </Card>
  </div>
</SimpleGrid>`
        }
      }
    };
  } else if (answers.designSystem === 'mui') {
    config = {
      importPath: '@mui/material',
      componentPrefix: '',
      layoutRules: {
        multiColumnWrapper: 'Grid',
        columnComponent: 'Grid',
        containerComponent: 'Container',
        layoutExamples: {
          twoColumn: `<Grid container spacing={2}>
  <Grid item xs={6}>
    <Card>
      <CardContent>
        <Typography variant="h6">Left Card</Typography>
        <Typography variant="body2" color="text.secondary">
          Left content goes here
        </Typography>
      </CardContent>
    </Card>
  </Grid>
  <Grid item xs={6}>
    <Card>
      <CardContent>
        <Typography variant="h6">Right Card</Typography>
        <Typography variant="body2" color="text.secondary">
          Right content goes here
        </Typography>
      </CardContent>
    </Card>
  </Grid>
</Grid>`
        }
      },
      designSystemGuidelines: {
        name: 'Material UI',
        additionalNotes: `
Material UI (MUI) is a React component library implementing Material Design.
- Import components from "@mui/material" (e.g., import { Button } from "@mui/material")
- Use the sx prop for inline styling with theme awareness
- Use Grid for layouts, Card for containers
- Leverage ThemeProvider for consistent theming
- Typography component for text with proper variants
        `.trim()
      }
    };
  } else {
    // Custom configuration
    config = {
      importPath: answers.importPath,
      componentPrefix: answers.componentPrefix || '',
      componentsPath: answers.componentsPath ? path.resolve(answers.componentsPath) : undefined,
      layoutRules: {
        multiColumnWrapper: 'div',
        columnComponent: 'div',
        containerComponent: 'div',
        layoutExamples: {
          twoColumn: `<div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem'}}>
  <div>Column 1 content</div>
  <div>Column 2 content</div>
</div>`
        }
      }
    };
  }

  // Add common configuration
  config.generatedStoriesPath = path.resolve(answers.generatedStoriesPath || './src/stories/generated/');
  config.storyPrefix = 'Generated/';
  config.defaultAuthor = 'Story UI AI';
  config.componentFramework = componentFramework; // react, angular, vue, svelte, or web-components
  config.storybookFramework = storybookFramework; // e.g., @storybook/react-vite, @storybook/angular
  config.llmProvider = answers.llmProvider || 'claude'; // claude, openai, or gemini

  // For web-components with local imports, add importExamples guidance
  if (componentFramework === 'web-components' && config.importPath?.startsWith('.')) {
    config.importExamples = [
      `import '${config.importPath}/alert/alert'; // For <your-prefix-alert> component`,
      `import '${config.importPath}/button/button'; // For <your-prefix-button> component`,
      `// IMPORTANT: Update these examples to match your component library's folder structure`,
      `// The AI uses these patterns to generate correct import statements`
    ];
  }

  // Add version tracking for update command
  config._storyUIVersion = getStoryUIVersion();
  config._lastUpdated = new Date().toISOString();

  // Create configuration file
  const configContent = `module.exports = ${JSON.stringify(config, null, 2)};`;
  const configPath = path.join(process.cwd(), 'story-ui.config.js');

  if (fs.existsSync(configPath) && !options.force) {
    console.log(chalk.yellow('ℹ️  story-ui.config.js already exists — kept as is. Re-run with --force to replace it.'));
  } else {
    fs.writeFileSync(configPath, configContent);
    console.log(chalk.green(fs.existsSync(configPath) && options.force ? '✅ Replaced story-ui.config.js' : '✅ Created story-ui.config.js'));
  }

  /**
   * Derive the host contract now that the design system's specifier is known.
   *
   * The two earlier call sites run BEFORE this config exists, so they never had
   * an importPath to derive from — and both were gated on a two-entry table, so
   * Carbon, Fluent, Astryx and Atlassian reached neither. Running it here, for
   * every design system including `auto` and `custom`, is what makes a preview
   * appear for a library nobody hardcoded.
   */
  if (config.importPath) {
    setupStorybookPreview(answers.designSystem, config.importPath);
  }

  // For web-components, provide guidance about importExamples
  if (componentFramework === 'web-components' && config.importPath?.startsWith('.')) {
    console.log(chalk.yellow('\n⚠️  Web Components Setup - Important:'));
    console.log(chalk.gray('   Update "importExamples" in story-ui.config.js to match your component library\'s structure.'));
    console.log(chalk.gray('   This helps the AI generate correct import statements for your components.'));
    console.log(chalk.gray('   Also update story-ui-considerations.md with component-specific behaviors.'));
  }

  // Create generated stories directory
  const storiesDir = path.dirname(config.generatedStoriesPath);
  if (!fs.existsSync(storiesDir)) {
    fs.mkdirSync(storiesDir, { recursive: true });
  }

  // Copy StoryUI component to the project
  const storyUITargetDir = path.join(storiesDir, 'StoryUI');
  if (!fs.existsSync(storyUITargetDir)) {
    fs.mkdirSync(storyUITargetDir, { recursive: true });
  }

  // Copy component files
  const templatesDir = path.resolve(__dirname, '../../templates/StoryUI');
  // NOTE: StoryUIPanel.tsx imports its siblings by relative path, so every module
  // it pulls in must be copied alongside it — a missing entry here breaks the
  // panel at import time in the consuming project, not at build time here.
  const componentFiles = [
    'StoryUIPanel.tsx',
    'StoryUIPanel.mdx',
    'StoryUIPanel.css',
    'DesignContextPanel.tsx',
    'VerificationBadge.tsx',
    'HandoffDialog.tsx',
    'manager.tsx',
  ];

  // Voice Canvas files (subdirectory)
  const voiceFiles = ['VoiceCanvas.tsx', 'VoiceControls.tsx', 'useVoiceInput.ts', 'voiceCommands.ts', 'types.ts'];

  console.log(chalk.blue('\n📦 Installing Story UI component...'));

  for (const file of componentFiles) {
    const sourcePath = path.join(templatesDir, file);
    const targetPath = path.join(storyUITargetDir, file);

    if (fs.existsSync(sourcePath)) {
      let content = fs.readFileSync(sourcePath, 'utf-8');

      // Replace Storybook import based on detected framework
      if (file === 'StoryUIPanel.stories.tsx' && storybookFramework !== '@storybook/react') {
        content = content.replace(
          "import type { StoryFn, Meta } from '@storybook/react';",
          `import type { StoryFn, Meta } from '${storybookFramework}';`
        );
      }

      if (fs.existsSync(targetPath) && !options.force) {
        console.log(chalk.yellow(`ℹ️  ${file} already exists — kept. Run \`story-ui update\` to refresh it, or init with --force.`));
        continue;
      }
      fs.writeFileSync(targetPath, content);
      console.log(chalk.green(`✅ Copied ${file}`));
    } else {
      console.warn(chalk.yellow(`⚠️  Template file not found: ${file}`));
    }
  }

  // Wire the "Edit in Story UI" toolbar button into the Storybook manager
  ensureManagerAddonWiring(storyUITargetDir);

  /**
   * Install the V2 workspace — ONE file.
   *
   * V1 copies seven modules plus the voice canvas into the project, because
   * the panel imports its siblings by relative path. V2 ships as a package
   * export instead, so the project needs only the MDX entry that mounts it and
   * resolves the API base. The workspace, its styles and its own UI
   * dependencies all live in the package and update when it does.
   */
  const v2TargetDir = path.join(storiesDir, 'StoryUIV2');
  const v2Source = path.resolve(__dirname, '../../templates/StoryUIV2/StoryUIV2.mdx');
  if (fs.existsSync(v2Source)) {
    if (!fs.existsSync(v2TargetDir)) fs.mkdirSync(v2TargetDir, { recursive: true });
    const v2Target = path.join(v2TargetDir, 'StoryUIV2.mdx');
    if (fs.existsSync(v2Target) && !options.force) {
      console.log(chalk.yellow('ℹ️  StoryUIV2.mdx already exists — kept. Run `story-ui update` to refresh it.'));
    } else {
      fs.copyFileSync(v2Source, v2Target);
      console.log(chalk.green('✅ Installed Story UI workspace (V2)'));
    }
  } else {
    console.warn(chalk.yellow('⚠️  V2 workspace template not found — only the classic panel was installed'));
  }

  // Copy Voice Canvas files
  const voiceSourceDir = path.join(templatesDir, 'voice');
  const voiceTargetDir = path.join(storyUITargetDir, 'voice');
  if (fs.existsSync(voiceSourceDir)) {
    if (!fs.existsSync(voiceTargetDir)) {
      fs.mkdirSync(voiceTargetDir, { recursive: true });
    }
    for (const file of voiceFiles) {
      const sourcePath = path.join(voiceSourceDir, file);
      const targetPath = path.join(voiceTargetDir, file);
      if (fs.existsSync(sourcePath)) {
        fs.copyFileSync(sourcePath, targetPath);
        console.log(chalk.green(`✅ Copied voice/${file}`));
      }
    }
  }

  // Generate component registry for Voice Canvas with static design system import
  // Vite requires static imports — bare specifiers can't be resolved at runtime
  const canvasTargetDir = path.join(voiceTargetDir, 'canvas');
  if (!fs.existsSync(canvasTargetDir)) {
    fs.mkdirSync(canvasTargetDir, { recursive: true });
  }

  // Copy canvas template files (types.ts, operations.ts, ComponentRenderer.tsx)
  const canvasSourceDir = path.join(voiceSourceDir, 'canvas');
  if (fs.existsSync(canvasSourceDir)) {
    for (const file of fs.readdirSync(canvasSourceDir)) {
      if (file === 'componentRegistry.ts') continue; // generated below
      const src = path.join(canvasSourceDir, file);
      const dst = path.join(canvasTargetDir, file);
      if (fs.statSync(src).isFile()) {
        fs.copyFileSync(src, dst);
        console.log(chalk.green(`✅ Copied voice/canvas/${file}`));
      }
    }
  }

  // Generate the registry with a lazy async import of the design system.
  // Uses a literal string in import() so Vite resolves it at build time,
  // but execution is deferred until loadRegistry() is called — avoiding
  // module-level side effects that can crash the docs page.
  if (config.importPath && config.importStyle !== 'individual') {
    const registryContent = `/**
 * Component registry for Voice Canvas — lazy-loaded from design system.
 *
 * Uses dynamic import('${config.importPath}') with a literal string so Vite
 * resolves it at build time, but the import only executes when loadRegistry()
 * is called (not at module evaluation time). This prevents crashes from
 * module-level side effects.
 *
 * Generated by story-ui init. Regenerate with: npx story-ui registry
 */

export const registry: Record<string, any> = {};

let _loaded = false;

export async function loadRegistry(): Promise<Record<string, any>> {
  if (_loaded) return registry;

  try {
    const mod = await import('${config.importPath}');

    for (const [key, value] of Object.entries(mod)) {
      if (/^[A-Z]/.test(key) && (typeof value === 'function' || typeof value === 'object')) {
        registry[key] = value;
      }
    }

    _loaded = true;
    console.log(\\\`[componentRegistry] Loaded \\\${Object.keys(registry).length} components from ${config.importPath}\\\`);
  } catch (err) {
    console.error('[componentRegistry] Failed to load design system:', err);
  }

  return registry;
}

export default registry;
`;
    fs.writeFileSync(path.join(canvasTargetDir, 'componentRegistry.ts'), registryContent);
    console.log(chalk.green(`✅ Generated voice/canvas/componentRegistry.ts with ${config.importPath} imports`));
  } else {
    // For individual import style or unknown, copy the placeholder
    const placeholderSrc = path.join(canvasSourceDir, 'componentRegistry.ts');
    if (fs.existsSync(placeholderSrc)) {
      fs.copyFileSync(placeholderSrc, path.join(canvasTargetDir, 'componentRegistry.ts'));
    }
    console.log(chalk.yellow(`⚠️  Voice Canvas registry is empty — populate voice/canvas/componentRegistry.ts manually`));
  }

  // Configure Storybook bundler for StoryUIPanel requirements
  console.log(chalk.blue('\n🔧 Configuring Storybook for Story UI...'));
  const mainConfigPath = path.join(process.cwd(), '.storybook', 'main.ts');
  const mainConfigPathJs = path.join(process.cwd(), '.storybook', 'main.js');
  const actualMainPath = fs.existsSync(mainConfigPath) ? mainConfigPath :
                         fs.existsSync(mainConfigPathJs) ? mainConfigPathJs : null;

  if (actualMainPath) {
    const globResult = ensureStoriesGlobCoversMdx(storiesDir);
    if (globResult.added) {
      console.log(chalk.green('✅ Added Story UI path to Storybook stories array'));
    } else if (globResult.checked && !globResult.covered) {
      console.log(chalk.yellow(`⚠️  Could not find a stories array to extend — add a glob matching .mdx under ${path.relative(process.cwd(), storiesDir)} to ${path.basename(actualMainPath)} manually`));
    }

    let mainContent = fs.readFileSync(actualMainPath, 'utf-8');
    let configUpdated = false;

    // Check if StoryUI config already exists
    if (mainContent.includes('@tpitre/story-ui') || mainContent.includes('StoryUIPanel')) {
      console.log(chalk.blue('ℹ️  Storybook already configured for Story UI'));
    } else if (componentFramework === 'angular') {
      // Angular uses webpack - needs CSS loaders
      if (!mainContent.includes('webpackFinal')) {
        const webpackConfig = `webpackFinal: async (config) => {
    // Story UI: Add CSS loader for StoryUIPanel CSS imports
    config.module?.rules?.push({
      test: /\\.css$/,
      use: ['style-loader', 'css-loader'],
    });
    return config;
  },`;
        // Insert webpackFinal inside the config object, before the closing };
        if (mainContent.match(/};\s*\n+\s*export\s+default/)) {
          mainContent = mainContent.replace(
            /(\n)(};\s*\n+\s*export\s+default)/,
            `\n  ${webpackConfig}\n$2`
          );
          configUpdated = true;
        }
      }

      // Install required loaders for Angular
      console.log(chalk.blue('📦 Installing CSS loaders for Angular...'));
      try {
        execSync('npm install --save-dev style-loader css-loader', { stdio: 'inherit' });
        console.log(chalk.green('✅ Installed style-loader and css-loader'));
      } catch (error) {
        console.warn(chalk.yellow('⚠️  Could not install CSS loaders. You may need to run: npm install --save-dev style-loader css-loader'));
      }
    } else if (storybookFramework === '@storybook/web-components-webpack5') {
      // Web Components with Webpack5 - needs babel-loader for TSX
      const hasBabelConfig = mainContent.includes('babel-loader') && mainContent.includes('StoryUI');

      if (!hasBabelConfig) {
        const babelLoaderRule = `
    // Story UI: Add babel-loader for TSX/JSX support (React panel in Web Components project)
    config.module?.rules?.push({
      test: /stories\\/StoryUI\\/.*\\.tsx$/,
      use: {
        loader: 'babel-loader',
        options: {
          presets: [
            ['@babel/preset-react', { runtime: 'automatic' }],
            '@babel/preset-typescript'
          ]
        }
      }
    });`;

        if (mainContent.includes('webpackFinal')) {
          // webpackFinal exists - inject babel-loader rule before return statement
          // Look for the return statement in webpackFinal and insert before it
          const returnPattern = /(webpackFinal[\s\S]*?)(return\s+config\s*;)/;
          if (mainContent.match(returnPattern)) {
            mainContent = mainContent.replace(
              returnPattern,
              `$1${babelLoaderRule}\n\n    $2`
            );
            configUpdated = true;
          }
        } else {
          // webpackFinal doesn't exist - add a complete block
          const webpackConfig = `webpackFinal: async (config) => {${babelLoaderRule}
    return config;
  },`;
          // Insert webpackFinal inside the config object, before the closing };
          if (mainContent.match(/};\s*\n+\s*export\s+default/)) {
            mainContent = mainContent.replace(
              /(\n)(};\s*\n+\s*export\s+default)/,
              `\n  ${webpackConfig}\n$2`
            );
            configUpdated = true;
          }
        }
      }

      // Install required loaders for Web Components Webpack5
      console.log(chalk.blue('📦 Installing babel loaders for Web Components Webpack5...'));
      try {
        execSync('npm install --save-dev babel-loader @babel/preset-react @babel/preset-typescript @babel/core', { stdio: 'inherit' });
        console.log(chalk.green('✅ Installed babel-loader and presets'));
      } catch (error) {
        console.warn(chalk.yellow('⚠️  Could not install babel loaders. You may need to run: npm install --save-dev babel-loader @babel/preset-react @babel/preset-typescript @babel/core'));
      }
    } else {
      // Vite-based frameworks (React, Vue, Svelte, Web Components with Vite)
      if (!mainContent.includes('viteFinal')) {
        const viteConfig = viteFinalConfigSnippet();
        // Insert viteFinal inside the config object, before the closing };
        // Find the last property line and add viteFinal after it
        // Pattern: match the closing }; that ends the config object (before export default)
        if (mainContent.match(/};\s*\n+\s*export\s+default/)) {
          mainContent = mainContent.replace(
            /(\n)(};\s*\n+\s*export\s+default)/,
            `\n  ${viteConfig}\n$2`
          );
          configUpdated = true;
        }
      } else {
        // A user-authored viteFinal is never rewritten. But if it excludes
        // '@tpitre/story-ui' without the CJS chain includes, the V2 workspace
        // cannot mount — so say precisely what is missing instead of skipping
        // silently.
        const missing = missingViteCjsIncludes(mainContent);
        if (missing.length > 0) {
          const one = missing.length === 1;
          console.warn(chalk.yellow(
            `⚠️  Your Storybook config already has a viteFinal that excludes '@tpitre/story-ui' from\n` +
            `    optimizeDeps but is missing the optimizeDeps.include entr${one ? 'y' : 'ies'} its CommonJS-only\n` +
            `    transitive dependencies need:\n` +
            missing.map(m => `      '${m}'`).join('\n') + '\n' +
            `    Without ${one ? 'it' : 'them'} the Story UI workspace fails to mount with\n` +
            `    "does not provide an export named 'default'". Add ${one ? 'it' : 'them'} to optimizeDeps.include\n` +
            `    inside your viteFinal.`
          ));
        }
      }
    }

    // For Web Components: Update tsconfig.json for TSX support
    if (componentFramework === 'web-components') {
      const tsconfigPath = path.join(process.cwd(), 'tsconfig.json');
      if (fs.existsSync(tsconfigPath)) {
        try {
          let tsconfigContent = fs.readFileSync(tsconfigPath, 'utf-8');
          if (!tsconfigContent.includes('"jsx"')) {
            // Add jsx config for TSX compilation
            tsconfigContent = tsconfigContent.replace(
              /"compilerOptions"\s*:\s*\{/,
              '"compilerOptions": {\n    "jsx": "react-jsx",'
            );
            fs.writeFileSync(tsconfigPath, tsconfigContent);
            console.log(chalk.green('✅ Added JSX support to tsconfig.json'));
          }
        } catch (error) {
          console.warn(chalk.yellow('⚠️  Could not update tsconfig.json. You may need to add "jsx": "react-jsx" manually.'));
        }
      }
    }

    if (configUpdated) {
      fs.writeFileSync(actualMainPath, mainContent);
      console.log(chalk.green('✅ Updated Storybook configuration for Story UI'));
    }
  } else {
    console.warn(chalk.yellow('⚠️  Could not find .storybook/main.ts or main.js'));
  }

  // Create considerations file
  const considerationsTemplatePath = path.resolve(__dirname, '../../templates/story-ui-considerations.md');
  const considerationsPath = path.join(process.cwd(), 'story-ui-considerations.md');

  if (!fs.existsSync(considerationsPath) && fs.existsSync(considerationsTemplatePath)) {
    let considerationsContent = fs.readFileSync(considerationsTemplatePath, 'utf-8');

    // Customize based on selected design system
    if (config.importPath) {
      considerationsContent = considerationsContent.replace('[Your Component Library]', config.importPath);
      considerationsContent = considerationsContent.replace('[your-import-path]', config.importPath);
    }

    fs.writeFileSync(considerationsPath, considerationsContent);
    console.log(chalk.green('✅ Created story-ui-considerations.md for AI customization'));
  }

  // Create documentation directory structure
  const docsDir = path.join(process.cwd(), 'story-ui-docs');
  if (!fs.existsSync(docsDir)) {
    console.log(chalk.blue('\n📚 Creating documentation directory structure...'));
    
    // Create main directory and subdirectories
    const subdirs = ['guidelines', 'tokens', 'components', 'patterns'];
    fs.mkdirSync(docsDir, { recursive: true });
    
    for (const subdir of subdirs) {
      fs.mkdirSync(path.join(docsDir, subdir), { recursive: true });
    }

    // Copy README template
    const docsReadmeTemplatePath = path.resolve(__dirname, '../../templates/story-ui-docs-README.md');
    const docsReadmePath = path.join(docsDir, 'README.md');
    
    if (fs.existsSync(docsReadmeTemplatePath)) {
      fs.writeFileSync(docsReadmePath, fs.readFileSync(docsReadmeTemplatePath, 'utf-8'));
    }
    
    console.log(chalk.green('✅ Created story-ui-docs/ directory structure'));
    console.log(chalk.gray('   Add your design system documentation to enhance AI story generation'));
  }

  // Create .env file with provider-specific configuration
  const envPath = path.join(process.cwd(), '.env');
  const selectedProvider = answers.llmProvider || 'claude';
  const providerConfig = LLM_PROVIDERS[selectedProvider as keyof typeof LLM_PROVIDERS];

  if (!fs.existsSync(envPath)) {
    // Generate .env content based on selected provider
    let envContent = `# Story UI Configuration
# Generated by: npx story-ui init

# LLM Provider: ${providerConfig?.name || selectedProvider}
DEFAULT_PROVIDER=${selectedProvider}

# API Key for ${providerConfig?.name || selectedProvider}
# Get your key from: ${providerConfig?.docsUrl || 'your provider dashboard'}
${providerConfig?.envKey || 'API_KEY'}=${answers.apiKey || 'your-api-key-here'}

# Story UI MCP Server Port
VITE_STORY_UI_PORT=${answers.mcpPort || '4001'}

# Optional: Add additional provider keys if you want to switch providers later
# ANTHROPIC_API_KEY=your-anthropic-key
# OPENAI_API_KEY=your-openai-key
# GEMINI_API_KEY=your-gemini-key
`;

    fs.writeFileSync(envPath, envContent);
    console.log(chalk.green(`✅ Created .env file for ${providerConfig?.name || selectedProvider}${answers.apiKey ? ' with your API key' : ''}`));
  } else {
    console.log(chalk.yellow('⚠️  .env file already exists, skipping'));
  }

  // Add .env to .gitignore if not already there
  const gitignorePath = path.join(process.cwd(), '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
    // NOTE: Do NOT add StoryUI/ to gitignore - it must be committed for production deployments
    // The StoryUI panel component needs to be deployed to Railway/production environments
    const patterns = [
      '.env',
      path.relative(process.cwd(), config.generatedStoriesPath),
      '.story-ui-history/'
    ];

    let gitignoreUpdated = false;
    for (const pattern of patterns) {
      if (!gitignoreContent.includes(pattern)) {
        fs.appendFileSync(gitignorePath, `\n${pattern}`);
        gitignoreUpdated = true;
      }
    }

    if (gitignoreUpdated) {
      fs.appendFileSync(gitignorePath, '\n');
      console.log(chalk.green(`✅ Updated .gitignore with Story UI patterns`));
    }
  }

  // Clean up default Storybook template components to prevent conflicts
  cleanupDefaultStorybookComponents();

  // Update package.json with convenience scripts
  if (packageJson) {
    const scripts = packageJson.scripts || {};
    // FIRST_EDIT: include chosen port in script
    const portFlag = `--port ${answers.mcpPort || '4001'}`;

    if (!scripts['story-ui']) {
      scripts['story-ui'] = `story-ui start ${portFlag}`;
    } else if (!scripts['story-ui'].includes('--port')) {
      scripts['story-ui'] += ` ${portFlag}`;
    }

    if (!scripts['storybook-with-ui'] && scripts['storybook']) {
      scripts['storybook-with-ui'] = 'concurrently "npm run storybook" "npm run story-ui"';
    }

    packageJson.scripts = scripts;
    
    // Check and add required dependencies
    const dependencies = packageJson.dependencies || {};
    const devDependencies = packageJson.devDependencies || {};
    let needsInstall = false;
    
    
    // Check for concurrently (needed for storybook-with-ui script)
    if (!dependencies['concurrently'] && !devDependencies['concurrently']) {
      console.log(chalk.blue('📦 Adding concurrently dependency...'));
      devDependencies['concurrently'] = '^8.2.0';
      needsInstall = true;
    }

    // Check for react-live (imported directly by voice canvas templates;
    // cannot be resolved transitively when @tpitre/story-ui is symlinked)
    if (!dependencies['react-live'] && !devDependencies['react-live']) {
      console.log(chalk.blue('📦 Adding react-live dependency (required by voice canvas)...'));
      devDependencies['react-live'] = '^4.1.8';
      needsInstall = true;
    }

    // The panel and the V2 workspace are React, rendered through addon-docs
    // even in a non-React Storybook. react/@storybook/react are OPTIONAL peers
    // of @tpitre/story-ui, so nothing force-installs them: npm usually hoists
    // Storybook's own copy of react, pnpm does not — and then the /workspace
    // export fails to resolve 'react'. Check resolution, not just declaration.
    if (componentFramework !== 'react') {
      const hostRequire = createRequire(path.join(process.cwd(), 'package.json'));
      const unresolvable = ['react', 'react-dom'].filter((pkg) => {
        if (dependencies[pkg] || devDependencies[pkg]) return false;
        try { hostRequire.resolve(pkg); return false; } catch { return true; }
      });
      if (unresolvable.length === 0) {
        console.log(chalk.gray('ℹ️  react already resolves in this project — the Story UI panel needs no extra install'));
      } else {
        console.log(chalk.blue(`📦 Adding ${unresolvable.join(' + ')} (the Story UI panel is React, even in a ${componentFramework} Storybook)...`));
        for (const pkg of unresolvable) {
          devDependencies[pkg] = '^18.3.1';
        }
        needsInstall = true;
      }
    }

    // React hosts need '@storybook/react' — the type import every generated
    // story starts with. It is an OPTIONAL peer (so non-React hosts skip it)
    // and pnpm's auto-install-peers skips optional peers, so on a React + pnpm
    // host it must be installed explicitly, pinned to the host's Storybook major.
    const storybookReactDep = missingReactStorybookDep(
      process.cwd(), { ...dependencies, ...devDependencies }, componentFramework,
    );
    if (storybookReactDep) {
      console.log(chalk.blue(`📦 Adding ${storybookReactDep.name}@${storybookReactDep.range} (generated React stories import their types from it)...`));
      devDependencies[storybookReactDep.name] = storybookReactDep.range;
      needsInstall = true;
    }

    packageJson.dependencies = dependencies;
    packageJson.devDependencies = devDependencies;
    
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
    console.log(chalk.green('✅ Added convenience scripts to package.json'));
    
    if (needsInstall) {
      console.log(chalk.blue('\n📦 Installing required dependencies...'));
      console.log(chalk.gray('This may take a moment...\n'));
      
      // Detect package manager
      const npmLock = fs.existsSync(path.join(process.cwd(), 'package-lock.json'));
      const yarnLock = fs.existsSync(path.join(process.cwd(), 'yarn.lock'));
      const pnpmLock = fs.existsSync(path.join(process.cwd(), 'pnpm-lock.yaml'));
      
      let installCommand = 'npm install';
      if (yarnLock) {
        installCommand = 'yarn install';
      } else if (pnpmLock) {
        installCommand = 'pnpm install';
      }
      
      try {
        execSync(installCommand, { stdio: 'inherit' });
        console.log(chalk.green('✅ Dependencies installed successfully'));
      } catch (error) {
        console.log(chalk.yellow('⚠️  Failed to install dependencies automatically.'));
        console.log(chalk.yellow(`   Please run "${installCommand}" manually to complete the setup.`));
      }
    }
  }


  console.log(chalk.green.bold('\n🎉 Setup complete!\n'));
  console.log(`📁 Configuration saved to: ${chalk.cyan(configPath)}`);
  console.log(`📁 Generated stories will be saved to: ${chalk.cyan(config.generatedStoriesPath)}`);
  console.log(`📁 Story UI component installed to: ${chalk.cyan(path.relative(process.cwd(), storyUITargetDir))}`);

  if (config.importPath) {
    console.log(`📦 Import path: ${chalk.cyan(config.importPath)}`);
  }

  if (!answers.apiKey) {
    const provider = LLM_PROVIDERS[answers.llmProvider as keyof typeof LLM_PROVIDERS] || LLM_PROVIDERS.claude;
    console.log(chalk.yellow(`\n⚠️  Don't forget to add your ${provider.name} API key to .env file!`));
    console.log(`   Get your key from: ${provider.docsUrl}`);
  }

  const providerName = LLM_PROVIDERS[answers.llmProvider as keyof typeof LLM_PROVIDERS]?.name || 'your LLM provider';
  console.log('\n🚀 Next steps:');
  console.log('1. ' + (answers.apiKey ? 'Start' : `Add your ${providerName} API key to .env, then start`) + ' Story UI: npm run story-ui');
  console.log('2. Start Storybook: npm run storybook');
  console.log('3. Navigate to "Story UI > Story Generator" in your Storybook sidebar');
  console.log('4. Start generating UI with natural language prompts!');

  console.log('\n💡 Tips:');
  console.log('- Run both together: npm run storybook-with-ui');
  console.log('- Generated stories are automatically excluded from git');
  console.log('- The Story UI panel is in your stories under "Story UI/Story Generator"');
  console.log('- You can modify story-ui.config.js to customize the configuration');

  console.log('\n📚 Teach the AI your design system (highly recommended):');
  console.log(`- ${chalk.cyan('story-ui-docs/')} — what your design system IS: component docs, design`);
  console.log('  tokens, patterns (Markdown, JSON, YAML, or XML files are all read)');
  console.log(`- ${chalk.cyan('story-ui-considerations.md')} — how the AI should USE it: rules,`);
  console.log('  constraints, and any packages it is explicitly allowed to import');
  console.log(`- For maximum fidelity, add ${chalk.cyan('features: { experimentalComponentsManifest: true }')}`);
  console.log('  to .storybook/main.ts — the AI then learns from your own curated stories');
  console.log('  via @storybook/addon-mcp (keep the "MCP context" toggle on in the panel)');

  console.log('\n🧩 Custom component libraries work too:');
  console.log('- Components in local directories (src/components, src/ui, or a configured');
  console.log('  componentsPath) are discovered automatically — no npm package required —');
  console.log('  and imported into generated stories via their real relative paths');

  console.log('\n🎨 Reference environments that showcase Story UI:');
  console.log('- React + Mantine · Vue 3 + Vuetify · Angular + Material');
  console.log('- Svelte 5 + Flowbite · Web Components + Shoelace');

  // Rendered verification resolves Playwright from the HOST project (see
  // story-generator/verify/hostTooling.ts) — say so now rather than letting
  // every story report "not verified" with no explanation.
  const verifyRequire = createRequire(path.join(process.cwd(), 'package.json'));
  const hasPlaywright = ['playwright', 'playwright-core'].some((pkg) => {
    try { verifyRequire.resolve(pkg); return true; } catch { return false; }
  });
  if (!hasPlaywright) {
    console.log(chalk.gray('\nℹ️  playwright is not installed — generated stories will report "not verified"; installing playwright (or playwright-core) unlocks the rendered-verification tier'));
  }
}
