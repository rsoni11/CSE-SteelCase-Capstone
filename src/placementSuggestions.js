import * as THREE from 'three';
import { TRUCK_DIMENSIONS } from './constants';

/** Floor plane used by DragController.clampY — box bottom rests here when on the deck */
const FLOOR_CONTACT_Y = 0.1;

const COARSE_GRID = 0.2;
const REFINE_STEP = 0.05;
const REFINE_RADIUS = 0.25;

const roundToStep = (value, step) => Math.round(value / step) * step;

const _corner = new THREE.Vector3();

/**
 * World-space AABB of the cargo mesh from entry.size + mesh.matrixWorld.
 * Ignores child objects (edges, sprites) so bounds match the real carton, not decorations.
 */
const worldAABBFromEntry = (entry) => {
  entry.mesh.updateMatrixWorld(true);
  const hx = entry.size.x / 2;
  const hy = entry.size.y / 2;
  const hz = entry.size.z / 2;
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const corners = [
    [-hx, -hy, -hz],
    [hx, -hy, -hz],
    [-hx, hy, -hz],
    [hx, hy, -hz],
    [-hx, -hy, hz],
    [hx, -hy, hz],
    [-hx, hy, hz],
    [hx, hy, hz]
  ];
  for (const [cx, cy, cz] of corners) {
    _corner.set(cx, cy, cz).applyMatrix4(entry.mesh.matrixWorld);
    min.min(_corner);
    max.max(_corner);
  }
  return { min: min.clone(), max: max.clone() };
};

const buildObstacleContext = (placed) =>
  placed.map((entry) => ({ entry, box: worldAABBFromEntry(entry) }));

const getAABB = (position, size) => {
  const half = new THREE.Vector3(size.x / 2, size.y / 2, size.z / 2);
  return {
    min: position.clone().sub(half),
    max: position.clone().add(half)
  };
};

const overlap1D = (aMin, aMax, bMin, bMax) =>
  Math.max(0, Math.min(aMax, bMax) - Math.max(aMin, bMin));

const intersectsAABB = (a, b, epsilon = 1e-4) => (
  a.min.x < b.max.x - epsilon &&
  a.max.x > b.min.x + epsilon &&
  a.min.y < b.max.y - epsilon &&
  a.max.y > b.min.y + epsilon &&
  a.min.z < b.max.z - epsilon &&
  a.max.z > b.min.z + epsilon
);

const horizontalBounds = (size) => {
  const halfL = TRUCK_DIMENSIONS.length / 2;
  const halfW = TRUCK_DIMENSIONS.width / 2;
  return {
    minX: -halfL + size.x / 2,
    maxX: halfL - size.x / 2,
    minZ: -halfW + size.z / 2,
    maxZ: halfW - size.z / 2
  };
};

const isWithinTruckBounds = (position, size) => {
  const { minX, maxX, minZ, maxZ } = horizontalBounds(size);
  const halfY = size.y / 2;
  return (
    position.x >= minX &&
    position.x <= maxX &&
    position.z >= minZ &&
    position.z <= maxZ &&
    position.y >= FLOOR_CONTACT_Y + halfY - 1e-3 &&
    position.y <= TRUCK_DIMENSIONS.height - halfY + 1e-3
  );
};

/**
 * Highest support surface under footprint (floor or top of any overlapping box).
 * Uses projected XZ overlap against world AABBs so rotated cargo is respected.
 */
const computeRestingCenterY = (x, z, size, ctx) => {
  const hx = size.x / 2;
  const hz = size.z / 2;
  const fminX = x - hx;
  const fmaxX = x + hx;
  const fminZ = z - hz;
  const fmaxZ = z + hz;

  let supportTop = FLOOR_CONTACT_Y;

  for (const { box } of ctx) {
    const overlapX = fminX < box.max.x - 1e-5 && fmaxX > box.min.x + 1e-5;
    const overlapZ = fminZ < box.max.z - 1e-5 && fmaxZ > box.min.z + 1e-5;
    if (overlapX && overlapZ) supportTop = Math.max(supportTop, box.max.y);
  }

  let centerY = supportTop + size.y / 2;
  centerY = roundToStep(centerY, 0.05);
  const maxCenter = TRUCK_DIMENSIONS.height - size.y / 2;
  if (centerY > maxCenter + 1e-3) return null;
  return centerY;
};

const collidesPlaced = (position, size, ctx) => {
  const candidate = getAABB(position, size);
  return ctx.some(({ box }) => intersectsAABB(candidate, box));
};

const computeSupport = (position, size, ctx) => {
  const candidateBottom = position.y - size.y / 2;
  const candidateArea = size.x * size.z;
  const candidateAABB = getAABB(position, size);
  let supportedArea = 0;

  if (Math.abs(candidateBottom - FLOOR_CONTACT_Y) <= 0.035) {
    supportedArea = candidateArea;
  } else {
    for (const { box } of ctx) {
      const top = box.max.y;
      if (Math.abs(candidateBottom - top) > 0.08) continue;
      const area =
        overlap1D(candidateAABB.min.x, candidateAABB.max.x, box.min.x, box.max.x) *
        overlap1D(candidateAABB.min.z, candidateAABB.max.z, box.min.z, box.max.z);
      supportedArea += area;
    }
  }

  const supportRatio = Math.min(1, supportedArea / Math.max(candidateArea, 1e-6));
  return {
    supportRatio,
    isFloorPlacement: Math.abs(candidateBottom - FLOOR_CONTACT_Y) <= 0.035
  };
};

const computeWastedSpaceScore = (position, size, ctx) => {
  const halfL = TRUCK_DIMENSIONS.length / 2;
  const halfW = TRUCK_DIMENSIONS.width / 2;
  const left = position.x - size.x / 2;
  const right = position.x + size.x / 2;
  const back = position.z - size.z / 2;
  const front = position.z + size.z / 2;
  const bottom = position.y - size.y / 2;

  let minGapX = Math.min(right - (-halfL), halfL - left);
  let minGapZ = Math.min(front - (-halfW), halfW - back);
  let minGapY = bottom - FLOOR_CONTACT_Y;

  for (const { box } of ctx) {
    minGapX = Math.min(
      minGapX,
      Math.max(0, left - box.max.x),
      Math.max(0, box.min.x - right)
    );
    minGapZ = Math.min(
      minGapZ,
      Math.max(0, back - box.max.z),
      Math.max(0, box.min.z - front)
    );
    minGapY = Math.min(minGapY, Math.max(0, bottom - box.max.y));
  }

  return minGapX + minGapZ + minGapY * 1.55;
};

const scorePlacement = (position, size, ctx) => {
  const support = computeSupport(position, size, ctx);
  const wastedSpace = computeWastedSpaceScore(position, size, ctx);
  const elevatedPenalty = Math.max(0, position.y - (FLOOR_CONTACT_Y + size.y / 2));
  const unsupportedPenalty = 1 - support.supportRatio;

  const score =
    (support.isFloorPlacement ? 0 : 18) +
    unsupportedPenalty * 32 +
    wastedSpace * 7.5 +
    elevatedPenalty * 4.5;

  return {
    score,
    supportRatio: support.supportRatio,
    wastedSpace
  };
};

const LAYOUT_CACHE = new Map();

const _half = new THREE.Vector3();

/** World AABB size for local box (w,h,d) after quaternion q (origin-centered). */
const axisAlignedSizeAfterRotation = (w, h, d, q) => {
  const hx = w / 2;
  const hy = h / 2;
  const hz = d / 2;
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const corners = [
    [-hx, -hy, -hz],
    [hx, -hy, -hz],
    [-hx, hy, -hz],
    [hx, hy, -hz],
    [-hx, -hy, hz],
    [hx, -hy, hz],
    [-hx, hy, hz],
    [hx, hy, hz]
  ];
  for (const [cx, cy, cz] of corners) {
    _half.set(cx, cy, cz).applyQuaternion(q);
    min.min(_half);
    max.max(_half);
  }
  return {
    x: max.x - min.x,
    y: max.y - min.y,
    z: max.z - min.z
  };
};

/**
 * Flat resting (smallest edge vertical) without 64³ enumeration — keeps UI responsive.
 * Tries a small fixed set of 90° rotations; dedupes by footprint.
 */
const flatRestingLayouts = (width, height, depth) => {
  const key = `${width.toFixed(4)}_${height.toFixed(4)}_${depth.toFixed(4)}`;
  if (LAYOUT_CACHE.has(key)) return LAYOUT_CACHE.get(key);

  const minThickness = Math.min(width, height, depth);
  const out = [];
  const seenFootprint = new Set();

  const Q = Math.PI / 2;
  const trials = [
    new THREE.Euler(0, 0, 0),
    new THREE.Euler(0, Q, 0),
    new THREE.Euler(0, -Q, 0),
    new THREE.Euler(Q, 0, 0),
    new THREE.Euler(-Q, 0, 0),
    new THREE.Euler(0, 0, Q),
    new THREE.Euler(0, 0, -Q),
    new THREE.Euler(Q, Q, 0),
    new THREE.Euler(Q, 0, Q),
    new THREE.Euler(0, Q, Q)
  ];

  for (const euler of trials) {
    const q = new THREE.Quaternion().setFromEuler(euler);
    const s = axisAlignedSizeAfterRotation(width, height, depth, q);
    if (Math.abs(s.y - minThickness) > 0.03) continue;
    const fk = `${s.x.toFixed(3)}_${s.z.toFixed(3)}`;
    if (seenFootprint.has(fk)) continue;
    seenFootprint.add(fk);
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

/** Flush-to-wall / flush-to-neighbor X positions that often yield tight packings */
const collectAnchorXs = (size, ctx) => {
  const { minX, maxX } = horizontalBounds(size);
  const xs = new Set();

  xs.add(roundToStep(minX, COARSE_GRID));
  xs.add(roundToStep(maxX, COARSE_GRID));
  xs.add(roundToStep((minX + maxX) / 2, COARSE_GRID));

  for (const { box } of ctx) {
    xs.add(roundToStep(box.min.x - size.x / 2, COARSE_GRID));
    xs.add(roundToStep(box.max.x + size.x / 2, COARSE_GRID));
    xs.add(roundToStep((box.min.x + box.max.x) / 2, COARSE_GRID));
  }

  return [...xs].filter((x) => x >= minX - 1e-4 && x <= maxX + 1e-4);
};

const collectAnchorZs = (size, ctx) => {
  const { minZ, maxZ } = horizontalBounds(size);
  const zs = new Set();

  zs.add(roundToStep(minZ, COARSE_GRID));
  zs.add(roundToStep(maxZ, COARSE_GRID));
  zs.add(roundToStep((minZ + maxZ) / 2, COARSE_GRID));

  for (const { box } of ctx) {
    zs.add(roundToStep(box.min.z - size.z / 2, COARSE_GRID));
    zs.add(roundToStep(box.max.z + size.z / 2, COARSE_GRID));
    zs.add(roundToStep((box.min.z + box.max.z) / 2, COARSE_GRID));
  }

  return [...zs].filter((z) => z >= minZ - 1e-4 && z <= maxZ + 1e-4);
};

const tryCandidate = (x, z, size, ctx) => {
  const y = computeRestingCenterY(x, z, size, ctx);
  if (y === null) return null;
  const position = new THREE.Vector3(x, y, z);
  if (!isWithinTruckBounds(position, size)) return null;
  if (collidesPlaced(position, size, ctx)) return null;
  const scored = scorePlacement(position, size, ctx);
  return { position, size: { ...size }, ...scored };
};

const coarseSearch = (size, ctx) => {
  const { minX, maxX, minZ, maxZ } = horizontalBounds(size);
  const out = [];

  for (let x = minX; x <= maxX + 1e-6; x += COARSE_GRID) {
    const sx = roundToStep(x, COARSE_GRID);
    for (let z = minZ; z <= maxZ + 1e-6; z += COARSE_GRID) {
      const sz = roundToStep(z, COARSE_GRID);
      const c = tryCandidate(sx, sz, size, ctx);
      if (c) out.push(c);
    }
  }

  const ax = collectAnchorXs(size, ctx);
  const az = collectAnchorZs(size, ctx);
  for (const x of ax) {
    for (const z of az) {
      const c = tryCandidate(x, z, size, ctx);
      if (c) out.push(c);
    }
  }

  out.sort((a, b) => a.score - b.score);
  return out.slice(0, 150);
};

const refineAround = (candidates, size, ctx) => {
  const refined = [];
  const offsets = [];
  for (let d = -REFINE_RADIUS; d <= REFINE_RADIUS + 1e-6; d += REFINE_STEP) {
    offsets.push(roundToStep(d, REFINE_STEP));
  }

  const seen = new Set();

  for (const base of candidates.slice(0, 45)) {
    const bx = base.position.x;
    const bz = base.position.z;
    for (const ox of offsets) {
      for (const oz of offsets) {
        const x = roundToStep(bx + ox, REFINE_STEP);
        const z = roundToStep(bz + oz, REFINE_STEP);
        const key = `${x.toFixed(3)}_${z.toFixed(3)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const c = tryCandidate(x, z, size, ctx);
        if (c) refined.push(c);
      }
    }
  }

  refined.sort((a, b) => a.score - b.score);
  return refined;
};

const mergeBest = (a, b, limit) => {
  const map = new Map();
  const keyOf = (p) =>
    `${p.position.x.toFixed(3)}:${p.position.y.toFixed(3)}:${p.position.z.toFixed(3)}`;

  for (const item of [...a, ...b]) {
    const k = keyOf(item);
    const prev = map.get(k);
    if (!prev || item.score < prev.score) map.set(k, item);
  }
  return [...map.values()].sort((x, y) => x.score - y.score).slice(0, limit);
};

export const getPlacementSuggestions = (size, placedBoxes, maxSuggestions = 3) => {
  if (!size || !size.x || !size.y || !size.z) return [];
  const placed = Array.isArray(placedBoxes) ? placedBoxes : [];
  const ctx = buildObstacleContext(placed);

  const layouts = flatRestingLayouts(size.x, size.y, size.z).slice(0, 6);

  const merged = [];
  const seen = new Set();

  for (const layout of layouts) {
    const s = layout.size;
    const coarse = coarseSearch(s, ctx);
    const refined = refineAround(coarse.length ? coarse : [], s, ctx);
    const best = mergeBest(coarse, refined, 80);

    for (const c of best) {
      const q = layout.quaternion;
      const key = `${c.position.x.toFixed(3)}:${c.position.y.toFixed(3)}:${c.position.z.toFixed(3)}:${s.x.toFixed(3)}:${s.z.toFixed(3)}:${q.x.toFixed(4)}:${q.z.toFixed(4)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({
        position: c.position.clone(),
        size: { x: s.x, y: s.y, z: s.z },
        quaternion: q.clone(),
        score: c.score,
        supportRatio: c.supportRatio,
        wastedSpace: c.wastedSpace
      });
    }
  }

  merged.sort((a, b) => a.score - b.score);
  return merged.slice(0, maxSuggestions);
};
