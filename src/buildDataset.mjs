/**
 * Sprint 9 (SCRUM-74): truck CSV → placed load plans → validated dataset →
 * de-duplicated train / validation / test splits, plus a quality report.
 *
 * Run from sandbox/ with:  node ../src/buildDataset.mjs [--csv data/truck_info.csv]
 *                          [--plans 50] [--seed 20261013] [--out out/dataset]
 *
 * The same CSV, code version, plan count and seed always produce the same
 * files; manifest.json records all four.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseTruckCsv, issuesToCsv, TruckCsvSchemaError } from './truckCsv.mjs';
import { generateSyntheticPlans, generateRandomPlans } from '../sandbox/src/generators.mjs';
import { setDiversity } from './diversity.mjs';
import { planToItems, buildReferenceLoad } from '../sandbox/src/tutor.mjs';
import {
  DATASET_COLUMNS,
  SPLIT_RATIOS,
  planToRows,
  rowsToCsv,
  validateDataset,
  datasetIssuesToCsv,
  dedupePlans,
  splitPlans,
  qualityReport
} from '../sandbox/src/dataset.mjs';

/** The diversity comparison is always made on equal samples of this size. */
const DIVERSITY_SAMPLE = 50;

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};

const CSV_PATH = arg('csv', 'data/truck_info.csv');
const OUT = arg('out', 'out/dataset');
const PLAN_COUNT = Number(arg('plans', 50));
const SEED = Number(arg('seed', 20261013));

const log = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
const write = (rel, text) => writeFileSync(join(OUT, rel), text);

const codeVersion = () => {
  try {
    const cwd = fileURLToPath(new URL('.', import.meta.url));
    const rev = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const dirty = execFileSync('git', ['status', '--porcelain', '--', '..'], { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return dirty ? `${rev}+uncommitted` : rev;
  } catch {
    return 'unknown';
  }
};

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// ── 1. Source CSV ───────────────────────────────────────────────────────────
log(`Parsing ${CSV_PATH}`);
const sourceText = readFileSync(CSV_PATH, 'utf8');
const source = { file: basename(CSV_PATH), sha256: createHash('sha256').update(sourceText).digest('hex') };
let parsed;
try {
  parsed = parseTruckCsv(sourceText);
} catch (err) {
  if (!(err instanceof TruckCsvSchemaError)) throw err;
  write('source_issues.csv', issuesToCsv(err.issues));
  console.error(`SCHEMA ERROR in source CSV: ${err.message}`);
  process.exit(1);
}
write('source_issues.csv', issuesToCsv(parsed.issues));
log(`  ${parsed.summary.accepted} source rows accepted, ${parsed.summary.rejected} rejected`);

// ── 2. Generate and place ───────────────────────────────────────────────────
// Always generate at least the diversity sample, so the comparison is made on
// 50 plans whatever --plans says.
const generated = generateSyntheticPlans(parsed.units, Math.max(PLAN_COUNT, DIVERSITY_SAMPLE), SEED);
const plans = generated.slice(0, PLAN_COUNT);
log(`Placing ${plans.length} plans with the existing heuristic…`);
const rows = [];
for (const plan of plans) rows.push(...planToRows(plan, buildReferenceLoad(planToItems(plan))));
const rawCsv = rowsToCsv(rows);
write('dataset_raw.csv', rawCsv);

// ── 3. Validate what was actually written ───────────────────────────────────
const validation = validateDataset(rawCsv);
write('rejections.csv', datasetIssuesToCsv(validation.issues));
log(`  ${validation.summary.acceptedPlans} plans accepted, ${validation.summary.rejectedPlans} rejected`);

// ── 4. De-duplicate, then split ─────────────────────────────────────────────
const { unique, duplicates } = dedupePlans(validation.accepted);
const splits = splitPlans(unique, SEED);
const splitSizes = {};
for (const [name, list] of Object.entries(splits)) {
  splitSizes[name] = list.length;
  write(`${name}.csv`, rowsToCsv(list.flatMap((p) => p.rows)));
}
log(`  ${duplicates.length} duplicate plans removed; split ${splitSizes.train} / ${splitSizes.validation} / ${splitSizes.test}`);

// ── 5. Quality report ───────────────────────────────────────────────────────
const sampleOf = (set) => {
  const s = setDiversity(set).summary;
  return {
    plans: s.plans,
    distinctTypeCombinations: s.distinctTypeCombinations,
    distinctTypesAcrossSet: s.distinctTypesAcrossSet,
    medianDistinctTypes: s.medianDistinctTypes
  };
};
const csvSample = sampleOf(generated.slice(0, DIVERSITY_SAMPLE));
const baselineSample = sampleOf(generateRandomPlans(DIVERSITY_SAMPLE, SEED));

write('quality_report.md', qualityReport({
  seed: SEED,
  source,
  generated: plans.length,
  validation: validation.summary,
  duplicates,
  splitSizes,
  csvSample,
  baselineSample
}));

write('manifest.json', JSON.stringify({
  seed: SEED,
  source,
  codeVersion: codeVersion(),
  plansRequested: PLAN_COUNT,
  columns: DATASET_COLUMNS,
  ratios: SPLIT_RATIOS,
  rounding: 'floor(n × ratio) each; leftovers go to the largest fractional part, ties to train, then validation, then test',
  validation: validation.summary,
  duplicatesRemoved: duplicates,
  splitSizes,
  planIds: Object.fromEntries(Object.entries(splits).map(([k, list]) => [k, list.map((p) => p.planId)])),
  diversity: { csvSample, baselineSample }
}, null, 2));

log(`Done. Output in ${OUT}/`);
