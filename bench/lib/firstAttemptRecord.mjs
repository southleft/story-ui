/**
 * First-attempt bench — the pure half.
 *
 * Everything here is a fold over SSE events plus the completion payload. No
 * network, no filesystem, no clock, so the shaping and the summary can be
 * tested without a server — which matters, because the interesting cases
 * (a run that errored mid-stream, a server too old to send `gate`) are the
 * ones a live run will not reliably produce on demand.
 *
 * THE ONE RULE THIS FILE EXISTS TO ENFORCE. Absent is not zero. A field the
 * stream did not carry becomes `null` and the record says WHY; it never
 * becomes 0, `false`, or "clean". Three separate diagnoses on this project
 * were wrong because a check that could not run reported the same thing as a
 * check that found nothing.
 */

// ============================================================
// Validation error classes — the prevention targets
// ============================================================

/**
 * Ordered most-specific first: several of these substrings co-occur, and the
 * first match wins. Each pattern is anchored on text a formatter in
 * story-generator/ actually emits, not on a guess at what an error looks like.
 */
const ERROR_CLASSES = [
  // Import isolation: a package outside the design system.
  [/is not valid\s+—\s+that is an npm SCOPE/i, 'import-isolation'],
  [/not part of (?:this|the) design system|is not in the design system|outside the design system|not an allowed import/i, 'import-isolation'],
  // Import resolution and export existence.
  [/does not resolve to a file/i, 'import-unresolved'],
  [/does not export/i, 'import-missing-export'],
  [/is an unknown component \(not in the catalog/i, 'catalog-unknown-component'],
  // Icon packages: a real package, a name it does not export.
  [/is not exported by\b/i, 'icon-import'],
  // Design tokens.
  [/is not a design token in this project/i, 'token-undeclared'],
  [/is a primitive colour; this project aliases it/i, 'token-tier'],
  // Spacing / typography literals.
  [/is a raw spacing value|is an arbitrary spacing value|overrides the design system's typography/i, 'inline-spacing'],
  // Prop conformance (the project's own TypeScript) vs catalog conformance.
  [/is not a prop this component declares/i, 'prop-undeclared'],
  [/props are declared on the component; do not hide them behind a cast|casts away this prop's type/i, 'prop-cast'],
  [/uses a prop this version of the library deprecates/i, 'prop-deprecated'],
  // Two shapes from conformance.ts: a literal that is not in the enum, and an
  // `as any` that defeats the enum. Both are "the value is not one this prop
  // takes", so both classify the same.
  [/not one of the values this prop accepts|\baccepts only\b/i, 'prop-bad-value'],
  // Edit blocks that did not apply (an update, not a fresh generation).
  [/edit block|SEARCH (?:was )?not found|appears (?:more than once|twice)/i, 'edit-block-unmatched'],
  // Story-shape patterns the validator forbids outright.
  [/UNSAFE_style/i, 'pattern-unsafe-style'],
  [/export default meta|missing (?:a )?default export|no story export/i, 'pattern-story-shape'],
  [/emoji/i, 'pattern-emoji-icon'],
];

/**
 * Which class of mistake one error message describes.
 *
 * `bucket` is the pipeline's own three-way split (syntax / pattern / import),
 * carried on the validation event so an unrecognised message still lands
 * somewhere true rather than in a catch-all that hides what it is.
 */
export function classifyValidationError(message, bucket = null) {
  const text = String(message ?? '');
  for (const [re, cls] of ERROR_CLASSES) if (re.test(text)) return cls;
  if (bucket === 'syntax') return 'syntax-other';
  if (bucket === 'pattern') return 'pattern-other';
  if (bucket === 'import') return 'import-other';
  return 'unclassified';
}

/** Every error in one validation event, classified, keeping bucket provenance. */
export function classifyRound(validationEvent) {
  const byBucket = validationEvent?.errorsByBucket;
  if (byBucket) {
    return [
      ...(byBucket.syntax ?? []).map(m => ({ message: m, bucket: 'syntax', class: classifyValidationError(m, 'syntax') })),
      ...(byBucket.pattern ?? []).map(m => ({ message: m, bucket: 'pattern', class: classifyValidationError(m, 'pattern') })),
      ...(byBucket.import ?? []).map(m => ({ message: m, bucket: 'import', class: classifyValidationError(m, 'import') })),
    ];
  }
  // Older server: the buckets were flattened before they reached us. Say so,
  // rather than inventing a bucket.
  return (validationEvent?.errors ?? []).map(m => ({ message: m, bucket: null, class: classifyValidationError(m, null) }));
}

// ============================================================
// The fold over one run's stream
// ============================================================

const SELF_HEALING = /self-healing/i;

/**
 * Split a run's events by GATE attempt and pull out what happened in each.
 *
 * The gate re-runs the whole pipeline, so validation and verification events
 * repeat. Attempt boundaries are the `gate_retry` progress events; everything
 * before the first one belongs to attempt 1, which is the only attempt this
 * bench's headline number is about.
 */
export function foldStream(events) {
  const attempts = [{ validations: [], retries: [], phases: [], gateFailureReason: null }];
  let completion = null;
  let error = null;
  let started = null;

  for (const ev of events) {
    const d = ev?.data ?? {};
    switch (ev?.type) {
      case 'started': started = d.generationId ?? null; break;
      case 'progress': {
        const cur = attempts[attempts.length - 1];
        cur.phases.push(d.phase);
        if (d.phase === 'gate_retry') {
          cur.gateFailureReason = d.message ?? null;
          attempts.push({ validations: [], retries: [], phases: [], gateFailureReason: null });
        }
        break;
      }
      case 'validation': attempts[attempts.length - 1].validations.push(d); break;
      case 'retry': attempts[attempts.length - 1].retries.push(d); break;
      case 'completion': completion = d; break;
      case 'error': error = d; break;
      default: break;
    }
  }
  return { attempts, completion, error, generationId: started };
}

/**
 * Did verification find a blocker the STORY authored, on the given attempt?
 *
 * true  — it rendered and nothing story-authored blocked.
 * false — it did not render, or a story-authored blocker stood.
 * null  — verification could not judge (no Storybook, no browser), which is
 *         not a pass and is not a failure.
 */
export function storyBlockerVerdict(completion, gateAttempts) {
  if (!completion) return { verdict: null, reason: 'no completion event' };
  // The gate's own answer, when the server sends it: authoritative, because
  // it is the value the pipeline actually acted on.
  const gate = completion.gate;
  if (gate) {
    if (gateAttempts > 1) return { verdict: false, reason: `gate spent ${gateAttempts} attempts; attempt 1 was not shippable` };
    if (gate.shippable) return { verdict: true, reason: gate.reason ?? 'shippable' };
    if (/not verified|verification did not run/i.test(gate.reason ?? '')) {
      return { verdict: null, reason: gate.reason ?? 'not verified' };
    }
    return { verdict: false, reason: gate.reason ?? 'not shippable' };
  }
  // Server without `gate` on the completion payload: reconstruct the same
  // predicate from the findings, exactly as story-generator/verify/gate.ts does.
  const v = completion.verification;
  if (!v) return { verdict: null, reason: 'completion carried no verification and no gate' };
  if (v.outcome === 'not_verified') return { verdict: null, reason: `not verified: ${v.reason ?? 'unknown'}` };
  const findings = v.findings ?? [];
  if (findings.some(f => String(f.id ?? '').startsWith('render-failed'))) {
    return { verdict: false, reason: 'did not render' };
  }
  const candidates = findings.filter(f => f.severity === 'blocker' && f.class !== 'infrastructure');
  const attributed = candidates.filter(f => f.repairable === true);
  if (attributed.length > 0) return { verdict: false, reason: `${attributed.length} story blocker(s)` };
  if (candidates.some(f => f.repairable === undefined)) {
    // Blockers arrived without `repairable`, so "story-authored" could not be
    // decided. Counting them as none would manufacture a clean run.
    return { verdict: null, reason: 'blockers present but attribution (repairable) not on the stream' };
  }
  return { verdict: true, reason: v.outcome === 'verified' ? 'verified clean' : 'no story blockers' };
}

/** Median of numbers, ignoring nulls. Null when nothing was measured. */
export function median(values) {
  const xs = values.filter(v => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

/**
 * One prompt's record: what happened BEFORE any healing, repair or regeneration.
 */
export function buildRecord({ prompt, events, durationMs, env, transportError = null }) {
  const { attempts, completion, error } = foldStream(events ?? []);
  const first = attempts[0];

  // ---- validation, gate attempt 1 -------------------------------------
  const firstValidation = first.validations[0] ?? null;
  const healingRetries = first.retries.filter(r => SELF_HEALING.test(r.reason ?? ''));
  const otherRetries = first.retries.filter(r => !SELF_HEALING.test(r.reason ?? ''));

  const validationAttempts = firstValidation ? 1 + healingRetries.length : null;
  const passedFirstRound = firstValidation ? firstValidation.isValid === true : null;

  const rounds = [];
  if (firstValidation) rounds.push({ round: 1, isValid: firstValidation.isValid === true, errors: classifyRound(firstValidation) });
  healingRetries.forEach((r, i) => {
    const next = first.validations[i + 1];
    rounds.push({
      round: i + 2,
      isValid: next ? next.isValid === true : null,
      errors: next ? classifyRound(next) : (r.errors ?? []).map(m => ({ message: m, bucket: null, class: classifyValidationError(m) })),
    });
  });

  // ---- gate ------------------------------------------------------------
  const gateRetryEvents = attempts.length - 1;
  const gateAttempts = completion?.gate?.attempts ?? (completion || error ? gateRetryEvents + 1 : null);
  const gateFailures = attempts.slice(0, -1).map((a, i) => ({ attempt: i + 1, reason: a.gateFailureReason }));

  // ---- verification and repair, gate attempt 1 -------------------------
  /**
   * `verify_inconclusive` is a terminal phase: verification reached an answer,
   * and the answer is that it could not judge. Repair definitively did not run.
   * Only a run that never reached ANY terminal verify phase leaves this null.
   */
  const VERIFY_TERMINAL = ['verified', 'verify_issues', 'verify_repair_failed', 'verify_inconclusive'];
  const repairRan = first.phases.includes('verify_repairing')
    ? true
    : (first.phases.some(p => VERIFY_TERMINAL.includes(p)) ? false : null);
  let repairImproved = null;
  if (repairRan === true) {
    if (first.phases.includes('verify_repaired')) repairImproved = true;
    else if (first.phases.includes('verify_repair_failed')) repairImproved = false;
  }

  const blocker = storyBlockerVerdict(completion, gateAttempts ?? 1);

  /**
   * The verification leg, read honestly.
   *
   * `blocker.verdict` describes the report the gate acted on, which is the
   * report AFTER repair. A story whose first output had two blockers that a
   * repair pass removed reports `shippable` — indistinguishable from one that
   * had none. So a repair having RUN is itself proof that verification found
   * a story-authored blocker in the first output, and it fails this leg.
   */
  const verificationLeg = repairRan === null ? null : (repairRan === false && blocker.verdict === true ? true : (blocker.verdict === null ? null : false));

  // ---- the headline ----------------------------------------------------
  let firstAttemptClean = null;
  const unknownReasons = [];
  if (passedFirstRound === null) unknownReasons.push('validation never reported (run did not reach validation)');
  if (verificationLeg === null) {
    unknownReasons.push(repairRan === null
      ? 'verification never reached an outcome, so whether a repair was needed is unknown'
      : `verification inconclusive: ${blocker.reason}`);
  }
  if (gateAttempts === null) unknownReasons.push('gate attempts unknown (stream ended without completion or error)');
  if (unknownReasons.length === 0) {
    firstAttemptClean = passedFirstRound === true && verificationLeg === true && gateAttempts === 1;
  } else if (passedFirstRound === false || verificationLeg === false || (gateAttempts !== null && gateAttempts > 1)) {
    // One leg is definitively false, so the conjunction is false whatever the
    // unknown legs turn out to be. Not clean, and not unknown.
    firstAttemptClean = false;
  }

  const outcome = transportError ? 'transport-error'
    : error ? 'error'
    : !completion ? 'incomplete'
    : completion.summary?.action ?? (completion.success ? 'created' : 'failed');

  return {
    id: prompt.id,
    suite: prompt.suite ?? null,
    complexity: prompt.complexity ?? null,
    prompt: prompt.prompt,
    env: env ?? null,
    outcome,
    firstAttemptClean,
    unknown: firstAttemptClean === null ? unknownReasons : null,
    durationMs: durationMs ?? null,
    seconds: typeof durationMs === 'number' ? Math.round(durationMs / 100) / 10 : null,
    // The count the SERVER kept, across every gate attempt. Null, never 0,
    // when the run did not complete.
    modelCalls: completion?.metrics?.llmCallsCount ?? null,
    validation: {
      attempts: validationAttempts,
      passedFirstRound,
      rounds,
      // The completion's number describes the attempt the gate KEPT, which is
      // a different question from "did attempt 1 pass". Both are recorded.
      keptAttemptAttempts: completion?.validation?.attempts ?? null,
      keptAttemptSelfHealed: completion?.validation?.selfHealingUsed ?? null,
      nonHealingRetries: otherRetries.map(r => r.reason),
    },
    verification: {
      outcome: completion?.verification?.outcome ?? null,
      reason: completion?.verification?.reason ?? null,
      // After repair — the report the gate acted on.
      storyBlockerFree: blocker.verdict,
      storyBlockerReason: blocker.reason,
      /** The leg the headline uses: no repair was needed AND none stood after. */
      firstOutputClean: verificationLeg,
      findingsByClass: countBy(completion?.verification?.findings ?? [], f => `${f.severity}/${f.class}`),
      /**
       * The KIND, not just the class. A run that reports "warning/code: 28"
       * says nothing about what to fix next, and reading it back meant opening
       * a server log beside the results. The kind is what the taxonomy is
       * built from, so record it here where the analysis actually happens.
       */
      findingsByKind: countBy(completion?.verification?.findings ?? [], f => f.kind || f.type || 'unnamed'),
      /** One example message per kind, capped, so a kind can be recognised. */
      findingExamples: Object.fromEntries(
        Object.entries(
          (completion?.verification?.findings ?? []).reduce((acc, f) => {
            const k = f.kind || f.type || 'unnamed';
            if (!acc[k]) acc[k] = String(f.message ?? '').slice(0, 160);
            return acc;
          }, {}),
        ).slice(0, 12),
      ),
      repairRan,
      repairImproved,
    },
    gate: {
      attempts: gateAttempts,
      bestAttempt: completion?.gate?.bestAttempt ?? null,
      shippable: completion?.gate?.shippable ?? null,
      reason: completion?.gate?.reason ?? null,
      // Present only when the server forwards `gate`; otherwise the count came
      // from counting gate_retry progress events, which is stated here.
      source: completion?.gate ? 'completion.gate' : (completion || error ? 'gate_retry progress events' : 'unknown'),
      earlierFailures: gateFailures,
    },
    storyId: completion?.storyId ?? null,
    fileName: completion?.fileName ?? null,
    error: transportError ?? (error ? { code: error.code, message: error.message } : null),
  };
}

function countBy(items, key) {
  const out = {};
  for (const it of items) { const k = key(it); out[k] = (out[k] ?? 0) + 1; }
  return out;
}

// ============================================================
// Summary
// ============================================================

/** The number this bench exists to produce, plus what it could not measure. */
export function summarise(records) {
  const total = records.length;
  const clean = records.filter(r => r.firstAttemptClean === true).length;
  const dirty = records.filter(r => r.firstAttemptClean === false).length;
  const unknown = records.filter(r => r.firstAttemptClean === null).length;
  // The percentage is over what could be JUDGED. A run nobody could judge is
  // not evidence of a clean rate and is not evidence against one.
  const judged = clean + dirty;
  const classCounts = {};
  for (const r of records) {
    for (const round of r.validation.rounds) {
      if (round.round !== 1) continue; // prevention targets the FIRST output
      for (const e of round.errors) classCounts[e.class] = (classCounts[e.class] ?? 0) + 1;
    }
  }
  const promptsWithClass = {};
  for (const r of records) {
    const seen = new Set((r.validation.rounds.find(x => x.round === 1)?.errors ?? []).map(e => e.class));
    for (const c of seen) promptsWithClass[c] = (promptsWithClass[c] ?? 0) + 1;
  }
  return {
    total, clean, dirty, unknown, judged,
    percent: judged ? Math.round((clean / judged) * 1000) / 10 : null,
    medianModelCalls: median(records.map(r => r.modelCalls)),
    medianSeconds: median(records.map(r => r.seconds)),
    validationClasses: Object.entries(classCounts).sort((a, b) => b[1] - a[1]),
    promptsPerValidationClass: promptsWithClass,
    repairRan: records.filter(r => r.verification.repairRan === true).length,
    repairImproved: records.filter(r => r.verification.repairImproved === true).length,
    gateRegenerated: records.filter(r => typeof r.gate.attempts === 'number' && r.gate.attempts > 1).length,
    selfHealed: records.filter(r => typeof r.validation.attempts === 'number' && r.validation.attempts > 1).length,
  };
}

/** The one line we track over time. */
export function headline(s) {
  const pct = s.percent === null ? 'n/a' : `${s.percent}%`;
  const mc = s.medianModelCalls === null ? 'unknown' : s.medianModelCalls;
  const sec = s.medianSeconds === null ? 'unknown' : s.medianSeconds;
  const denom = s.judged === s.total ? s.total : `${s.judged} judged of ${s.total}`;
  return `first-attempt clean: ${s.clean}/${denom} (${pct}) · median model calls ${mc} · median ${sec}s`;
}

const CLEAN_MARK = { true: 'CLEAN', false: 'dirty', null: 'UNKNOWN' };

/** Fixed-width table. `?` never stands for 0 — it stands for not measured. */
export function formatTable(records) {
  const col = (s, w) => String(s ?? '').padEnd(w).slice(0, w);
  const num = (v, w) => String(v === null || v === undefined ? '?' : v).padStart(w);
  const lines = [];
  lines.push(`${col('id', 5)} ${col('cplx', 8)} ${col('first', 7)} ${num('val', 4)} ${num('gate', 5)} ${num('calls', 6)} ${num('secs', 6)} ${col('verify', 13)} ${col('repair', 11)} first-round error classes`);
  lines.push('-'.repeat(110));
  for (const r of records) {
    const first = r.validation.rounds.find(x => x.round === 1);
    const classes = first ? [...new Set(first.errors.map(e => e.class))].join(',') : (r.validation.passedFirstRound === null ? '(not measured)' : '');
    const repair = r.verification.repairRan === null ? '?'
      : r.verification.repairRan === false ? 'no'
      : r.verification.repairImproved === true ? 'yes/better'
      : r.verification.repairImproved === false ? 'yes/no-gain' : 'yes/?';
    lines.push([
      col(r.id, 5), col(r.complexity, 8),
      col(CLEAN_MARK[String(r.firstAttemptClean)], 7),
      num(r.validation.attempts, 4), num(r.gate.attempts, 5),
      num(r.modelCalls, 6), num(r.seconds, 6),
      col(r.verification.outcome ?? '?', 13), col(repair, 11),
      classes,
    ].join(' '));
  }
  return lines.join('\n');
}

/** The lines printed under the table: the metric, then the prevention targets. */
export function formatSummary(s) {
  const lines = [headline(s)];
  if (s.unknown > 0) {
    lines.push(`${s.unknown} run(s) NOT JUDGED — verification or validation could not report. Not counted as clean and not counted as dirty.`);
  }
  lines.push(`self-healed: ${s.selfHealed} · verification repair ran: ${s.repairRan} (improved ${s.repairImproved}) · gate regenerated: ${s.gateRegenerated}`);
  if (s.validationClasses.length === 0) {
    lines.push('first-round validation errors: none observed.');
  } else {
    lines.push('top first-round validation error classes (the prevention targets):');
    for (const [cls, n] of s.validationClasses.slice(0, 8)) {
      lines.push(`  ${String(n).padStart(4)}  ${cls}  (in ${s.promptsPerValidationClass[cls]} prompt${s.promptsPerValidationClass[cls] === 1 ? '' : 's'})`);
    }
  }
  return lines.join('\n');
}
