/**
 * Run with:  npm test
 *
 * Uses node's built-in test runner so there is no new dependency to install.
 * packingScore.js is deliberately free of THREE/DOM imports so it can be
 * loaded straight into node here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FLOOR_Y,
  HEAVY_MASS,
  DEFAULT_TRUCK,
  estimateMass,
  makeAABB,
  overlap1D,
  intersects,
  computeContact,
  computeSupport,
  loadStats,
  scorePlacement,
  restingCentreY,
  withinBounds,
  suggestLoadOrder,
  normaliseItem
} from './packingScore.js';

const box = (x, y, z, sx, sy, sz, extra = {}) => ({
  ...makeAABB({ x, y, z }, { x: sx, y: sy, z: sz }),
  ...extra
});

/** A carton resting on the deck, centred at (x, z). */
const onFloor = (x, z, sx, sy, sz, extra = {}) =>
  box(x, FLOOR_Y + sy / 2, z, sx, sy, sz, extra);

const ctx = (obstacles, over = {}) => ({
  obstacles,
  truck: DEFAULT_TRUCK,
  mass: 20,
  fragile: false,
  ...over
});

// ── deck height ──────────────────────────────────────────────────────────────

/**
 * Regression: the deck slab in TruckScene is 0.2 ft tall and centred at
 * y = 0.1, so cargo rests at y = 0.2. Several modules hard-coded 0.1 (the
 * slab's centre), which placed suggestions 0.1 ft inside the deck and made
 * floor-contact checks miss boxes the physics engine had settled at 0.2.
 */
test('the deck surface matches the floor slab in TruckScene', () => {
  const slabCentreY = 0.1;
  const slabHeight = 0.2;
  assert.equal(FLOOR_Y, slabCentreY + slabHeight / 2);
});

test('a carton resting on the deck reports floor contact', () => {
  // Physics settles a 5.75" carton here; the scorer must agree it is grounded.
  const h = 5.75 / 12;
  const settled = box(0, FLOOR_Y + h / 2, 0, 1.458, h, 1.083);
  const s = computeSupport(settled, []);
  assert.equal(s.onFloor, true, 'a settled carton must count as floor-supported');
  assert.equal(s.ratio, 1);
});

// ── primitives ───────────────────────────────────────────────────────────────

test('overlap1D measures the shared span', () => {
  assert.equal(overlap1D(0, 10, 5, 15), 5);
  assert.equal(overlap1D(0, 10, 10, 20), 0);
  assert.equal(overlap1D(0, 10, 20, 30), 0);
});

test('intersects ignores boxes that merely touch', () => {
  const a = makeAABB({ x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 2 });
  const b = makeAABB({ x: 2, y: 0, z: 0 }, { x: 2, y: 2, z: 2 }); // flush
  const c = makeAABB({ x: 1, y: 0, z: 0 }, { x: 2, y: 2, z: 2 }); // overlapping
  assert.equal(intersects(a, b), false);
  assert.equal(intersects(a, c), true);
});

test('estimateMass scales with volume', () => {
  const small = estimateMass({ x: 1, y: 1, z: 1 });
  const big = estimateMass({ x: 2, y: 1, z: 1 });
  assert.ok(big > small);
  assert.ok(small > 0);
});

// ── contact ──────────────────────────────────────────────────────────────────

test('a carton on the open deck contacts only the floor', () => {
  const b = onFloor(0, 0, 2, 2, 2);
  const c = computeContact(b, [], DEFAULT_TRUCK);
  assert.equal(c.floor, 4);
  assert.equal(c.walls, 0);
  assert.equal(c.neighbours, 0);
});

test('a carton in a corner against a neighbour contacts much more', () => {
  const halfW = DEFAULT_TRUCK.width / 2;
  const halfL = DEFAULT_TRUCK.length / 2;

  const lonely = onFloor(0, 0, 2, 2, 2);
  const neighbour = onFloor(-halfL + 3, -halfW + 1, 2, 2, 2);
  const tucked = onFloor(-halfL + 1, -halfW + 1, 2, 2, 2); // wall + wall + neighbour

  const a = computeContact(lonely, [neighbour], DEFAULT_TRUCK);
  const b = computeContact(tucked, [neighbour], DEFAULT_TRUCK);

  assert.ok(b.ratio > a.ratio, 'tucked carton should be snugger');
  assert.ok(b.walls > 0, 'should register wall contact');
  assert.ok(b.neighbours > 0, 'should register neighbour contact');
});

// ── support ──────────────────────────────────────────────────────────────────

test('a carton on the deck is fully supported', () => {
  const s = computeSupport(onFloor(0, 0, 2, 2, 2), []);
  assert.equal(s.onFloor, true);
  assert.equal(s.ratio, 1);
});

test('support ratio reflects the overlapping footprint', () => {
  const base = onFloor(0, 0, 2, 2, 2);            // top at FLOOR_Y + 2
  const full = box(0, FLOOR_Y + 3, 0, 2, 2, 2);   // sits squarely on it
  const half = box(1, FLOOR_Y + 3, 0, 2, 2, 2);   // half hanging off

  assert.equal(computeSupport(full, [base]).ratio, 1);
  assert.ok(Math.abs(computeSupport(half, [base]).ratio - 0.5) < 1e-6);
});

test('a floating carton has no support', () => {
  const floating = box(0, FLOOR_Y + 5, 0, 2, 2, 2);
  assert.equal(computeSupport(floating, []).ratio, 0);
});

// ── the bug this rewrite fixes ───────────────────────────────────────────────

test('tucking against existing cargo beats open floor', () => {
  const halfL = DEFAULT_TRUCK.length / 2;
  const halfW = DEFAULT_TRUCK.width / 2;

  // One carton already loaded, flush in the nose-left corner.
  const loaded = onFloor(halfL - 1, -halfW + 1, 2, 2, 2, { mass: 20 });
  const obstacles = [loaded];

  const tucked = onFloor(halfL - 3, -halfW + 1, 2, 2, 2); // beside it
  const stranded = onFloor(0, 0, 2, 2, 2);                // middle of the deck

  const t = scorePlacement(tucked, ctx(obstacles));
  const s = scorePlacement(stranded, ctx(obstacles));

  assert.ok(
    t.score < s.score,
    `tucked (${t.score.toFixed(2)}) should beat stranded (${s.score.toFixed(2)})`
  );
});

test('the deep end is preferred over the door end, all else equal', () => {
  const halfL = DEFAULT_TRUCK.length / 2;
  const deep = onFloor(halfL - 1, 0, 2, 2, 2);
  const door = onFloor(-halfL + 1, 0, 2, 2, 2);

  // Both are flush to an end wall, so contact is symmetric; only depth differs.
  const d = scorePlacement(deep, ctx([]));
  const n = scorePlacement(door, ctx([]));
  assert.ok(d.score < n.score);
});

// ── weight awareness (the second thing the team asked for) ───────────────────

test('a heavy carton is not suggested on top of a fragile one', () => {
  const fragileBase = onFloor(0, 0, 3, 2, 3, { mass: 14, fragile: true });
  const sturdyBase = onFloor(6, 0, 3, 2, 3, { mass: 40, fragile: false });
  const obstacles = [fragileBase, sturdyBase];

  const onFragile = box(0, FLOOR_Y + 3, 0, 3, 2, 3);
  const onSturdy = box(6, FLOOR_Y + 3, 0, 3, 2, 3);

  const heavy = ctx(obstacles, { mass: HEAVY_MASS + 20 });
  const a = scorePlacement(onFragile, heavy);
  const b = scorePlacement(onSturdy, heavy);

  assert.equal(a.restsOnFragile, true);
  assert.equal(b.restsOnFragile, false);
  assert.ok(a.score > b.score, 'stacking on the fragile carton must score worse');
});

test('heavy cartons are kept low', () => {
  const base = onFloor(0, 0, 3, 2, 3, { mass: 40 });
  const low = onFloor(6, 0, 3, 2, 3);
  const high = box(0, FLOOR_Y + 3, 0, 3, 2, 3);

  const heavy = ctx([base], { mass: 60 });
  const light = ctx([base], { mass: 3 });

  const heavyPenalty = scorePlacement(high, heavy).terms.comHeight;
  const lightPenalty = scorePlacement(high, light).terms.comHeight;

  assert.ok(heavyPenalty > lightPenalty,
    'carrying more mass higher should cost more');
  assert.ok(scorePlacement(low, heavy).terms.comHeight === 0 ||
            scorePlacement(low, heavy).terms.comHeight < heavyPenalty);
});

test('resting a heavy carton on a lighter one is penalised', () => {
  const light = onFloor(0, 0, 3, 2, 3, { mass: 5 });
  const strong = onFloor(6, 0, 3, 2, 3, { mass: 80 });

  const onLight = box(0, FLOOR_Y + 3, 0, 3, 2, 3);
  const onStrong = box(6, FLOOR_Y + 3, 0, 3, 2, 3);

  const c = ctx([light, strong], { mass: 50 });
  assert.ok(scorePlacement(onLight, c).terms.crush >
            scorePlacement(onStrong, c).terms.crush);
});

test('lateral balance pulls the load toward the centreline', () => {
  const halfW = DEFAULT_TRUCK.width / 2;
  // Everything so far is jammed against one side.
  const skewed = onFloor(0, halfW - 1, 2, 2, 2, { mass: 100 });

  const sameSide = onFloor(6, halfW - 1, 2, 2, 2);
  const otherSide = onFloor(6, -halfW + 1, 2, 2, 2);

  const c = ctx([skewed], { mass: 100 });
  assert.ok(scorePlacement(otherSide, c).terms.balance <
            scorePlacement(sameSide, c).terms.balance,
    'balancing the load should be cheaper than piling on the same side');
});

// ── resting height / bounds ──────────────────────────────────────────────────

test('a carton dropped on an empty deck rests exactly on the floor', () => {
  const size = { x: 2, y: 1.5, z: 2 };
  const y = restingCentreY(0, 0, size, []);
  assert.equal(y, FLOOR_Y + size.y / 2);
});

test('a carton dropped onto another rests exactly on its top face', () => {
  const base = onFloor(0, 0, 3, 2, 3);
  const size = { x: 2, y: 1, z: 2 };
  const y = restingCentreY(0, 0, size, [base]);
  assert.equal(y, base.max.y + size.y / 2);
});

test('a carton taller than the trailer cannot rest anywhere', () => {
  assert.equal(restingCentreY(0, 0, { x: 1, y: 20, z: 1 }, []), null);
});

/**
 * Regression: the resting height used to be snapped to a 0.05 ft grid, which
 * rounded DOWN below the legal floor-contact height for this exact carton.
 * withinBounds then rejected it, so the real Steelcase 30.25" x 25.63" x 13.5"
 * furniture carton produced zero suggestions even on an empty trailer.
 */
test('an off-grid resting height still passes the bounds check', () => {
  const size = { x: 30.25 / 12, y: 13.5 / 12, z: 25.63 / 12 };
  const y = restingCentreY(0, 0, size, []);

  assert.ok(y !== null);
  assert.ok(
    withinBounds({ x: 0, y, z: 0 }, size),
    `resting centre ${y} must be a legal position`
  );

  // and it must genuinely be off the 0.05 grid, or this test proves nothing
  const snapped = Math.round(y / 0.05) * 0.05;
  assert.ok(Math.abs(snapped - y) > 1e-6,
    'this carton should have an off-grid resting height');
});

test('every Steelcase SKU height lands somewhere legal on an empty deck', () => {
  const heightsInches = [5.75, 48.0, 13.5, 5.5, 7.5, 25.63, 4.5];
  for (const hIn of heightsInches) {
    const size = { x: 1, y: hIn / 12, z: 1 };
    const y = restingCentreY(0, 0, size, []);
    assert.ok(y !== null, `${hIn}" carton should rest somewhere`);
    assert.ok(withinBounds({ x: 0, y, z: 0 }, size),
      `${hIn}" carton rest height ${y} must pass bounds`);
  }
});

// ── partial contact with a fragile carton ────────────────────────────────────

/**
 * Regression: the fragile penalty used to scale linearly with contact share,
 * so a 90 lb carton resting 1% of its footprint on a fragile panel paid ~1% of
 * the penalty and the placement was still suggested.
 */
test('even slight contact with a fragile carton is heavily penalised', () => {
  const fragileBase = onFloor(0, 0, 3, 2, 3, { mass: 30, fragile: true });
  const sturdy = onFloor(20, 0, 3, 2, 3, { mass: 90, fragile: false });
  const obstacles = [fragileBase, sturdy];

  // Overlaps the fragile carton by only a sliver of its footprint.
  const clipping = box(2.9, FLOOR_Y + 3, 0, 3, 2, 3);
  const heavy = ctx(obstacles, { mass: 90 });

  const r = scorePlacement(clipping, heavy);
  assert.equal(r.restsOnFragile, true);
  assert.ok(r.terms.fragileUnder > 40,
    `a clipping contact should still cost a lot, got ${r.terms.fragileUnder}`);
});

// ── load ordering ────────────────────────────────────────────────────────────

test('normaliseItem reads both queue and scorer shapes', () => {
  const fromQueue = normaliseItem({
    dimensions: { width: 2, height: 1, depth: 3 },
    physics: { mass: 40 },
    fragile: true
  });
  assert.deepEqual(fromQueue.size, { x: 2, y: 1, z: 3 });
  assert.equal(fromQueue.mass, 40);
  assert.equal(fromQueue.fragile, true);

  const fromScorer = normaliseItem({ size: { x: 1, y: 1, z: 1 }, mass: 5 });
  assert.equal(fromScorer.mass, 5);
  assert.equal(fromScorer.fragile, false);
});

test('suggestLoadOrder puts heavy cartons first and fragile ones last', () => {
  const s = { x: 1, y: 1, z: 1 };
  const queue = [
    { size: s, mass: 10, fragile: false, id: 'light' },
    { size: s, mass: 90, fragile: true, id: 'heavy-but-fragile' },
    { size: s, mass: 90, fragile: false, id: 'heavy' },
    { size: s, mass: 45, fragile: false, id: 'medium' }
  ];
  const order = suggestLoadOrder(queue).map((i) => i.id);
  assert.deepEqual(order, ['heavy', 'medium', 'light', 'heavy-but-fragile']);
});

test('suggestLoadOrder breaks mass ties by bulk, and is stable', () => {
  const queue = [
    { size: { x: 1, y: 1, z: 1 }, mass: 20, id: 'small' },
    { size: { x: 2, y: 2, z: 2 }, mass: 20, id: 'big' },
    { size: { x: 1, y: 1, z: 1 }, mass: 20, id: 'small2' }
  ];
  assert.deepEqual(suggestLoadOrder(queue).map((i) => i.id),
    ['big', 'small', 'small2']);
});

test('suggestLoadOrder does not mutate its input', () => {
  const queue = [
    { size: { x: 1, y: 1, z: 1 }, mass: 1, id: 'a' },
    { size: { x: 1, y: 1, z: 1 }, mass: 99, id: 'b' }
  ];
  const before = queue.map((i) => i.id);
  suggestLoadOrder(queue);
  assert.deepEqual(queue.map((i) => i.id), before);
});

// ── bookkeeping ──────────────────────────────────────────────────────────────

test('loadStats reports mass, centre of mass and envelope', () => {
  const a = onFloor(-4, 0, 2, 2, 2, { mass: 10 });
  const b = onFloor(4, 0, 2, 2, 2, { mass: 30 });
  const s = loadStats([a, b]);

  assert.equal(s.count, 2);
  assert.equal(s.totalMass, 40);
  // (-4 * 10 + 4 * 30) / 40 = 2 — pulled toward the heavier carton.
  assert.ok(Math.abs(s.comX - 2) < 1e-9, 'CoM pulled toward the heavier carton');
  assert.equal(s.envelope.minX, -5);
  assert.equal(s.envelope.maxX, 5);
});

test('loadStats on an empty trailer has no envelope', () => {
  const s = loadStats([]);
  assert.equal(s.count, 0);
  assert.equal(s.envelope, null);
  assert.equal(s.totalMass, 0);
});

test('scorePlacement always returns a finite score', () => {
  const cases = [
    [onFloor(0, 0, 2, 2, 2), ctx([])],
    [box(0, FLOOR_Y + 9, 0, 1, 1, 1), ctx([])],
    [onFloor(0, 0, 2, 2, 2), ctx([], { mass: 0 })]
  ];
  for (const [b, c] of cases) {
    const r = scorePlacement(b, c);
    assert.ok(Number.isFinite(r.score), `score was ${r.score}`);
  }
});
