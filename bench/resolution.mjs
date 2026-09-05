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
import { pathToFileURL, fileURLToPath } from 'url';

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const flag = (n) => args.includes(`--${n}`);

/**
 * The build this bench measures: this repository's own dist, found from the
 * script's location. It used to be an absolute path to one machine.
 */
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(REPO, 'dist');

/**
 * Where the Storybook fixtures live. They are separate checkouts, not part of
 * this repository, so only their LOCATION is configurable — the list below,
 * which is the set of environments Story UI claims to support, stays in git.
 */
const PROJECTS_ROOT = process.env.STORY_UI_TEST_PROJECTS
  ? path.resolve(process.env.STORY_UI_TEST_PROJECTS)
  : path.resolve(REPO, '..', 'test-storybooks');
const project = (dir) => path.resolve(PROJECTS_ROOT, dir);

/** Every environment we claim to support, so a change is measured against all. */
const ENVIRONMENTS = [
  { name: 'react-mantine (npm barrel)', project: project('react-mantine'), storybook: 'http://localhost:6101' },
  { name: 'college-town (Radix+Tailwind, local)', project: project('../college-town'), storybook: 'http://localhost:6006' },
  { name: 'mui-material (subpath npm)', project: project('mui-material'), storybook: 'http://localhost:6107' },
  { name: 'atlaskit (package-per-component)', project: project('atlaskit'), storybook: 'http://localhost:6108' },
  { name: 'carbon (IBM, barrel + SCSS)', project: project('carbon'), storybook: 'http://localhost:6109' },
  // Federated barrel: declares nothing, re-exports its whole API from 58
  // sibling packages. Measured by nobody until it was added here, and it was
  // the only architecture reporting props for 0 of 233 components.
  { name: 'fluent (federated barrel)', project: project('fluent'), storybook: 'http://localhost:6110' },
  // Published June 2026, after every current model's training cutoff — the only
  // environment here that cannot be answered from memory instead of knowledge.
  { name: 'astryx (Meta, StyleX)', project: project('astryx'), storybook: 'http://localhost:6111' },
  // Namespace-only exports: `import { Menu }` then `<Menu.Root>`. 29 of its 40
  // top-level exports are namespaces, and they were invisible — a shape
  // carrying roughly 10% of the React component-library market by installs.
  { name: 'base-ui (namespace exports)', project: project('base-ui'), storybook: 'http://localhost:6112' },
  // Federated NAMESPACE barrel — the composition of two architectures, and the
  // single largest package in the ecosystem at 42.4M installs/month. Every one
  // of its 55 siblings arrives as `import * as x` + `export { x as Name }`,
  // which needs federation to reach props AND namespaces to know the members
  // are `Dialog.Root`. Either half alone yields nothing usable.
  { name: 'radix-ui (federated namespace)', project: project('radix'), storybook: 'http://localhost:6113' },
  // Ships BOTH surfaces for the same components — flat `DialogRoot` and
  // namespace `Dialog.Root` — and states nearly every prop through an inherited
  // generic, which is the deepest heritage chain measured anywhere.
  { name: 'chakra-v3 (dual surface)', project: project('chakra'), storybook: 'http://localhost:6114' },
  // The four non-React frameworks CLAUDE.md claims support for. Until they
  // were listed here their numbers were assumed, not measured — and the bench
  // instantiated ReactAdapter for every environment regardless of the
  // configured componentFramework, so it could not have measured them anyway.
  { name: 'vue-vuetify (Vue 3)', project: project('vue-vuetify'), storybook: 'http://localhost:6103' },
  { name: 'angular-material (Angular)', project: project('angular-material'), storybook: 'http://localhost:6102' },
  { name: 'svelte-flowbite (Svelte 5)', project: project('svelte-flowbite'), storybook: 'http://localhost:6104' },
  { name: 'web-components-shoelace (Lit)', project: project('web-components-shoelace'), storybook: 'http://localhost:6105' },
];

/**
 * Does the package actually EXPORT the name the catalog tells the model to
 * import? "node_modules/<pkg> exists" was the whole check, and it is the wrong
 * question: a specifier can resolve to a real package that has no such export,
 * and the story then fails at runtime with "does not provide an export named".
 *
 * Reads the package's declarations entry (or its JS entry) and follows
 * `export * from`, braced re-exports and CommonJS `__exportStar`, so a barrel
 * of barrels is checked to its leaves. Deliberately independent of the
 * engine's own declaration reader: a bench that reuses the code under test
 * cannot see that code's mistakes.
 *
 * Returns 'present', 'missing', or 'unchecked' when no entry could be read —
 * and 'unchecked' is reported as such, never folded into either answer.
 */
function makeExportChecker(projectRoot) {
  const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
  const pkgNameOf = (spec) => spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];

  function pkgDirFor(name) {
    let dir = projectRoot;
    for (let i = 0; i < 12; i++) {
      const candidate = path.join(dir, 'node_modules', ...name.split('/'));
      if (isFile(path.join(candidate, 'package.json'))) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return null;
  }

  /** The declarations entry for `<pkg>/<subpath>`, else the JS entry, else null. */
  function entryFor(pkgDir, subpath) {
    let pkg = {};
    try { pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')); } catch { /* no manifest */ }
    const found = [];
    const walk = (node, depth = 0) => {
      if (depth > 5 || node == null) return;
      if (typeof node === 'string') { found.push(node); return; }
      if (Array.isArray(node)) return node.forEach(n => walk(n, depth + 1));
      if (typeof node === 'object') {
        if (typeof node.types === 'string') found.push(node.types);
        for (const [k, v] of Object.entries(node)) if (k !== 'types') walk(v, depth + 1);
      }
    };
    if (pkg.exports) {
      const key = subpath ? `./${subpath}` : '.';
      if (typeof pkg.exports === 'string') { if (!subpath) found.push(pkg.exports); }
      else if (pkg.exports[key] !== undefined) walk(pkg.exports[key]);
      else if (!subpath) walk(pkg.exports);
      else {
        // Pattern keys: `./components/*` → `./lib/components/*\/index.js`.
        for (const [k, v] of Object.entries(pkg.exports)) {
          if (!k.includes('*')) continue;
          const star = k.indexOf('*');
          const pre = k.slice(0, star), post = k.slice(star + 1);
          if (!key.startsWith(pre) || !key.endsWith(post) || key.length < pre.length + post.length) continue;
          const filled = key.slice(pre.length, key.length - post.length);
          const sub = [];
          walk(v, 0); // collect into found, then rewrite the tail we just added
          const added = found.splice(found.length - (found.length - sub.length), found.length);
          for (const t of added) found.push(t.replace('*', filled));
        }
      }
    }
    if (!subpath) {
      for (const k of ['types', 'typings', 'main', 'module']) if (typeof pkg[k] === 'string') found.push(pkg[k]);
      found.push('index.d.ts', 'index.ts', 'index.js', 'index.mjs');
    } else {
      const nested = path.join(pkgDir, subpath);
      if (isFile(path.join(nested, 'package.json'))) return entryFor(nested, '');
      found.push(`${subpath}/index.d.ts`, `${subpath}.d.ts`, `${subpath}/index.ts`, `${subpath}/index.js`, `${subpath}.js`, `${subpath}/index.mjs`);
    }
    const decl = (p) => /\.(d\.[cm]?ts|ts|tsx|mts)$/.test(p);
    const ordered = [...found.filter(decl), ...found.filter(p => !decl(p))];
    const entries = { declarations: null, runtime: null };
    for (const rel of ordered) {
      const full = path.join(pkgDir, rel);
      if (decl(rel) && isFile(full)) { entries.declarations ??= full; continue; }
      const twin = full.replace(/\.(m?js|cjs|jsx)$/, '');
      if (twin !== full) for (const e of ['.d.ts', '.d.mts', '.d.cts']) if (isFile(twin + e)) { entries.declarations ??= twin + e; break; }
      if (isFile(full)) entries.runtime ??= full;
    }
    return entries.declarations || entries.runtime ? entries : null;
  }

  const DECL_EXTS = ['.d.ts', '.d.mts', '.ts', '.tsx', '.mts'];
  const JS_EXTS = ['.js', '.mjs', '.cjs', '.vue', '.svelte'];
  function resolve(spec, fromFile) {
    if (spec.startsWith('.')) {
      const base = path.resolve(path.dirname(fromFile), spec);
      const stripped = base.replace(/\.(m?js|cjs|jsx)$/, '');
      // Stay in the world we came from: a JS barrel's `./FormLabel` is its
      // JS sibling, whose exports may exceed what the .d.ts twin declares.
      const fromJs = /\.(m?js|cjs)$/.test(fromFile);
      const EXTS = fromJs ? [...JS_EXTS, ...DECL_EXTS] : [...DECL_EXTS, ...JS_EXTS];
      const candidates = [
        ...(stripped !== base && !fromJs ? DECL_EXTS.map(e => stripped + e) : []),
        base, ...EXTS.map(e => base + e), ...EXTS.map(e => path.join(base, 'index' + e)),
      ];
      return candidates.find(isFile) ?? null;
    }
    const dir = pkgDirFor(pkgNameOf(spec));
    if (!dir) return null;
    const sub = spec.length > pkgNameOf(spec).length ? spec.slice(pkgNameOf(spec).length + 1) : '';
    const e = entryFor(dir, sub);
    return e ? (e.declarations || e.runtime) : null;
  }

  const cache = new Map();
  function exportsIn(file, depth = 0, seen = new Set()) {
    if (cache.has(file)) return cache.get(file);
    const names = new Set();
    cache.set(file, names);
    if (seen.has(file) || depth > 5) return names;
    seen.add(file);
    if (/\.(vue|svelte)$/.test(file)) { names.add('default'); return names; }
    let src = '';
    try { src = fs.readFileSync(file, 'utf8'); } catch { return names; }

    let m;
    const declRe = /export\s+(?:declare\s+)?(?:abstract\s+)?(?:default\s+)?(?:const\s+enum|const|let|var|async\s+function\*?|function\*?|class|type|interface|enum|namespace)\s+([A-Za-z_$][\w$]*)/g;
    while ((m = declRe.exec(src)) !== null) names.add(m[1]);
    if (/export\s+default\b/.test(src)) names.add('default');
    const bracedRe = /export\s*(?:type\s+)?\{([^}]*)\}(?:\s*from\s*['"]([^'"]+)['"])?/g;
    while ((m = bracedRe.exec(src)) !== null) {
      for (const raw of m[1].split(',')) {
        const entry = raw.trim().replace(/^type\s+/, '');
        if (!entry) continue;
        const parts = entry.split(/\s+as\s+/).map(p => p.trim());
        names.add(parts[parts.length - 1]);
      }
    }
    const starAsRe = /export\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s+from/g;
    while ((m = starAsRe.exec(src)) !== null) names.add(m[1]);
    const cjsRe = /(?:^|[^.\w])exports\.([A-Za-z_$][\w$]*)\s*=|Object\.defineProperty\(\s*exports\s*,\s*['"]([A-Za-z_$][\w$]*)['"]/g;
    while ((m = cjsRe.exec(src)) !== null) names.add(m[1] || m[2]);

    const follow = [];
    const starRe = /export\s*\*\s*from\s*['"]([^'"]+)['"]/g;
    while ((m = starRe.exec(src)) !== null) follow.push(m[1]);
    const exportStarRe = /__export(?:Star)?\(\s*require\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((m = exportStarRe.exec(src)) !== null) follow.push(m[1]);
    const reassign = src.match(/module\.exports\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/);
    if (reassign) follow.push(reassign[1]);
    // Babel's export-star: `var _x = _interopRequireWildcard(require("./x"));
    // Object.keys(_x).forEach(...)`. MUI's CJS barrel re-exports every
    // component's siblings this way, and nothing else declares them.
    const required = new Map();
    const reqRe = /(?:var|const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:_interopRequireWildcard\(|_interopRequireDefault\()?\s*require\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((m = reqRe.exec(src)) !== null) required.set(m[1], m[2]);
    const keysRe = /Object\.keys\(\s*([A-Za-z_$][\w$]*)\s*\)\.forEach/g;
    while ((m = keysRe.exec(src)) !== null) if (required.has(m[1])) follow.push(required.get(m[1]));
    for (const spec of follow) {
      const target = resolve(spec, file);
      if (!target) continue;
      for (const n of exportsIn(target, depth + 1, seen)) if (n !== 'default') names.add(n);
    }
    return names;
  }

  return {
    /** 'present' | 'missing' | 'unchecked' */
    check(spec, name, isDefault) {
      const pkgName = pkgNameOf(spec);
      const dir = pkgDirFor(pkgName);
      if (!dir) return 'unchecked';
      const sub = spec.length > pkgName.length ? spec.slice(pkgName.length + 1) : '';
      const entry = entryFor(dir, sub);
      if (!entry) return 'unchecked';
      // Declarations OR runtime: MUI exports `FormLabelRoot` from FormLabel.js
      // and never declares it. A name the runtime module provides is present,
      // whatever the .d.ts omits — the story would import it fine.
      const want = isDefault ? 'default' : name;
      if (entry.declarations && exportsIn(entry.declarations).has(want)) return 'present';
      if (entry.runtime && exportsIn(entry.runtime).has(want)) return 'runtime-only';
      return 'missing';
    },
  };
}

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

  /**
   * A bare specifier resolves the way Node resolves it: through the package's
   * `exports` map when it has one. "node_modules/<pkg> exists" accepted
   * `vuetify/components/lib/components/VApp` — a path Vuetify's map does not
   * expose — as resolvable, for 172 components.
   */
  const bareResolves = (spec) => {
    const pkgName = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
    let pkgDir = null;
    let dir = projectRoot;
    for (let i = 0; i < 12; i++) {
      const candidate = path.join(dir, 'node_modules', ...pkgName.split('/'));
      if (fs.existsSync(path.join(candidate, 'package.json'))) { pkgDir = candidate; break; }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    if (!pkgDir) return false;
    const subpath = spec.length > pkgName.length ? spec.slice(pkgName.length + 1) : '';
    if (!subpath) return true;
    let pkg = {};
    try { pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')); } catch { /* no manifest */ }
    if (!pkg.exports || typeof pkg.exports === 'string') return asFile(path.join(pkgDir, subpath));
    const targets = (node, out = [], depth = 0) => {
      if (depth > 5 || node == null) return out;
      if (typeof node === 'string') { out.push(node); return out; }
      if (Array.isArray(node)) { node.forEach(n => targets(n, out, depth + 1)); return out; }
      if (typeof node === 'object') for (const v of Object.values(node)) targets(v, out, depth + 1);
      return out;
    };
    const key = `./${subpath}`;
    if (pkg.exports[key] !== undefined) return targets(pkg.exports[key]).some(t => asFile(path.join(pkgDir, t)));
    for (const [k, v] of Object.entries(pkg.exports)) {
      if (!k.includes('*')) continue;
      const star = k.indexOf('*');
      const pre = k.slice(0, star), post = k.slice(star + 1);
      if (!key.startsWith(pre) || !key.endsWith(post) || key.length < pre.length + post.length) continue;
      const filled = key.slice(pre.length, key.length - post.length);
      if (targets(v).some(t => asFile(path.join(pkgDir, t.replace('*', filled))))) return true;
    }
    return false;
  };

  return {
    aliases,
    isBare: (spec) => !spec.startsWith('.') && !aliases.some(a => spec.startsWith(a.prefix)),
    /** Does this specifier point at something real? */
    resolves(spec, fromDir) {
      if (!spec) return false;
      if (!spec.startsWith('.') && !aliases.some(a => spec.startsWith(a.prefix))) return bareResolves(spec);
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
  const { getAdapter } = await import(pathToFileURL(`${DIST}/story-generator/framework-adapters/index.js`).href);

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

  /** Kept for the counts below, which run outside this block. */
  let extractedFacts = null;
  try {
    const { extractProps, extractPropsForPackages, rankProps } = await import(pathToFileURL(`${DIST}/story-generator/knowledge/propExtractor.js`).href);
    // Same package selection as the pipeline: a design system spread over many
    // packages is read package by package, not as one truncated tree.
    const homes = [...new Set(components.map(c => c.__componentPath).filter(p => typeof p === 'string'))];
    const extracted = homes.length > 1
      ? await extractPropsForPackages([config.importPath, ...homes], env.project)
      : await extractProps(config.importPath, env.project);
    extractedFacts = extracted;
    if (extracted) {
      for (const component of components) {
        // Same join the pipeline makes: a package's default export under the
        // name the project actually imports it by.
        const facts = extracted.components[component.name]
          ?? (component.__componentPath && extracted.defaultExports?.[component.__componentPath]
            ? extracted.components[extracted.defaultExports[component.__componentPath]]
            : undefined);
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
  //
  // It requires a RUNNING Storybook. When there is none, examples cannot be
  // measured at all — and printing that as `0%` is the exact failure this
  // bench exists to catch, committed by the bench itself: for a long time
  // every environment reported "usage example known: 0%" and it meant only
  // that nobody had started a dev server.
  let manifestReachable = true;
  try {
    const res = await fetch(`${env.storybook.replace(/\/+$/, '')}/manifests/components.json`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) manifestReachable = false;
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
  } catch {
    // Storybook not running, or no manifest at that URL.
    manifestReachable = false;
  }

  /**
   * The adapter for the CONFIGURED framework, not React for everyone.
   *
   * `new ReactAdapter()` was hardcoded here, so a Vue, Angular, Svelte or
   * Web Components environment would have been measured against a catalog
   * those frameworks never see. Which adapter answered is printed, so a
   * silent fallback to React cannot masquerade as a measurement.
   */
  const framework = config.componentFramework || 'react';
  const adapter = getAdapter(framework);
  if (!adapter) throw new Error(`no framework adapter registered for componentFramework "${framework}"`);
  const resolver = makeResolver(env.project);
  const exportChecker = makeExportChecker(env.project);
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
  const defaultImports = new Set();
  for (const m of reference.matchAll(/\*\*([A-Za-z0-9_]+)\*\* \((?:import\s+(\w+\s+)?from\s+)?'([^']+)'/g)) {
    specs.set(m[1], m[3]);
    if (m[2]) defaultImports.add(m[1]);
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
  const missingExport = [];
  const uncheckedExport = [];
  const runtimeOnlyExport = [];
  let bareSpecifiers = 0;
  for (const [name, spec] of specs) {
    if (!resolver.resolves(spec, generatedDir)) { dead.push(`${name} -> ${spec}`); continue; }
    // A bare specifier that resolves only proves the PACKAGE is installed.
    // The named export is a separate fact, and a separate failure.
    const bare = !spec.startsWith('.') && !resolver.aliases.some(a => spec.startsWith(a.prefix));
    if (!bare) continue;
    // A custom element is imported for its side effect (`import 'lib/button'`
    // registers the tag); there is no named export to check, and the module
    // resolving IS the check, which the dead-specifier pass already made.
    if (framework === 'web-components') continue;
    bareSpecifiers++;
    const verdict = exportChecker.check(spec, name, defaultImports.has(name));
    if (verdict === 'missing') missingExport.push(`${name} -> ${spec}${defaultImports.has(name) ? ' (default)' : ''}`);
    else if (verdict === 'unchecked') uncheckedExport.push(`${name} -> ${spec}`);
    else if (verdict === 'runtime-only') runtimeOnlyExport.push(`${name} -> ${spec}`);
  }

  /**
   * A component that declares nothing beyond its library's shared styling
   * surface is KNOWN, not unknown: the compiler resolved it and there was
   * nothing of its own to report. Counting it as a gap made one library look
   * 40 points worse than it is.
   */
  const knownByBase = new Set(
    Object.entries(extractedFacts?.components || {})
      .filter(([, f]) => (f.sharedBaseOnly || f.declaresNoProps || f.namespaceMembers?.length) && !(f.props || []).length)
      .map(([name]) => name),
  );
  /**
   * Exports the compiler proved are not components — an NgModule, an injection
   * token, a version constant. They were counted as components we knew nothing
   * about, which is two errors at once: the percentage looked worse than the
   * knowledge, and the catalog was offering the model something it cannot
   * write. Excluded from the denominator and reported, never silently dropped.
   */
  const notComponents = new Set(
    Object.entries(extractedFacts?.components || {})
      .filter(([, f]) => f.notAComponent)
      .map(([name]) => name),
  );
  const judged = components.filter(c => !notComponents.has(c.name));
  const excluded = components.length - judged.length;
  const withProps = judged.filter(c => (c.props || []).length > 0 || knownByBase.has(c.name)).length;
  /**
   * WHICH components we know nothing about, not just how many.
   *
   * A percentage cannot tell a real gap from a denominator full of things that
   * are not components — namespace objects, type exports, modules — and the two
   * call for opposite fixes. Named here so the next reader can tell them apart.
   */
  const noProps = judged.filter(c => (c.props || []).length === 0 && !knownByBase.has(c.name)).map(c => c.name);
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
    framework,
    adapter: adapter.type,
    aliasesRead: resolver.aliases.map(a => a.prefix),
    components: components.length,
    withSpecifier: specs.size,
    resolvable: specs.size - dead.length,
    dead,
    bareSpecifiers,
    missingExport,
    uncheckedExport,
    runtimeOnlyExport,
    knowProps: withProps,
    noProps,
    judgedComponents: judged.length,
    excludedNotComponents: excluded,
    totalProps, docedProps, deprecatedProps, defaultedProps,
    knowDescription: withDesc,
    knowExamples: withExamples,
    manifestReachable,
  };
}

function report(r) {
  const pct = (n, d) => d === 0 ? '—' : `${Math.round((100 * n) / d)}%`;
  console.log(`\n=== ${r.environment} ===`);
  console.log(`  framework / adapter        : ${r.framework} / ${r.adapter}`);
  console.log(`  aliases read from tsconfig : ${r.aliasesRead.length ? r.aliasesRead.join(', ') : 'none'}`);
  console.log(`  components discovered      : ${r.components}`);
  console.log(`  import specifier resolves  : ${r.resolvable}/${r.withSpecifier}  ${pct(r.resolvable, r.withSpecifier)}`);
  const checked = r.bareSpecifiers - r.uncheckedExport.length;
  console.log(r.bareSpecifiers === 0
    ? (r.framework === 'web-components'
      ? `  named export present       : n/a — custom elements are side-effect imports; the specifier resolving is the check`
      : `  named export present       : n/a — no bare package specifiers in this catalog`)
    : `  named export present       : ${checked - r.missingExport.length}/${checked}  ${pct(checked - r.missingExport.length, checked)}` +
      (r.uncheckedExport.length ? `  (${r.uncheckedExport.length} NOT CHECKED — no readable package entry)` : ''));
  console.log(`  props known                : ${r.knowProps}/${r.judgedComponents ?? r.components}  ${pct(r.knowProps, r.judgedComponents ?? r.components)}`
    + (r.excludedNotComponents ? `  (${r.excludedNotComponents} export(s) excluded: the compiler proved they cannot be written as an element)` : ''));
  if (r.noProps?.length) {
    console.log(`    no props known for ${r.noProps.length}: ${r.noProps.slice(0, 14).join(', ')}${r.noProps.length > 14 ? ' …' : ''}`);
  }
  console.log(`  real description known     : ${r.knowDescription}/${r.components}  ${pct(r.knowDescription, r.components)}`);
  // Held, not shipped: see the note in generationCore's enrichment block.
  console.log(`  prop descriptions known    : ${r.docedProps}/${r.totalProps}  ${pct(r.docedProps, r.totalProps)}  (knowledge only, not in catalog)`);
  console.log(`  prop defaults known        : ${r.defaultedProps}`);
  console.log(`  deprecated props flagged   : ${r.deprecatedProps}`);
  console.log(r.manifestReachable
    ? `  usage example known        : ${r.knowExamples}/${r.components}  ${pct(r.knowExamples, r.components)}`
    : `  usage example known        : NOT MEASURED — Storybook unreachable, so this is not zero`);
  if (r.dead.length) {
    console.log(`  DEAD SPECIFIERS (${r.dead.length}):`);
    for (const d of r.dead.slice(0, 12)) console.log(`    ${d}`);
    if (r.dead.length > 12) console.log(`    …and ${r.dead.length - 12} more`);
  }
  if (r.missingExport.length) {
    console.log(`  PACKAGE PRESENT BUT EXPORT MISSING (${r.missingExport.length}):`);
    for (const d of r.missingExport.slice(0, 12)) console.log(`    ${d}`);
    if (r.missingExport.length > 12) console.log(`    …and ${r.missingExport.length - 12} more`);
  }
  if (r.runtimeOnlyExport.length) {
    // The story renders; a typechecked consumer would not compile. Both facts.
    console.log(`  EXPORT PRESENT AT RUNTIME ONLY, undeclared in types (${r.runtimeOnlyExport.length}):`);
    for (const d of r.runtimeOnlyExport.slice(0, 6)) console.log(`    ${d}`);
    if (r.runtimeOnlyExport.length > 6) console.log(`    …and ${r.runtimeOnlyExport.length - 6} more`);
  }
  if (r.uncheckedExport.length) {
    console.log(`  EXPORT NOT CHECKED (${r.uncheckedExport.length}) — package found, no entry file to read:`);
    for (const d of r.uncheckedExport.slice(0, 6)) console.log(`    ${d}`);
    if (r.uncheckedExport.length > 6) console.log(`    …and ${r.uncheckedExport.length - 6} more`);
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
  let unmeasured = 0;
  let notPresent = 0;
  for (const env of ENVIRONMENTS) {
    // A missing directory is an environment we CLAIM and did not measure. It
    // must be visible in the output, not skipped into a cleaner-looking run.
    if (!fs.existsSync(env.project)) {
      console.log(`\n=== ${env.name} ===\n  NOT PRESENT — expected at ${env.project}; nothing measured`);
      notPresent++;
      continue;
    }
    const r = spawnSync(process.execPath, [
      new URL(import.meta.url).pathname,
      '--project', env.project,
      '--storybook', env.storybook,
      '--name', env.name,
    ], { encoding: 'utf8' });
    process.stdout.write((r.stdout || '').split('\n').filter(l => /^(===|  [A-Za-z]|    |DEAD|\d+ dead|\d+ missing|All specifiers|NO COMPONENTS)/.test(l)).join('\n') + '\n');
    if (r.status !== 0) failed++;
    if (/NOT MEASURED/.test(r.stdout || '')) unmeasured++;
  }
  /**
   * "Clean" must not be able to mean "we checked almost nothing".
   *
   * The per-environment line already refuses to print an unmeasurable metric
   * as `0%`, which is the defect that mattered. The exit CODE is a separate
   * question: a Storybook that is not running is an environment state, not a
   * regression, and failing the run for it would make the bench unusable as
   * the thing you run on every change — you would need ten dev servers up.
   *
   * So: dead specifiers fail, incompleteness is reported loudly, and CI can
   * demand the stronger claim with --require-complete.
   */
  console.log(failed === 0 ? '\nAll environments clean.' : `\n${failed} environment(s) with dead specifiers, missing exports, or no components.`);
  if (notPresent > 0) {
    console.log(`${notPresent} of ${ENVIRONMENTS.length} environment(s) NOT PRESENT on disk — claimed, not measured.`);
  }
  if (unmeasured > 0) {
    console.log(
      `${unmeasured} of ${ENVIRONMENTS.length} environment(s) had metrics that could NOT be measured ` +
      `— start their Storybook to measure them. This run is INCOMPLETE, not clean.`
    );
  }
  const incomplete = flag('require-complete') && (unmeasured > 0 || notPresent > 0);
  process.exit(failed > 0 || incomplete ? 1 : 0);
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
  if (r.missingExport.length > 0) console.log(`${r.missingExport.length} missing export(s): the package is installed but does not export that name.`);
  process.exit(r.dead.length > 0 || r.missingExport.length > 0 ? 1 : 0);
} catch (e) {
  console.log(`\n=== ${env.name} ===\n  FAILED: ${String(e).slice(0, 300)}`);
  process.exit(1);
}
