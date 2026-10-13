/**
 * Load-plan generators.
 *
 *   generateSyntheticPlans()  NEW — resamples real handling units from the
 *                             truck information CSV, keeping the cartons that
 *                             actually travelled together on one shipment.
 *   generateRandomPlans()     BASELINE — what the app can produce today: boxes
 *                             drawn at random from the five hard-coded SKUs in
 *                             constants.js (the pool the stress test and the
 *                             Add Box list cycle through).
 *
 * Both return the same plan shape so the diversity metrics and the tutor can
 * treat them identically.
 */
import { BOX_CONFIGS, TRUCK_VOLUME, MAX_BOXES } from '../../src/constants.js';
import { createRng } from './rng.mjs';

export const DEFAULT_OPTIONS = {
  minBoxes: 30,
  maxBoxes: 60,            // the app caps a session at MAX_BOXES (75)
  maxStops: 4,
  maxFillRatio: 0.5,       // share of trailer volume a plan may ask for
  maxPayloadLb: 44000
};

/**
 * The file has no fragile column, so it is inferred from the description.
 * This is an assumption to confirm with Steelcase, not a fact from the data.
 */
export const FRAGILE_PATTERN = /\b(GLASS|MARKERBOARD|WHITEBOARD|MIRROR|CERAMIC|ACRYLIC|LAMP|LIGHT)\b/i;

const PALETTE = ['#FF6B35', '#004E89', '#1AA37A', '#9B59B6', '#E74C3C', '#F39C12', '#2C3E50'];

const round = (v, places = 3) => Number(v.toFixed(places));

/** Orientation-independent identity of a carton size, e.g. "5.75x13x17.5". */
export const typeKeyOf = (l, w, h) => [l, w, h].sort((a, b) => a - b).join('x');

const cubeFt3 = (b) => (b.lengthIn * b.widthIn * b.heightIn) / 1728;

function finishPlan(plan) {
  const colorOf = new Map();
  for (const b of plan.boxes) {
    if (!colorOf.has(b.typeKey)) colorOf.set(b.typeKey, PALETTE[colorOf.size % PALETTE.length]);
    b.color = colorOf.get(b.typeKey);
  }
  plan.totals = {
    boxes: plan.boxes.length,
    distinctTypes: colorOf.size,
    stops: new Set(plan.boxes.map((b) => b.stop)).size,
    cubeFt3: round(plan.boxes.reduce((s, b) => s + cubeFt3(b), 0), 1),
    weightLb: round(plan.boxes.reduce((s, b) => s + b.weightLb, 0), 1)
  };
  plan.totals.fillRatio = round(plan.totals.cubeFt3 / TRUCK_VOLUME, 3);
  return plan;
}

/** Group validated units: shipment → delivery → [units]. */
export function indexShipments(units) {
  const shipments = new Map();
  for (const u of units) {
    if (!shipments.has(u.shipment)) shipments.set(u.shipment, new Map());
    const deliveries = shipments.get(u.shipment);
    if (!deliveries.has(u.delivery)) deliveries.set(u.delivery, []);
    deliveries.get(u.delivery).push(u);
  }
  return shipments;
}

/**
 * NEW generator. Each plan is cut from one real shipment:
 *
 *   1. pick a template shipment that has enough cartons;
 *   2. pick 1–maxStops of its deliveries (weighted by size) as the stops,
 *      adding more deliveries only if those cannot supply enough cartons;
 *   3. draw cartons from those deliveries without replacement until the box
 *      target is met, skipping any that would break the volume or payload cap.
 *
 * Dimensions and weights are never invented or perturbed — every carton in a
 * plan is a real HU, so the size mix is the mix loaders actually see.
 */
export function generateSyntheticPlans(units, count, seed, options = {}) {
  const opt = { ...DEFAULT_OPTIONS, ...options };
  if (opt.maxBoxes > MAX_BOXES) throw new Error(`maxBoxes ${opt.maxBoxes} exceeds the app limit of ${MAX_BOXES}`);

  const shipments = indexShipments(units);
  const templates = [...shipments.entries()]
    .filter(([, deliveries]) => [...deliveries.values()].reduce((n, d) => n + d.length, 0) >= opt.minBoxes)
    .map(([id]) => id)
    .sort();
  if (templates.length === 0) throw new Error(`No shipment has at least ${opt.minBoxes} usable cartons`);

  const maxCube = opt.maxFillRatio * TRUCK_VOLUME;
  const plans = [];

  for (let n = 0; n < count; n += 1) {
    // One seed per plan, so plan 17 is the same whether you ask for 20 or 200.
    const planSeed = (seed + n * 7919) >>> 0;
    const rng = createRng(planSeed);
    let plan = null;

    for (let attempt = 0; attempt < 25 && !plan; attempt += 1) {
      const shipment = rng.pick(templates);
      const deliveries = [...shipments.get(shipment).entries()].sort(([a], [b]) => (a < b ? -1 : 1));
      const target = rng.int(opt.minBoxes, opt.maxBoxes);
      const wantStops = rng.int(1, Math.min(opt.maxStops, deliveries.length));

      const remaining = [...deliveries];
      const chosen = [];
      let pooled = 0;
      while (remaining.length && (chosen.length < wantStops || pooled < target)) {
        const i = rng.weightedIndex(remaining.map(([, list]) => list.length));
        const [picked] = remaining.splice(i, 1);
        chosen.push(picked);
        pooled += picked[1].length;
      }

      const stopOf = new Map(chosen.map(([delivery], i) => [delivery, i + 1]));
      const pool = rng.shuffle(chosen.flatMap(([, list]) => list));
      const boxes = [];
      let cube = 0;
      let weight = 0;
      for (const u of pool) {
        if (boxes.length >= target) break;
        const c = cubeFt3(u);
        if (cube + c > maxCube || weight + u.weightLb > opt.maxPayloadLb) continue;
        cube += c;
        weight += u.weightLb;
        boxes.push({
          id: `b${String(boxes.length + 1).padStart(2, '0')}`,
          hu: u.hu,
          sourceRow: u.row,
          typeKey: typeKeyOf(u.lengthIn, u.widthIn, u.heightIn),
          lengthIn: u.lengthIn,
          widthIn: u.widthIn,
          heightIn: u.heightIn,
          weightLb: u.weightLb,
          stop: stopOf.get(u.delivery),
          delivery: u.delivery,
          description: u.description,
          packType: u.packType,
          fragile: FRAGILE_PATTERN.test(u.description)
        });
      }
      if (boxes.length < opt.minBoxes) continue;

      plan = finishPlan({
        id: `syn-${String(n + 1).padStart(3, '0')}`,
        generator: 'synthetic',
        seed: planSeed,
        templateShipment: shipment,
        boxes
      });
    }

    if (!plan) throw new Error(`Could not build plan ${n + 1} within the volume/payload caps`);
    plans.push(plan);
  }
  return plans;
}

/** BASELINE generator: uniform random draws from the five constants.js SKUs. */
export function generateRandomPlans(count, seed, options = {}) {
  const opt = { ...DEFAULT_OPTIONS, ...options };
  const plans = [];
  for (let n = 0; n < count; n += 1) {
    const planSeed = (seed + n * 7919) >>> 0;
    const rng = createRng(planSeed);
    const target = rng.int(opt.minBoxes, opt.maxBoxes);
    const boxes = [];
    for (let i = 0; i < target; i += 1) {
      const cfg = rng.pick(BOX_CONFIGS);
      // Same inch mapping the app's CSV uploader uses: width↔Length, depth↔Width.
      const lengthIn = round(cfg.dimensions.width * 12);
      const widthIn = round(cfg.dimensions.depth * 12);
      const heightIn = round(cfg.dimensions.height * 12);
      boxes.push({
        id: `b${String(i + 1).padStart(2, '0')}`,
        hu: null,
        sourceRow: null,
        typeKey: typeKeyOf(lengthIn, widthIn, heightIn),
        lengthIn,
        widthIn,
        heightIn,
        weightLb: cfg.physics.mass,
        stop: 1,
        delivery: null,
        description: cfg.label,
        packType: 'PACK',
        fragile: cfg.fragile
      });
    }
    plans.push(finishPlan({
      id: `rnd-${String(n + 1).padStart(3, '0')}`,
      generator: 'random-baseline',
      seed: planSeed,
      templateShipment: null,
      boxes
    }));
  }
  return plans;
}

/**
 * Plan → CSV the app's existing "Drag & Drop your Steelcase CSV" uploader
 * accepts unchanged (Length, Width, Height, # Pieces, Stop, Weight). One row
 * per carton with # Pieces = 1, because the uploader reads # Pieces as a
 * carton count.
 */
export function planToUploaderCsv(plan) {
  const rows = ['Length,Width,Height,# Pieces,Stop,Weight'];
  for (const b of plan.boxes) {
    rows.push([b.lengthIn, b.widthIn, b.heightIn, 1, `Stop ${b.stop}`, b.weightLb].join(','));
  }
  return rows.join('\r\n') + '\r\n';
}
