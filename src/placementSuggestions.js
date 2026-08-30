import * as THREE from 'three';
import { TRUCK_DIMENSIONS } from './constants';
import {
  makeAABB,
  intersects,
  loadStats,
  scorePlacement,
  estimateMass,
  restingCentreY,
  withinBounds
} from './packingScore';

/**
 * Candidate generation for the "AI Best Fit" suggestion.
 *
 * Previously this swept a dense 0.2 ft grid across the whole deck for every
 * orientation. That was both slow and — combined with the broken wasted-space
 * term in the old scorer — biased toward wide-open floor.
 *
 * Now we use extreme points: the only positions worth testing are the ones
 * flush against a wall or against a face/edge of something already loaded.
 * That is the standard container-loading approach (Crainic et al., 2008) and it
 * naturally produces the tetris-style wall building the team asked for.
 * A coarse grid is still swept as a fallback so nothing is missed on an empty
 * or sparsely loaded trailer.
 */

const GRID_FALLBACK_STEP = 1.0;   // feet — safety net, not the primary source
const SNAP = 0.05;                // positions are rounded to this
const MAX_ANCHORS_PER_AXIS = 30;
const TIME_BUDGET_MS = 70;        // keep the click responsive

const roundToStep = (v, step) => Math.round(v / step) * step;

/**
 * Registry entries → plain obstacles carrying the mass/fragility the scorer needs.
 *
 * `entry.size` is already the WORLD-axis-aligned extent, not local dimensions —
 * that is the convention the rest of the app uses (CollisionSystem builds its
 * AABB straight from `size` + position, and DragController swaps `size.x`/
 * `size.z` when it turns a carton 90°). This used to transform `size` by
 * `mesh.matrixWorld`, which applied the rotation a second time and produced
 * badly wrong bounds for any turned carton — suggestions then overlapped those
 * boxes, and the solver launched them through the walls and floor.
 */
const buildObstacles = (placed) => placed.map((entry) => {
  const p = entry.mesh.position;
  const s = entry.size;
  return {
    min: { x: p.x - s.x / 2, y: p.y - s.y / 2, z: p.z - s.z / 2 },
    max: { x: p.x + s.x / 2, y: p.y + s.y / 2, z: p.z + s.z / 2 },
    mass: entry.physics?.mass ?? estimateMass(s),
    fragile: entry.fragile ?? false,
    entry
  };
});

const collides = (pos, size, obstacles) => {
  const candidate = makeAABB(pos, size);
  for (const o of obstacles) {
    if (intersects(candidate, o)) return true;
  }
  return false;
};

/**
 * Extreme points along one axis: flush beside each loaded carton, aligned with
 * its edges (so stacks line up), and flush to both walls.
 */
const anchorsFor = (axis, size, obstacles) => {
  const half = axis === 'x'
    ? TRUCK_DIMENSIONS.length / 2
    : TRUCK_DIMENSIONS.width / 2;
  const extent = size[axis];
  const lo = -half + extent / 2;
  const hi = half - extent / 2;

  const set = new Set([
    roundToStep(lo, SNAP),
    roundToStep(hi, SNAP),
    roundToStep((lo + hi) / 2, SNAP)
  ]);

  for (const o of obstacles) {
    const oMin = o.min[axis];
    const oMax = o.max[axis];
    // beside it (both sides), and edge-aligned with it (both edges)
    set.add(roundToStep(oMax + extent / 2, SNAP));
    set.add(roundToStep(oMin - extent / 2, SNAP));
    set.add(roundToStep(oMin + extent / 2, SNAP));
    set.add(roundToStep(oMax - extent / 2, SNAP));
  }

  let out = [...set].filter((v) => v >= lo - 1e-4 && v <= hi + 1e-4);

  // If we have to trim, keep the anchors nearest the working face of the load
  // (the door-most edge of what is already stacked) — those are the ones that
  // continue the wall. Trimming toward the nose instead threw away every spot
  // adjacent to existing cargo once the trailer had ~20 cartons in it.
  if (out.length > MAX_ANCHORS_PER_AXIS) {
    let pivot = axis === 'x' ? hi : 0;
    if (axis === 'x' && obstacles.length) {
      pivot = obstacles.reduce((m, o) => Math.min(m, o.min.x), Infinity);
    }
    out.sort((a, b) => Math.abs(a - pivot) - Math.abs(b - pivot));
    out = out.slice(0, MAX_ANCHORS_PER_AXIS);
  }
  return out;
};

const gridFallback = (axis, size) => {
  const half = axis === 'x'
    ? TRUCK_DIMENSIONS.length / 2
    : TRUCK_DIMENSIONS.width / 2;
  const extent = size[axis];
  const lo = -half + extent / 2;
  const hi = half - extent / 2;
  const out = [];
  for (let v = lo; v <= hi + 1e-6; v += GRID_FALLBACK_STEP) {
    out.push(roundToStep(v, SNAP));
  }
  if (out.length === 0 || Math.abs(out[out.length - 1] - hi) > 1e-3) {
    out.push(roundToStep(hi, SNAP));
  }
  return out;
};

const LAYOUT_CACHE = new Map();
const _half = new THREE.Vector3();

const axisAlignedSizeAfterRotation = (w, h, d, q) => {
  const hx = w / 2, hy = h / 2, hz = d / 2;
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const corners = [
    [-hx, -hy, -hz], [hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz],
    [-hx, -hy, hz], [hx, -hy, hz], [-hx, hy, hz], [hx, hy, hz]
  ];
  for (const [cx, cy, cz] of corners) {
    _half.set(cx, cy, cz).applyQuaternion(q);
    min.min(_half);
    max.max(_half);
  }
  return { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z };
};

/** Flat resting orientations (smallest edge vertical), deduped by footprint. */
const flatRestingLayouts = (width, height, depth) => {
  const key = `${width.toFixed(4)}_${height.toFixed(4)}_${depth.toFixed(4)}`;
  if (LAYOUT_CACHE.has(key)) return LAYOUT_CACHE.get(key);

  const minThickness = Math.min(width, height, depth);
  const out = [];
  const seen = new Set();
  const Q = Math.PI / 2;
  const trials = [
    new THREE.Euler(0, 0, 0), new THREE.Euler(0, Q, 0), new THREE.Euler(0, -Q, 0),
    new THREE.Euler(Q, 0, 0), new THREE.Euler(-Q, 0, 0),
    new THREE.Euler(0, 0, Q), new THREE.Euler(0, 0, -Q),
    new THREE.Euler(Q, Q, 0), new THREE.Euler(Q, 0, Q), new THREE.Euler(0, Q, Q)
  ];

  for (const euler of trials) {
    const q = new THREE.Quaternion().setFromEuler(euler);
    const s = axisAlignedSizeAfterRotation(width, height, depth, q);
    if (Math.abs(s.y - minThickness) > 0.03) continue;
    const fk = `${s.x.toFixed(3)}_${s.z.toFixed(3)}`;
    if (seen.has(fk)) continue;
    seen.add(fk);
    out.push({ size: { x: s.x, y: s.y, z: s.z }, quaternion: q.clone() });
  }

  if (out.length === 0) {
    out.push({
      size: { x: width, y: height, z: depth },
      quaternion: new THREE.Quaternion()
    });
  }

  LAYOUT_CACHE.set(key, out);
  return out;
};

/**
 * Ranked placement suggestions for a carton.
 *
 * @param {{x:number,y:number,z:number}} size  carton dimensions in feet
 * @param {Array} placedBoxes                  live cargo registry entries
 * @param {number} maxSuggestions
 * @param {{mass?:number, fragile?:boolean, exclude?:Array}} options
 *        `exclude` lists registry entries to leave out of the obstacle set —
 *        used for the carton we are about to move, so it does not have to find
 *        a spot that avoids where it is currently sitting.
 */
export const getPlacementSuggestions = (
  size,
  placedBoxes,
  maxSuggestions = 3,
  options = {}
) => {
  if (!size || !size.x || !size.y || !size.z) return [];

  const placed = Array.isArray(placedBoxes) ? placedBoxes : [];
  const skip = new Set(options.exclude ?? []);
  const obstacles = buildObstacles(
    skip.size ? placed.filter((e) => !skip.has(e)) : placed
  );
  const stats = loadStats(obstacles);

  const mass = options.mass ?? estimateMass(size);
  const fragile = options.fragile ?? false;
  const ctxBase = {
    obstacles,
    truck: TRUCK_DIMENSIONS,
    mass,
    fragile,
    stats,
    explain: false
  };

  const clock = typeof performance !== 'undefined' ? performance : Date;
  const started = clock.now();
  const outOfTime = () => clock.now() - started > TIME_BUDGET_MS;

  const layouts = flatRestingLayouts(size.x, size.y, size.z).slice(0, 4);
  const scored = [];

  for (const layout of layouts) {
    if (outOfTime()) break;

    const s = layout.size;
    const xs = new Set([...anchorsFor('x', s, obstacles), ...gridFallback('x', s)]);
    const zs = new Set([...anchorsFor('z', s, obstacles), ...gridFallback('z', s)]);

    for (const x of xs) {
      // A full trailer makes this loop long; bail before the click feels slow.
      if (outOfTime()) break;
      for (const z of zs) {
        const y = restingCentreY(x, z, s, obstacles, TRUCK_DIMENSIONS);
        if (y === null) continue;

        const pos = { x, y, z };
        if (!withinBounds(pos, s, TRUCK_DIMENSIONS)) continue;
        if (collides(pos, s, obstacles)) continue;

        const box = makeAABB(pos, s);
        const result = scorePlacement(box, ctxBase);

        scored.push({
          position: new THREE.Vector3(pos.x, pos.y, pos.z),
          size: { x: s.x, y: s.y, z: s.z },
          quaternion: layout.quaternion.clone(),
          score: result.score,
          terms: result.terms,
          contactRatio: result.contactRatio,
          supportRatio: result.supportRatio,
          restsOnFragile: result.restsOnFragile,
          reasons: []
        });
      }
    }
  }

  scored.sort((a, b) => a.score - b.score);

  // Return spatially distinct options — three near-identical spots are not
  // three suggestions.
  const picked = [];
  const minSeparation = Math.max(0.75, Math.min(size.x, size.z) * 0.75);
  for (const cand of scored) {
    const tooClose = picked.some((p) =>
      Math.abs(p.position.x - cand.position.x) < minSeparation &&
      Math.abs(p.position.z - cand.position.z) < minSeparation &&
      Math.abs(p.position.y - cand.position.y) < minSeparation
    );
    if (tooClose) continue;
    picked.push(cand);
    if (picked.length >= maxSuggestions) break;
  }

  // Now that we know which few placements survive, work out why.
  for (const p of picked) {
    p.reasons = scorePlacement(
      makeAABB(p.position, p.size),
      { ...ctxBase, explain: true }
    ).reasons;
  }

  return picked;
};
