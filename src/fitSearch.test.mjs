/**
 * Run with:  npm test
 *
 * Covers US1 (adaptive sampling, constraint awareness, the 200 ms budget) and
 * US2 (multi-orientation search). fitSearch.js is free of THREE imports so it
 * loads straight into node's test runner — the same reason packingScore.js is.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FLOOR_Y,
  HEAVY_MASS,
  DEFAULT_TRUCK,
  makeAABB
} from './packingScore.js';

import {
  findBestFits,
  orientationsFor,
  rotatedExtents,
  axisSamples,
  isPlacementValid,
  ORIENTATION_TRIALS,
  TIME_BUDGET_MS,
  COARSE_STEP,
  FINE_STEP,
  NEAR_BAND,
  SNAP
} from './fitSearch.js';

// The five Steelcase SKUs from constants.js, in feet.
const SKUS = [
  { name: 'tray',   d: { x: 17.5 / 12,  y: 5.75 / 12,  z: 13.0 / 12  }, mass: 20, fragile: false },
  { name: 'parcel', d: { x: 9.5 / 12,   y: 48.0 / 12,  z: 4.5 / 12   }, mass: 26, fragile: false },
  { name: 'carton', d: { x: 30.25 / 12, y: 13.5 / 12,  z: 25.63 / 12 }, mass: 44, fragile: false },
  { name: 'panel',  d: { x: 29.0 / 12,  y: 5.5 / 12,   z: 26.0 / 12  }, mass: 30, fragile: true  },
  { name: 'acc',    d: { x: 12.75 / 12, y: 5.75 / 12,  z: 7.5 / 12   }, mass: 14, fragile: true  }
];

const obstacle = (pos, size, extra = {}) => ({ ...makeAABB(pos, size), ...extra });

/** A carton resting on the deck, centred at (x, z). */
const onFloor = (x, z, size, extra = {}) =>
  obstacle({ x, y: FLOOR_Y + size.y / 2, z }, size, extra);

/** Load the trailer by repeatedly asking the solver, the way a loader would. */
function buildLoad(count) {
  const obstacles = [];
  for (let i = 0; i < count; i += 1) {
    const sku = SKUS[i % SKUS.length];
    const { results } = findBestFits(sku.d, obstacles, {
      mass: sku.mass, fragile: sku.fragile, maxResults: 1
    });
    if (!results.length) break;
    const r = results[0];
    obstacles.push(obstacle(r.position, r.size, { mass: sku.mass, fragile: sku.fragile }));
  }
  return obstacles;
}

const sizeKey = (s) => `${s.x.toFixed(4)}|${s.y.toFixed(4)}|${s.z.toFixed(4)}`;

// ── US2: orientations ────────────────────────────────────────────────────────

test('rotatedExtents produces every permutation of the carton edges', () => {
  const d = { x: 2, y: 3, z: 5 };
  const got = ORIENTATION_TRIALS.map((t) => {
    const e = rotatedExtents(d, t.euler);
    return `${e.x},${e.y},${e.z}`;
  });
  assert.deepEqual([...got].sort(), [
    '2,3,5', '2,5,3', '3,2,5', '3,5,2', '5,2,3', '5,3,2'
  ].sort());
});

test('an unrotated carton keeps its own dimensions', () => {
  const d = { x: 1.25, y: 0.5, z: 2 };
  assert.deepEqual(rotatedExtents(d, [0, 0, 0]), d);
});

/**
 * US2 acceptance: "All three Y-axis orientations are tested." Each of the
 * carton's three edges must get a turn standing vertical, and each of those
 * must be offered both square-on and turned 90° about Y.
 */
test('all three orientations are generated, each with its 90° turn', () => {
  const orientations = orientationsFor({ x: 2, y: 3, z: 5 });
  assert.equal(orientations.length, 6);

  const verticals = new Set(orientations.map((o) => o.vertical));
  assert.deepEqual([...verticals].sort(), ['depth', 'height', 'width']);

  for (const vertical of verticals) {
    const pair = orientations.filter((o) => o.vertical === vertical);
    assert.equal(pair.length, 2, `${vertical}: square-on and turned 90°`);
    assert.deepEqual(pair.map((o) => o.yawed).sort(), [false, true]);
  }

  // Every carton edge gets a turn standing up.
  assert.deepEqual(
    [...new Set(orientations.map((o) => o.size.y))].sort((a, b) => a - b),
    [2, 3, 5]
  );
});

test('duplicate orientations are dropped', () => {
  assert.equal(orientationsFor({ x: 2, y: 2, z: 2 }).length, 1, 'a cube has one');
  // A square footprint: turning it about Y changes nothing.
  const square = orientationsFor({ x: 2, y: 5, z: 2 });
  assert.equal(square.length, 3);
  assert.equal(new Set(square.map((o) => sizeKey(o.size))).size, 3);
});

test('orientations come back flattest-first, and deterministically', () => {
  const a = orientationsFor({ x: 1.5, y: 4, z: 0.5 });
  const slender = a.map((o) => o.size.y / Math.min(o.size.x, o.size.z));
  for (let i = 1; i < slender.length; i += 1) {
    assert.ok(slender[i] >= slender[i - 1] - 1e-9, 'sorted by slenderness');
  }
  assert.deepEqual(orientationsFor({ x: 1.5, y: 4, z: 0.5 }), a);
});

/**
 * US2 acceptance: the suggestion is the best-scoring orientation, not the one
 * the carton happens to be sitting in. Here the carton is 2.0 long and the
 * space is only 1.1 wide, so the only pose that fits is the turned one.
 */
test('a carton that only fits turned is suggested turned', () => {
  const narrow = { length: 1.1, width: 2.2, height: 0.75 };
  const dimensions = { x: 2.0, y: 0.5, z: 1.0 };

  const { results } = findBestFits(dimensions, [], { truck: narrow, mass: 20 });

  assert.equal(results.length > 0, true, 'the turned pose fits');
  const best = results[0];
  assert.equal(best.size.x, 1.0);
  assert.equal(best.size.z, 2.0);
  assert.equal(best.size.y, 0.5);
  assert.notDeepEqual(best.euler, [0, 0, 0], 'a rotation was applied');
  assert.deepEqual(rotatedExtents(dimensions, best.euler), best.size,
    'the euler handed back really does produce that footprint');
});

test('the winning orientation is returned alongside the position', () => {
  const load = buildLoad(12);
  const { results } = findBestFits(SKUS[0].d, load, { mass: SKUS[0].mass });
  assert.ok(results.length > 0);
  for (const r of results) {
    assert.ok(Array.isArray(r.euler) && r.euler.length === 3);
    assert.equal(typeof r.orientation, 'string');
    assert.deepEqual(rotatedExtents(SKUS[0].d, r.euler), r.size);
  }
});

test('every orientation is scored, even on a busy trailer', () => {
  const load = buildLoad(50);
  for (const sku of SKUS) {
    const res = findBestFits(sku.d, load, { mass: sku.mass, fragile: sku.fragile });
    assert.equal(
      res.orientationsTried,
      orientationsFor(sku.d).length,
      `${sku.name}: every orientation reached the scorer`
    );
  }
});

test('a 48in parcel is not stood on end just because it fits', () => {
  const parcel = SKUS[1];
  const { results } = findBestFits(parcel.d, buildLoad(8), { mass: parcel.mass });
  assert.ok(results.length > 0);
  const s = results[0].size;
  assert.ok(
    s.y / Math.min(s.x, s.z) < 3,
    `chose a tip-prone pose: ${s.x.toFixed(2)} x ${s.y.toFixed(2)} x ${s.z.toFixed(2)}`
  );
});

// ── US1: adaptive sampling ───────────────────────────────────────────────────

const spacings = (values) => {
  const out = [];
  for (let i = 1; i < values.length; i += 1) out.push(values[i] - values[i - 1]);
  return out;
};

test('an empty trailer is swept at the coarse step', () => {
  const { sweep } = axisSamples('x', 1, [], DEFAULT_TRUCK, 48, 200);
  const gaps = spacings(sweep).filter((g) => g > 1e-6);
  // The final sample lands on the far wall, so the last gap is a remainder.
  for (const g of gaps.slice(0, -1)) {
    assert.ok(Math.abs(g - COARSE_STEP) < 1e-6, `expected ${COARSE_STEP}, got ${g}`);
  }
});

test('the step shrinks to the fine step near occupied cargo', () => {
  const obstacles = [onFloor(0, 0, { x: 2, y: 2, z: 2 })];
  const { anchors, sweep } = axisSamples('x', 1, obstacles, DEFAULT_TRUCK, 48, 400);

  // What the search actually tries is both lists together: a sweep position
  // that coincides with an anchor is dropped from `sweep` as a duplicate, not
  // left untested.
  const all = [...new Set([...anchors, ...sweep])].sort((a, b) => a - b);

  const nearBand = all.filter((v) => Math.abs(v) <= 1 + NEAR_BAND - 0.3);
  const openDeck = all.filter((v) => v < -10);

  const nearGaps = spacings(nearBand).filter((g) => g > 1e-6);
  const openGaps = spacings(openDeck).filter((g) => g > 1e-6);

  assert.ok(nearGaps.length > 0 && openGaps.length > 0);

  // Positions are rounded to SNAP, so a FINE_STEP of 0.125 lands as an
  // alternating 0.10 / 0.15 — the average is the step, each gap is within SNAP.
  const mean = (a) => a.reduce((t, v) => t + v, 0) / a.length;
  assert.ok(
    Math.max(...nearGaps) <= FINE_STEP + SNAP + 1e-6,
    `near cargo the step should be ~${FINE_STEP}, saw ${Math.max(...nearGaps)}`
  );
  assert.ok(
    Math.abs(mean(nearGaps) - FINE_STEP) < SNAP,
    `near cargo the average step should be ~${FINE_STEP}, saw ${mean(nearGaps)}`
  );
  assert.ok(
    Math.min(...openGaps) >= COARSE_STEP - SNAP - 1e-6,
    `on open deck the step should be ~${COARSE_STEP}, saw ${Math.min(...openGaps)}`
  );
  assert.ok(
    Math.max(...nearGaps) * 4 < Math.min(...openGaps),
    'near cargo must be markedly finer than open deck'
  );
});

test('the sweep stays finer near cargo even when it has to be trimmed', () => {
  const obstacles = [onFloor(0, 0, { x: 2, y: 2, z: 2 })];
  const { anchors, sweep } = axisSamples('x', 1, obstacles, DEFAULT_TRUCK, 48, 20);
  const all = [...new Set([...anchors, ...sweep])].sort((a, b) => a - b);
  const near = spacings(all.filter((v) => Math.abs(v) <= 3)).filter((g) => g > 1e-6);
  const open = spacings(all.filter((v) => v < -10)).filter((g) => g > 1e-6);
  assert.ok(near.length > 0 && open.length > 0);
  const median = (a) => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)];
  assert.ok(
    median(near) * 3 < median(open),
    `near ${median(near)} should be much finer than open ${median(open)}`
  );
});

test('anchors sit flush against both walls and against loaded cargo', () => {
  const size = { x: 2, y: 2, z: 2 };
  const obstacles = [onFloor(0, 0, size)];
  const { anchors } = axisSamples('x', 1, obstacles, DEFAULT_TRUCK, 48, 40);

  const halfL = DEFAULT_TRUCK.length / 2;
  const has = (v) => anchors.some((a) => Math.abs(a - v) < 1e-6);

  assert.ok(has(-halfL + 0.5), 'flush against the door-end wall');
  assert.ok(has(halfL - 0.5), 'flush against the nose wall');
  assert.ok(has(1.5), 'flush against the carton\'s far face');
  assert.ok(has(-1.5), 'flush against the carton\'s near face');
});

test('a carton wider than the trailer produces no samples', () => {
  const { anchors, sweep } = axisSamples('z', 20, [], DEFAULT_TRUCK, 48, 40);
  assert.deepEqual(anchors, []);
  assert.deepEqual(sweep, []);
});

// ── US1: constraint awareness ────────────────────────────────────────────────

test('a heavy carton is never suggested on top of a fragile one', () => {
  const panel = { x: 2.4, y: 0.46, z: 2.2 };
  const obstacles = [
    onFloor(0, 0, panel, { mass: 30, fragile: true })
  ];
  const heavy = { x: 2.0, y: 1.0, z: 2.0 };

  const { results } = findBestFits(heavy, obstacles, { mass: 44, maxResults: 5 });
  assert.ok(results.length > 0);
  for (const r of results) {
    assert.equal(r.restsOnFragile, false, 'suggested resting on the fragile panel');
  }
});

/**
 * The load path, not just the carton directly underneath. A fragile panel on
 * the deck with one ordinary carton on top of it still takes the whole weight
 * of anything stacked on the third tier.
 */
test('a heavy carton avoids a column whose load path runs onto a fragile one', () => {
  const panel = { x: 2.4, y: 0.5, z: 2.2 };
  const spacer = { x: 2.4, y: 1.0, z: 2.2 };

  const fragileColumnX = 0;
  const safeColumnX = 6;

  const obstacles = [
    onFloor(fragileColumnX, 0, panel, { mass: 30, fragile: true }),
    obstacle({ x: fragileColumnX, y: FLOOR_Y + panel.y + spacer.y / 2, z: 0 }, spacer, { mass: 20 }),
    // An identical column with no fragile carton in it, for comparison.
    onFloor(safeColumnX, 0, panel, { mass: 30, fragile: false }),
    obstacle({ x: safeColumnX, y: FLOOR_Y + panel.y + spacer.y / 2, z: 0 }, spacer, { mass: 20 })
  ];

  const heavy = { x: 2.4, y: 0.8, z: 2.2 };
  const { results } = findBestFits(heavy, obstacles, {
    mass: 44, maxResults: 8
  });

  const onFragileColumn = results.filter(
    (r) => Math.abs(r.position.x - fragileColumnX) < 1.2 && r.position.y > FLOOR_Y + 1
  );
  for (const r of onFragileColumn) {
    assert.equal(r.loadsFragileBelow, true, 'the penalty should have fired');
  }
  assert.equal(
    results[0].loadsFragileBelow,
    false,
    'the best suggestion should not load the fragile panel'
  );
});

test('a light carton may still be stacked over a fragile one', () => {
  const panel = { x: 2.4, y: 0.5, z: 2.2 };
  const obstacles = [onFloor(0, 0, panel, { mass: 30, fragile: true })];
  const light = { x: 1.0, y: 0.4, z: 1.0 };

  const { results } = findBestFits(light, obstacles, {
    mass: HEAVY_MASS - 10, maxResults: 20
  });
  assert.ok(
    results.some((r) => r.position.y > FLOOR_Y + panel.y),
    'nothing light was allowed on top of the panel'
  );
});

test('placements flush against a wall or a carton are preferred', () => {
  const { results } = findBestFits({ x: 1, y: 1, z: 1 }, [], { mass: 10, maxResults: 1 });
  assert.ok(results.length > 0);
  const best = results[0];
  assert.ok(best.flushFaces >= 3, `expected a corner, got ${best.flushFaces} flush faces`);

  const halfW = DEFAULT_TRUCK.width / 2;
  assert.ok(
    Math.abs(Math.abs(best.position.z) - (halfW - 0.5)) < 1e-6,
    'the best spot should be against a sidewall'
  );
  assert.ok(Math.abs(best.position.y - (FLOOR_Y + 0.5)) < 1e-6, 'and on the deck');
});

// ── US1 task 3: responsiveness ───────────────────────────────────────────────

test('a suggestion for a 50-carton trailer lands inside the 200 ms budget', () => {
  const load = buildLoad(50);
  assert.ok(load.length >= 50, `only managed to load ${load.length} cartons`);

  for (const sku of SKUS) {
    // Warm the JIT the way a real session does — this is never the first click.
    findBestFits(sku.d, load, { mass: sku.mass, fragile: sku.fragile });

    let worst = 0;
    for (let i = 0; i < 5; i += 1) {
      const res = findBestFits(sku.d, load, { mass: sku.mass, fragile: sku.fragile });
      assert.ok(res.results.length > 0, `${sku.name}: no suggestion`);
      assert.equal(res.timedOut, false, `${sku.name}: overran the budget`);
      worst = Math.max(worst, res.elapsedMs);
    }
    assert.ok(worst < TIME_BUDGET_MS, `${sku.name}: worst run was ${worst.toFixed(1)} ms`);
  }
});

test('the search reports how long it took and what it looked at', () => {
  const res = findBestFits(SKUS[0].d, buildLoad(10), { mass: 20 });
  assert.equal(typeof res.elapsedMs, 'number');
  assert.ok(res.elapsedMs >= 0);
  assert.ok(res.evaluated > 0);
  assert.equal(typeof res.timedOut, 'boolean');
});

test('the same trailer always produces the same suggestion', () => {
  const load = buildLoad(30);
  const a = findBestFits(SKUS[2].d, load, { mass: 44, maxResults: 3 });
  const b = findBestFits(SKUS[2].d, load, { mass: 44, maxResults: 3 });
  assert.deepEqual(
    a.results.map((r) => [r.position, r.size, r.score]),
    b.results.map((r) => [r.position, r.size, r.score])
  );
});

// ── Result sanity ────────────────────────────────────────────────────────────

test('suggestions are ranked tightest-first and never overlap the load', () => {
  const load = buildLoad(20);
  const { results } = findBestFits(SKUS[0].d, load, { mass: 20, maxResults: 3 });
  assert.ok(results.length > 0);
  for (let i = 1; i < results.length; i += 1) {
    assert.ok(results[i].score >= results[i - 1].score, 'ranked by score');
  }
  for (const r of results) {
    assert.equal(isPlacementValid(r.position, r.size, load), true);
    assert.ok(Number.isFinite(r.score));
  }
});

test('every Steelcase SKU gets a suggestion on an empty trailer', () => {
  for (const sku of SKUS) {
    const { results } = findBestFits(sku.d, [], { mass: sku.mass, fragile: sku.fragile });
    assert.ok(results.length > 0, `${sku.name} found nothing on an empty deck`);
    assert.equal(isPlacementValid(results[0].position, results[0].size, []), true);
  }
});

test('a carton too big for the trailer yields nothing, quickly', () => {
  const res = findBestFits({ x: 60, y: 1, z: 1 }, buildLoad(10), { mass: 20 });
  assert.deepEqual(res.results, []);
  assert.ok(res.elapsedMs < TIME_BUDGET_MS);
});

test('bad input is refused rather than throwing', () => {
  assert.deepEqual(findBestFits(null, []).results, []);
  assert.deepEqual(findBestFits({ x: 0, y: 1, z: 1 }, []).results, []);
  assert.deepEqual(findBestFits({ x: 1, y: 1 }, []).results, []);
});

test('isPlacementValid rejects a spot that is already taken', () => {
  const size = { x: 2, y: 2, z: 2 };
  const load = [onFloor(0, 0, size)];
  const pos = { x: 0, y: FLOOR_Y + 1, z: 0 };
  assert.equal(isPlacementValid(pos, size, load), false);
  assert.equal(isPlacementValid(pos, size, []), true);
});

test('isPlacementValid rejects a carton floating above its resting height', () => {
  const size = { x: 2, y: 2, z: 2 };
  assert.equal(isPlacementValid({ x: 0, y: FLOOR_Y + 3, z: 0 }, size, []), false);
});
