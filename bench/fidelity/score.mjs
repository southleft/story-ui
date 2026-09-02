/**
 * Pure scoring for the fidelity bench.
 *
 * Nothing in here touches the network, the filesystem, or a model. Every
 * function takes strings and plain objects and returns plain objects, so the
 * whole file is unit-testable and the bench's verdicts are reproducible from a
 * saved `<scenario>.json` alone.
 *
 * Two rules carried over from the rest of the codebase:
 *
 *   1. Absent and zero must look different. A check that could not run
 *      returns `pass: null`, never `false`. The report prints it as "n/a".
 *   2. Derive from what is in hand. Which tags are legal is read from the
 *      code's own import statements, not from a list of Mantine names.
 */

/* ------------------------------------------------------------------ */
/* Code reading                                                        */
/* ------------------------------------------------------------------ */

/**
 * Every value import in the file: `{ names, source }`.
 *
 * Handles `import X from`, `import { A, B as C } from`, `import * as NS from`,
 * `import X, { Y } from`, and multi-line braces. Type-only imports are skipped
 * because they cannot appear as JSX.
 */
export function parseImports(code) {
  const out = [];
  const re = /import\s+(type\s+)?([^'"]+?)\s+from\s+['"]([^'"]+)['"]/g;
  for (const m of code.matchAll(re)) {
    if (m[1]) continue;
    let clause = m[2].trim();
    const source = m[3];
    const names = [];

    const ns = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
    if (ns) { names.push(ns[1]); clause = clause.replace(ns[0], ''); }

    const braced = clause.match(/\{([^}]*)\}/);
    if (braced) {
      for (const part of braced[1].split(',')) {
        const p = part.trim().replace(/^type\s+/, '');
        if (!p) continue;
        const alias = p.split(/\s+as\s+/);
        names.push(alias[alias.length - 1].trim());
      }
      clause = clause.replace(braced[0], '');
    }

    const def = clause.replace(/,/g, '').trim();
    if (def && /^[A-Za-z_$][\w$]*$/.test(def)) names.push(def);

    out.push({ names, source });
  }
  return out;
}

/**
 * Every capitalised JSX element in the file.
 *
 * Returns `{ full, root }` pairs: `<Tabs.Panel>` has full `Tabs.Panel` and
 * root `Tabs` — the root is what an import statement has to supply.
 */
export function jsxTags(code) {
  const tags = [];
  // A `<` preceded by an identifier character is a TypeScript generic
  // (`useState<Billing>`, `Record<Role, string>`), not an element.
  const re = /(^|[^\w$.])<([A-Z][\w$]*(?:\.[A-Za-z_$][\w$]*)*)(?=[\s/>])/g;
  for (const m of code.matchAll(re)) {
    // `<K extends …>` / `<T,>` is a generic parameter list on an arrow function.
    const after = code.slice(m.index + m[0].length, m.index + m[0].length + 12);
    if (/^\s*(extends\b|,)/.test(after)) continue;
    tags.push({ full: m[2], root: m[2].split('.')[0] });
  }
  return tags;
}

/** Component-shaped names the file declares itself. */
export function localDeclarations(code) {
  const names = new Set();
  // Types count too: `type Billing = …` used as `<Billing>` in a generic is
  // a declaration this file makes, not a component it forgot to import.
  const re = /\b(?:function|const|let|var|class|type|interface|enum)\s+([A-Z][\w$]*)/g;
  for (const m of code.matchAll(re)) names.add(m[1]);
  return names;
}

/** Is this import source the design system, a project-local module, or something else? */
export function classifySource(source, importPath) {
  if (source === importPath || source.startsWith(importPath + '/')) return 'design-system';
  // Sibling packages of a scoped design system (`@mantine/dates` next to
  // `@mantine/core`) are the same vendor and count as the design system.
  if (importPath.startsWith('@')) {
    const scope = importPath.split('/')[0];
    if (source.startsWith(scope + '/')) return 'design-system';
  }
  if (source.startsWith('.') || source.startsWith('/') || source.startsWith('@/') || source.startsWith('~/')) return 'local';
  return 'foreign';
}

/* ------------------------------------------------------------------ */
/* Checks                                                              */
/* ------------------------------------------------------------------ */

/**
 * Component adherence.
 *
 * Every capitalised JSX root must be (a) imported from the design system,
 * (b) imported from a local module, (c) imported from some other package, or
 * (d) declared in the file. Anything else is UNKNOWN and would fail at
 * runtime — that is the only thing that fails this check on its own.
 * Foreign tags (icons, `React.Fragment`) are reported, not failed.
 */
export function componentAdherence(code, { importPath }) {
  const imports = parseImports(code);
  const declared = localDeclarations(code);
  const byName = new Map();
  for (const imp of imports) {
    const kind = classifySource(imp.source, importPath);
    for (const n of imp.names) byName.set(n, { kind, source: imp.source });
  }

  const tags = jsxTags(code);
  const seen = new Set();
  const designSystemTags = [];
  const localTags = [];
  const foreignTags = [];
  const declaredTags = [];
  const unknownTags = [];
  for (const t of tags) {
    if (seen.has(t.root)) continue;
    seen.add(t.root);
    const hit = byName.get(t.root);
    if (hit?.kind === 'design-system') designSystemTags.push(t.root);
    else if (hit?.kind === 'local') localTags.push(t.root);
    else if (hit?.kind === 'foreign') foreignTags.push(`${t.root} (${hit.source})`);
    else if (declared.has(t.root)) declaredTags.push(t.root);
    else unknownTags.push(t.root);
  }

  const designSystemImports = imports
    .filter(i => classifySource(i.source, importPath) === 'design-system')
    .flatMap(i => i.names);
  const foreignImports = imports
    .filter(i => classifySource(i.source, importPath) === 'foreign')
    .map(i => i.source);
  // Imported from the design system and never used as a tag: harmless, but a
  // signal that the model is listing what it knows rather than what it needs.
  const tagRoots = new Set(tags.map(t => t.root));
  const unusedImports = designSystemImports.filter(n => !tagRoots.has(n) && !new RegExp(`\\b${n}\\b`).test(code.replace(/import[^;]*;/g, '')));

  return {
    pass: unknownTags.length === 0,
    designSystemTags, localTags, foreignTags, declaredTags, unknownTags,
    designSystemImports, foreignImports, unusedImports,
    tagsUsed: [...new Set(tags.map(t => t.full))],
  };
}

/**
 * mustUse / mustUseAnyOf / mustNot.
 *
 * `mustUseAnyOf` is a list of groups; each group is satisfied by any one of
 * its names. A flat list of strings is treated as a single group. A name
 * counts as used when it appears as a JSX root — `Tabs` is satisfied by
 * `<Tabs.Panel>` — AND is imported from the design system or from a
 * project-local module, so a `Card` declared inside the story file does not
 * satisfy a requirement to use the library's.
 */
export function componentRequirements(code, { importPath, mustUse = [], mustUseAnyOf = [], mustNot = [] }) {
  const adherence = componentAdherence(code, { importPath });
  // A project's own components are its design system too: the house Pillbox
  // satisfies a "badge" requirement as well as Mantine's Badge does. Only a
  // component declared inside the story file itself does not count.
  const ds = new Set([...adherence.designSystemTags, ...adherence.localTags]);
  const roots = new Set(jsxTags(code).map(t => t.root));

  const missingMustUse = mustUse.filter(n => !ds.has(n));
  const usedButNotFromDesignSystem = mustUse.filter(n => !ds.has(n) && roots.has(n));

  const groups = mustUseAnyOf.length && typeof mustUseAnyOf[0] === 'string' ? [mustUseAnyOf] : mustUseAnyOf;
  const unsatisfiedGroups = groups.filter(g => !g.some(n => ds.has(n)));

  const presentMustNot = mustNot.filter(n => roots.has(n));

  return {
    pass: missingMustUse.length === 0 && unsatisfiedGroups.length === 0 && presentMustNot.length === 0,
    missingMustUse, usedButNotFromDesignSystem, unsatisfiedGroups, presentMustNot,
  };
}

/**
 * Forbidden patterns — regex sources, applied to the code with the `g` flag.
 * Reports up to three matches per pattern so the report is readable.
 */
export function forbiddenPatterns(code, patterns = []) {
  const hits = [];
  for (const src of patterns) {
    let re;
    try { re = new RegExp(src, 'g'); } catch (e) { hits.push({ pattern: src, error: String(e.message) }); continue; }
    const matches = [...code.matchAll(re)].map(m => m[0]);
    if (matches.length) hits.push({ pattern: src, count: matches.length, matches: matches.slice(0, 3) });
  }
  return { pass: hits.every(h => !h.count), hits };
}

/** Divergence threshold. `divergence` is the number editDivergence returned. */
export function divergenceCheck(divergence, maxDivergence) {
  if (maxDivergence === undefined || maxDivergence === null) return { pass: null, divergence, maxDivergence: null };
  if (typeof divergence !== 'number' || Number.isNaN(divergence)) return { pass: null, divergence: null, maxDivergence, reason: 'no previous code to compare against' };
  return { pass: divergence <= maxDivergence, divergence, maxDivergence };
}

/** Case-sensitive substring presence, for text that must survive an edit. */
export function textSurvived(code, mustContainText = []) {
  const missing = mustContainText.filter(t => !code.includes(t));
  return { pass: mustContainText.length ? missing.length === 0 : null, missing };
}

/* ------------------------------------------------------------------ */
/* Pins                                                                */
/* ------------------------------------------------------------------ */

/**
 * Every opening `<Component ...>` tag in source order, with its attribute text.
 *
 * Walks characters so `onClick={() => f('>')}` and `label="a > b"` do not end
 * the tag early. Deliberately not a full JSX parser: it only has to find the
 * attribute region of a named element.
 */
export function openingTags(code, component) {
  const out = [];
  const re = new RegExp(`<${component.replace(/[.$]/g, '\\$&')}(?=[\\s/>])`, 'g');
  for (const m of code.matchAll(re)) {
    let i = m.index + m[0].length;
    let depth = 0;
    let quote = null;
    while (i < code.length) {
      const ch = code[i];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch;
      } else if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
      } else if (ch === '>' && depth === 0) {
        break;
      }
      i++;
    }
    out.push({ start: m.index, attrs: code.slice(m.index + m[0].length, i) });
  }
  return out;
}

/** The value of `prop` in an attribute string, normalised to plain text, or null. */
export function readAttr(attrs, prop) {
  const re = new RegExp(`(?:^|\\s)${prop}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|\\{([^}]*)\\})`);
  const m = attrs.match(re);
  if (!m) {
    // Bare boolean attribute: `<Button disabled>`.
    return new RegExp(`(?:^|\\s)${prop}(?=\\s|$|/)`).test(attrs) ? 'true' : null;
  }
  if (m[1] !== undefined) return m[1];
  if (m[2] !== undefined) return m[2];
  return m[3].trim().replace(/^["'`]|["'`]$/g, '');
}

/**
 * Did a pinned prop survive a rewrite?
 *
 * Same occurrence semantics as the editor: 0-based, source order. Reports
 * what was found so a lost pin and a changed pin read differently.
 */
export function pinSurvived(code, { component, occurrence = 0, prop, value }) {
  const tags = openingTags(code, component);
  if (tags.length === 0) return { pass: false, reason: `no <${component}> in the code`, occurrences: 0, found: null };
  if (occurrence >= tags.length) return { pass: false, reason: `only ${tags.length} <${component}> element(s); occurrence ${occurrence} does not exist`, occurrences: tags.length, found: null };
  const found = readAttr(tags[occurrence].attrs, prop);
  const want = String(value);
  return { pass: found === want, occurrences: tags.length, found, want };
}

/* ------------------------------------------------------------------ */
/* Event stream                                                        */
/* ------------------------------------------------------------------ */

/** Time-to-preview, time-to-completion, LLM calls, retries — from captured events. */
export function timing(events, { maxTimeToPreviewMs } = {}) {
  const first = (type) => events.find(e => e.type === type);
  const preview = first('preview_ready');
  const completion = first('completion');
  const error = first('error');
  const retries = events.filter(e => e.type === 'retry').length;
  const tPreviewMs = preview ? preview.at : null;
  const tTotalMs = completion ? completion.at : (error ? error.at : null);
  const llmCalls = completion?.data?.metrics?.llmCallsCount ?? null;
  let pass = null;
  if (typeof maxTimeToPreviewMs === 'number') pass = tPreviewMs !== null && tPreviewMs <= maxTimeToPreviewMs;
  return { pass, tPreviewMs, tTotalMs, llmCalls, retries, maxTimeToPreviewMs: maxTimeToPreviewMs ?? null };
}

/**
 * The completion's own verification verdict.
 *
 * `verified` passes; `issues` passes only with zero blockers (warnings are
 * reported, not failed); `not_verified` is n/a, because it was not measured.
 */
export function verificationCheck(completion) {
  const v = completion?.verification;
  if (!v) return { pass: null, outcome: 'absent', reason: 'completion carried no verification block', blockers: [], warnings: [], checksRun: null, checksTotal: null };
  const findings = v.findings || [];
  const blockers = findings.filter(f => f.severity === 'blocker').map(f => `${f.class}: ${f.message}`);
  const warnings = findings.filter(f => f.severity === 'warning').map(f => `${f.class}: ${f.message}`);
  const checksRun = v.metrics?.checksRun ?? null;
  const checksTotal = v.metrics?.checksTotal ?? null;
  if (v.outcome === 'not_verified') return { pass: null, outcome: v.outcome, reason: v.reason, blockers, warnings, checksRun, checksTotal };
  return { pass: blockers.length === 0, outcome: v.outcome, reason: v.reason, blockers, warnings, checksRun, checksTotal };
}

/** The completion says the story exists and is not a failure placeholder. */
export function completionCheck(completion, errorEvent) {
  if (errorEvent) return { pass: false, reason: `error event: ${errorEvent.data?.code || ''} ${errorEvent.data?.message || ''}`.trim() };
  if (!completion) return { pass: false, reason: 'stream ended without a completion event' };
  if (completion.summary?.action === 'failed') return { pass: false, reason: completion.summary.description || 'completion reports failure' };
  if (completion.success === false) return { pass: false, reason: 'completion.success is false' };
  return { pass: true, action: completion.summary?.action };
}

/* ------------------------------------------------------------------ */
/* Assembly                                                            */
/* ------------------------------------------------------------------ */

/**
 * One step's scorecard. A step is a generation (new or follow-up) plus its
 * expectations; `previousCode` and `divergence` are present only for updates.
 */
export function scoreStep({ code, expect = {}, events = [], completion, errorEvent, importPath, previousCode, divergence, pins }) {
  const forbidden = expect.forbiddenPatterns || [];
  const checks = {
    completion: completionCheck(completion, errorEvent),
    adherence: code ? componentAdherence(code, { importPath }) : { pass: null, reason: 'no code returned' },
    requirements: code ? componentRequirements(code, {
      importPath,
      mustUse: expect.mustUseComponents || [],
      mustUseAnyOf: expect.mustUseAnyOf || [],
      mustNot: expect.mustNotUseComponents || [],
    }) : { pass: null, reason: 'no code returned' },
    forbidden: code ? forbiddenPatterns(code, forbidden) : { pass: null, reason: 'no code returned' },
    verification: verificationCheck(completion),
    divergence: divergenceCheck(divergence, previousCode ? expect.maxDivergence : undefined),
    text: code ? textSurvived(code, expect.mustContainText || []) : { pass: null, reason: 'no code returned' },
    pins: pins ? pinsCheck(code, pins, completion) : { pass: null },
    timing: timing(events, { maxTimeToPreviewMs: expect.maxTimeToPreviewMs }),
  };
  const failed = Object.entries(checks).filter(([, c]) => c.pass === false).map(([k]) => k);
  const notMeasured = Object.entries(checks).filter(([, c]) => c.pass === null).map(([k]) => k);
  return { pass: failed.length === 0, failed, notMeasured, checks };
}

/** Every pin must still be in the code; the completion's own `pins.lost` is cross-checked. */
export function pinsCheck(code, pins, completion) {
  const results = pins.map(p => ({ pin: p, ...(code ? pinSurvived(code, p) : { pass: null, reason: 'no code' }) }));
  const serverLost = completion?.pins?.lost || [];
  return {
    pass: results.every(r => r.pass === true),
    results,
    serverReported: completion?.pins ?? null,
    serverLost,
  };
}

/**
 * Human-readable issues from one step: failed checks plus everything the
 * stream said that a person should read.
 */
export function issuesFrom(stepLabel, { events = [], completion, score }) {
  const issues = [];
  const add = (kind, text) => issues.push({ step: stepLabel, kind, text });

  for (const e of events) {
    if (e.type === 'error') add('error', `${e.data?.code || 'ERROR'}: ${e.data?.message || ''}${e.data?.details ? ` — ${String(e.data.details).slice(0, 200)}` : ''}`);
    if (e.type === 'retry') add('retry', `attempt ${e.data?.attempt}/${e.data?.maxAttempts}: ${e.data?.reason || ''} ${(e.data?.errors || []).slice(0, 3).join('; ')}`);
    if (e.type === 'progress' && /_failed$|verify_issues|verify_inconclusive/.test(e.data?.phase || '')) add('phase', `${e.data.phase}: ${e.data.message || ''}`);
    // A repair or runtime heal that SUCCEEDED still spent an LLM call on
    // code the first pass got wrong; that is a cost worth seeing.
    if (e.type === 'progress' && /^(verify_repairing|runtime_healing)$/.test(e.data?.phase || '')) add('repair', `${e.data.phase}: ${e.data.message || ''}`);
    if (e.type === 'validation' && e.data?.autoFixApplied) add('autofix', `auto-fix applied: ${(e.data.fixDetails || []).slice(0, 3).join('; ') || 'details not given'}`);
  }
  if (completion?.notice) add('notice', completion.notice);
  if (completion?.validation?.errors?.length) add('validation', completion.validation.errors.slice(0, 3).join('; '));
  if (completion?.verification?.reason && completion.verification.outcome === 'not_verified') add('not_verified', completion.verification.reason);
  if (completion?.pins?.lost?.length) add('pins', `server reports lost pins: ${completion.pins.lost.map(p => `${p.component}[${p.occurrence}].${p.prop}`).join(', ')}`);

  if (score) {
    const c = score.checks;
    if (c.completion.pass === false) add('fail', `completion: ${c.completion.reason}`);
    if (c.adherence.pass === false) add('fail', `unknown JSX tags (not imported, not declared): ${c.adherence.unknownTags.join(', ')}`);
    if (c.requirements.pass === false) {
      if (c.requirements.missingMustUse.length) add('fail', `required components not used from the design system: ${c.requirements.missingMustUse.join(', ')}${c.requirements.usedButNotFromDesignSystem.length ? ` (present but not imported from it: ${c.requirements.usedButNotFromDesignSystem.join(', ')})` : ''}`);
      for (const g of c.requirements.unsatisfiedGroups) add('fail', `none of [${g.join(', ')}] used`);
      if (c.requirements.presentMustNot.length) add('fail', `forbidden components used: ${c.requirements.presentMustNot.join(', ')}`);
    }
    if (c.forbidden.pass === false) for (const h of c.forbidden.hits) if (h.count) add('fail', `forbidden pattern /${h.pattern}/ matched ${h.count}x: ${h.matches.map(m => JSON.stringify(m.slice(0, 60))).join(', ')}`);
    if (c.verification.pass === false) add('fail', `verification blockers: ${c.verification.blockers.join(' | ')}`);
    if (c.divergence.pass === false) add('fail', `divergence ${c.divergence.divergence.toFixed(3)} exceeds ${c.divergence.maxDivergence} — the edit rewrote more than it was asked to`);
    if (c.text.pass === false) add('fail', `expected text missing: ${c.text.missing.map(t => JSON.stringify(t)).join(', ')}`);
    if (c.pins.pass === false) for (const r of c.pins.results) if (r.pass === false) add('fail', `pin ${r.pin.component}[${r.pin.occurrence}].${r.pin.prop}=${JSON.stringify(r.pin.value)} did not survive: ${r.reason || `found ${JSON.stringify(r.found)}`}`);
    if (c.timing.pass === false) add('fail', `preview took ${c.timing.tPreviewMs}ms, budget ${c.timing.maxTimeToPreviewMs}ms`);
    if (c.verification.warnings?.length) add('warning', `verification warnings: ${c.verification.warnings.slice(0, 3).join(' | ')}`);
    if (c.adherence.foreignTags?.length) add('info', `tags from packages outside the design system: ${c.adherence.foreignTags.join(', ')}`);
  }
  return issues;
}
