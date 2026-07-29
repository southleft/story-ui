/**
 * Resolution bench — what does the engine actually KNOW about a design system?
 *
 * Deterministic, free, and runs in seconds. No model, no generation, no
 * variance. It asks only questions with checkable answers:
 *
 *   Can we find the components?
 *   Can we produce an import specifier that resolves to a real file?
 *   Do we know their props?
 *   Do we know how the team uses them?
 *
 * WHY THIS EXISTS. Every defect worth finding this session was a deterministic
 * property of the knowledge layer — dead imports, missing components, wrong
 * names — and every one of them was chased with a generation bench costing
 * minutes and real tokens, noisy enough that a 5-vs-4 result meant nothing. Two
 * separate measurement errors survived that process: a prop validator that
 * flagged correct Mantine style props, and a dead-import count that never
 * checked index files. Both would have been obvious here in one run.
 *
 * The split is the point:
 *   this bench          knowledge — deterministic, run on every change
 *   componentSelection  judgement — LLM, slow, run rarely
 *
 * It doubles as the diagnostic a practitioner runs before adopting: point it at
 * your design system and see, in seconds, how much of it we understand.
 *
 *   node bench/resolution.mjs --project ../college-town --import '@/components'
 *   node bench/resolution.mjs --all
 */

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const flag = (n) => args.includes(`--${n}`);

const DIST = '/Users/tjpitre/Sites/story-ui/dist';

/** Every environment we claim to support, so a change is measured against all. */
const ENVIRONMENTS = [
  { name: 'react-mantine (npm barrel)', project: '/Users/tjpitre/Sites/test-storybooks/react-mantine', storybook: 'http://localhost:6101' },
  { name: 'college-town (Radix+Tailwind, local)', project: '/Users/tjpitre/Sites/college-town', storybook: 'http://localhost:6006' },
  { name: 'mui-material (subpath npm)', project: '/Users/tjpitre/Sites/test-storybooks/mui-material', storybook: 'http://localhost:6107' },
  { name: 'atlaskit (package-per-component)', project: '/Users/tjpitre/Sites/test-storybooks/atlaskit', storybook: 'http://localhost:6108' },
  { name: 'carbon (IBM, barrel + SCSS)', project: '/Users/tjpitre/Sites/test-storybooks/carbon', storybook: 'http://localhost:6109' },
  // Federated barrel: declares nothing, re-exports its whole API from 58
  // sibling packages. Measured by nobody until it was added here, and it was
  // the only architecture reporting props for 0 of 233 components.
  { name: 'fluent (federated barrel)', project: '/Users/tjpitre/Sites/test-storybooks/fluent', storybook: 'http://localhost:6110' },
  // Published June 2026, after every current model's training cutoff — the only
  // environment here that cannot be answered from memory instead of knowledge.
  { name: 'astryx (Meta, StyleX)', project: '/Users/tjpitre/Sites/test-storybooks/astryx', storybook: 'http://localhost:6111' },
  // Namespace-only exports: `import { Menu }` then `<Menu.Root>`. 29 of its 40
  // top-level exports are namespaces, and they were invisible — a shape
  // carrying roughly 10% of the React component-library market by installs.
  { name: 'base-ui (namespace exports)', project: '/Users/tjpitre/Sites/test-storybooks/base-ui', storybook: 'http://localhost:6112' },
  // Federated NAMESPACE barrel — the composition of two architectures, and the
  // single largest package in the ecosystem at 42.4M installs/month. Every one
  // of its 55 siblings arrives as `import * as x` + `export { x as Name }`,
  // which needs federation to reach props AND namespaces to know the members
  // are `Dialog.Root`. Either half alone yields nothing usable.
  { name: 'radix-ui (federated namespace)', project: '/Users/tjpitre/Sites/test-storybooks/radix', storybook: 'http://localhost:6113' },
];

/**
 * Resolve an import specifier the way the project's own tooling would.
 *
 * Reads tsconfig `compilerOptions.paths` rather than assuming `@/` means `src/`.
 * That mapping is a fact a project states; guessing it is how an engine ends up
 * confidently wrong on a repo that uses `~/` or `@ui/` instead.
 */
function makeResolver(projectRoot) {
  let aliases = [];
  for (const name of ['tsconfig.json', 'tsconfig.app.json', 'jsconfig.json']) {
    const file = path.join(projectRoot, name);
    if (!fs.existsSync(file)) continue;
    try {
      // Strip comments and trailing commas; tsconfig is JSON5-ish in practice.
      const raw = fs.readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')
        .replace(/,(\s*[}\]])/g, '$1');
      const json = JSON.parse(raw);
      const paths = json?.compilerOptions?.paths || {};
      const baseUrl = json?.compilerOptions?.baseUrl || '.';
      for (const [pattern, targets] of Object.entries(paths)) {
        aliases.push({
          prefix: pattern.replace(/\*$/, ''),
          targets: targets.map(t => path.resolve(projectRoot, baseUrl, t.replace(/\*$/, ''))),
        });
      }
    } catch { /* unparseable; other sources may still supply aliases */ }
  }

  const EXTS = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.vue', '.svelte'];
  const asFile = (base) =>
    EXTS.some(e => fs.existsSync(base + e)) ||
    EXTS.some(e => fs.existsSync(path.join(base, 'index' + e))) ||
    fs.existsSync(base);

  return {
    aliases,
    /** Does this specifier point at something real? */
    resolves(spec, fromDir) {
      if (!spec) return false;
      // Bare package specifier — node_modules' problem, not ours.
      if (!spec.startsWith('.') && !aliases.some(a => spec.startsWith(a.prefix))) {
        return fs.existsSync(path.join(projectRoot, 'node_modules', spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/')));
      }
      if (spec.startsWith('.')) return asFile(path.resolve(fromDir, spec));
      for (const a of aliases) {
        if (!spec.startsWith(a.prefix)) continue;
        const rest = spec.slice(a.prefix.length);
        if (a.targets.some(t => asFile(path.join(t, rest)))) return true;
      }
      return false;
    },
  };
}

async function measure(env) {
  const { loadUserConfig } = await import(pathToFileURL(`${DIST}/story-generator/configLoader.js`).href);
  const { EnhancedComponentDiscovery } = await import(pathToFileURL(`${DIST}/story-generator/enhancedComponentDiscovery.js`).href);
  const { getFrameworkAdapter } = await import(pathToFileURL(`${DIST}/story-generator/framework-adapters/index.js`).href)
    .catch(() => ({ getFrameworkAdapter: null }));
  const { ReactAdapter } = await import(pathToFileURL(`${DIST}/story-generator/framework-adapters/react-adapter.js`).href);

  // One definition of "is this a real description", shared with the pipeline.
  const { saysMoreThanName } = await import(
    pathToFileURL(`${DIST}/story-generator/knowledge/descriptionQuality.js`).href
  );

  const prevCwd = process.cwd();
  process.chdir(env.project);
  const config = await loadUserConfig();

  const discovery = new EnhancedComponentDiscovery(config);
  // Give discovery the same Storybook knowledge generation gives it.
  try {
    const { storybookComponentDirs } = await import(pathToFileURL(`${DIST}/story-generator/knowledge/storybookCatalog.js`).href);
    const dirs = await storybookComponentDirs({ storybookUrl: env.storybook, projectRoot: env.project });
    if (dirs.length && discovery.setStorybookComponentDirs) discovery.setStorybookComponentDirs(dirs);
  } catch { /* Storybook not running; discovery still works from the filesystem */ }

  const components = await discovery.discoverAll();

  /**
   * Apply the same enrichment the generation pipeline applies.
   *
   * generationCore enriches the catalog with prop signatures read from the
   * package's type declarations AFTER discovery returns. A bench that stops at
   * discovery reported 4% prop coverage for a library where propExtractor knows
   * 235 components — measuring a stage the model never sees. If this bench is
   * to mean anything it has to mirror the pipeline, not a slice of it.
   */
  /**
   * Prop-level knowledge, counted over the components we actually discovered.
   *
   * Prop coverage alone says a component HAS props, not that we know anything
   * about them. Reading Carbon's propTypes added 2,399 prop descriptions and
   * 88 deprecations without moving the prop-coverage number at all — a gain
   * this bench could not see, and therefore could not protect.
   *
   * Deprecations are broken out because they are the one fact here that
   * decides whether output is acceptable to the team that owns the system.
   */
  let docedProps = 0, totalProps = 0, deprecatedProps = 0, defaultedProps = 0;

  try {
    const { extractProps, extractPropsForPackages, rankProps } = await import(pathToFileURL(`${DIST}/story-generator/knowledge/propExtractor.js`).href);
    // Same package selection as the pipeline: a design system spread over many
    // packages is read package by package, not as one truncated tree.
    const homes = [...new Set(components.map(c => c.__componentPath).filter(p => typeof p === 'string'))];
    const extracted = homes.length > 1
      ? await extractPropsForPackages([config.importPath, ...homes], env.project)
      : await extractProps(config.importPath, env.project);
    if (extracted) {
      for (const component of components) {
        const facts = extracted.components[component.name];
        if (!facts) continue;
        if (!component.props || component.props.length === 0) {
          component.props = rankProps(facts.props).map(p => `${p.name}${p.required ? '' : '?'}`);
        }
        // Prose the package writes about itself, same precedence as the
        // pipeline: never overwrite a description read from project source.
        if (facts.doc && !saysMoreThanName(component.name, component.description)) component.description = facts.doc;
        totalProps += facts.props.length;
        docedProps += facts.props.filter(p => p.doc).length;
        deprecatedProps += facts.props.filter(p => p.deprecated).length;
        defaultedProps += facts.props.filter(p => p.defaultValue).length;
      }
    }
  } catch { /* npm type declarations unavailable; local sources still counted */ }

  // Source facts: variant maps and the team's own prose, same as the pipeline.
  try {
    const { enrichWithSourceFacts } = await import(pathToFileURL(`${DIST}/story-generator/knowledge/sourceFacts.js`).href);
    enrichWithSourceFacts(components);
  } catch { /* source facts unavailable */ }

  // Storybook's own component manifest is the pipeline's example source.
  try {
    const res = await fetch(`${env.storybook.replace(/\/+$/, '')}/manifests/components.json`, {
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const manifest = await res.json();
      const byName = new Map();
      for (const entry of Object.values(manifest.components || {})) {
        if (entry?.name) byName.set(entry.name, entry);
      }
      for (const component of components) {
        const entry = byName.get(component.name);
        if (entry?.stories?.length && (!component.examples || component.examples.length === 0)) {
          component.examples = entry.stories.map(st => st.snippet).filter(Boolean);
        }
      }
    }
  } catch { /* Storybook not running or no manifest */ }

  const adapter = new ReactAdapter();
  const resolver = makeResolver(env.project);
  const generatedDir = path.resolve(env.project, config.generatedStoriesPath || './src/stories/generated');

  // The adapter's catalog text is exactly what the model is told, so parse the
  // specifiers back out of it rather than calling a private method.
  //
  // Match the QUOTED PATH, not the sentence around it. The catalog gained a
  // second phrasing for default exports (`import Avatar from '...'`) and a
  // regex pinned to `(import from '` silently stopped checking every component
  // that used it — atlaskit fell from 31 specifiers to 10 and still reported
  // "All specifiers resolve". A coverage check that quietly shrinks is worse
  // than no check, so the count is asserted against the catalog below.
  const reference = adapter.generateComponentReference(components, config);
  const specs = new Map();
  for (const m of reference.matchAll(/\*\*([A-Za-z0-9_]+)\*\* \((?:import\s+(?:\w+\s+)?from\s+)?'([^']+)'/g)) {
    specs.set(m[1], m[2]);
  }

  // Every catalog entry offers an import path; if we parsed fewer than the
  // catalog lists, the parser has drifted from the format again.
  const entryCount = (reference.match(/^- \*\*[A-Za-z0-9_]+\*\* \(/gm) || []).length;
  if (specs.size < entryCount) {
    throw new Error(
      `bench parser drift: catalog lists ${entryCount} components but only ${specs.size} import specifiers were parsed. ` +
      `The catalog format changed; update the regex before trusting any number below.`,
    );
  }

  const dead = [];
  for (const [name, spec] of specs) {
    if (!resolver.resolves(spec, generatedDir)) dead.push(`${name} -> ${spec}`);
  }

  const withProps = components.filter(c => (c.props || []).length > 0).length;
  /**
   * A description counts only if it says something the component's NAME does
   * not — the same predicate the pipeline uses to decide whether to REPLACE a
   * description. This bench kept its own copy, and the two drifted: enrichment
   * treated discovery's `Chip component from Material UI` as a real
   * description and declined to overwrite it, while the bench correctly
   * scored it as nothing. The result read as "extraction found no
   * descriptions" when extraction had found 32 and been refused.
   */
  const withDesc = components.filter(c => saysMoreThanName(c.name, c.description)).length;
  const withExamples = components.filter(c => (c.examples || []).length > 0).length;

  process.chdir(prevCwd);
  return {
    environment: env.name,
    aliasesRead: resolver.aliases.map(a => a.prefix),
    components: components.length,
    withSpecifier: specs.size,
    resolvable: specs.size - dead.length,
    dead,
    knowProps: withProps,
    totalProps, docedProps, deprecatedProps, defaultedProps,
    knowDescription: withDesc,
    knowExamples: withExamples,
  };
}

function report(r) {
  const pct = (n, d) => d === 0 ? '—' : `${Math.round((100 * n) / d)}%`;
  console.log(`\n=== ${r.environment} ===`);
  console.log(`  aliases read from tsconfig : ${r.aliasesRead.length ? r.aliasesRead.join(', ') : 'none'}`);
  console.log(`  components discovered      : ${r.components}`);
  console.log(`  import specifier resolves  : ${r.resolvable}/${r.withSpecifier}  ${pct(r.resolvable, r.withSpecifier)}`);
  console.log(`  props known                : ${r.knowProps}/${r.components}  ${pct(r.knowProps, r.components)}`);
  console.log(`  real description known     : ${r.knowDescription}/${r.components}  ${pct(r.knowDescription, r.components)}`);
  // Held, not shipped: see the note in generationCore's enrichment block.
  console.log(`  prop descriptions known    : ${r.docedProps}/${r.totalProps}  ${pct(r.docedProps, r.totalProps)}  (knowledge only, not in catalog)`);
  console.log(`  prop defaults known        : ${r.defaultedProps}`);
  console.log(`  deprecated props flagged   : ${r.deprecatedProps}`);
  console.log(`  usage example known        : ${r.knowExamples}/${r.components}  ${pct(r.knowExamples, r.components)}`);
  if (r.dead.length) {
    console.log(`  DEAD SPECIFIERS (${r.dead.length}):`);
    for (const d of r.dead.slice(0, 12)) console.log(`    ${d}`);
    if (r.dead.length > 12) console.log(`    …and ${r.dead.length - 12} more`);
  }
}

/**
 * Each environment runs in its OWN process.
 *
 * Measuring two projects in one process reported college-town as importing 229
 * components from `@mantine/core`: the config loader caches, discovery holds
 * module state, and process.chdir does not undo either. A bench that leaks
 * state between subjects measures the leak.
 */
if (flag('all')) {
  const { spawnSync } = await import('child_process');
  let failed = 0;
  for (const env of ENVIRONMENTS) {
    const r = spawnSync(process.execPath, [
      new URL(import.meta.url).pathname,
      '--project', env.project,
      '--storybook', env.storybook,
      '--name', env.name,
    ], { encoding: 'utf8' });
    process.stdout.write((r.stdout || '').split('\n').filter(l => /^(===|  [a-z]|    |DEAD|\d+ dead|All specifiers)/.test(l)).join('\n') + '\n');
    if (r.status !== 0) failed++;
  }
  console.log(failed === 0 ? '\nAll environments clean.' : `\n${failed} environment(s) with dead specifiers.`);
  process.exit(failed > 0 ? 1 : 0);
}

const env = {
  name: arg('name', arg('project', ENVIRONMENTS[0].project)),
  project: path.resolve(arg('project', ENVIRONMENTS[0].project)),
  storybook: arg('storybook', ''),
};

try {
  const r = await measure(env);
  report(r);
  // An empty catalog previously reported "All specifiers resolve" and exited 0
  // — the atlaskit scope discovered nothing and the bench called it clean.
  if (r.components === 0) {
    console.log('\nNO COMPONENTS DISCOVERED — the engine knows nothing about this design system.');
    process.exit(1);
  }
  console.log(`\n${r.dead.length === 0 ? 'All specifiers resolve.' : `${r.dead.length} dead specifier(s).`}`);
  process.exit(r.dead.length > 0 ? 1 : 0);
} catch (e) {
  console.log(`\n=== ${env.name} ===\n  FAILED: ${String(e).slice(0, 300)}`);
  process.exit(1);
}
