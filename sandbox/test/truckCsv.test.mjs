/**
 * Run with:  node --test test/
 *
 * Feeds the parser the malformed input the story's risk calls out and checks
 * that each kind is rejected with a reason rather than read as a number.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseTruckCsv, tokenizeCsv, TruckCsvSchemaError, SCHEMA } from '../src/truckCsv.mjs';

const HEADER = SCHEMA.map((s) => s.column).join(',');
const GOOD = 'HU1,1,12.5,1.0,8800,"TOP, LAMINATE",PACK,24,12,6,1.0,0093000001,7001000001';
const csv = (...rows) => [HEADER, ...rows].join('\r\n') + '\r\n';
const row = (over) => {
  const cells = ['HU1', '1', '12.5', '1.0', '8800', 'DESC', 'PACK', '24', '12', '6', '1.0', '0093000001', '7001000001'];
  for (const [column, value] of Object.entries(over)) cells[SCHEMA.findIndex((s) => s.column === column)] = value;
  return cells.join(',');
};
const codes = (result) => result.issues.map((i) => i.code);

test('a clean row is accepted with typed values', () => {
  const r = parseTruckCsv(csv(GOOD));
  assert.equal(r.units.length, 1);
  assert.deepEqual(r.issues, []);
  const u = r.units[0];
  assert.equal(u.lengthIn, 24);
  assert.equal(u.weightLb, 12.5);
  assert.equal(u.description, 'TOP, LAMINATE');
  assert.equal(u.delivery, '0093000001'); // leading zeros survive — ids stay strings
  assert.equal(u.row, 2);
});

test('tokenizer handles quotes, doubled quotes, embedded newlines, BOM and bare LF', () => {
  const recs = tokenizeCsv('﻿a,b\n"x, ""y""","line1\nline2"\n\nlast,row');
  assert.deepEqual(recs.map((r) => r.cells), [['a', 'b'], ['x, "y"', 'line1\nline2'], ['last', 'row']]);
  assert.deepEqual(recs.map((r) => r.line), [1, 2, 5]);
});

test('a missing required column stops the parse before any row is read', () => {
  const text = csv(GOOD).replace('Gross Weight,', '');
  assert.throws(() => parseTruckCsv(text), (err) =>
    err instanceof TruckCsvSchemaError && err.issues.some((i) => i.code === 'MISSING_COLUMN' && i.column === 'Gross Weight'));
});

test('an empty file and an unterminated quote are schema errors', () => {
  assert.throws(() => parseTruckCsv(''), TruckCsvSchemaError);
  assert.throws(() => parseTruckCsv(`${HEADER}\r\nHU1,1,"oops`), TruckCsvSchemaError);
});

test('text in a numeric cell is rejected, not truncated to its leading digits', () => {
  for (const bad of ['12abc', 'N/A', '1,5', '--3', '0x10', 'NaN', 'Infinity']) {
    const r = parseTruckCsv(csv(row({ Length: bad.includes(',') ? `"${bad}"` : bad })));
    assert.equal(r.units.length, 0, bad);
    assert.deepEqual(codes(r), ['NOT_A_NUMBER'], bad);
  }
});

test('blank, negative and zero values are rejected with distinct codes', () => {
  assert.deepEqual(codes(parseTruckCsv(csv(row({ Width: '' })))), ['MISSING_VALUE']);
  assert.deepEqual(codes(parseTruckCsv(csv(row({ Height: '-6' })))), ['NEGATIVE_VALUE']);
  assert.deepEqual(codes(parseTruckCsv(csv(row({ 'Gross Weight': '0' })))), ['ZERO_VALUE']);
  assert.deepEqual(codes(parseTruckCsv(csv(row({ '# Pieces': '1.5' })))), ['NOT_A_COUNT']);
  assert.deepEqual(codes(parseTruckCsv(csv(row({ '# Pieces': '0' })))), ['NOT_A_COUNT']);
  assert.deepEqual(codes(parseTruckCsv(csv(row({ Shipment: '  ' })))), ['MISSING_VALUE']);
});

test('zero, partial and oversize dimensions never reach the generator', () => {
  const zero = parseTruckCsv(csv(row({ Length: '0', Width: '0', Height: '0', 'Straight Cube': '0' })));
  assert.deepEqual(codes(zero), ['ZERO_DIMENSIONS']);
  assert.deepEqual(codes(parseTruckCsv(csv(row({ Width: '0' })))), ['PARTIAL_DIMENSIONS']);
  // 637 in is longer than the 636 in trailer; 110 x 110 cannot lie flat or stand.
  assert.deepEqual(codes(parseTruckCsv(csv(row({ Length: '637' })))), ['OVERSIZE']);
  assert.deepEqual(codes(parseTruckCsv(csv(row({ Length: '110', Width: '110' })))), ['OVERSIZE']);
  // 195 in long is fine as long as it runs nose-to-door.
  assert.equal(parseTruckCsv(csv(row({ Length: '195', 'Straight Cube': '8.125' }))).units.length, 1);
});

test('a ragged row is rejected and reports its own line number', () => {
  const r = parseTruckCsv(csv(GOOD, 'HU2,1,12.5', row({ 'HU Number': 'HU3' })));
  assert.equal(r.units.length, 2);
  assert.deepEqual(r.issues.map((i) => [i.row, i.code]), [[3, 'ROW_WIDTH']]);
});

test('a repeated HU keeps the first row and rejects the rest', () => {
  const r = parseTruckCsv(csv(GOOD, GOOD));
  assert.equal(r.units.length, 1);
  assert.deepEqual(r.issues.map((i) => [i.row, i.code]), [[3, 'DUPLICATE_HU']]);
  assert.equal(r.summary.rejected, 1);
});

test('warnings are logged but do not reject the row', () => {
  const r = parseTruckCsv(csv(
    row({ 'Straight Cube': '9' }),
    row({ 'HU Number': 'HU2', PackMatType: 'CRATE' }),
    row({ 'HU Number': 'HU3', 'Gross Weight': '0.002' })
  ));
  assert.equal(r.units.length, 3);
  assert.deepEqual(codes(r), ['CUBE_MISMATCH', 'UNKNOWN_PACK_TYPE', 'IMPLAUSIBLE_WEIGHT']);
  assert.ok(r.issues.every((i) => i.severity === 'warning'));
});

test('extra columns and padded headers are tolerated', () => {
  const text = `${HEADER.replace('Length', ' Length ')},Notes\r\n${GOOD},hello\r\n`;
  const r = parseTruckCsv(text);
  assert.equal(r.units.length, 1);
  assert.deepEqual(codes(r), ['UNKNOWN_COLUMN']);
});
