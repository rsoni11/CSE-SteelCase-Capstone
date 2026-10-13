/**
 * AI tutor prototype — rule-based coaching layered on the EXISTING heuristic.
 *
 * Nothing here scores a placement itself. Every judgement comes from
 * packingScore.js (scorePlacement, suggestLoadOrder) and fitSearch.js
 * (findBestFits) imported unmodified from the Yash branch; this file only
 * turns their numbers into what a trainee loader should hear:
 *
 *   briefing()           before loading — what is on this plan and what to watch
 *   recommendLoadOrder() the order to bring cartons to the trailer
 *   evaluatePlacement()  after each drop — a grade, what is wrong, a better spot
 *   sessionSummary()     after the load — how the finished trailer measures up
 *
 * buildReferenceLoad() and simulateLearner() exist to test the tutor: one
 * loads a plan the way the heuristic would, the other makes deliberate
 * mistakes so we can see what the tutor says about them.
 */
import {
  FLOOR_Y,
  HEAVY_MASS,
  DEFAULT_TRUCK,
  TIP_SAFE_RATIO,
  makeAABB,
  intersects,
  loadStats,
  scorePlacement,
  suggestLoadOrder,
  restingCentreY,
  withinBounds
} from '../../src/packingScore.js';
import { findBestFits, orientationsFor, isPlacementValid } from '../../src/fitSearch.js';

/**
 * Score gap (learner minus best available) at which a grade is given. Lower
 * score is better, so the gap is how much worse the learner's spot is.
 * PROTOTYPE VALUES — picked by reading sample output, not tuned with users.
 */
export const GRADE_GAPS = { excellent: 3, good: 12, improvable: 30 };

/** A term must be this much worse than in the best spot before we mention it. */
export const NOTE_THRESHOLD = 2;

/**
 * findBestFits stops early when the wall clock runs out, which would make the
 * sandbox's output depend on how busy the machine is. A clock that never
 * advances lets every search run to its sample caps, so runs are repeatable.
 */
const FROZEN_CLOCK = () => 0;

const round = (v, places = 2) => Number(v.toFixed(places));

/** Plan cartons (inches) → the items the heuristic works in (feet). */
export function planToItems(plan) {
  return plan.boxes.map((b) => ({
    id: b.id,
    stop: b.stop,
    description: b.description,
    // Same axis mapping as the app's CSV uploader: Length→x, Height→y, Width→z.
    dimensions: { x: b.lengthIn / 12, y: b.heightIn / 12, z: b.widthIn / 12 },
    mass: b.weightLb,
    fragile: b.fragile
  }));
}

/**
 * Last stop goes on first so it ends up deepest in the nose; within a stop the
 * existing suggestLoadOrder() decides (heavy and bulky first, fragile last).
 */
export function recommendLoadOrder(items) {
  const stops = [...new Set(items.map((i) => i.stop))].sort((a, b) => b - a);
  return stops.flatMap((stop) => suggestLoadOrder(items.filter((i) => i.stop === stop)));
}

const bestFitFor = (item, obstacles, truck) =>
  findBestFits(item.dimensions, obstacles, {
    truck,
    mass: item.mass,
    fragile: item.fragile,
    maxResults: 1,
    now: FROZEN_CLOCK
  }).results[0] ?? null;

const toObstacle = (item, pose) => ({
  ...makeAABB(pose.position, pose.size),
  mass: item.mass,
  fragile: item.fragile,
  id: item.id,
  stop: item.stop
});

/** Where a pose is, in words a loader can act on. */
export function describeSpot(pose, truck = DEFAULT_TRUCK) {
  const box = makeAABB(pose.position, pose.size);
  // Math.max also folds the -0.0 that float error leaves at a wall into 0.0.
  const fromNose = Math.max(0, truck.length / 2 - box.max.x);
  const fromSide = Math.max(0, box.min.z + truck.width / 2);
  const lift = box.min.y - FLOOR_Y;
  const height = lift < 0.01 ? 'on the deck' : `${lift.toFixed(1)} ft up`;
  return `${fromNose.toFixed(1)} ft from the nose, ${fromSide.toFixed(1)} ft from the side wall, ${height}`;
}

// ── Before loading ──────────────────────────────────────────────────────────

export function briefing(plan, items, truck = DEFAULT_TRUCK) {
  const tips = [];
  const stops = [...new Set(items.map((i) => i.stop))].sort((a, b) => a - b);
  const heavy = items.filter((i) => i.mass >= HEAVY_MASS);
  const fragile = items.filter((i) => i.fragile);
  const sizes = new Set(plan.boxes.map((b) => b.typeKey)).size;

  tips.push(
    `${items.length} cartons in ${sizes} different sizes, ${Math.round(plan.totals.weightLb).toLocaleString('en-US')} lb, ` +
    `about ${Math.round(plan.totals.fillRatio * 100)}% of the trailer by volume.`
  );

  if (stops.length > 1) {
    tips.push(
      `${stops.length} stops. Load Stop ${stops[stops.length - 1]} first, against the nose, and finish with ` +
      `Stop 1 at the doors so the first delivery comes off without digging.`
    );
  }

  if (heavy.length) {
    const top = heavy.reduce((a, b) => (b.mass > a.mass ? b : a));
    tips.push(
      `${heavy.length} heavy carton${heavy.length > 1 ? 's' : ''} (${HEAVY_MASS} lb or more); the heaviest is ` +
      `${Math.round(top.mass)} lb (${top.description}). Put these on the deck before anything is stacked.`
    );
  }

  if (fragile.length) {
    tips.push(
      `${fragile.length} fragile carton${fragile.length > 1 ? 's' : ''}. Bring ${fragile.length > 1 ? 'them' : 'it'} last ` +
      `within each stop and keep heavy cartons off ${fragile.length > 1 ? 'them' : 'it'}.`
    );
  }

  const long = items.filter((i) => Math.max(i.dimensions.x, i.dimensions.y, i.dimensions.z) > truck.width);
  if (long.length) {
    tips.push(
      `${long.length} carton${long.length > 1 ? 's are' : ' is'} longer than the trailer is wide ` +
      `(${truck.width} ft) and can only run nose-to-door.`
    );
  }

  const slender = items.filter((i) => {
    const d = [i.dimensions.x, i.dimensions.y, i.dimensions.z].sort((a, b) => a - b);
    return d[2] / d[0] > TIP_SAFE_RATIO * 2;
  });
  if (slender.length) {
    tips.push(
      `${slender.length} long, thin carton${slender.length > 1 ? 's' : ''}. Lay ${slender.length > 1 ? 'them' : 'it'} flat ` +
      `or brace ${slender.length > 1 ? 'them' : 'it'} against a wall; stood on end ${slender.length > 1 ? 'they tip' : 'it tips'} in transit.`
    );
  }

  return tips;
}

// ── After each placement ────────────────────────────────────────────────────

const TERM_NOTES = {
  snugness: () => 'Leaves gaps around it. Slide it tight against a wall or the cartons already loaded.',
  flush: (l) => `Only ${l.flushFaces} face${l.flushFaces === 1 ? '' : 's'} flush. A corner of the load gives three.`,
  unsupported: (l) => `Only ${Math.round(l.supportRatio * 100)}% of its base is supported, so it overhangs.`,
  envelope: () => 'Opens new dead space instead of filling a gap that already exists.',
  span: () => 'Stretches the load toward the doors before the current wall is finished.',
  depth: () => 'Too far from the nose. Build from the nose back toward the doors.',
  comHeight: () => 'Carries weight high in the stack. Keep heavy cartons low.',
  tipping: () => 'Tall for its base in this orientation. Lay it flatter or brace it.',
  crush: () => 'Heavier than the carton it is resting on.',
  fragileUnder: () => 'Sits directly on a fragile carton. Move it.',
  fragileColumn: () => 'Its weight carries down onto a fragile carton further below.',
  balance: () => 'Pulls the load off the trailer centreline.'
};

function gradeFor(gap, learner) {
  if (learner.restsOnFragile) return 'poor';
  if (gap <= GRADE_GAPS.excellent) return 'excellent';
  if (gap <= GRADE_GAPS.good) return 'good';
  if (gap <= GRADE_GAPS.improvable) return 'improvable';
  return 'poor';
}

/**
 * Grade one placement against the best spot the heuristic can find.
 *
 * @param {object} item       from planToItems()
 * @param {{position, size}} pose   world-space centre and extents, feet
 * @param {Array} obstacles   cartons already loaded
 * @param {object} options    { truck, best } — pass `best` if already searched
 */
export function evaluatePlacement(item, pose, obstacles, options = {}) {
  const truck = options.truck ?? DEFAULT_TRUCK;
  const box = makeAABB(pose.position, pose.size);

  if (!isPlacementValid(pose.position, pose.size, obstacles, truck)) {
    let why = 'It is floating or sunk into what is below it. Set it down on the deck or on a carton.';
    if (!withinBounds(pose.position, pose.size, truck)) why = 'Part of it is outside the trailer.';
    else if (obstacles.some((o) => intersects(box, o))) why = 'It overlaps a carton that is already loaded.';
    return { grade: 'invalid', gap: null, score: null, bestScore: null, notes: [why], suggestion: null };
  }

  const ctx = { obstacles, truck, mass: item.mass, fragile: item.fragile, stats: loadStats(obstacles) };
  const learner = scorePlacement(box, ctx);
  const best = options.best ?? bestFitFor(item, obstacles, truck);
  const gap = best ? Math.max(0, learner.score - best.score) : 0;
  const grade = gradeFor(gap, learner);

  const notes = [];
  if (best && grade !== 'excellent') {
    const worse = Object.keys(TERM_NOTES)
      .map((term) => ({ term, delta: learner.terms[term] - best.terms[term] }))
      .filter((t) => t.delta > NOTE_THRESHOLD)
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 3);
    for (const { term } of worse) notes.push(TERM_NOTES[term](learner));
  }

  return {
    grade,
    gap: round(gap),
    score: round(learner.score),
    bestScore: best ? round(best.score) : null,
    restsOnFragile: learner.restsOnFragile,
    loadsFragileBelow: learner.loadsFragileBelow,
    supportRatio: learner.supportRatio,
    contactRatio: learner.contactRatio,
    praise: grade === 'excellent' ? learner.reasons : [],
    notes,
    suggestion: best && grade !== 'excellent'
      ? { spot: describeSpot(best, truck), orientation: best.orientation, reasons: best.reasons }
      : null
  };
}

// ── After the load ──────────────────────────────────────────────────────────

export function sessionSummary(steps, truck = DEFAULT_TRUCK) {
  const placed = steps.filter((s) => s.pose);
  const obstacles = placed.map((s) => toObstacle(s.item, s.pose));
  const stats = loadStats(obstacles);
  const cube = obstacles.reduce((v, o) =>
    v + (o.max.x - o.min.x) * (o.max.y - o.min.y) * (o.max.z - o.min.z), 0);
  const usedLength = stats.envelope ? stats.envelope.maxX - stats.envelope.minX : 0;
  const grades = {};
  for (const s of placed) grades[s.feedback.grade] = (grades[s.feedback.grade] ?? 0) + 1;

  return {
    cartons: steps.length,
    placed: placed.length,
    unplaced: steps.length - placed.length,
    usedLengthFt: round(usedLength, 1),
    // How solid the loaded section is: carton volume ÷ the trailer cross-section
    // over the length actually used.
    packDensity: usedLength > 0 ? round(cube / (usedLength * truck.width * truck.height)) : 0,
    lateralOffsetPct: Math.round((Math.abs(stats.comZ) / (truck.width / 2)) * 100),
    meanSupport: round(placed.reduce((s, p) => s + p.feedback.supportRatio, 0) / Math.max(placed.length, 1)),
    heavyOnFragile: placed.filter((p) => p.feedback.restsOnFragile).length,
    weightOverFragile: placed.filter((p) => p.feedback.loadsFragileBelow).length,
    grades
  };
}

// ── Test drivers ────────────────────────────────────────────────────────────

/** Load the whole plan the way the heuristic recommends. */
export function buildReferenceLoad(items, truck = DEFAULT_TRUCK) {
  const obstacles = [];
  const steps = [];
  for (const item of recommendLoadOrder(items)) {
    const best = bestFitFor(item, obstacles, truck);
    if (!best) { steps.push({ item, pose: null, feedback: null, mistake: false }); continue; }
    const feedback = evaluatePlacement(item, best, obstacles, { truck, best });
    obstacles.push(toObstacle(item, best));
    steps.push({ item, pose: best, feedback, mistake: false, reasons: best.reasons });
  }
  return steps;
}

function randomValidPose(item, obstacles, rng, truck) {
  const orientations = orientationsFor(item.dimensions);
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const size = rng.pick(orientations).size;
    const x = (rng.next() - 0.5) * (truck.length - size.x);
    const z = (rng.next() - 0.5) * (truck.width - size.z);
    const y = restingCentreY(x, z, size, obstacles, truck);
    if (y === null) continue;
    const position = { x, y, z };
    if (isPlacementValid(position, size, obstacles, truck)) return { position, size };
  }
  return null;
}

/**
 * A trainee who follows the recommended order but, `mistakeRate` of the time,
 * sets the carton down somewhere arbitrary (legal, but unconsidered). The
 * tutor grades every step; mistakes stay in the trailer, as they would.
 */
export function simulateLearner(items, rng, options = {}) {
  const truck = options.truck ?? DEFAULT_TRUCK;
  const mistakeRate = options.mistakeRate ?? 0.3;
  const obstacles = [];
  const steps = [];
  for (const item of recommendLoadOrder(items)) {
    const best = bestFitFor(item, obstacles, truck);
    if (!best) { steps.push({ item, pose: null, feedback: null, mistake: false }); continue; }
    const slip = rng.next() < mistakeRate ? randomValidPose(item, obstacles, rng, truck) : null;
    const pose = slip ?? best;
    const feedback = evaluatePlacement(item, pose, obstacles, { truck, best });
    obstacles.push(toObstacle(item, pose));
    steps.push({ item, pose, feedback, mistake: Boolean(slip) });
  }
  return steps;
}
