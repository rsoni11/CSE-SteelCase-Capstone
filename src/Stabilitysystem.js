import * as THREE from 'three';
import { TRUCK_DIMENSIONS } from './constants';

// ── US3 Rhea: Load Stability Validation ───────────────────────────────────────
//
// Terminology used throughout:
//   "support ratio"  – fraction of the box's floor footprint that is rested on
//                      something solid (truck floor OR another box's top face).
//                      Range 0–1.  1 = fully supported, 0 = floating in mid-air.
//
// Thresholds:
//   >= SUPPORT_OK      → stable, no warning
//   >= SUPPORT_WARN    → partially supported → yellow warning, placement allowed
//   <  SUPPORT_WARN    → severely unsupported → red warning, placement BLOCKED

export const SUPPORT_OK   = 0.50;   // 50 % footprint supported → fine
export const SUPPORT_WARN = 0.25;   // 25 – 49 % → caution
// below 25 % → blocked

// How close the bottom of a box must be to a surface to count as "resting on it"
const CONTACT_EPS = 0.12; // feet

export class StabilitySystem {
  /**
   * @param {Array} cargoRegistry  – live array of { mesh, size } entries
   */
  constructor(cargoRegistry) {
    this.cargoRegistry = cargoRegistry;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Evaluate stability for a box at the given position / size.
   * The box whose mesh is `excludeMesh` is ignored (useful when re-checking a
   * box that is already in the registry after it was placed).
   *
   * @returns {{ ratio: number, status: 'ok'|'warn'|'blocked', message: string }}
   */
  evaluate(position, size, excludeMesh = null) {
    const ratio = this._supportRatio(position, size, excludeMesh);

    if (ratio >= SUPPORT_OK) {
      return { ratio, status: 'ok', message: '' };
    }

    if (ratio >= SUPPORT_WARN) {
      const pct = Math.round(ratio * 100);
      return {
        ratio,
        status: 'warn',
        message: `⚠️ Partially supported (${pct}% of footprint). Box may shift in transit.`
      };
    }

    const pct = Math.round(ratio * 100);
    return {
      ratio,
      status: 'blocked',
      message: `🚫 Severely unsupported (${pct}% of footprint). Move closer to a surface before placing.`
    };
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  /**
   * Returns the fraction [0, 1] of the box's XZ footprint that is supported.
   *
   * Algorithm:
   *   1. Check if the box is sitting on the truck floor.
   *   2. For every other box whose top face is within CONTACT_EPS of our bottom,
   *      accumulate the overlapping XZ area.
   *   3. Divide by our total footprint area.
   */
  _supportRatio(pos, size, excludeMesh) {
    const boxBottom = pos.y - size.y / 2;
    const myArea    = size.x * size.z;

    // ── 1. Truck floor ───────────────────────────────────────────────────────
    const floorTop = 0.2; // matches the floor body position in TruckScene
    if (Math.abs(boxBottom - floorTop) <= CONTACT_EPS) {
      // Sitting on the floor → fully supported
      return 1.0;
    }

    // ── 2. Other boxes beneath ───────────────────────────────────────────────
    let supportedArea = 0;

    for (const other of this.cargoRegistry) {
      if (other.mesh === excludeMesh) continue;

      const otherTop = other.mesh.position.y + other.size.y / 2;

      // Is our bottom close to this box's top?
      if (Math.abs(boxBottom - otherTop) > CONTACT_EPS) continue;

      // XZ overlap
      const overlapX = this._overlap1D(
        pos.x, size.x,
        other.mesh.position.x, other.size.x
      );
      const overlapZ = this._overlap1D(
        pos.z, size.z,
        other.mesh.position.z, other.size.z
      );

      if (overlapX > 0 && overlapZ > 0) {
        supportedArea += overlapX * overlapZ;
      }
    }

    return Math.min(supportedArea / myArea, 1.0);
  }

  /** Returns the length of the 1-D overlap between two centred segments. */
  _overlap1D(centerA, sizeA, centerB, sizeB) {
    const minA = centerA - sizeA / 2;
    const maxA = centerA + sizeA / 2;
    const minB = centerB - sizeB / 2;
    const maxB = centerB + sizeB / 2;
    return Math.max(0, Math.min(maxA, maxB) - Math.max(minA, minB));
  }
}