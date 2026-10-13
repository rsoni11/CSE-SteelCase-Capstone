/**
 * Sandbox pipeline: CSV → validated units → load plans → diversity comparison
 * → tutor trial. Writes everything under out/ and touches nothing outside sandbox/.
 *
 * Run with:  node src/run.mjs [--csv data/truck_info.csv] [--plans 50]
 *                             [--seed 20261013] [--out out] [--tutor-plans 50]
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { STEELCASE_LOAD_EXAMPLES } from '../../src/loadExamples.js';
import { parseTruckCsv, issuesToCsv, TruckCsvSchemaError } from './truckCsv.mjs';
import {
  generateSyntheticPlans,
  generateRandomPlans,
  planToUploaderCsv,
  typeKeyOf,
  FRAGILE_PATTERN
} from './generators.mjs';
import { setDiversity, typeCounts } from './diversity.mjs';
import { createRng } from './rng.mjs';
import {
  planToItems,
  briefing,
  buildReferenceLoad,
  simulateLearner,
  sessionSummary,
  describeSpot
} from './tutor.mjs';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};

const CSV_PATH = arg('csv', 'data/truck_info.csv');
const OUT = arg('out', 'out');
const PLAN_COUNT = Number(arg('plans', 50));
const SEED = Number(arg('seed', 20261013));
const TUTOR_PLANS = Number(arg('tutor-plans', PLAN_COUNT));

const log = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
const write = (rel, text) => writeFileSync(join(OUT, rel), text);
const csvRow = (cells) => cells.map((c) => (/[",\r\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(',');

rmSync(OUT, { recursive: true, force: true });
for (const dir of ['', 'plans', 'plans_uploader_csv', 'baseline_plans', 'tutor']) {
  mkdirSync(join(OUT, dir), { recursive: true });
}

// ── 1. Parse and validate ───────────────────────────────────────────────────
log(`Parsing ${CSV_PATH}`);
let parsed;
try {
  parsed = parseTruckCsv(readFileSync(CSV_PATH, 'utf8'));
} catch (err) {
  if (!(err instanceof TruckCsvSchemaError)) throw err;
  write('parse_issues.csv', issuesToCsv(err.issues));
  console.error(`SCHEMA ERROR: ${err.message}`);
  console.error(`Nothing was generated. Details in ${join(OUT, 'parse_issues.csv')}`);
  process.exit(1);
}
const { units, issues, summary: parseSummary } = parsed;
write('parse_issues.csv', issuesToCsv(issues));
write('parse_summary.json', JSON.stringify(parseSummary, null, 2));
log(`  ${parseSummary.dataRows} rows: ${parseSummary.accepted} accepted, ${parseSummary.rejected} rejected, ${parseSummary.warnings} warnings`);
for (const [code, n] of Object.entries(parseSummary.byCode).sort((a, b) => b[1] - a[1])) {
  log(`    ${code.padEnd(28)} ${n}`);
}
if (units.length === 0) {
  console.error('No usable rows — stopping before generation.');
  process.exit(1);
}

// ── 2. Generate ─────────────────────────────────────────────────────────────
const synthetic = generateSyntheticPlans(units, PLAN_COUNT, SEED);
const baseline = generateRandomPlans(PLAN_COUNT, SEED);
for (const plan of synthetic) {
  write(`plans/${plan.id}.json`, JSON.stringify(plan, null, 2));
  write(`plans_uploader_csv/${plan.id}.csv`, planToUploaderCsv(plan));
}
for (const plan of baseline) write(`baseline_plans/${plan.id}.json`, JSON.stringify(plan, null, 2));
log(`Generated ${synthetic.length} synthetic plans and ${baseline.length} random-baseline plans (seed ${SEED})`);

// The three hand-written examples the app ships with, for reference.
const shipped = STEELCASE_LOAD_EXAMPLES.map((ex) => {
  const boxes = ex.boxes.flatMap((t) => Array.from({ length: t.quantity }, () => ({
    typeKey: typeKeyOf(t.dimensionsInches.width, t.dimensionsInches.depth, t.dimensionsInches.height),
    lengthIn: t.dimensionsInches.width,
    widthIn: t.dimensionsInches.depth,
    heightIn: t.dimensionsInches.height,
    weightLb: 0,
    fragile: Boolean(t.fragile)
  })));
  return { id: ex.id, boxes, totals: { stops: 1, fillRatio: 0 } };
});

// ── 3. Diversity ────────────────────────────────────────────────────────────
const divSyn = setDiversity(synthetic);
const divRnd = setDiversity(baseline);
const divShipped = setDiversity(shipped);

const perPlanCols = Object.keys(divSyn.perPlan[0]);
write('diversity_per_plan.csv', [
  csvRow(['generator', ...perPlanCols]),
  ...divSyn.perPlan.map((p) => csvRow(['synthetic', ...perPlanCols.map((k) => p[k])])),
  ...divRnd.perPlan.map((p) => csvRow(['random-baseline', ...perPlanCols.map((k) => p[k])]))
].join('\r\n') + '\r\n');

const METRIC_LABELS = [
  ['plans', 'Plans'],
  ['medianBoxes', 'Boxes per plan (median)'],
  ['distinctTypesAcrossSet', 'Distinct box sizes across all plans'],
  ['distinctTypeCombinations', 'Distinct box-size combinations'],
  ['medianDistinctTypes', 'Box sizes per plan (median)'],
  ['minDistinctTypes', 'Box sizes per plan (min)'],
  ['maxDistinctTypes', 'Box sizes per plan (max)'],
  ['meanEffectiveTypes', 'Effective box sizes per plan (mean)'],
  ['meanLargestGroupShare', 'Share of plan taken by its most common size (mean)'],
  ['meanPairwiseJaccard', 'Overlap between plans (0 = nothing shared, 1 = identical)'],
  ['medianStops', 'Stops per plan (median)'],
  ['plansWithFragile', 'Plans containing a fragile box'],
  ['smallestEdgeIn', 'Smallest edge (in)'],
  ['largestEdgeIn', 'Largest edge (in)'],
  ['lightestLb', 'Lightest box (lb)'],
  ['heaviestLb', 'Heaviest box (lb)'],
  ['medianFillRatio', 'Trailer fill by volume (median)']
];
const NOT_APPLICABLE = new Set(['medianStops', 'lightestLb', 'heaviestLb', 'medianFillRatio']);

const combo = (plan, limit = 8) => {
  const counts = typeCounts(plan);
  const shown = counts.slice(0, limit).map(([k, n]) => `${n} × ${k.replace(/x/g, '×')}`).join(', ');
  return counts.length > limit ? `${shown}, … +${counts.length - limit} more sizes` : shown;
};

const report = [
  '# Box-combination diversity: synthetic vs. random baseline',
  '',
  `Seed ${SEED}. Sizes are inches, smallest edge first, and a size counts once however the box is turned.`,
  '',
  '| Metric | Synthetic (from CSV) | Random baseline (5 SKUs) | Shipped examples (3) |',
  '| --- | ---: | ---: | ---: |',
  ...METRIC_LABELS.map(([k, label]) =>
    `| ${label} | ${divSyn.summary[k]} | ${divRnd.summary[k]} | ${NOT_APPLICABLE.has(k) ? 'n/a' : divShipped.summary[k]} |`),
  '',
  '## Side by side — first 8 plans from each generator',
  '',
  ...Array.from({ length: Math.min(8, PLAN_COUNT) }, (_, i) => [
    `**${synthetic[i].id}** — ${synthetic[i].totals.boxes} boxes, ${synthetic[i].totals.distinctTypes} sizes, ${synthetic[i].totals.stops} stop(s), from shipment ${synthetic[i].templateShipment}`,
    '',
    `> ${combo(synthetic[i])}`,
    '',
    `**${baseline[i].id}** — ${baseline[i].totals.boxes} boxes, ${baseline[i].totals.distinctTypes} sizes`,
    '',
    `> ${combo(baseline[i])}`,
    ''
  ]).flat(),
  '## Every synthetic plan',
  '',
  '| Plan | Boxes | Sizes | Stops | Fill | Fragile | Largest box (in) | Heaviest (lb) |',
  '| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: |',
  ...synthetic.map((p, i) => {
    const d = divSyn.perPlan[i];
    const big = p.boxes.reduce((a, b) => (b.lengthIn * b.widthIn * b.heightIn > a.lengthIn * a.widthIn * a.heightIn ? b : a));
    return `| ${p.id} | ${d.boxes} | ${d.distinctTypes} | ${d.stops} | ${Math.round(d.fillRatio * 100)}% | ${d.fragileBoxes} | ${big.lengthIn} × ${big.widthIn} × ${big.heightIn} | ${d.maxWeightLb} |`;
  }),
  ''
];
write('diversity_report.md', report.join('\n'));
log(`Diversity: ${divSyn.summary.distinctTypesAcrossSet} distinct sizes (synthetic) vs ${divRnd.summary.distinctTypesAcrossSet} (random baseline)`);

// ── 4. Tutor trial ──────────────────────────────────────────────────────────
log(`Running the tutor on ${Math.min(TUTOR_PLANS, synthetic.length)} plans (reference load + simulated learner)…`);
const tutorRows = [];
const mistakeGrades = {};
let mistakes = 0;
let mistakesUnexplained = 0;
let tutorMs = 0;

for (const plan of synthetic.slice(0, TUTOR_PLANS)) {
  const started = performance.now();
  const items = planToItems(plan);
  const tips = briefing(plan, items);
  const reference = buildReferenceLoad(items);
  const learner = simulateLearner(items, createRng(plan.seed ^ 0x5bd1e995), { mistakeRate: 0.3 });
  const refSummary = sessionSummary(reference);
  const learnerSummary = sessionSummary(learner);
  tutorMs += performance.now() - started;

  const slips = learner.filter((s) => s.mistake);
  for (const s of slips) {
    mistakes += 1;
    mistakeGrades[s.feedback.grade] = (mistakeGrades[s.feedback.grade] ?? 0) + 1;
    if (s.feedback.grade !== 'excellent' && s.feedback.notes.length === 0) mistakesUnexplained += 1;
  }

  tutorRows.push({
    plan: plan.id,
    boxes: items.length,
    refPlaced: refSummary.placed,
    refUnplaced: refSummary.unplaced,
    refUsedLengthFt: refSummary.usedLengthFt,
    refPackDensity: refSummary.packDensity,
    refMeanSupport: refSummary.meanSupport,
    refHeavyOnFragile: refSummary.heavyOnFragile,
    refWeightOverFragile: refSummary.weightOverFragile,
    refLateralOffsetPct: refSummary.lateralOffsetPct,
    learnerMistakes: slips.length,
    learnerUsedLengthFt: learnerSummary.usedLengthFt,
    learnerPackDensity: learnerSummary.packDensity,
    learnerPoor: learnerSummary.grades.poor ?? 0,
    learnerImprovable: learnerSummary.grades.improvable ?? 0,
    learnerGood: learnerSummary.grades.good ?? 0,
    learnerExcellent: learnerSummary.grades.excellent ?? 0
  });

  const dims = (item) => `${round1(item.dimensions.x * 12)} × ${round1(item.dimensions.z * 12)} × ${round1(item.dimensions.y * 12)} in`;
  const md = [
    `# Tutor trial — ${plan.id}`,
    '',
    `Template shipment ${plan.templateShipment}, seed ${plan.seed}.`,
    '',
    '## Briefing (before loading)',
    '',
    ...tips.map((t) => `- ${t}`),
    '',
    '## Reference load (heuristic places every carton)',
    '',
    `Placed ${refSummary.placed} of ${refSummary.cartons}; used ${refSummary.usedLengthFt} ft of trailer at ${Math.round(refSummary.packDensity * 100)}% density; ` +
    `mean base support ${Math.round(refSummary.meanSupport * 100)}%; heavy-on-fragile ${refSummary.heavyOnFragile}; ` +
    `centre of mass ${refSummary.lateralOffsetPct}% off the centreline.`,
    '',
    '| # | Carton | Stop | Weight | Where | Pose | Why |',
    '| ---: | --- | ---: | ---: | --- | --- | --- |',
    ...reference.map((s, i) => (s.pose
      ? `| ${i + 1} | ${s.item.id} · ${dims(s.item)}${s.item.fragile ? ' · FRAGILE' : ''} | ${s.item.stop} | ${round1(s.item.mass)} lb | ${describeSpot(s.pose)} | ${s.pose.orientation} | ${s.reasons.join('; ')} |`
      : `| ${i + 1} | ${s.item.id} · ${dims(s.item)} | ${s.item.stop} | ${round1(s.item.mass)} lb | — | — | No legal spot found |`)),
    '',
    '## Simulated learner (30% of drops are careless)',
    '',
    `${slips.length} careless drops out of ${learner.length}. Finished load: ${learnerSummary.usedLengthFt} ft used at ` +
    `${Math.round(learnerSummary.packDensity * 100)}% density (reference: ${refSummary.usedLengthFt} ft at ${Math.round(refSummary.packDensity * 100)}%). ` +
    `Grades: ${Object.entries(learnerSummary.grades).map(([g, n]) => `${g} ${n}`).join(', ')}.`,
    '',
    ...slips.flatMap((s) => [
      `### ${s.item.id} · ${dims(s.item)} · ${round1(s.item.mass)} lb${s.item.fragile ? ' · FRAGILE' : ''} — **${s.feedback.grade}** (gap ${s.feedback.gap})`,
      '',
      `Learner put it ${describeSpot(s.pose)}.`,
      '',
      ...(s.feedback.grade === 'excellent'
        ? [`Tutor: Good spot. ${s.feedback.praise.join('; ')}.`, '']
        : [
          ...s.feedback.notes.map((n) => `- ${n}`),
          ...(s.feedback.suggestion
            ? [`- Better: ${s.feedback.suggestion.spot}, ${s.feedback.suggestion.orientation}. ${s.feedback.suggestion.reasons.join('; ')}.`]
            : []),
          ''
        ])
    ])
  ];
  write(`tutor/${plan.id}.md`, md.join('\n'));
}

function round1(v) { return Number(v.toFixed(1)); }

const tutorCols = Object.keys(tutorRows[0] ?? {});
write('tutor_summary.csv', [csvRow(tutorCols), ...tutorRows.map((r) => csvRow(tutorCols.map((k) => r[k])))].join('\r\n') + '\r\n');

const sum = (k) => tutorRows.reduce((s, r) => s + r[k], 0);
const runSummary = {
  seed: SEED,
  csv: CSV_PATH,
  parse: parseSummary,
  fragileInferredFrom: String(FRAGILE_PATTERN),
  fragileUnitsInCsv: units.filter((u) => FRAGILE_PATTERN.test(u.description)).length,
  plans: { synthetic: synthetic.length, randomBaseline: baseline.length },
  diversity: { synthetic: divSyn.summary, randomBaseline: divRnd.summary, shippedExamples: divShipped.summary },
  tutor: {
    plansRun: tutorRows.length,
    cartons: sum('boxes'),
    referencePlaced: sum('refPlaced'),
    referenceUnplaced: sum('refUnplaced'),
    referenceHeavyOnFragile: sum('refHeavyOnFragile'),
    referenceWeightOverFragile: sum('refWeightOverFragile'),
    meanReferencePackDensity: Number((sum('refPackDensity') / Math.max(tutorRows.length, 1)).toFixed(3)),
    meanLearnerPackDensity: Number((sum('learnerPackDensity') / Math.max(tutorRows.length, 1)).toFixed(3)),
    carelessDrops: mistakes,
    carelessDropGrades: mistakeGrades,
    carelessDropsFlaggedButUnexplained: mistakesUnexplained,
    seconds: Number((tutorMs / 1000).toFixed(1))
  }
};
write('run_summary.json', JSON.stringify(runSummary, null, 2));

log(`Tutor: reference placed ${runSummary.tutor.referencePlaced}/${runSummary.tutor.cartons} cartons, heavy-on-fragile ${runSummary.tutor.referenceHeavyOnFragile}`);
log(`Tutor: ${mistakes} careless drops graded ${JSON.stringify(mistakeGrades)}; ${mistakesUnexplained} flagged without an explanation`);
log(`Done in ${runSummary.tutor.seconds}s of tutor time. Output in ${OUT}/`);
