/**
 * Sprint 9, SCRUM-74 — the three test scenarios from the planning agreement.
 *
 * Run with:  node --test test/dataset.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  DATASET_COLUMNS,
  DatasetSchemaError,
  validateDataset,
  rowsToCsv,
  planFingerprint,
  dedupePlans,
  splitCounts,
  splitPlans,
  qualityReport
} from '../src/dataset.mjs';

const FIXTURES = fileURLToPath(new URL('./fixtures/dataset/', import.meta.url));
const fixture = (name) => readFileSync(`${FIXTURES}${name}`, 'utf8');

// ── Scenario 1: schema validation ───────────────────────────────────────────

/** Each invalid fixture has exactly one defect: [line in file, code, column]. */
const EXPECTED_REJECTION = {
  'invalid-01-missing-field.csv':        [3, 'MISSING_FIELD', 'weight_lb'],
  'invalid-02-duplicate-box-id.csv':     [4, 'DUPLICATE_BOX_ID', 'box_id'],
  'invalid-03-nonpositive-dimension.csv': [2, 'NONPOSITIVE_DIMENSION', 'width_in'],
  'invalid-04-nonfinite-coordinate.csv': [4, 'NONFINITE_COORDINATE', 'pos_y_ft'],
  'invalid-05-invalid-stop-id.csv':      [3, 'INVALID_STOP_ID', 'stop_id']
};

test('scenario 1: all 10 fixtures are classified correctly', () => {
  const files = readdirSync(FIXTURES).filter((f) => f.endsWith('.csv')).sort();
  assert.equal(files.length, 10);
  assert.equal(files.filter((f) => f.startsWith('valid-')).length, 5);

  for (const file of files) {
    const r = validateDataset(fixture(file));
    if (file.startsWith('valid-')) {
      assert.equal(r.accepted.length, 1, file);
      assert.equal(r.rejected.length, 0, file);
      assert.deepEqual(r.issues, [], file);
    } else {
      assert.equal(r.accepted.length, 0, file);
      assert.equal(r.rejected.length, 1, file);
    }
  }
});

test('scenario 1: every rejected fixture has a row-specific reason', () => {
  for (const [file, [row, code, column]] of Object.entries(EXPECTED_REJECTION)) {
    const { rejected } = validateDataset(fixture(file));
    assert.deepEqual(
      rejected[0].reasons.map((i) => [i.row, i.code, i.column]),
      [[row, code, column]],
      file
    );
    assert.ok(rejected[0].reasons[0].message.length > 0, file);
  }
});

test('scenario 1: accepted output has 0 missing required values', () => {
  const files = readdirSync(FIXTURES).filter((f) => f.endsWith('.csv'));
  let rows = 0;
  for (const file of files) {
    for (const plan of validateDataset(fixture(file)).accepted) {
      for (const row of plan.rows) {
        rows += 1;
        for (const column of DATASET_COLUMNS) {
          assert.ok(row[column] !== undefined && row[column] !== '' && !Number.isNaN(row[column]), `${file} ${column}`);
        }
      }
    }
  }
  assert.equal(rows, 13);
});

test('one bad row rejects the whole plan and leaves other plans alone', () => {
  const good = fixture('valid-01-one-stop.csv').trim().split(/\r?\n/);
  const bad = fixture('invalid-04-nonfinite-coordinate.csv').trim().split(/\r?\n/).slice(1);
  const r = validateDataset([...good, ...bad].join('\r\n'));
  assert.deepEqual(r.accepted.map((p) => p.planId), ['fx-v1']);
  assert.deepEqual(r.rejected.map((p) => p.planId), ['fx-i4']);
  assert.equal(r.summary.acceptedRows, 3);
});

test('other nonfinite and malformed values are caught too', () => {
  const header = DATASET_COLUMNS.join(',');
  const row = (over) => {
    const cells = ['p', 'b01', '1', '1', '24', '12', '6', '30', 'false', '25.5', '0.45', '-3.75', '2', '0.5', '1'];
    for (const [c, v] of Object.entries(over)) cells[DATASET_COLUMNS.indexOf(c)] = v;
    return `${header}\r\n${cells.join(',')}\r\n`;
  };
  const code = (over) => validateDataset(row(over)).issues.map((i) => i.code);

  assert.deepEqual(code({ pos_x_ft: 'Infinity' }), ['NONFINITE_COORDINATE']);
  assert.deepEqual(code({ pos_z_ft: '-Infinity' }), ['NONFINITE_COORDINATE']);
  assert.deepEqual(code({ pos_x_ft: '1.2.3' }), ['NONFINITE_COORDINATE']);
  assert.deepEqual(code({ height_in: '-6' }), ['NONPOSITIVE_DIMENSION']);
  assert.deepEqual(code({ size_y_ft: '0' }), ['NONPOSITIVE_DIMENSION']);
  assert.deepEqual(code({ length_in: '12abc' }), ['NOT_A_NUMBER']);
  assert.deepEqual(code({ stop_id: '1.5' }), ['INVALID_STOP_ID']);
  assert.deepEqual(code({ stop_id: '-1' }), ['INVALID_STOP_ID']);
  assert.deepEqual(code({ stop_id: 'Stop 1' }), ['INVALID_STOP_ID']);
  assert.deepEqual(code({ stop_id: '' }), ['MISSING_FIELD']);
  assert.deepEqual(code({ plan_id: '' }), ['MISSING_FIELD']);
  assert.deepEqual(code({ fragile: 'yes' }), ['INVALID_FLAG']);
  assert.deepEqual(code({}), []);
});

test('a header without a required column is refused outright', () => {
  const text = fixture('valid-01-one-stop.csv').replace(',stop_id', '');
  assert.throws(() => validateDataset(text), (err) =>
    err instanceof DatasetSchemaError && err.issues[0].column === 'stop_id');
});

// ── Scenario 2: dataset separation ──────────────────────────────────────────

/** `count` unique valid plans of 2–4 boxes each, as validated plan objects. */
function makePlans(count) {
  const rows = [];
  for (let p = 0; p < count; p += 1) {
    const boxes = 2 + (p % 3);
    for (let b = 0; b < boxes; b += 1) {
      rows.push({
        plan_id: `plan-${String(p).padStart(4, '0')}`,
        box_id: `b${b + 1}`,
        load_seq: b + 1,
        stop_id: 1 + (b % 2),
        length_in: 10 + (p % 97),          // (p % 97, floor(p / 97)) is unique per plan
        width_in: 8 + Math.floor(p / 97),
        height_in: 6 + b,
        weight_lb: 20,
        fragile: false,
        pos_x_ft: 25 - b,
        pos_y_ft: 0.5,
        pos_z_ft: -3,
        size_x_ft: 1,
        size_y_ft: 0.5,
        size_z_ft: 1
      });
    }
  }
  const { accepted, rejected } = validateDataset(rowsToCsv(rows));
  assert.equal(rejected.length, 0);
  return accepted;
}

test('scenario 2: 1,000 plans split 700/150/150 identically on two runs', () => {
  const plans = makePlans(1000);
  assert.equal(dedupePlans(plans).unique.length, 1000, 'fixture plans are unique');

  const ids = (split) => Object.fromEntries(Object.entries(split).map(([k, v]) => [k, v.map((p) => p.planId)]));
  const first = ids(splitPlans(plans, 20261013));
  const second = ids(splitPlans(plans, 20261013));

  assert.deepEqual(first, second);
  assert.deepEqual([first.train.length, first.validation.length, first.test.length], [700, 150, 150]);
});

test('scenario 2: no plan, duplicate or box crosses between splits', () => {
  const plans = makePlans(1000);
  const split = splitPlans(plans, 20261013);

  const idHome = new Map();
  const fingerprintHome = new Map();
  let boxes = 0;
  for (const [name, list] of Object.entries(split)) {
    for (const plan of list) {
      assert.ok(!idHome.has(plan.planId), `${plan.planId} is in ${idHome.get(plan.planId)} and ${name}`);
      idHome.set(plan.planId, name);

      const fp = planFingerprint(plan);
      assert.ok(!fingerprintHome.has(fp), `duplicate content in ${fingerprintHome.get(fp)} and ${name}`);
      fingerprintHome.set(fp, name);

      // Every row of a plan sits in that plan's split.
      for (const row of plan.rows) {
        assert.equal(row.plan_id, plan.planId);
        boxes += 1;
      }
    }
  }
  assert.equal(idHome.size, 1000);
  assert.equal(boxes, plans.reduce((n, p) => n + p.rows.length, 0), 'no box lost or repeated');
});

test('the split depends on the seed and the set of plans, not on input order', () => {
  const plans = makePlans(200);
  const ids = (split) => JSON.stringify(Object.values(split).map((v) => v.map((p) => p.planId)));
  assert.equal(ids(splitPlans(plans, 7)), ids(splitPlans([...plans].reverse(), 7)));
  assert.notEqual(ids(splitPlans(plans, 7)), ids(splitPlans(plans, 8)));
});

test('rounding for other dataset sizes is as documented and always sums to n', () => {
  assert.deepEqual(splitCounts(1000), { train: 700, validation: 150, test: 150 });
  assert.deepEqual(splitCounts(50), { train: 35, validation: 8, test: 7 });
  assert.deepEqual(splitCounts(10), { train: 7, validation: 2, test: 1 });
  assert.deepEqual(splitCounts(3), { train: 2, validation: 1, test: 0 });
  assert.deepEqual(splitCounts(1), { train: 1, validation: 0, test: 0 });
  assert.deepEqual(splitCounts(0), { train: 0, validation: 0, test: 0 });
  for (let n = 0; n <= 300; n += 1) {
    const c = splitCounts(n);
    assert.equal(c.train + c.validation + c.test, n, `n=${n}`);
  }
});

test('exact duplicates are removed before splitting, whatever their ids say', () => {
  const [a, b] = makePlans(2);
  const copy = {
    planId: 'renamed-copy',
    rows: a.rows.map((r, i) => ({ ...r, plan_id: 'renamed-copy', box_id: `other-${i}` }))
  };
  const { unique, duplicates } = dedupePlans([a, b, copy]);
  assert.deepEqual(unique.map((p) => p.planId), [a.planId, b.planId]);
  assert.deepEqual(duplicates, [{ planId: 'renamed-copy', duplicateOf: a.planId }]);

  // A plan that differs by one coordinate is not a duplicate.
  const moved = { planId: 'moved', rows: a.rows.map((r, i) => (i ? r : { ...r, pos_x_ft: r.pos_x_ft - 1 })) };
  assert.equal(dedupePlans([a, moved]).duplicates.length, 0);

  assert.throws(() => splitPlans([a, a], 1), /Duplicate plan id/);
});

// ── Scenario 3: diversity report ────────────────────────────────────────────

const reportInput = (csvCombos, baselineCombos) => ({
  seed: 1,
  source: { file: 'truck_info.csv', sha256: 'a'.repeat(64) },
  generated: 50,
  validation: { acceptedPlans: 48, rejectedPlans: 2, byCode: { MISSING_FIELD: 3 }, missingByColumn: { pos_x_ft: 3 } },
  duplicates: [{ planId: 'syn-009', duplicateOf: 'syn-002' }],
  splitSizes: { train: 33, validation: 7, test: 7 },
  csvSample: { plans: 50, distinctTypeCombinations: csvCombos, distinctTypesAcrossSet: 400, medianDistinctTypes: 15 },
  baselineSample: { plans: 50, distinctTypeCombinations: baselineCombos, distinctTypesAcrossSet: 5, medianDistinctTypes: 5 }
});

test('scenario 3: report has both combination counts, accepted/rejected and an explanation', () => {
  const md = qualityReport(reportInput(50, 2));
  assert.match(md, /\| Unique box combinations \| 50 \| 2 \|/);
  assert.match(md, /\| Accepted by schema validation \| 48 \|/);
  assert.match(md, /\| Rejected by schema validation \| 2 \|/);
  assert.match(md, /\| pos_x_ft \| 3 \|/);
  assert.match(md, /`syn-009` is an exact duplicate of `syn-002`/);
  assert.match(md, /MORE unique box combinations/);
  assert.match(md, /cuts each plan from a real shipment/);
});

test('scenario 3: a lower diversity result is recorded, not hidden', () => {
  const md = qualityReport(reportInput(2, 9));
  assert.match(md, /\| Unique box combinations \| 2 \| 9 \|/);
  assert.match(md, /LOWER diversity than the previous generator \(2 vs 9/);
  assert.match(md, /Recorded for review/);
  assert.doesNotMatch(md, /MORE unique/);
});
