import test from 'node:test';
import assert from 'node:assert/strict';

import { TRUCK_VOLUME, BOX_CONFIGS } from '../../src/constants.js';
import { FLOOR_Y } from '../../src/packingScore.js';
import { generateSyntheticPlans, generateRandomPlans, planToUploaderCsv, DEFAULT_OPTIONS } from '../src/generators.mjs';
import { setDiversity } from '../../src/diversity.mjs';
import { planToItems, recommendLoadOrder, evaluatePlacement, buildReferenceLoad } from '../src/tutor.mjs';

/** 3 shipments × 4 deliveries × 30 cartons, sizes varying by shipment. */
const units = [];
for (let s = 0; s < 3; s += 1) {
  for (let d = 0; d < 4; d += 1) {
    for (let i = 0; i < 30; i += 1) {
      units.push({
        row: units.length + 2,
        hu: `HU${s}-${d}-${i}`,
        lengthIn: 10 + s * 6 + (i % 5) * 2,
        widthIn: 8 + d,
        heightIn: 6 + (i % 3),
        weightLb: 5 + i,
        description: i === 0 ? 'TOP - GLASS, CLEAR' : 'CARTON',
        packType: 'PACK',
        delivery: `D${s}${d}`,
        shipment: `S${s}`
      });
    }
  }
}

test('synthetic plans are reproducible from the seed', () => {
  const a = generateSyntheticPlans(units, 5, 42);
  const b = generateSyntheticPlans(units, 5, 42);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, generateSyntheticPlans(units, 5, 43));
  // plan n does not depend on how many plans were asked for
  assert.deepEqual(generateSyntheticPlans(units, 2, 42), a.slice(0, 2));
});

test('every synthetic plan respects the box, volume and single-shipment limits', () => {
  for (const plan of generateSyntheticPlans(units, 20, 7)) {
    assert.ok(plan.boxes.length >= DEFAULT_OPTIONS.minBoxes && plan.boxes.length <= DEFAULT_OPTIONS.maxBoxes);
    assert.ok(plan.totals.cubeFt3 <= DEFAULT_OPTIONS.maxFillRatio * TRUCK_VOLUME);
    assert.equal(new Set(plan.boxes.map((b) => b.hu)).size, plan.boxes.length, 'no carton used twice');
    assert.ok(plan.boxes.every((b) => b.hu.startsWith(`HU${plan.templateShipment.slice(1)}-`)));
    assert.ok(plan.boxes.every((b) => b.stop >= 1 && b.stop <= plan.totals.stops));
    assert.ok(plan.boxes.every((b) => b.fragile === /GLASS/.test(b.description)));
  }
});

test('the baseline only ever draws the five constants.js SKUs', () => {
  const d = setDiversity(generateRandomPlans(20, 7));
  assert.ok(d.summary.distinctTypesAcrossSet <= BOX_CONFIGS.length);
});

test('uploader CSV has one row per carton under the headers the app reads', () => {
  const [plan] = generateSyntheticPlans(units, 1, 1);
  const lines = planToUploaderCsv(plan).trim().split(/\r?\n/);
  assert.equal(lines[0], 'Length,Width,Height,# Pieces,Stop,Weight');
  assert.equal(lines.length, plan.boxes.length + 1);
});

test('tutor loads the last stop first and grades its own best spot excellent', () => {
  const [plan] = generateSyntheticPlans(units, 1, 3);
  const items = planToItems(plan);
  const stops = recommendLoadOrder(items).map((i) => i.stop);
  assert.deepEqual(stops, [...stops].sort((a, b) => b - a));

  const steps = buildReferenceLoad(items.slice(0, 12));
  assert.ok(steps.every((s) => s.pose && s.feedback.grade === 'excellent'));
});

test('tutor rejects an illegal drop and criticises a careless one', () => {
  const item = { id: 'x', stop: 1, dimensions: { x: 2, y: 1, z: 2 }, mass: 30, fragile: false };
  const size = { x: 2, y: 1, z: 2 };

  const floating = evaluatePlacement(item, { position: { x: 0, y: 4, z: 0 }, size }, []);
  assert.equal(floating.grade, 'invalid');

  const outside = evaluatePlacement(item, { position: { x: 40, y: FLOOR_Y + 0.5, z: 0 }, size }, []);
  assert.equal(outside.grade, 'invalid');
  assert.match(outside.notes[0], /outside the trailer/);

  // Legal, but in the middle of an empty deck instead of the nose corner.
  const careless = evaluatePlacement(item, { position: { x: 0, y: FLOOR_Y + 0.5, z: 0 }, size }, []);
  assert.notEqual(careless.grade, 'excellent');
  assert.ok(careless.notes.length > 0);
  assert.ok(careless.suggestion.spot.startsWith('0.0 ft from the nose'));
});
