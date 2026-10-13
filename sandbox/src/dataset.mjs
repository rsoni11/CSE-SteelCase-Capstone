/**
 * Training dataset: schema validation, duplicate removal and train /
 * validation / test splits (Sprint 9, SCRUM-74). Pure — no fs, no DOM.
 *
 * The dataset is one CSV row per placed box. Every row carries its plan_id, so
 * a plan is the set of rows sharing one id. Validation, de-duplication and
 * splitting all work on whole plans: a plan is accepted or rejected as a unit
 * and never divided between splits.
 */
import { createHash } from 'node:crypto';

import { tokenizeCsv, strictNumber } from './truckCsv.mjs';
import { createRng } from './rng.mjs';

/**
 * Row contract. `kind` drives the per-cell check:
 *   id        non-empty string
 *   seq       whole number >= 1
 *   stop      whole number 1..MAX_STOP_ID
 *   dimension finite number > 0
 *   coord     finite number (any sign — the trailer is centred on the origin)
 *   flag      true / false
 */
export const DATASET_SCHEMA = [
  { column: 'plan_id',   kind: 'id' },
  { column: 'box_id',    kind: 'id' },
  { column: 'load_seq',  kind: 'seq' },        // order the box is loaded, 1 = first
  { column: 'stop_id',   kind: 'stop' },       // delivery stop, 1 = first delivery
  { column: 'length_in', kind: 'dimension' },
  { column: 'width_in',  kind: 'dimension' },
  { column: 'height_in', kind: 'dimension' },
  { column: 'weight_lb', kind: 'dimension' },
  { column: 'fragile',   kind: 'flag' },
  { column: 'pos_x_ft',  kind: 'coord' },      // placed centre; +x is the nose
  { column: 'pos_y_ft',  kind: 'coord' },
  { column: 'pos_z_ft',  kind: 'coord' },
  { column: 'size_x_ft', kind: 'dimension' },  // world-axis extents as placed
  { column: 'size_y_ft', kind: 'dimension' },
  { column: 'size_z_ft', kind: 'dimension' }
];

export const DATASET_COLUMNS = DATASET_SCHEMA.map((s) => s.column);

/** A stop id above this is treated as a data error, not a long route. */
export const MAX_STOP_ID = 99;

export const SPLIT_RATIOS = { train: 0.7, validation: 0.15, test: 0.15 };

export class DatasetSchemaError extends Error {
  constructor(message, issues) {
    super(message);
    this.name = 'DatasetSchemaError';
    this.issues = issues;
  }
}

// ── Writing ─────────────────────────────────────────────────────────────────

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Row objects → CSV text, columns in DATASET_COLUMNS order. */
export const rowsToCsv = (rows) =>
  [DATASET_COLUMNS.join(',')]
    .concat(rows.map((r) => DATASET_COLUMNS.map((c) => csvCell(r[c])).join(',')))
    .join('\r\n') + '\r\n';

const trim = (v) => Number(v.toFixed(4));

/**
 * One plan plus the heuristic's placements → dataset rows.
 *
 * `steps` is the output of buildReferenceLoad(). A box the heuristic could not
 * place is written with blank placement cells, so the validator rejects the
 * plan for the right reason instead of the box silently disappearing.
 */
export function planToRows(plan, steps) {
  const boxOf = new Map(plan.boxes.map((b) => [b.id, b]));
  return steps.map((step, i) => {
    const box = boxOf.get(step.item.id);
    const p = step.pose?.position;
    const s = step.pose?.size;
    return {
      plan_id: plan.id,
      box_id: box.id,
      load_seq: i + 1,
      stop_id: box.stop,
      length_in: box.lengthIn,
      width_in: box.widthIn,
      height_in: box.heightIn,
      weight_lb: box.weightLb,
      fragile: box.fragile,
      pos_x_ft: p ? trim(p.x) : '',
      pos_y_ft: p ? trim(p.y) : '',
      pos_z_ft: p ? trim(p.z) : '',
      size_x_ft: s ? trim(s.x) : '',
      size_y_ft: s ? trim(s.y) : '',
      size_z_ft: s ? trim(s.z) : ''
    };
  });
}

// ── Validation (SCRUM-77) ───────────────────────────────────────────────────

function checkCell(kind, raw) {
  if (raw === '') return { code: 'MISSING_FIELD', message: 'Required value is blank' };
  if (kind === 'id') return { value: raw };
  if (kind === 'flag') {
    if (raw === 'true' || raw === 'false') return { value: raw === 'true' };
    return { code: 'INVALID_FLAG', message: 'Expected true or false' };
  }

  const n = strictNumber(raw);
  if (kind === 'coord') {
    return Number.isFinite(n)
      ? { value: n }
      : { code: 'NONFINITE_COORDINATE', message: 'Placement coordinate is not a finite number' };
  }
  if (kind === 'dimension') {
    if (!Number.isFinite(n)) return { code: 'NOT_A_NUMBER', message: 'Expected a number' };
    return n > 0 ? { value: n } : { code: 'NONPOSITIVE_DIMENSION', message: 'Must be greater than zero' };
  }
  if (kind === 'stop') {
    return Number.isInteger(n) && n >= 1 && n <= MAX_STOP_ID
      ? { value: n }
      : { code: 'INVALID_STOP_ID', message: `Expected a whole number from 1 to ${MAX_STOP_ID}` };
  }
  // seq
  return Number.isInteger(n) && n >= 1
    ? { value: n }
    : { code: 'INVALID_SEQUENCE', message: 'Expected a whole number of 1 or more' };
}

/**
 * Validate dataset CSV text.
 *
 * A plan is accepted only if every one of its rows passes; one bad row rejects
 * the whole plan, because a load plan with a box missing is a different (and
 * wrong) training example. Rows with no plan_id cannot be attached to a plan
 * and are reported on their own.
 *
 * @returns {{ accepted: Array, rejected: Array, issues: Array, summary: object }}
 *   accepted  [{ planId, rows }]            rows are typed objects
 *   rejected  [{ planId, reasons }]         reasons are the plan's issues
 *   issues    [{ row, planId, code, column, value, message }] — `row` is the
 *             line number in the file
 * @throws {DatasetSchemaError} if the header is missing a required column
 */
export function validateDataset(text) {
  const records = tokenizeCsv(text);
  if (records.length === 0) {
    throw new DatasetSchemaError('Dataset is empty', [
      { row: 1, planId: '', code: 'EMPTY_FILE', column: '', value: '', message: 'No header row' }
    ]);
  }

  const header = records[0].cells.map((h) => h.trim());
  const missing = DATASET_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) {
    throw new DatasetSchemaError(
      `Dataset header is missing: ${missing.join(', ')}`,
      missing.map((column) => ({ row: 1, planId: '', code: 'MISSING_COLUMN', column, value: '', message: 'Required column not found in header' }))
    );
  }
  const indexOf = Object.fromEntries(DATASET_COLUMNS.map((c) => [c, header.indexOf(c)]));

  const issues = [];
  const plans = new Map();   // planId → { planId, rows, reasons, boxRow }
  const orphanReasons = [];

  for (const { line, cells } of records.slice(1)) {
    const planId = (cells[indexOf.plan_id] ?? '').trim();
    const rowIssues = [];
    const flag = (code, column, value, message) =>
      rowIssues.push({ row: line, planId, code, column, value: String(value), message });

    const typed = { row: line };
    if (cells.length !== header.length) {
      flag('ROW_WIDTH', '', cells.length, `Expected ${header.length} cells, found ${cells.length}`);
    } else {
      for (const { column, kind } of DATASET_SCHEMA) {
        const raw = cells[indexOf[column]].trim();
        const res = checkCell(kind, raw);
        if (res.code) flag(res.code, column, raw, res.message);
        else typed[column] = res.value;
      }
    }

    if (planId === '') {
      // Already flagged as MISSING_FIELD on plan_id (or as a ragged row).
      for (const i of rowIssues) { issues.push(i); orphanReasons.push(i); }
      continue;
    }

    if (!plans.has(planId)) plans.set(planId, { planId, rows: [], reasons: [], boxRow: new Map() });
    const plan = plans.get(planId);

    const boxId = typed.box_id;
    if (boxId !== undefined) {
      const first = plan.boxRow.get(boxId);
      if (first !== undefined) {
        flag('DUPLICATE_BOX_ID', 'box_id', boxId, `Box id already used in this plan on row ${first}`);
      } else {
        plan.boxRow.set(boxId, line);
      }
    }

    if (rowIssues.length === 0) plan.rows.push(typed);
    for (const i of rowIssues) { issues.push(i); plan.reasons.push(i); }
  }

  const accepted = [];
  const rejected = [];
  for (const plan of plans.values()) {
    if (plan.reasons.length) rejected.push({ planId: plan.planId, reasons: plan.reasons });
    else accepted.push({ planId: plan.planId, rows: plan.rows });
  }
  if (orphanReasons.length) rejected.push({ planId: '', reasons: orphanReasons });

  const byCode = {};
  const missingByColumn = {};
  for (const i of issues) {
    byCode[i.code] = (byCode[i.code] ?? 0) + 1;
    if (i.code === 'MISSING_FIELD') missingByColumn[i.column] = (missingByColumn[i.column] ?? 0) + 1;
  }

  return {
    accepted,
    rejected,
    issues,
    summary: {
      dataRows: records.length - 1,
      plans: plans.size + (orphanReasons.length ? 1 : 0),
      acceptedPlans: accepted.length,
      rejectedPlans: rejected.length,
      acceptedRows: accepted.reduce((n, p) => n + p.rows.length, 0),
      byCode,
      missingByColumn
    }
  };
}

/** Issue list → CSV text for the rejection log. */
export const datasetIssuesToCsv = (issues) =>
  ['row,plan_id,code,column,value,message']
    .concat(issues.map((i) =>
      [i.row, i.planId, i.code, i.column, i.value, i.message].map(csvCell).join(',')))
    .join('\r\n') + '\r\n';

// ── Duplicates (SCRUM-79) ───────────────────────────────────────────────────

const CONTENT_COLUMNS = DATASET_COLUMNS.filter((c) => c !== 'plan_id' && c !== 'box_id');

/**
 * Identity of a plan's CONTENT. Two plans are exact duplicates when they hold
 * the same boxes in the same places in the same order — whatever their plan
 * ids and box ids say. Ids are labels; a model trained on one copy and tested
 * on the other has seen the answer.
 */
export function planFingerprint(plan) {
  const lines = plan.rows
    .map((r) => CONTENT_COLUMNS.map((c) => r[c]).join(','))
    .sort();
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

/** Keep the first of each set of exact duplicates, in input order. */
export function dedupePlans(plans) {
  const firstWith = new Map();
  const unique = [];
  const duplicates = [];
  for (const plan of plans) {
    const fp = planFingerprint(plan);
    const kept = firstWith.get(fp);
    if (kept !== undefined) duplicates.push({ planId: plan.planId, duplicateOf: kept });
    else { firstWith.set(fp, plan.planId); unique.push(plan); }
  }
  return { unique, duplicates };
}

// ── Splits (SCRUM-79) ───────────────────────────────────────────────────────

/**
 * How many plans go to each split.
 *
 * Rounding rule: each split first gets floor(n × ratio). Plans left over are
 * handed out one at a time to the split with the largest fractional part, and
 * a tie goes to train, then validation, then test. So 1,000 plans → 700 / 150
 * / 150 exactly; 50 → 35 / 8 / 7; 10 → 7 / 2 / 1; 1 → 1 / 0 / 0. The three
 * counts always add up to n.
 */
export function splitCounts(n, ratios = SPLIT_RATIOS) {
  const names = Object.keys(ratios);
  const exact = names.map((k) => n * ratios[k]);
  // The epsilon keeps 1000 × 0.7 = 700.0000000000001 from being treated as
  // having a fractional part.
  const counts = exact.map((v) => Math.floor(v + 1e-9));
  const order = names
    .map((_, i) => ({ i, frac: exact[i] - counts[i] }))
    .sort((a, b) => (Math.abs(b.frac - a.frac) > 1e-9 ? b.frac - a.frac : a.i - b.i));
  let left = n - counts.reduce((s, c) => s + c, 0);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left -= 1) counts[order[k].i] += 1;
  return Object.fromEntries(names.map((k, i) => [k, counts[i]]));
}

/**
 * Deterministic split of whole plans.
 *
 * Plans are sorted by id before the seeded shuffle, so the result depends only
 * on the set of plans and the seed — not on the order they were read in.
 * Call dedupePlans() first; this throws if it is handed duplicate plan ids.
 */
export function splitPlans(plans, seed, ratios = SPLIT_RATIOS) {
  const sorted = [...plans].sort((a, b) => (a.planId < b.planId ? -1 : a.planId > b.planId ? 1 : 0));
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].planId === sorted[i - 1].planId) throw new Error(`Duplicate plan id "${sorted[i].planId}"`);
  }
  const shuffled = createRng(seed).shuffle(sorted);
  const counts = splitCounts(shuffled.length, ratios);
  const out = {};
  let at = 0;
  for (const name of Object.keys(ratios)) {
    out[name] = shuffled.slice(at, at + counts[name]);
    at += counts[name];
  }
  return out;
}

// ── Quality report (SCRUM-78) ───────────────────────────────────────────────

/**
 * @param {object} r
 *   seed, source { file, sha256 }, generated, validation (summary from
 *   validateDataset), rejected, duplicates, splitSizes,
 *   csvSample / baselineSample: { plans, distinctTypeCombinations,
 *   distinctTypesAcrossSet, medianDistinctTypes }
 */
export function qualityReport(r) {
  const v = r.validation;
  const csv = r.csvSample;
  const base = r.baselineSample;

  // Stated mechanically from the numbers, whichever way they fall — a lower
  // result for the new generator is reported, not explained away.
  const delta = csv.distinctTypeCombinations - base.distinctTypeCombinations;
  let verdict;
  if (delta > 0) {
    verdict = `The CSV-based sample has MORE unique box combinations than the previous generator (${csv.distinctTypeCombinations} vs ${base.distinctTypeCombinations}).`;
  } else if (delta < 0) {
    verdict = `The CSV-based sample has LOWER diversity than the previous generator (${csv.distinctTypeCombinations} vs ${base.distinctTypeCombinations} unique box combinations). Recorded for review.`;
  } else {
    verdict = `Both samples have the same number of unique box combinations (${csv.distinctTypeCombinations}). Recorded for review.`;
  }

  const missing = Object.entries(v.missingByColumn);
  const codes = Object.entries(v.byCode).sort((a, b) => b[1] - a[1]);

  return [
    '# Dataset quality report',
    '',
    `Seed ${r.seed}. Source \`${r.source.file}\` (sha256 ${r.source.sha256.slice(0, 16)}…).`,
    '',
    '## Plans',
    '',
    '| | Count |',
    '| --- | ---: |',
    `| Generated | ${r.generated} |`,
    `| Accepted by schema validation | ${v.acceptedPlans} |`,
    `| Rejected by schema validation | ${v.rejectedPlans} |`,
    `| Exact duplicates removed | ${r.duplicates.length} |`,
    `| Written to splits | ${r.splitSizes.train + r.splitSizes.validation + r.splitSizes.test} |`,
    `| — training | ${r.splitSizes.train} |`,
    `| — validation | ${r.splitSizes.validation} |`,
    `| — test | ${r.splitSizes.test} |`,
    '',
    '## Rejections',
    '',
    ...(codes.length
      ? ['| Reason | Rows |', '| --- | ---: |', ...codes.map(([c, n]) => `| ${c} | ${n} |`)]
      : ['No rows were rejected.']),
    '',
    '## Missing fields',
    '',
    ...(missing.length
      ? ['| Column | Rows missing it |', '| --- | ---: |', ...missing.map(([c, n]) => `| ${c} | ${n} |`)]
      : ['No required field is missing in any row.']),
    '',
    '## Duplicate plans',
    '',
    ...(r.duplicates.length
      ? r.duplicates.map((d) => `- \`${d.planId}\` is an exact duplicate of \`${d.duplicateOf}\` and was dropped.`)
      : ['No exact duplicate plans.']),
    '',
    `## Box-combination diversity (${csv.plans}-plan samples)`,
    '',
    '| | CSV-based generator | Previous random generator |',
    '| --- | ---: | ---: |',
    `| Plans in sample | ${csv.plans} | ${base.plans} |`,
    `| Unique box combinations | ${csv.distinctTypeCombinations} | ${base.distinctTypeCombinations} |`,
    `| Distinct box sizes across the sample | ${csv.distinctTypesAcrossSet} | ${base.distinctTypesAcrossSet} |`,
    `| Box sizes per plan (median) | ${csv.medianDistinctTypes} | ${base.medianDistinctTypes} |`,
    '',
    verdict,
    '',
    'A "box combination" is the set of box sizes that appear together in one plan, ' +
    'ignoring quantities and how each box is turned. The previous generator draws every ' +
    `box from the same ${base.distinctTypesAcrossSet} hard-coded sizes, so its plans can only differ in which of those ` +
    'sizes happen to be absent. The CSV-based generator cuts each plan from a real shipment, ' +
    `so the sizes available to it are whatever that shipment carried — ${csv.distinctTypesAcrossSet} distinct sizes ` +
    'across this sample.',
    ''
  ].join('\n');
}
