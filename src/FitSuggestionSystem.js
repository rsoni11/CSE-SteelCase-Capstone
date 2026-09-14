import * as THREE from 'three';

import { TRUCK_DIMENSIONS } from './constants';
import { estimateMass, makeAABB } from './packingScore';
import {
  findBestFits,
  isPlacementValid,
  orientationsFor,
  TIME_BUDGET_MS
} from './fitSearch';

/**
 * "AI Best Fit" — the engine behind the ghost preview and Snap Last Box.
 *
 * ── What changed, and why ────────────────────────────────────────────────────
 *
 * US1: the old findBestFit() walked a flat 0.5 ft grid over all 53 ft of deck
 * and took the first non-colliding cell in each column. That was slow, it could
 * only ever place a carton where the grid happened to fall (so "flush against
 * that pallet" was unreachable unless the pallet sat on a 0.5 ft boundary), and
 * its scorer knew nothing about weight. Sampling is now adaptive — exact
 * contact positions first, then a step that is fine near cargo and coarse over
 * open deck — and scoring is delegated to packingScore.js, which penalises
 * heavy-on-fragile and rewards flush faces.
 *
 * US2: findBestFit() no longer takes the loader's current rotation as given. It
 * scores every axis-aligned orientation of the carton independently and returns
 * the winning one alongside the position, so the ghost previews the pose that
 * actually fits and snapping applies it.
 *
 * The search itself lives in fitSearch.js, which is free of THREE imports so it
 * can be unit-tested under `npm test`. This class is the part that knows about
 * the live cargo registry and hands back THREE types.
 */
export class FitSuggestionSystem {
  /**
   * @param {Array} cargoRegistry live registry entries — { mesh, size, physics, fragile }
   * @param {object} truck        trailer dimensions, for tests that want a small one
   */
  constructor(cargoRegistry, truck = TRUCK_DIMENSIONS) {
    this.cargoRegistry = cargoRegistry;
    this.truck = truck;
    /** Diagnostics from the most recent search — timing, candidate count. */
    this.lastSearch = null;
  }

  /**
   * The single tightest placement, or null if the carton does not fit.
   *
   * @param {object} size    { x, y, z } or { width, height, depth }, in feet
   * @param {object} options { mass, fragile, exclude, timeBudgetMs }
   * @returns {?{position: THREE.Vector3, size: object, quaternion: THREE.Quaternion,
   *            euler: number[], orientation: string, score: number, reasons: string[]}}
   */
  findBestFit(size, options = {}) {
    return this.findBestFits(size, 1, options)[0] ?? null;
  }

  /**
   * The `count` tightest placements, best first and spatially distinct.
   * Same result shape as findBestFit().
   */
  findBestFits(size, count = 3, options = {}) {
    const dimensions = normaliseSize(size);
    if (!dimensions) {
      this.lastSearch = emptyDiagnostics();
      return [];
    }

    const obstacles = this.obstacles(options.exclude);
    const search = findBestFits(dimensions, obstacles, {
      truck: this.truck,
      mass: options.mass ?? estimateMass(dimensions),
      fragile: options.fragile ?? false,
      maxResults: count,
      timeBudgetMs: options.timeBudgetMs ?? TIME_BUDGET_MS
    });

    this.lastSearch = {
      elapsedMs: search.elapsedMs,
      timedOut: search.timedOut,
      evaluated: search.evaluated,
      orientationsTried: search.orientationsTried,
      orientationsAvailable: orientationsFor(dimensions).length
    };

    return search.results.map(toThreeResult);
  }

  /**
   * Is a placement we handed out earlier still legal against the registry as it
   * stands now?
   *
   * The physics world keeps settling after a suggestion is drawn, so the spot
   * under the ghost can stop being free. Snapping re-checks with this rather
   * than blindly re-solving, because re-solving could quietly move the carton
   * somewhere other than the ghost the loader is looking at.
   */
  isStillValid(result, exclude = []) {
    if (!result?.position || !result?.size) return false;
    return isPlacementValid(
      { x: result.position.x, y: result.position.y, z: result.position.z },
      result.size,
      this.obstacles(exclude),
      this.truck
    );
  }

  /**
   * Registry entries → plain obstacles carrying the mass/fragility the scorer
   * needs.
   *
   * `entry.size` is already the WORLD-axis-aligned extent, not local dimensions
   * — that is the convention the rest of the app uses (CollisionSystem builds
   * its AABB straight from `size` + position, and DragController swaps
   * `size.x`/`size.z` when it turns a carton 90°). Transforming it by the mesh
   * matrix would apply the rotation a second time and produce badly wrong
   * bounds for any turned carton.
   *
   * `exclude` leaves entries out — used for the carton we are about to move, so
   * it does not have to find a spot that avoids where it is currently sitting.
   */
  obstacles(exclude = []) {
    const skip = new Set(exclude ?? []);
    const out = [];
    for (const entry of this.cargoRegistry ?? []) {
      if (skip.has(entry)) continue;
      const p = entry.mesh.position;
      const s = entry.size;
      out.push({
        ...makeAABB({ x: p.x, y: p.y, z: p.z }, s),
        mass: entry.physics?.mass ?? estimateMass(s),
        fragile: entry.fragile ?? false,
        entry
      });
    }
    return out;
  }
}

/** Accepts the scorer's { x, y, z } or the box configs' { width, height, depth }. */
function normaliseSize(size) {
  if (!size) return null;
  const out = {
    x: size.x ?? size.width,
    y: size.y ?? size.height,
    z: size.z ?? size.depth
  };
  if (!(out.x > 0) || !(out.y > 0) || !(out.z > 0)) return null;
  return out;
}

/** Plain search result → THREE types the scene can consume directly. */
function toThreeResult(r) {
  return {
    ...r,
    position: new THREE.Vector3(r.position.x, r.position.y, r.position.z),
    quaternion: new THREE.Quaternion().setFromEuler(
      new THREE.Euler(r.euler[0], r.euler[1], r.euler[2])
    )
  };
}

const emptyDiagnostics = () => ({
  elapsedMs: 0,
  timedOut: false,
  evaluated: 0,
  orientationsTried: 0,
  orientationsAvailable: 0
});
