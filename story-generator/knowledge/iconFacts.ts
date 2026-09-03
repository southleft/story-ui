/**
 * Where icons and placeholder images come from in THIS project — derived
 * from what is installed and what the catalog offers, never from a list of
 * package names.
 *
 * A review of MUI stories found six using text glyphs (⋯ × ✓) as icons and
 * eight pulling remote photographs, one where the prompt asked for a
 * placeholder. The prompt had told the model to "use Unicode symbols" when it
 * knew of no icon package, and its idea of an icon package was a hard-coded
 * list of four — so `@carbon/icons-react`, a dependency of `@carbon/react`
 * itself, was neither offered nor allowed, and a local `src/icons` module was
 * only found when its exports happened to be named `*Icon`.
 *
 * Three facts, each read from the project:
 *
 *   PACKAGES    a dependency of the project or of the design system whose own
 *               package.json says it is an icon set (name, keywords or
 *               description), installed, with its export names read from its
 *               declarations
 *   CATALOG     components the catalog already holds that are icons, and the
 *               library's icon primitive (a component that renders an SVG)
 *   PLACEHOLDER components the catalog holds for the "image not yet chosen"
 *               case — skeletons, aspect-ratio boxes, avatar fallbacks
 */

import fs from 'fs';
import path from 'path';

export interface IconPackage {
  name: string;
  /** Who depends on it: the project, or the design system's own manifest. */
  via: 'project' | 'design-system' | 'config';
  /** Export names read from the package's declarations; empty when unreadable. */
  exports: string[];
  /** A handful of exports that name common UI affordances, for the prompt. */
  examples: string[];
}

export interface IconVocabulary {
  packages: IconPackage[];
  /** Catalog components that are icons themselves. */
  iconComponents: Array<{ name: string; importPath?: string }>;
  /** The library's icon wrapper, when it has one (Icon, SvgIcon, IconButton is NOT one). */
  iconPrimitive?: string;
  /** Catalog components for an image that is not yet chosen. */
  placeholders: string[];
  source: string;
}

const AFFORDANCE = /^(?:Icon)?(Add|Plus|Close|X|Xmark|Check|Checkmark|Search|Menu|Bars|Chevron(Down|Up|Left|Right)?|Arrow(Down|Up|Left|Right)?|Edit|Pencil|Delete|Trash|Settings|Gear|Cog|User|Person|Bell|Notification|Overflow|More|Dots|Ellipsis|Filter|Download|Upload|Star|Heart|Mail|Envelope|Calendar|Warning|Error|Info|Information|Home|Copy|Share|Eye|Lock|Refresh|Save|Send|Logout|Login)([A-Z][a-z]*)?(Icon)?$/;

const _cache = new Map<string, { at: number; value: IconPackage[] }>();

function readJson(file: string): any | null {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** Does this manifest describe an icon set? Judged from what it says about itself. */
export function manifestSaysIcons(pkg: { name?: string; keywords?: string[]; description?: string } | null): boolean {
  if (!pkg) return false;
  const text = [pkg.name, pkg.description, ...(pkg.keywords || [])].filter(Boolean).join(' ');
  return /\bicons?\b|\bicon-|-icons?\b|\bglyphs?\b/i.test(text);
}

/** The declaration file a package points at, if any. */
function typesEntry(root: string, pkg: any): string | null {
  const candidates: string[] = [];
  const push = (v: unknown) => { if (typeof v === 'string' && /\.d\.(ts|mts|cts)$/.test(v)) candidates.push(v); };
  push(pkg?.types); push(pkg?.typings);
  const walk = (node: unknown, depth = 0) => {
    if (depth > 4 || node == null) return;
    if (typeof node === 'string') return push(node);
    if (Array.isArray(node)) return node.forEach(n => walk(n, depth + 1));
    if (typeof node === 'object') for (const [k, v] of Object.entries(node as any)) if (k === 'types' || k === 'typings' || k === 'import' || k === 'default' || k === 'require' || k === '.') walk(v, depth + 1);
  };
  walk(pkg?.exports?.['.'] ?? pkg?.exports);
  for (const rel of ['index.d.ts', 'lib/index.d.ts', 'dist/index.d.ts', 'types/index.d.ts']) candidates.push(rel);
  for (const c of candidates) {
    const full = path.join(root, c);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

/**
 * Export names from a declaration file, following `export * from` one hop.
 * Textual on purpose — an icon set is thousands of one-line exports, and a
 * TypeScript program over it costs more than the generation.
 */
export function readExportNames(file: string, limitFiles = 40): string[] {
  const names = new Set<string>();
  const seen = new Set<string>();
  const queue = [file];
  while (queue.length && seen.size < limitFiles) {
    const f = queue.shift()!;
    if (seen.has(f)) continue;
    seen.add(f);
    let text: string;
    try {
      const stat = fs.statSync(f);
      if (stat.size > 4_000_000) continue;
      text = fs.readFileSync(f, 'utf8');
    } catch { continue; }
    for (const m of text.matchAll(/export\s+(?:declare\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
    for (const m of text.matchAll(/export\s*\{([^}]*)\}/g)) {
      for (const part of m[1].split(',')) {
        const alias = part.trim().split(/\s+as\s+/).pop()?.trim();
        if (alias && /^[A-Za-z_$][\w$]*$/.test(alias) && alias !== 'default' && alias !== 'type') names.add(alias);
      }
    }
    // `declare const _X: T;` paired with `export { _X as X }` is covered above;
    // a bare `declare const X` exported nowhere is not an export.
    for (const m of text.matchAll(/export\s+\*\s+from\s+['"](\.[^'"]+)['"]/g)) {
      const base = path.resolve(path.dirname(f), m[1]);
      for (const cand of [base + '.d.ts', path.join(base, 'index.d.ts'), base.replace(/\.js$/, '.d.ts')]) {
        if (fs.existsSync(cand)) { queue.push(cand); break; }
      }
    }
  }
  names.delete('Icon');
  return [...names].sort();
}

function packageRoot(projectRoot: string, name: string): string | null {
  const root = path.join(projectRoot, 'node_modules', ...name.split('/'));
  return fs.existsSync(path.join(root, 'package.json')) ? root : null;
}

function designSystemPackageName(importPath?: string): string | null {
  if (!importPath || importPath.startsWith('.') || importPath.startsWith('/') || importPath.startsWith('@/')) return null;
  return importPath.startsWith('@') ? importPath.split('/').slice(0, 2).join('/') : importPath.split('/')[0];
}

/**
 * Installed icon packages, judged by their own manifests: the project's
 * dependencies and the design system's, since a library's icon set is often
 * a dependency of the library rather than of the project.
 */
export function derivedIconPackages(projectRoot: string, importPath?: string, configured?: string): IconPackage[] {
  const key = `${projectRoot}\n${importPath ?? ''}\n${configured ?? ''}`;
  const cached = _cache.get(key);
  if (cached && Date.now() - cached.at < 60_000) return cached.value;

  const out: IconPackage[] = [];
  const consider = (name: string, via: IconPackage['via']) => {
    if (out.some(p => p.name === name)) return;
    const root = packageRoot(projectRoot, name);
    if (!root) return;
    const pkg = readJson(path.join(root, 'package.json'));
    if (via !== 'config' && !manifestSaysIcons(pkg)) return;
    const entry = typesEntry(root, pkg);
    const exports = entry ? readExportNames(entry) : [];
    const examples = exports.filter(n => AFFORDANCE.test(n)).slice(0, 24);
    out.push({ name, via, exports, examples: examples.length ? examples : exports.slice(0, 16) });
  };

  if (configured) consider(configured, 'config');
  const project = readJson(path.join(projectRoot, 'package.json'));
  const dsName = designSystemPackageName(importPath);
  for (const dep of Object.keys({ ...(project?.dependencies || {}), ...(project?.devDependencies || {}) })) {
    if (dep === dsName) continue;
    consider(dep, 'project');
  }
  if (dsName) {
    const dsRoot = packageRoot(projectRoot, dsName);
    const dsPkg = dsRoot ? readJson(path.join(dsRoot, 'package.json')) : null;
    for (const dep of Object.keys({ ...(dsPkg?.dependencies || {}), ...(dsPkg?.peerDependencies || {}) })) {
      if (dep === dsName) continue;
      consider(dep, 'design-system');
    }
  }
  _cache.set(key, { at: Date.now(), value: out });
  return out;
}

export function deriveIconVocabulary(input: {
  projectRoot: string;
  importPath?: string;
  configuredPackage?: string;
  components: Array<{ name: string; filePath?: string; description?: string; __componentPath?: string; props?: string[] }>;
}): IconVocabulary {
  const packages = derivedIconPackages(input.projectRoot, input.importPath, input.configuredPackage);
  const iconComponents: IconVocabulary['iconComponents'] = [];
  let iconPrimitive: string | undefined;
  const placeholders: string[] = [];
  for (const c of input.components) {
    const file = (c.filePath || '').split(path.sep).join('/');
    const fromIconsModule = /\/icons?\//i.test(file) || /\/icons?\.[jt]sx?$/i.test(file);
    if (/^(Icon|SvgIcon)$/.test(c.name)) { iconPrimitive = iconPrimitive || c.name; continue; }
    // An icon is a leaf: it comes from the icons module, or it is named
    // *Icon AND its known props have no children slot. `ListItemIcon`,
    // `StepIcon` and `SideNavIcon` all take children — they are slots that
    // HOLD an icon, and the name alone cannot tell them apart.
    const props = Array.isArray(c.props) ? c.props.map(String) : [];
    const leaf = props.length > 0 && !props.some(p => /^children\b/.test(p));
    if ((fromIconsModule && /^[A-Z]/.test(c.name)) || (/^[A-Z]\w*Icon$/.test(c.name) && leaf)) {
      iconComponents.push({ name: c.name, importPath: c.__componentPath });
    }
    if (/Skeleton|Placeholder|AspectRatio|AvatarFallback/.test(c.name) && !/Skeleton(Icon|Text)$/.test(c.name)) placeholders.push(c.name);
  }
  // The generic ones first — a placeholder by name, then the bare Skeleton /
  // AspectRatio / AvatarFallback, then per-component skeletons.
  const rank = (n: string) => /Placeholder/.test(n) ? 0 : /^(Skeleton|AspectRatio|AvatarFallback)$/.test(n) ? 1 : /^Skeleton/.test(n) ? 2 : 3;
  placeholders.sort((a, b) => rank(a) - rank(b) || a.length - b.length || a.localeCompare(b));
  const parts: string[] = [];
  if (packages.length) parts.push(`icon package(s): ${packages.map(p => `${p.name} (${p.via}, ${p.exports.length} exports)`).join(', ')}`);
  if (iconComponents.length) parts.push(`${iconComponents.length} icon component(s) in the catalog`);
  if (iconPrimitive) parts.push(`icon primitive <${iconPrimitive}>`);
  if (placeholders.length) parts.push(`placeholders: ${placeholders.slice(0, 3).join(', ')}`);
  return { packages, iconComponents, iconPrimitive, placeholders, source: parts.length ? parts.join('; ') : 'no icon package, no icon component, no placeholder component' };
}

export type Syntax = 'jsx' | 'html';

/** The icon section of the prompt. Text glyphs are never icons, whatever exists. */
export function formatIconRules(vocab: IconVocabulary | null | undefined, syntax: Syntax = 'jsx'): string[] {
  const lines: string[] = ['', 'ICON RULES (derived from this project):'];
  const pkgs = vocab?.packages ?? [];
  const comps = vocab?.iconComponents ?? [];
  if (pkgs.length) {
    for (const p of pkgs.slice(0, 2)) {
      lines.push(`- Icons come from \`${p.name}\` (installed; ${p.via === 'design-system' ? 'the design system\'s own icon set' : p.via === 'config' ? 'configured for this project' : 'a dependency of this project'}).`);
      if (p.examples.length) lines.push(`  Real export names include: ${p.examples.join(', ')}${p.exports.length > p.examples.length ? ` …${p.exports.length - p.examples.length} more, all named like these` : ''}`);
      lines.push(`  ${syntax === 'jsx' ? `import { ${p.examples[0] || 'IconName'} } from '${p.name}';` : `Import each icon from '${p.name}'.`} Only names the package exports exist; validation checks them.`);
    }
  }
  if (comps.length) {
    lines.push(`- This design system ships its own icon components: ${comps.slice(0, 16).map(c => c.name).join(', ')}${comps.length > 16 ? ` …${comps.length - 16} more` : ''} — import them exactly as the catalog states.`);
  }
  if (vocab?.iconPrimitive) {
    lines.push(`- For an icon neither of the above provides, use the library's <${vocab.iconPrimitive}> primitive with an inline SVG path — never a text character.`);
  } else if (!pkgs.length && !comps.length) {
    lines.push('- No icon package and no icon component is available. Where an icon is needed, write an inline <svg viewBox="0 0 24 24" aria-hidden="true"> with a simple path (a chevron, a cross, a check) sized by the surrounding component — never a text character.');
  }
  lines.push('- A text glyph (⋯ × ✓ ↑ ↓ → ← ☰ • ★ ▸ ✕) is NEVER an icon. It renders in the text font at the wrong size and weight and is invisible to assistive technology. If no icon exists, an inline SVG or a text label ("More", "Close") is the answer.');
  lines.push('- An icon is decorative (aria-hidden), the leading/trailing slot of a control, or the child of an icon button — never interactive on its own.');
  return lines;
}

/** The image section: placeholders from the catalog; a remote photo only for a real image. */
export function formatImageRules(vocab: IconVocabulary | null | undefined, syntax: Syntax = 'jsx'): string {
  const ph = vocab?.placeholders ?? [];
  const svg = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='300'><rect width='100%' height='100%' fill='%23e5e7eb'/></svg>";
  const lines = ['IMAGE RULES (derived from this project):'];
  if (ph.length) {
    lines.push(`- PLACEHOLDER (the request says "placeholder", or the image is not the point): render the design system's own placeholder — ${ph.slice(0, 4).map(n => `<${n}>`).join(', ')} — or an inline SVG data URI. Never a remote URL for a placeholder.`);
  } else {
    lines.push('- PLACEHOLDER (the request says "placeholder", or the image is not the point): this catalog has no skeleton/placeholder component, so use an inline SVG data URI as the src — never a remote URL.');
  }
  lines.push(`  ${syntax === 'jsx' ? `<img src="${svg}" alt="" />` : `<img src="${svg}" alt="">`}`);
  lines.push('- REAL PHOTO (only when the request asks for an actual picture): https://picsum.photos/[width]/[height]?random=N, always with descriptive alt text.');
  return lines.join('\n');
}

export interface IconImportViolation { line: number; name: string; pkg: string; message: string }

/** Names imported from a derived icon package that the package does not export. */
export function checkIconImports(code: string, vocab: IconVocabulary | null | undefined): IconImportViolation[] {
  if (!vocab?.packages.length) return [];
  const out: IconImportViolation[] = [];
  const lines = code.split('\n');
  for (const p of vocab.packages) {
    if (!p.exports.length) continue;
    const set = new Set(p.exports);
    const re = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*['"]${p.name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?:/[^'"]*)?['"]`, 'g');
    for (const m of code.matchAll(re)) {
      const line = code.slice(0, m.index).split('\n').length;
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0].trim().replace(/^type\s+/, '');
        if (!name || set.has(name)) continue;
        const near = p.exports.find(e => e.toLowerCase() === name.toLowerCase()) || p.exports.find(e => e.toLowerCase().includes(name.toLowerCase().replace(/icon$/, '')) && name.length > 3);
        out.push({ line, name, pkg: p.name, message: `"${name}" is not exported by ${p.name}${near ? ` — did you mean "${near}"?` : `. Use one of its real exports (e.g. ${p.examples.slice(0, 6).join(', ')}).`}` });
      }
    }
  }
  void lines;
  return out;
}

export function formatIconImportErrors(v: IconImportViolation[]): string[] {
  return v.map(x => `Line ${x.line}: ${x.message}`);
}
