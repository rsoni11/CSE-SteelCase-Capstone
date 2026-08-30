/**
 * Packing evaluation — pure math, no THREE / DOM / React imports.
 *
 * Kept dependency-free on purpose so the placement logic can be exercised with
 * `npm test` (node --test) without a browser or a bundler.
 *
 * SCORE CONVENTION: lower is better (unchanged from the previous scorer).
 *
 * Why this file exists — the old scorer in placementSuggestions.js had a bug
 * that made its "wasted space" term collapse to 0 as soon as a single box was
 * on the trailer, so ranking was driven almost entirely by "is this on the
 * floor?". That is why suggestions landed in open floor space instead of
 * tucked against existing cargo. See computeContact() for the replacement:
 * we now measure real face-to-face contact area instead of a min-gap proxy.
 */

import { DECK_SURFACE_Y } from './constants.js';

/** Height a resting carton's bottom face sits at (feet) — the deck surface. */
export const FLOOR_Y = DECK_SURFACE_Y;

export const DEFAULT_TRUCK = { length: 53, width: 8.5, height: 9 };

/**
 * Fallback density when a carton carries no mass. The Steelcase SKUs in
 * constants.js run ~7–44 lb/ft³; 18 is a middle-of-the-road carton.
 */
export const DEFAULT_DENSITY = 18;

/** At or above this mass a carton is "heavy" for crush / fragility checks. */
export const HEAVY_MASS = 25;

/** Two faces count as touching within this distance (feet). */
export const CONTACT_EPS = 0.06;

/**
 * The trailer is loaded from the door end toward the nose. With NOSE_SIGN = 1
 * the door is at -X and the nose (deep end) is at +X, which matches the loading
 * bay sitting at x = -40 in TruckScene. Flip to -1 if that ever changes.
 */
export const NOSE_SIGN = 1;

/**
 * Term weights. Tuned so that "tuck it against what is already loaded" beats
 * "drop it in the nearest open floor". Exported so tests and tuning scripts
 * can reference them instead of hard-coding numbers.
 */
export const WEIGHTS = {
  contact: 34,        // reward for face contact with floor/walls/neighbours
  support: 30,        // penalty for an unsupported footprint
  envelope: 14,       // penalty for growing the load's bounding box
  span: 3,            // penalty for extending the load toward the door
  depth: 7,           // mild bias toward filling the deep end first
  comHeight: 22,      // penalty for carrying mass high
  crush: 26,          // penalty for resting a heavy box on a lighter one
  fragileUnder: 140,  // heavy box on a fragile box — effectively a rejection
  balance: 10,        // penalty for pushing the load off the centreline
  floorBonus: 5       // small preference for floor placements
};

/**
 * Loaders do not centre every carton — they care about gross imbalance. The
 * centre of mass may drift this fraction of the half-width before the balance
 * term starts charging for it. Without the deadband, a perfectly centred
 * single-file row down the trailer beat filling the full width.
 */
export const BALANCE_DEADBAND = 0.25;

export const estimateMass = (size, density = DEFAULT_DENSITY) =>
  Math.max(1, size.x * size.y * size.z * density);

export const makeAABB = (pos, size) => ({
  min: { x: pos.x - size.x / 2, y: pos.y - size.y / 2, z: pos.z - size.z / 2 },
  max: { x: pos.x + size.x / 2, y: pos.y + size.y / 2, z: pos.z + size.z / 2 }
});

export const overlap1D = (aMin, aMax, bMin, bMax) =>
  Math.max(0, Math.min(aMax, bMax) - Math.max(aMin, bMin));

export const intersects = (a, b, eps = 1e-4) => (
  a.min.x < b.max.x - eps && a.max.x > b.min.x + eps &&
  a.min.y < b.max.y - eps && a.max.y > b.min.y + eps &&
  a.min.z < b.max.z - eps && a.max.z > b.min.z + eps
);

const dims = (b) => ({
  x: b.max.x - b.min.x,
  y: b.max.y - b.min.y,
  z: b.max.z - b.min.z
});

const centre = (b) => ({
  x: (b.min.x + b.max.x) / 2,
  y: (b.min.y + b.max.y) / 2,
  z: (b.min.z + b.max.z) / 2
});

/**
 * Fraction of the box's own surface area that is flush against the deck, a
 * wall, or another carton. This is the "snugness" signal — a box wedged into a
 * corner against two neighbours scores far higher than one sitting alone.
 */
export function computeContact(box, obstacles, truck = DEFAULT_TRUCK) {
  const s = dims(box);
  const surface = 2 * (s.x * s.y + s.y * s.z + s.x * s.z);
  const halfL = truck.length / 2;
  const halfW = truck.width / 2;

  let floor = 0;
  let walls = 0;
  let neighbours = 0;

  if (Math.abs(box.min.y - FLOOR_Y) <= CONTACT_EPS) floor += s.x * s.z;

  if (Math.abs(box.min.x + halfL) <= CONTACT_EPS) walls += s.y * s.z;
  if (Math.abs(halfL - box.max.x) <= CONTACT_EPS) walls += s.y * s.z;
  if (Math.abs(box.min.z + halfW) <= CONTACT_EPS) walls += s.x * s.y;
  if (Math.abs(halfW - box.max.z) <= CONTACT_EPS) walls += s.x * s.y;

  for (const o of obstacles) {
    if (Math.abs(box.min.x - o.max.x) <= CONTACT_EPS ||
        Math.abs(o.min.x - box.max.x) <= CONTACT_EPS) {
      neighbours += overlap1D(box.min.y, box.max.y, o.min.y, o.max.y) *
                    overlap1D(box.min.z, box.max.z, o.min.z, o.max.z);
    }
    if (Math.abs(box.min.y - o.max.y) <= CONTACT_EPS ||
        Math.abs(o.min.y - box.max.y) <= CONTACT_EPS) {
      neighbours += overlap1D(box.min.x, box.max.x, o.min.x, o.max.x) *
                    overlap1D(box.min.z, box.max.z, o.min.z, o.max.z);
    }
    if (Math.abs(box.min.z - o.max.z) <= CONTACT_EPS ||
        Math.abs(o.min.z - box.max.z) <= CONTACT_EPS) {
      neighbours += overlap1D(box.min.x, box.max.x, o.min.x, o.max.x) *
                    overlap1D(box.min.y, box.max.y, o.min.y, o.max.y);
    }
  }

  const total = floor + walls + neighbours;
  return {
    floor, walls, neighbours, total, surface,
    ratio: surface > 0 ? Math.min(1, total / surface) : 0
  };
}

/**
 * How much of the footprint rests on something solid, plus which cartons are
 * carrying it (needed for the crush / fragility checks).
 */
export function computeSupport(box, obstacles) {
  const s = dims(box);
  const area = s.x * s.z;

  if (Math.abs(box.min.y - FLOOR_Y) <= CONTACT_EPS) {
    return { ratio: 1, onFloor: true, supporters: [] };
  }

  let supported = 0;
  const supporters = [];
  for (const o of obstacles) {
    if (Math.abs(box.min.y - o.max.y) > CONTACT_EPS) continue;
    const a = overlap1D(box.min.x, box.max.x, o.min.x, o.max.x) *
              overlap1D(box.min.z, box.max.z, o.min.z, o.max.z);
    if (a > 0) {
      supported += a;
      supporters.push({ obstacle: o, area: a });
    }
  }

  return {
    ratio: area > 0 ? Math.min(1, supported / area) : 0,
    onFloor: false,
    supporters
  };
}

/**
 * Height of the carton's CENTRE once it is dropped straight down at (x, z):
 * it rests on the deck, or on the tallest carton under its footprint.
 *
 * NB: this value is deliberately NOT snapped to a grid. Rounding it to 0.05 ft
 * used to push cartons a few thousandths BELOW the legal floor-contact height,
 * and the bounds check then rejected every candidate — which is why a
 * 30.25" x 25.63" x 13.5" Steelcase carton produced zero suggestions even on a
 * completely empty trailer. Snapping also broke face-contact detection.
 * Returns null when the carton would poke through the roof.
 */
export function restingCentreY(x, z, size, obstacles, truck = DEFAULT_TRUCK) {
  const hx = size.x / 2;
  const hz = size.z / 2;
  const minX = x - hx, maxX = x + hx;
  const minZ = z - hz, maxZ = z + hz;

  let top = FLOOR_Y;
  for (const o of obstacles) {
    if (minX < o.max.x - 1e-5 && maxX > o.min.x + 1e-5 &&
        minZ < o.max.z - 1e-5 && maxZ > o.min.z + 1e-5) {
      if (o.max.y > top) top = o.max.y;
    }
  }

  const centreY = top + size.y / 2;
  return centreY > truck.height - size.y / 2 + 1e-9 ? null : centreY;
}

/** Is the carton fully inside the trailer at this centre position? */
export function withinBounds(pos, size, truck = DEFAULT_TRUCK) {
  const halfL = truck.length / 2;
  const halfW = truck.width / 2;
  const eps = 1e-6;
  return (
    pos.x >= -halfL + size.x / 2 - eps && pos.x <= halfL - size.x / 2 + eps &&
    pos.z >= -halfW + size.z / 2 - eps && pos.z <= halfW - size.z / 2 + eps &&
    pos.y >= FLOOR_Y + size.y / 2 - eps &&
    pos.y <= truck.height - size.y / 2 + eps
  );
}

/** Aggregate mass / centre-of-mass / envelope of everything already loaded. */
export function loadStats(obstacles) {
  let totalMass = 0;
  let mx = 0;
  let mz = 0;
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (const o of obstacles) {
    const m = o.mass ?? 0;
    const c = centre(o);
    totalMass += m;
    mx += m * c.x;
    mz += m * c.z;
    if (o.min.x < minX) minX = o.min.x;
    if (o.max.x > maxX) maxX = o.max.x;
    if (o.min.y < minY) minY = o.min.y;
    if (o.max.y > maxY) maxY = o.max.y;
    if (o.min.z < minZ) minZ = o.min.z;
    if (o.max.z > maxZ) maxZ = o.max.z;
  }

  return {
    count: obstacles.length,
    totalMass,
    comX: totalMass > 0 ? mx / totalMass : 0,
    comZ: totalMass > 0 ? mz / totalMass : 0,
    envelope: obstacles.length ? { minX, maxX, minY, maxY, minZ, maxZ } : null
  };
}

/**
 * Rank one candidate placement. Lower is better.
 *
 * ctx: { obstacles, truck?, mass?, fragile?, stats? }
 * Each obstacle is { min, max, mass?, fragile? } in world space.
 */
export function scorePlacement(box, ctx) {
  const {
    obstacles = [],
    truck = DEFAULT_TRUCK,
    mass = 0,
    fragile = false,
    // The search scores thousands of candidates but only ever shows a handful,
    // so callers can skip building the human-readable notes until they know
    // which placements survived.
    explain: wantReasons = true
  } = ctx;
  const stats = ctx.stats ?? loadStats(obstacles);

  const s = dims(box);
  const c = centre(box);
  const boxVolume = s.x * s.y * s.z;
  const footprint = s.x * s.z;

  const contact = computeContact(box, obstacles, truck);
  const support = computeSupport(box, obstacles);

  // ── Geometry ──────────────────────────────────────────────────────────────
  const snugness = -WEIGHTS.contact * contact.ratio;
  const unsupported = WEIGHTS.support * (1 - support.ratio);
  const floorBonus = support.onFloor ? -WEIGHTS.floorBonus : 0;

  // Growth of the whole load's bounding box beyond the carton's own volume.
  // A perfect infill adds nothing; a box dropped in open floor adds a lot.
  let envelope = 0;
  let span = 0;
  if (stats.envelope) {
    const e = stats.envelope;
    const oldV = (e.maxX - e.minX) * (e.maxY - e.minY) * (e.maxZ - e.minZ);
    const newV =
      (Math.max(e.maxX, box.max.x) - Math.min(e.minX, box.min.x)) *
      (Math.max(e.maxY, box.max.y) - Math.min(e.minY, box.min.y)) *
      (Math.max(e.maxZ, box.max.z) - Math.min(e.minZ, box.min.z));
    envelope = WEIGHTS.envelope *
      (Math.max(0, newV - oldV - boxVolume) / Math.max(boxVolume, 1e-6));

    // A trailer is long and narrow: fill across the width (and upward) before
    // extending the load toward the door. Without this the scorer happily laid
    // a single-file row of cartons down 46 ft of an 8.5 ft wide trailer.
    const oldLen = e.maxX - e.minX;
    const newLen = Math.max(e.maxX, box.max.x) - Math.min(e.minX, box.min.x);
    span = WEIGHTS.span * (Math.max(0, newLen - oldLen) / Math.max(s.x, 1e-6));
  }

  // Fill the deep end first, the way a loader walls off from the nose back.
  const halfL = truck.length / 2;
  const fromDoor = NOSE_SIGN > 0 ? (box.min.x + halfL) : (halfL - box.max.x);
  const depth = WEIGHTS.depth * (1 - Math.min(1, fromDoor / truck.length));

  // ── Weight ────────────────────────────────────────────────────────────────
  // Keep mass low in the stack: heavy high up is both unstable and unsafe.
  const comHeight = WEIGHTS.comHeight *
    (mass / HEAVY_MASS) * ((c.y - FLOOR_Y) / truck.height);

  // Never rest a heavy carton on a fragile one; avoid resting heavy on light.
  let crush = 0;
  let fragileUnder = 0;
  for (const sup of support.supporters) {
    const share = sup.area / Math.max(footprint, 1e-6);
    const om = sup.obstacle.mass ?? 0;

    // Scaling these penalties linearly from zero let a heavy carton clip the
    // corner of a fragile one for ~1% of the penalty. Resting *any* real part
    // of a heavy carton on a fragile one is unacceptable, so once contact is
    // more than incidental the penalty jumps to most of its full value.
    if (sup.obstacle.fragile && mass >= HEAVY_MASS && share > 0.01) {
      fragileUnder += Math.max(0.35, Math.min(1, share / 0.25));
    }
    if (om > 0 && mass > om && share > 0.01) {
      const severity = (mass - om) / HEAVY_MASS;
      crush += Math.max(0.3, Math.min(1, share / 0.25)) * severity;
    }
  }
  crush *= WEIGHTS.crush;
  fragileUnder *= WEIGHTS.fragileUnder;

  // Keep the running centre of mass near the trailer centreline.
  const newMass = stats.totalMass + mass;
  const newComZ = newMass > 0
    ? (stats.comZ * stats.totalMass + c.z * mass) / newMass
    : 0;
  const halfW = truck.width / 2;
  const deadband = BALANCE_DEADBAND * halfW;
  const balance = WEIGHTS.balance * Math.min(
    1,
    Math.max(0, Math.abs(newComZ) - deadband) / Math.max(halfW - deadband, 1e-6)
  );

  const terms = {
    snugness, unsupported, floorBonus, envelope, span, depth,
    comHeight, crush, fragileUnder, balance
  };

  let score = 0;
  for (const k in terms) score += terms[k];

  return {
    score,
    terms,
    contactRatio: contact.ratio,
    supportRatio: support.ratio,
    onFloor: support.onFloor,
    restsOnFragile: fragileUnder > 0,
    reasons: wantReasons
      ? explain({ contact, support, terms, mass, fragile })
      : []
  };
}

/**
 * Read a carton's dimensions/mass whether it comes from the box queue
 * (`dimensions` + `physics.mass`) or from the scorer's own shape (`size`).
 */
export function normaliseItem(item) {
  const d = item.size ?? item.dimensions ?? {};
  const size = {
    x: d.x ?? d.width ?? 0,
    y: d.y ?? d.height ?? 0,
    z: d.z ?? d.depth ?? 0
  };
  const mass = item.mass ?? item.physics?.mass ?? estimateMass(size);
  return { size, mass, fragile: item.fragile ?? false };
}

/**
 * Order a queue so the packer has a chance of doing the right thing: heaviest
 * and bulkiest onto the deck first, fragile cartons last so they ride on top.
 *
 * This is the Greedy Volume ordering from the Sprint 2 research, extended with
 * weight. It matters because no scoring function can put a heavy carton on the
 * floor if that carton only arrives after the floor is already full — in a
 * mixed load, arrival order, not the scorer, was what stranded 90 lb cartons
 * near the roof.
 *
 * Returns a new array; the input is not mutated.
 */
export function suggestLoadOrder(items) {
  const volume = (s) => s.x * s.y * s.z;
  return items
    .map((item, index) => ({ item, index, n: normaliseItem(item) }))
    .sort((a, b) => {
      // fragile last
      const af = a.n.fragile ? 1 : 0;
      const bf = b.n.fragile ? 1 : 0;
      if (af !== bf) return af - bf;
      // heaviest first
      if (b.n.mass !== a.n.mass) return b.n.mass - a.n.mass;
      // then bulkiest first
      const av = volume(a.n.size);
      const bv = volume(b.n.size);
      if (bv !== av) return bv - av;
      return a.index - b.index; // stable
    })
    .map(({ item }) => item);
}

/** Short human-readable notes so the UI can say *why* a spot was suggested. */
function explain({ contact, support, terms, mass, fragile }) {
  const out = [];
  if (contact.ratio >= 0.45) out.push('Wedged tightly against surrounding cargo');
  else if (contact.ratio >= 0.25) out.push('Flush with nearby cargo');
  if (support.onFloor) out.push('Rests flat on the deck');
  else if (support.ratio >= 0.95) out.push('Fully supported by the cartons below');
  else if (support.ratio >= 0.5) out.push(`${Math.round(support.ratio * 100)}% supported`);
  if (terms.fragileUnder > 0) out.push('Warning: sits on a fragile carton');
  else if (mass >= HEAVY_MASS && support.onFloor) out.push('Heavy carton kept on the floor');
  if (fragile) out.push('Fragile — keep heavy cartons off this one');
  if (terms.envelope <= 0.01 && support.supporters.length) out.push('Fills existing space without extending the load');
  return out;
}
