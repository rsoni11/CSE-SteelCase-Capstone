/**
 * Box-combination diversity — numbers to put next to the eyeball comparison,
 * not a replacement for it.
 *
 * A "type" is a carton size regardless of how it is turned (typeKey).
 */

const round = (v, places = 2) => Number(v.toFixed(places));

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Quantity of each carton type in a plan, largest group first. */
export function typeCounts(plan) {
  const counts = new Map();
  for (const b of plan.boxes) counts.set(b.typeKey, (counts.get(b.typeKey) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}

export function planDiversity(plan) {
  const counts = typeCounts(plan);
  const n = plan.boxes.length;

  // Shannon entropy of the type mix. 2^H is the "effective number of types":
  // a plan of 40 boxes split evenly over 4 sizes scores 4; one dominated by a
  // single size scores close to 1 however many stray sizes ride along.
  let entropy = 0;
  for (const [, c] of counts) entropy -= (c / n) * Math.log2(c / n);

  const edges = plan.boxes.flatMap((b) => [b.lengthIn, b.widthIn, b.heightIn]);
  const cubes = plan.boxes.map((b) => (b.lengthIn * b.widthIn * b.heightIn) / 1728);
  const weights = plan.boxes.map((b) => b.weightLb);

  return {
    planId: plan.id,
    boxes: n,
    distinctTypes: counts.length,
    effectiveTypes: round(2 ** entropy),
    largestGroupShare: round(counts[0][1] / n),
    stops: plan.totals.stops,
    fragileBoxes: plan.boxes.filter((b) => b.fragile).length,
    minEdgeIn: Math.min(...edges),
    maxEdgeIn: Math.max(...edges),
    minCubeFt3: round(Math.min(...cubes), 3),
    maxCubeFt3: round(Math.max(...cubes), 3),
    minWeightLb: round(Math.min(...weights), 1),
    maxWeightLb: round(Math.max(...weights), 1),
    fillRatio: plan.totals.fillRatio
  };
}

export function setDiversity(plans) {
  const perPlan = plans.map(planDiversity);
  const typeSets = plans.map((p) => new Set(p.boxes.map((b) => b.typeKey)));
  const allTypes = new Set(typeSets.flatMap((s) => [...s]));

  // Mean pairwise Jaccard similarity of the type sets: 1 = every plan uses the
  // same sizes, 0 = no two plans share a size.
  let pairs = 0;
  let jaccard = 0;
  for (let i = 0; i < typeSets.length; i += 1) {
    for (let j = i + 1; j < typeSets.length; j += 1) {
      let shared = 0;
      for (const t of typeSets[i]) if (typeSets[j].has(t)) shared += 1;
      jaccard += shared / (typeSets[i].size + typeSets[j].size - shared);
      pairs += 1;
    }
  }

  const combos = new Set(typeSets.map((s) => [...s].sort().join('|')));
  const col = (k) => perPlan.map((p) => p[k]);

  return {
    perPlan,
    summary: {
      plans: plans.length,
      distinctTypesAcrossSet: allTypes.size,
      distinctTypeCombinations: combos.size,
      meanPairwiseJaccard: pairs ? round(jaccard / pairs, 3) : 0,
      medianBoxes: median(col('boxes')),
      medianDistinctTypes: median(col('distinctTypes')),
      minDistinctTypes: Math.min(...col('distinctTypes')),
      maxDistinctTypes: Math.max(...col('distinctTypes')),
      meanEffectiveTypes: round(mean(col('effectiveTypes'))),
      meanLargestGroupShare: round(mean(col('largestGroupShare'))),
      medianStops: median(col('stops')),
      plansWithFragile: perPlan.filter((p) => p.fragileBoxes > 0).length,
      smallestEdgeIn: Math.min(...col('minEdgeIn')),
      largestEdgeIn: Math.max(...col('maxEdgeIn')),
      lightestLb: Math.min(...col('minWeightLb')),
      heaviestLb: Math.max(...col('maxWeightLb')),
      medianFillRatio: round(median(col('fillRatio')), 3)
    }
  };
}
