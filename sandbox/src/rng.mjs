/**
 * Seeded random numbers, so every generated plan can be reproduced from the
 * seed printed in its file. Math.random() cannot be seeded.
 */
export function createRng(seed) {
  let a = seed >>> 0;
  // mulberry32
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = (list) => list[Math.floor(next() * list.length)];
  const shuffle = (list) => {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  /** Index drawn in proportion to `weights`. */
  const weightedIndex = (weights) => {
    const total = weights.reduce((s, w) => s + w, 0);
    let r = next() * total;
    for (let i = 0; i < weights.length; i += 1) {
      r -= weights[i];
      if (r < 0) return i;
    }
    return weights.length - 1;
  };

  return { next, int, pick, shuffle, weightedIndex };
}
