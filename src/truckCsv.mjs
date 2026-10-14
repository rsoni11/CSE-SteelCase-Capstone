/**
 * Strict parser for the Steelcase truck information CSV — pure, no fs / DOM.
 *
 * The app's current uploader reads cells with parseFloat(...) || 0, which
 * silently turns "12abc" into 12 and a blank into a zero-size carton. This
 * parser does the opposite: every row is checked against SCHEMA, anything
 * that fails is rejected and logged with its row number and a reason code,
 * and nothing malformed reaches the generator.
 *
 * One row of the file is one handling unit (HU) — one physical carton or
 * pallet. `# Pieces` is how many parts are inside that HU, NOT how many
 * cartons there are, so it is validated but never used as a quantity.
 */

/** 53 ft trailer interior, in inches (matches TRUCK_DIMENSIONS in the app). */
export const TRAILER_INCHES = { length: 636, width: 102, height: 108 };

export const KNOWN_PACK_TYPES = ['PACK', 'NOPK', 'PLLT', 'PKKD'];

/** Stated cube may differ from L×W×H/1728 by this fraction before we warn. */
export const CUBE_TOLERANCE = 0.05;

/** Below this a gross weight is almost certainly a data-entry artefact. */
export const MIN_PLAUSIBLE_WEIGHT_LB = 0.1;

/**
 * Column contract. `kind` drives the per-cell check:
 *   id       non-empty string
 *   text     any string (may be empty)
 *   count    whole number >= 1
 *   positive finite number > 0
 *   measure  finite number >= 0   (zero is handled by the cross-field rules)
 */
export const SCHEMA = [
  { column: 'HU Number',       key: 'hu',          kind: 'id' },
  { column: '# Pieces',        key: 'pieces',      kind: 'count' },
  { column: 'Gross Weight',    key: 'weightLb',    kind: 'positive' },
  { column: 'Post Volume',     key: 'postVolume',  kind: 'measure' },
  { column: 'Plant',           key: 'plant',       kind: 'id' },
  { column: 'Parcel Descript', key: 'description', kind: 'text' },
  { column: 'PackMatType',     key: 'packType',    kind: 'id' },
  { column: 'Length',          key: 'lengthIn',    kind: 'measure' },
  { column: 'Width',           key: 'widthIn',     kind: 'measure' },
  { column: 'Height',          key: 'heightIn',    kind: 'measure' },
  { column: 'Straight Cube',   key: 'cubeFt3',     kind: 'measure' },
  { column: 'Delivery',        key: 'delivery',    kind: 'id' },
  { column: 'Shipment',        key: 'shipment',    kind: 'id' }
];

export class TruckCsvSchemaError extends Error {
  constructor(message, issues) {
    super(message);
    this.name = 'TruckCsvSchemaError';
    this.issues = issues;
  }
}

/**
 * RFC 4180 tokenizer: quoted fields, doubled quotes, embedded commas and
 * newlines, CRLF / LF / CR line endings, optional BOM. Blank lines are dropped.
 * Returns [{ line, cells }] where `line` is the 1-based line the record starts on.
 */
export function tokenizeCsv(text) {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records = [];
  let cells = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let recordLine = 1;

  const endRecord = () => {
    cells.push(cell);
    if (cells.length > 1 || cells[0].trim() !== '') records.push({ line: recordLine, cells });
    cells = [];
    cell = '';
  };

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false;
      } else {
        if (ch === '\n') line += 1;
        cell += ch;
      }
    } else if (ch === '"' && cell === '') {
      quoted = true;
    } else if (ch === ',') {
      cells.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      endRecord();
      line += 1;
      recordLine = line;
    } else {
      cell += ch;
    }
  }
  if (quoted) {
    throw new TruckCsvSchemaError(
      `Unterminated quoted field starting in the record at line ${recordLine}`,
      [{ row: recordLine, severity: 'error', code: 'UNTERMINATED_QUOTE', column: '', value: '', message: 'Quoted field never closes' }]
    );
  }
  if (cell !== '' || cells.length) endRecord();
  return records;
}

// parseFloat("12abc") is 12; this is not.
const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
export const strictNumber = (s) => (NUMBER_RE.test(s) ? Number(s) : NaN);

function checkCell(kind, raw) {
  if (kind === 'text') return { value: raw };
  if (raw === '') return { code: 'MISSING_VALUE', message: 'Required value is blank' };
  if (kind === 'id') return { value: raw };

  const n = strictNumber(raw);
  if (!Number.isFinite(n)) return { code: 'NOT_A_NUMBER', message: 'Expected a number' };
  if (n < 0) return { code: 'NEGATIVE_VALUE', message: 'Must not be negative' };
  if (kind === 'count' && (!Number.isInteger(n) || n < 1)) {
    return { code: 'NOT_A_COUNT', message: 'Expected a whole number of 1 or more' };
  }
  if (kind === 'positive' && n === 0) return { code: 'ZERO_VALUE', message: 'Must be greater than zero' };
  return { value: n };
}

/** Does a carton fit inside the trailer in at least one axis-aligned pose? */
const fitsTrailer = (l, w, h, trailer) => {
  const box = [l, w, h].sort((a, b) => a - b);
  const room = [trailer.length, trailer.width, trailer.height].sort((a, b) => a - b);
  return box.every((d, i) => d <= room[i] + 1e-9);
};

/**
 * Parse and validate the truck information CSV.
 *
 * @param {string} text  file contents
 * @param {{trailer?: object}} options
 * @returns {{ units: Array, issues: Array, summary: object }}
 *   `units`  rows that passed every error-level rule (warnings do not reject)
 *   `issues` { row, severity, code, column, value, message } — `row` is the
 *            line number in the file, so it matches what Excel shows
 * @throws {TruckCsvSchemaError} when the header itself is unusable — there is
 *         no safe way to read rows without knowing which column is which.
 */
export function parseTruckCsv(text, options = {}) {
  const trailer = options.trailer ?? TRAILER_INCHES;
  const records = tokenizeCsv(text);
  if (records.length === 0) {
    throw new TruckCsvSchemaError('CSV is empty', [
      { row: 1, severity: 'error', code: 'EMPTY_FILE', column: '', value: '', message: 'No header row' }
    ]);
  }

  // ── Header ────────────────────────────────────────────────────────────────
  const header = records[0].cells.map((h) => h.trim());
  const headerIssues = [];
  const seen = new Set();
  for (const h of header) {
    if (seen.has(h)) {
      headerIssues.push({ row: 1, severity: 'error', code: 'DUPLICATE_COLUMN', column: h, value: h, message: 'Column appears more than once' });
    }
    seen.add(h);
  }
  for (const { column } of SCHEMA) {
    if (!seen.has(column)) {
      headerIssues.push({ row: 1, severity: 'error', code: 'MISSING_COLUMN', column, value: '', message: 'Required column not found in header' });
    }
  }
  if (headerIssues.length) {
    throw new TruckCsvSchemaError(
      `CSV header does not match the schema: ${headerIssues.map((i) => `${i.code} "${i.column}"`).join(', ')}`,
      headerIssues
    );
  }

  const issues = [];
  const known = new Set(SCHEMA.map((s) => s.column));
  for (const h of header) {
    if (!known.has(h)) {
      issues.push({ row: 1, severity: 'warning', code: 'UNKNOWN_COLUMN', column: h, value: h, message: 'Column is not in the schema and is ignored' });
    }
  }
  const indexOf = Object.fromEntries(SCHEMA.map((s) => [s.column, header.indexOf(s.column)]));

  // ── Rows ──────────────────────────────────────────────────────────────────
  const units = [];
  const firstRowOfHu = new Map();
  let rejected = 0;

  for (const { line, cells } of records.slice(1)) {
    const rowIssues = [];
    const flag = (severity, code, column, value, message) =>
      rowIssues.push({ row: line, severity, code, column, value: String(value), message });

    if (cells.length !== header.length) {
      flag('error', 'ROW_WIDTH', '', cells.length, `Expected ${header.length} cells, found ${cells.length}`);
    } else {
      const unit = { row: line };
      for (const { column, key, kind } of SCHEMA) {
        const raw = cells[indexOf[column]].trim();
        const res = checkCell(kind, raw);
        if (res.code) flag('error', res.code, column, raw, res.message);
        else unit[key] = res.value;
      }

      if (rowIssues.length === 0) {
        const { lengthIn: l, widthIn: w, heightIn: h } = unit;
        const zeros = [l, w, h].filter((d) => d === 0).length;
        if (zeros === 3) {
          flag('error', 'ZERO_DIMENSIONS', 'Length/Width/Height', '0 x 0 x 0', 'No dimensions recorded — carton has no geometry');
        } else if (zeros > 0) {
          flag('error', 'PARTIAL_DIMENSIONS', 'Length/Width/Height', `${l} x ${w} x ${h}`, 'One or two dimensions are zero');
        } else if (!fitsTrailer(l, w, h, trailer)) {
          flag('error', 'OVERSIZE', 'Length/Width/Height', `${l} x ${w} x ${h}`, 'Does not fit the trailer in any orientation');
        }

        const prior = firstRowOfHu.get(unit.hu);
        if (prior !== undefined) {
          flag('error', 'DUPLICATE_HU', 'HU Number', unit.hu, `Same handling unit already read on row ${prior}`);
        }
      }

      if (rowIssues.length === 0) {
        const { lengthIn: l, widthIn: w, heightIn: h } = unit;
        const cube = (l * w * h) / 1728;
        if (unit.cubeFt3 > 0 && Math.abs(cube - unit.cubeFt3) / unit.cubeFt3 > CUBE_TOLERANCE) {
          flag('warning', 'CUBE_MISMATCH', 'Straight Cube', unit.cubeFt3, `L×W×H gives ${cube.toFixed(3)} ft³`);
        }
        if (unit.weightLb < MIN_PLAUSIBLE_WEIGHT_LB) {
          flag('warning', 'IMPLAUSIBLE_WEIGHT', 'Gross Weight', unit.weightLb, `Under ${MIN_PLAUSIBLE_WEIGHT_LB} lb`);
        }
        if (!KNOWN_PACK_TYPES.includes(unit.packType)) {
          flag('warning', 'UNKNOWN_PACK_TYPE', 'PackMatType', unit.packType, `Expected one of ${KNOWN_PACK_TYPES.join(', ')}`);
        }
        firstRowOfHu.set(unit.hu, line);
        units.push(unit);
      }
    }

    if (rowIssues.some((i) => i.severity === 'error')) rejected += 1;
    for (const i of rowIssues) issues.push(i);
  }

  const byCode = {};
  for (const i of issues) {
    const k = `${i.severity}:${i.code}`;
    byCode[k] = (byCode[k] ?? 0) + 1;
  }

  return {
    units,
    issues,
    summary: {
      dataRows: records.length - 1,
      accepted: units.length,
      rejected,
      warnings: issues.filter((i) => i.severity === 'warning').length,
      byCode,
      shipments: new Set(units.map((u) => u.shipment)).size,
      deliveries: new Set(units.map((u) => u.delivery)).size
    }
  };
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Issue list → CSV text for the error log. */
export const issuesToCsv = (issues) =>
  ['row,severity,code,column,value,message']
    .concat(issues.map((i) =>
      [i.row, i.severity, i.code, i.column, i.value, i.message].map(csvCell).join(',')))
    .join('\r\n') + '\r\n';
