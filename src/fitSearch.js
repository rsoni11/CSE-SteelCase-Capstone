/**
 * Best-fit search — pure math, no THREE / DOM / React imports.
 *
 * Same rule as packingScore.js: this file stays dependency-free so the search
 * itself (not just the scorer) can be exercised with `npm test` under node.
 * FitSuggestionSystem.js is the thin THREE-facing wrapper around it.
 *
 * Two things live here:
 *
 *   1. ORIENTATIONS (US2) — the axis-aligned poses a carton can be set down in.
 *      Every one is scored independently and the tightest wins, so the loader
 *      never has to rotate-and-re-suggest by hand.
 *
 *   2. ADAPTIVE SAMPLING (US1) — where along each axis we try to put it. The
 *      old scan walked a flat 0.5 ft grid across all 53 ft of deck, which was
 *      both slow and unable to express "flush against that carton" unless the
 *      carton happened to land on the grid. We now sample at exact contact
 *      positions first, then fill in with a step that is fine near occupied
 *      cargo and coarse across open deck.
 */

import {
  DEFAULT_TRUCK,
  makeAABB,
  intersects,
  loadStats,
  scorePlacement,
  estimateMass,
  restingCentreY,
  withinBounds
} from './packingScore.js';

/**
 * Target time for one suggestion (US1 task 3). The search stops adding
 * candidates once it passes this and already has a result, and reports how long
 * it actually took plus whether it stopped early, so the UI can be honest.
 */
export const TIME_BUDGET_MS = 200;

/**
 * Last-resort ceiling. The budget above is a target the search aims at while
 * it already has something to show; it will overrun up to this much while it
 * still has NOTHING, because "no suggestion" on a trailer that does have room
 * is a worse answer than a slightly slow one.
 */
export const HARD_CEILING_MS = 3 * TIME_BUDGET_MS;

export const COARSE_STEP = 1.0;    // feet — open deck, nothing nearby
export const FINE_STEP   = 0.125;  // feet — within NEAR_BAND of cargo
export const NEAR_BAND   = 1.5;    // feet — how close counts as "near cargo"
export const SNAP        = 0.05;   // positions are rounded to this

/**
 * Sample caps per axis. Anchors get the bigger share because they are the
 * placements that actually win; the sweep is only the safety net for deck the
 * anchors cannot describe, so it is capped hard.
 *
 * These are what keep the search inside TIME_BUDGET_MS: the candidate count is
 * (anchors + sweep)² per orientation, so doubling a cap roughly quadruples the
 * work. Measured on a 50-carton trailer this set lands at ~80 ms under node,
 * ~40 ms in the browser after the 55-box stress test.
 */
export const MAX_ANCHORS_X = 48;   // 53 ft of length
export const MAX_ANCHORS_Z = 32;   // 8.5 ft of width
export const MAX_SWEEP_X   = 40;
export const MAX_SWEEP_Z   = 20;

/**
 * Share of the sweep budget reserved for samples near cargo.
 *
 * Without this the cap quietly undid the adaptive step: the fine samples around
 * the load outnumber the coarse ones over open deck, so thinning the list as a
 * whole threw away most of the fine ones and left a near-uniform grid again.
 */
export const NEAR_SWEEP_SHARE = 0.7;

const Q = Math.PI / 2;

const roundToStep = (v, step) => Math.round(v / step) * step;
const clean = (v) => Math.round(v * 1e6) / 1e6;

// ── Orientations (US2) ───────────────────────────────────────────────────────

/**
 * Rotation matrix for an intrinsic X→Y→Z euler triple.
 *
 * Mirrors THREE.Matrix4.makeRotationFromEuler with the default 'XYZ' order, so
 * the eulers handed back by this module produce exactly the pose the ghost
 * preview and the carton's mesh end up in.
 */
export function rotationMatrixXYZ(x, y, z) {
  const a = Math.cos(x), b = Math.sin(x);
  const c = Math.cos(y), d = Math.sin(y);
  const e = Math.cos(z), f = Math.sin(z);
  const ae = a * e, af = a * f, be = b * e, bf = b * f;
  return [
    [c * e,          -c * f,          d    ],
    [af + be * d,     ae - bf * d,   -b * c],
    [bf - ae * d,     be + af * d,    a * c]
  ];
}

/**
 * World-axis-aligned extents of a box after a rotation.
 *
 * For an AABB the answer is |R| · extents — no corner sweep needed. This is the
 * same quantity the rest of the app calls `entry.size`: CollisionSystem builds
 * its bounds straight from it, and DragController swaps x/z when it turns a
 * carton 90°.
 */
export function rotatedExtents(dimensions, euler) {
  const m = rotationMatrixXYZ(euler[0], euler[1], euler[2]);
  const v = [dimensions.x, dimensions.y, dimensions.z];
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i += 1) {
    out[i] = Math.abs(m[i][0]) * v[0] +
             Math.abs(m[i][1]) * v[1] +
             Math.abs(m[i][2]) * v[2];
  }
  return { x: clean(out[0]), y: clean(out[1]), z: clean(out[2]) };
}

/**
 * The poses a carton can be set down in, as euler triples.
 *
 * Three choices of which of the carton's own edges stands vertical, each with
 * and without a 90° turn about Y — the six axis-aligned orientations, which
 * between them produce every distinct footprint the carton has. US2 asks for
 * "all three Y-axis orientations"; these six are that set plus the yaw of each,
 * and orientationsFor() drops whichever are duplicates for a given carton (a
 * square-footprint carton genuinely has fewer than six).
 */
export const ORIENTATION_TRIALS = [
  { euler: [0, 0, 0], vertical: 'height', yawed: false },
  { euler: [0, Q, 0], vertical: 'height', yawed: true  },
  { euler: [0, 0, Q], vertical: 'width',  yawed: false },
  { euler: [Q, Q, 0], vertical: 'width',  yawed: true  },
  { euler: [Q, 0, 0], vertical: 'depth',  yawed: false },
  { euler: [Q, 0, Q], vertical: 'depth',  yawed: true  }
];

const ORIENTATION_CACHE = new Map();

/**
 * Distinct orientations for a carton, flattest first.
 *
 * Flattest-first matters for the time budget rather than for correctness: every
 * orientation is still scored, but the ones a loader would reach for first get
 * scored first, so a search that runs out of time has already seen the good
 * poses. The tie-break on the trial index keeps the order deterministic.
 */
export function orientationsFor(dimensions) {
  const key = `${dimensions.x.toFixed(5)}|${dimensions.y.toFixed(5)}|${dimensions.z.toFixed(5)}`;
  const hit = ORIENTATION_CACHE.get(key);
  if (hit) return hit;

  const out = [];
  const seen = new Set();

  ORIENTATION_TRIALS.forEach((trial, index) => {
    const size = rotatedExtents(dimensions, trial.euler);
    const footprint = `${size.x.toFixed(4)}|${size.y.toFixed(4)}|${size.z.toFixed(4)}`;
    if (seen.has(footprint)) return;
    seen.add(footprint);
    out.push({
      size,
      euler: trial.euler,
      vertical: trial.vertical,
      yawed: trial.yawed,
      label: `${trial.vertical}-up${trial.yawed ? ' (turned 90°)' : ''}`,
      index
    });
  });

  out.sort((a, b) => {
    const sa = a.size.y / Math.max(Math.min(a.size.x, a.size.z), 1e-6);
    const sb = b.size.y / Math.max(Math.min(b.size.x, b.size.z), 1e-6);
    if (Math.abs(sa - sb) > 1e-9) return sa - sb;
    return a.index - b.index;
  });

  ORIENTATION_CACHE.set(key, out);
  return out;
}

// ── Adaptive sampling (US1) ──────────────────────────────────────────────────

/**
 * Distance from the span [lo, hi] to the nearest occupied face, or 0 if a face
 * falls inside it. `faces` must be sorted ascending.
 */
function gapToNearestFace(faces, lo, hi) {
  if (faces.length === 0) return Infinity;
  let a = 0;
  let b = faces.length;
  while (a < b) {
    const m = (a + b) >> 1;
    if (faces[m] < lo) a = m + 1; else b = m;
  }
  if (a < faces.length && faces[a] <= hi) return 0;
  let gap = Infinity;
  if (a < faces.length) gap = Math.min(gap, faces[a] - hi);
  if (a > 0) gap = Math.min(gap, lo - faces[a - 1]);
  return gap;
}

/**
 * Where to try the carton's centre along one axis.
 *
 * `anchors` are exact-contact positions — flush to each wall, flush beside each
 * loaded carton, and edge-aligned with each loaded carton so stacks line up.
 * They are the limit case of "the step shrinks near occupied boxes": right at a
 * face the step is zero, because the position is generated outright.
 *
 * `sweep` is the adaptive fill: FINE_STEP while the carton would sit within
 * NEAR_BAND of something already loaded, COARSE_STEP across open deck. On an
 * empty 53 ft trailer that is ~53 samples instead of the old 106, and around
 * cargo it is 8× finer than the old 0.5 ft grid ever was.
 *
 * Both lists are returned separately so the caller can score the anchors first.
 */
export function axisSamples(
  axis,
  extent,
  obstacles,
  truck = DEFAULT_TRUCK,
  maxAnchors = MAX_ANCHORS_X,
  maxSweep = MAX_SWEEP_X
) {
  const half = (axis === 'x' ? truck.length : truck.width) / 2;
  const lo = -half + extent / 2;
  const hi = half - extent / 2;
  if (hi < lo - 1e-9) return { anchors: [], sweep: [] };

  const inRange = (v) => v >= lo - 1e-4 && v <= hi + 1e-4;
  const normalise = (v) => clean(Math.min(hi, Math.max(lo, roundToStep(v, SNAP))));

  // ── anchors ───────────────────────────────────────────────────────────────
  const anchorSet = new Set([normalise(lo), normalise(hi)]);
  for (const o of obstacles) {
    const oMin = o.min[axis];
    const oMax = o.max[axis];
    for (const v of [
      oMax + extent / 2,   // flush against its far face
      oMin - extent / 2,   // flush against its near face
      oMin + extent / 2,   // near edges aligned
      oMax - extent / 2    // far edges aligned
    ]) {
      if (inRange(v)) anchorSet.add(normalise(v));
    }
  }

  let anchors = [...anchorSet];

  // When there are too many, keep the ones nearest the working face of the load
  // — the door-most edge of what is already stacked. Those are the anchors that
  // continue the wall; trimming toward the nose instead threw away every spot
  // adjacent to existing cargo once the trailer had ~20 cartons in it.
  if (anchors.length > maxAnchors) {
    let pivot = axis === 'x' ? hi : 0;
    if (axis === 'x' && obstacles.length) {
      pivot = obstacles.reduce((m, o) => Math.min(m, o.min.x), Infinity);
    }
    anchors.sort((a, b) => Math.abs(a - pivot) - Math.abs(b - pivot));
    anchors = anchors.slice(0, maxAnchors);
  }
  anchors.sort((a, b) => a - b);

  // ── adaptive sweep ────────────────────────────────────────────────────────
  const faces = [];
  for (const o of obstacles) {
    faces.push(o.min[axis], o.max[axis]);
  }
  faces.sort((a, b) => a - b);

  const taken = new Set(anchors);
  const near = [];
  const far = [];
  let v = lo;
  let guard = 0;
  while (v <= hi + 1e-9 && guard < 4096) {
    guard += 1;
    const isNear =
      gapToNearestFace(faces, v - extent / 2, v + extent / 2) <= NEAR_BAND;
    const at = normalise(v);
    if (!taken.has(at)) {
      taken.add(at);
      (isNear ? near : far).push(at);
    }
    v += isNear ? FINE_STEP : COARSE_STEP;
  }
  const end = normalise(hi);
  if (!taken.has(end)) far.push(end);

  return { anchors, sweep: allocateSweep(near, far, maxSweep) };
}

/**
 * Fit the sweep inside its budget while keeping the near-cargo samples that are
 * the whole point of the adaptive step. Whatever the open-deck bucket does not
 * need goes back to the near bucket.
 */
function allocateSweep(near, far, limit) {
  const merged = (a, b) => [...a, ...b].sort((p, q) => p - q);
  if (near.length + far.length <= limit) return merged(near, far);

  const farBudget = Math.min(far.length, Math.floor(limit * (1 - NEAR_SWEEP_SHARE)));
  const keptNear = decimate(near, limit - farBudget);
  const keptFar = decimate(far, limit - keptNear.length);
  return merged(keptNear, keptFar);
}

/**
 * Thin a sorted list down to `limit` entries by keeping every k-th one, so the
 * survivors still span the whole axis. Truncating instead would have kept only
 * the door end of the trailer and left the nose untested.
 */
function decimate(values, limit) {
  if (values.length <= limit || limit <= 0) return values;
  const stride = values.length / limit;
  const out = [];
  for (let i = 0; i < limit; i += 1) {
    out.push(values[Math.min(values.length - 1, Math.floor(i * stride))]);
  }
  return [...new Set(out)];
}

// ── Search ───────────────────────────────────────────────────────────────────

const collides = (box, obstacles) => {
  for (const o of obstacles) {
    if (intersects(box, o)) return true;
  }
  return false;
};

/**
 * Is this exact pose still legal right now? Used to confirm that the spot the
 * loader is looking at in the ghost preview is still the spot we can snap to.
 */
export function isPlacementValid(pos, size, obstacles, truck = DEFAULT_TRUCK) {
  if (!withinBounds(pos, size, truck)) return false;
  const resting = restingCentreY(pos.x, pos.z, size, obstacles, truck);
  if (resting === null || Math.abs(resting - pos.y) > 1e-3) return false;
  return !collides(makeAABB(pos, size), obstacles);
}

const defaultClock = () =>
  (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Ranked best-fit placements for a carton, tightest first.
 *
 * @param {{x:number,y:number,z:number}} dimensions  UNROTATED carton extents (ft)
 * @param {Array} obstacles  world-space { min, max, mass?, fragile? }
 * @param {object} options
 *        truck, mass, fragile, maxResults, timeBudgetMs, now
 * @returns {{ results: Array, elapsedMs: number, timedOut: boolean,
 *             evaluated: number, orientationsTried: number }}
 *
 * Each result carries `position`, `size` (world extents in the winning pose),
 * `euler`, `orientation`, `score`, `terms` and `reasons`.
 */
export function findBestFits(dimensions, obstacles = [], options = {}) {
  const {
    truck = DEFAULT_TRUCK,
    fragile = false,
    maxResults = 3,
    timeBudgetMs = TIME_BUDGET_MS,
    now = defaultClock
  } = options;

  const empty = {
    results: [], elapsedMs: 0, timedOut: false,
    evaluated: 0, orientationsTried: 0
  };
  if (!dimensions || !(dimensions.x > 0) || !(dimensions.y > 0) || !(dimensions.z > 0)) {
    return empty;
  }

  const mass = options.mass ?? estimateMass(dimensions);
  const stats = loadStats(obstacles);
  const ctx = { obstacles, truck, mass, fragile, stats, explain: false };

  const started = now();
  const hardCeiling = Math.max(timeBudgetMs, HARD_CEILING_MS);
  const scored = [];
  let evaluated = 0;

  // Overrunning the budget is allowed only while we have nothing at all to
  // show, and never past the hard ceiling.
  const outOfTime = () => {
    const spent = now() - started;
    if (spent > hardCeiling) return true;
    return spent > timeBudgetMs && scored.length > 0;
  };

  const orientations = orientationsFor(dimensions);

  const samples = orientations.map((o) => ({
    orientation: o,
    x: axisSamples('x', o.size.x, obstacles, truck, MAX_ANCHORS_X, MAX_SWEEP_X),
    z: axisSamples('z', o.size.z, obstacles, truck, MAX_ANCHORS_Z, MAX_SWEEP_Z)
  }));

  const tryAt = (orientation, x, z) => {
    const s = orientation.size;
    const y = restingCentreY(x, z, s, obstacles, truck);
    if (y === null) return;

    const pos = { x, y, z };
    if (!withinBounds(pos, s, truck)) return;

    const box = makeAABB(pos, s);
    if (collides(box, obstacles)) return;

    evaluated += 1;
    const result = scorePlacement(box, ctx);
    scored.push({
      position: pos,
      size: { x: s.x, y: s.y, z: s.z },
      euler: orientation.euler,
      orientation: orientation.label,
      score: result.score,
      terms: result.terms,
      contactRatio: result.contactRatio,
      flushFaces: result.flushFaces,
      supportRatio: result.supportRatio,
      restsOnFragile: result.restsOnFragile,
      loadsFragileBelow: result.loadsFragileBelow,
      reasons: []
    });
  };

  // Pass 1 — exact-contact anchors, for every orientation. This is the cheap,
  // high-value half of the search: the tightest spot on a loaded trailer is
  // almost always flush against something, and running it for all orientations
  // before any grid work means US2's "try every rotation" survives a timeout.
  // `orientationsTried` counts only the orientations whose anchor set was swept
  // in full, so the figure the UI shows ("6/6 rotations tried") means exactly
  // that — a partial sweep cut short by the clock is not counted as tried.
  let orientationsTried = 0;
  for (const entry of samples) {
    if (outOfTime()) break;
    let complete = true;
    for (const x of entry.x.anchors) {
      if (outOfTime()) { complete = false; break; }
      for (const z of entry.z.anchors) tryAt(entry.orientation, x, z);
    }
    if (complete) orientationsTried += 1;
  }

  // Pass 2 — adaptive fill, for the open deck an anchor cannot describe. Pairs
  // where both coordinates are anchors were already covered by pass 1.
  for (const entry of samples) {
    if (outOfTime()) break;
    const anchorX = new Set(entry.x.anchors);
    const anchorZ = new Set(entry.z.anchors);
    const xs = [...entry.x.anchors, ...entry.x.sweep];
    const zs = [...entry.z.anchors, ...entry.z.sweep];
    for (const x of xs) {
      if (outOfTime()) break;
      for (const z of zs) {
        if (anchorX.has(x) && anchorZ.has(z)) continue;
        tryAt(entry.orientation, x, z);
      }
    }
  }

  scored.sort((a, b) => (a.score - b.score) || (a.position.x - b.position.x) ||
                        (a.position.z - b.position.z) || (a.position.y - b.position.y));

  // Return spatially distinct options — three near-identical spots are not
  // three suggestions.
  const picked = [];
  const minSeparation = Math.max(
    0.75,
    Math.min(dimensions.x, dimensions.y, dimensions.z) * 0.75
  );
  for (const cand of scored) {
    const tooClose = picked.some((p) =>
      Math.abs(p.position.x - cand.position.x) < minSeparation &&
      Math.abs(p.position.z - cand.position.z) < minSeparation &&
      Math.abs(p.position.y - cand.position.y) < minSeparation
    );
    if (tooClose) continue;
    picked.push(cand);
    if (picked.length >= maxResults) break;
  }

  // Only now, on the handful that survived, work out why.
  for (const p of picked) {
    p.reasons = scorePlacement(
      makeAABB(p.position, p.size),
      { ...ctx, explain: true }
    ).reasons;
  }

  const elapsedMs = now() - started;
  return {
    results: picked,
    elapsedMs,
    timedOut: elapsedMs > timeBudgetMs,
    evaluated,
    orientationsTried
  };
}
