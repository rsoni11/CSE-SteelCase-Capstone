# Sandbox: CSV-driven load plans and ML dataset

Headless prototype that turns the Steelcase truck information file into load
plans, places them with the existing heuristic, and exports a validated
training dataset. It lives entirely in `sandbox/` and imports
`src/packingScore.js` and `src/fitSearch.js` unmodified; nothing in the app's
`src/` is changed.

Needs Node 20 or newer. There is nothing to `npm install`.

## Data

The source file is not in the repository (it is real shipment data). Put the
Excel export somewhere local and convert it once:

```bash
cd sandbox
node src/xlsxToCsv.mjs "path/to/SW region 1 month NG RDC .xlsx" data/truck_info.csv
```

`data/` and `out/` are git-ignored.

## Commands

Run from `sandbox/`.

| Command | What it does |
| --- | --- |
| `node src/buildDataset.mjs` | Sprint 9: generate, place, validate, de-duplicate and split the dataset |
| `node src/run.mjs` | Sprint 8: 50 plans, diversity comparison and tutor trial |
| `npm test` | Sandbox tests, including the three Sprint 9 test scenarios |
| `node src/verifyHeuristic.mjs` | Checks `src/` matches `origin/Yash` and its tests pass |

`buildDataset.mjs` takes `--csv <path> --plans <n> --seed <n> --out <dir>`
(defaults: `data/truck_info.csv`, 50, 20261013, `out/dataset`). The same CSV,
code version, plan count and seed always produce byte-identical files.

## Sprint 9 dataset (SCRUM-74)

### Output files (`out/dataset/`)

| File | Contents |
| --- | --- |
| `train.csv`, `validation.csv`, `test.csv` | The splits |
| `dataset_raw.csv` | Every generated row, before validation |
| `rejections.csv` | Each rejected row: line number, plan, reason code, column, value |
| `quality_report.md` | Accepted/rejected counts, missing fields, duplicates, diversity comparison |
| `manifest.json` | Seed, source file name and sha256, code version, plan ids per split |
| `source_issues.csv` | Rows of the source CSV that were rejected or warned about |

### Row schema

One row per placed box. A plan is the set of rows sharing a `plan_id`.

| Column | Type | Meaning |
| --- | --- | --- |
| `plan_id` | text | Load plan the box belongs to |
| `box_id` | text | Unique within its plan |
| `load_seq` | integer ≥ 1 | Order the box is loaded |
| `stop_id` | integer 1–99 | Delivery stop; 1 is the first delivery |
| `length_in`, `width_in`, `height_in` | number > 0 | Carton dimensions as listed, inches |
| `weight_lb` | number > 0 | Gross weight |
| `fragile` | `true` / `false` | Inferred from the description (see below) |
| `pos_x_ft`, `pos_y_ft`, `pos_z_ft` | finite number | Centre of the placed box, feet |
| `size_x_ft`, `size_y_ft`, `size_z_ft` | number > 0 | Extents along the world axes as placed |

Coordinates use the simulator's frame: origin at the centre of the deck, `+x`
toward the nose, `y` up, deck surface at `y = 0.2`.

### Validation rules

A plan is accepted only if every one of its rows passes; one bad row rejects
the whole plan. Reason codes: `MISSING_FIELD`, `DUPLICATE_BOX_ID`,
`NONPOSITIVE_DIMENSION`, `NONFINITE_COORDINATE`, `INVALID_STOP_ID`,
`NOT_A_NUMBER`, `INVALID_SEQUENCE`, `INVALID_FLAG`, `ROW_WIDTH`.

### Duplicates and splits

- Two plans are exact duplicates when they hold the same boxes in the same
  places in the same order, whatever their `plan_id` and `box_id` values. The
  first is kept.
- Plans are sorted by id, shuffled with the seed, and cut 70 / 15 / 15. Every
  row of a plan goes to the same split.
- **Rounding:** each split gets `floor(n × ratio)`; leftover plans go to the
  split with the largest fractional part, ties to train, then validation, then
  test. So 1,000 → 700 / 150 / 150, 50 → 35 / 8 / 7, 10 → 7 / 2 / 1.

### Test scenarios

`test/dataset.test.mjs` covers the three scenarios in the planning agreement:
the 10 fixtures in `test/fixtures/dataset/`, the 1,000-plan split run twice
with one seed, and the diversity report (including the case where the new
generator scores lower).

## Decisions and open questions

- **One source row is one box.** `# Pieces` is parts inside the handling unit,
  not a carton count. The app's CSV uploader currently reads it as a quantity.
- **Fragile is inferred** from description keywords (`FRAGILE_PATTERN` in
  `src/generators.mjs`); the source file has no fragile column.
- **Plans are 30–60 boxes** because the app caps a session at 75.
- **The "previous random generator"** is uniform random draws from the five
  `constants.js` SKUs; the repo has no other random generator to compare with.
- **Placements come from the existing heuristic** (`findBestFits`, load order
  from `suggestLoadOrder`, last stop first). The row schema above still needs
  agreeing with the State/Target export in SCRUM-76.
- **Feasibility and LIFO checks are not here.** They are SCRUM-75; this
  validator checks that records are complete and well-formed, not that a load
  can be unloaded in order.
