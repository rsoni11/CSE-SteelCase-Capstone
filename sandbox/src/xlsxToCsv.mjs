/**
 * One-off converter: first worksheet of an .xlsx → RFC 4180 CSV.
 *
 * The truck information arrives as an Excel export, but the story (and the
 * app's uploader) works on CSV, so everything downstream of this file only
 * ever sees CSV. Dependency-free on purpose — the sandbox has no node_modules.
 *
 * Run with:  node src/xlsxToCsv.mjs <input.xlsx> [output.csv]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;

/** Central directory → Map(name → { method, compSize, localOff }). */
function readZipDirectory(buf) {
  let eocd = -1;
  const stop = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= stop; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not an .xlsx file (no zip directory found)');

  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let n = 0; n < count; n += 1) {
    if (buf.readUInt32LE(off) !== CENTRAL_SIG) throw new Error('Corrupt zip directory');
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    entries.set(buf.toString('utf8', off + 46, off + 46 + nameLen), {
      method: buf.readUInt16LE(off + 10),
      compSize: buf.readUInt32LE(off + 20),
      localOff: buf.readUInt32LE(off + 42)
    });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readZipEntry(buf, entries, name) {
  const e = entries.get(name);
  if (!e) throw new Error(`Missing ${name} in workbook`);
  const nameLen = buf.readUInt16LE(e.localOff + 26);
  const extraLen = buf.readUInt16LE(e.localOff + 28);
  const start = e.localOff + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + e.compSize);
  if (e.method === 0) return raw.toString('utf8');
  if (e.method === 8) return inflateRawSync(raw).toString('utf8');
  throw new Error(`Unsupported zip compression method ${e.method} for ${name}`);
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodeXml = (s) => s.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (m, code) => {
  if (code[0] !== '#') return ENTITIES[code] ?? m;
  const n = code[1] === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
  return String.fromCodePoint(n);
});

const textRuns = (xml) => {
  let out = '';
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += m[1];
  return decodeXml(out);
};

const columnIndex = (letters) => {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/** First worksheet as an array of rows, every cell a string. */
export function readFirstSheet(xlsxPath) {
  const buf = readFileSync(xlsxPath);
  const entries = readZipDirectory(buf);

  const shared = [];
  if (entries.has('xl/sharedStrings.xml')) {
    const xml = readZipEntry(buf, entries, 'xl/sharedStrings.xml');
    for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(textRuns(m[1]));
  }

  const sheet = readZipEntry(buf, entries, 'xl/worksheets/sheet1.xml');
  const rows = [];
  for (const rowMatch of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    const cells = rowMatch[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g);
    for (const [, letters, attrs, body = ''] of cells) {
      const type = /\bt="(\w+)"/.exec(attrs)?.[1] ?? 'n';
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = '';
      if (type === 'inlineStr') value = textRuns(body);
      else if (v === undefined) value = '';
      else if (type === 's') value = shared[Number(v)] ?? '';
      else if (type === 'n') {
        // Excel stores 2.603 as 2.6030000000000002; round-trip through Number
        // to get the shortest representation back.
        const num = Number(v);
        value = Number.isFinite(num) ? String(num) : decodeXml(v);
      } else value = decodeXml(v);
      row[columnIndex(letters)] = value;
    }
    rows.push(row);
  }

  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  return rows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ''));
}

const csvCell = (s) => (/[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, output = 'data/truck_info.csv'] = process.argv.slice(2);
  if (!input) {
    console.error('usage: node src/xlsxToCsv.mjs <input.xlsx> [output.csv]');
    process.exit(2);
  }
  const rows = readFirstSheet(input);
  mkdirSync(dirname(resolve(output)), { recursive: true });
  writeFileSync(output, toCsv(rows));
  console.log(`Wrote ${rows.length - 1} data rows x ${rows[0]?.length ?? 0} columns to ${output}`);
}
