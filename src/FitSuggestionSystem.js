import * as THREE from 'three';
import { TRUCK_DIMENSIONS } from './constants';

const STEP = 0.5;

export class FitSuggestionSystem {
  constructor(cargoRegistry) {
    this.cargoRegistry = cargoRegistry;
  }

  findBestFit(size) {
    const { length, width, height } = TRUCK_DIMENSIONS;
    const halfL = length / 2;
    const halfW = width / 2;

    const minX = -halfL + size.x / 2;
    const maxX =  halfL - size.x / 2;
    const minZ = -halfW + size.z / 2;
    const maxZ =  halfW - size.z / 2;
    const minY = size.y / 2 + 0.1;
    const maxY = height - size.y / 2;

    let bestPos   = null;
    let bestScore = Infinity;

    for (let x = minX; x <= maxX + 0.01; x = Math.round((x + STEP) * 100) / 100) {
      for (let z = minZ; z <= maxZ + 0.01; z = Math.round((z + STEP) * 100) / 100) {
        for (let y = minY; y <= maxY + 0.01; y = Math.round((y + STEP) * 100) / 100) {
          const candidate = new THREE.Vector3(x, y, z);
          if (!this._collides(candidate, size)) {
            const score = this._score(candidate, size);
            if (score < bestScore) {
              bestScore = score;
              bestPos   = candidate.clone();
            }
            break;
          }
        }
      }
    }

    return bestPos;
  }

  _collides(pos, size) {
    const half = new THREE.Vector3(size.x / 2, size.y / 2, size.z / 2);
    const aMin = pos.clone().sub(half);
    const aMax = pos.clone().add(half);

    for (const other of this.cargoRegistry) {
      const op    = other.mesh.position;
      const os    = other.size;
      const oHalf = new THREE.Vector3(os.x / 2, os.y / 2, os.z / 2);
      const bMin  = op.clone().sub(oHalf);
      const bMax  = op.clone().add(oHalf);

      const overlaps =
        aMin.x < bMax.x && aMax.x > bMin.x &&
        aMin.y < bMax.y && aMax.y > bMin.y &&
        aMin.z < bMax.z && aMax.z > bMin.z;

      if (overlaps) return true;
    }
    return false;
  }

  _score(pos, size) {
    const { length, width } = TRUCK_DIMENSIONS;
    const halfL = length / 2;
    const halfW = width / 2;

    const distFront  = (halfL - size.x / 2) - pos.x;
    const distBack   = pos.x + halfL - size.x / 2;
    const distLeft   = (halfW - size.z / 2) - pos.z;
    const distRight  = pos.z + halfW - size.z / 2;
    const distBottom = pos.y - size.y / 2 - 0.2;

    let minGapX = Math.min(distFront, distBack);
    let minGapZ = Math.min(distLeft, distRight);
    let minGapY = distBottom;

    for (const other of this.cargoRegistry) {
      const op = other.mesh.position;
      const os = other.size;

      const gapRight = pos.x - size.x / 2 - (op.x + os.x / 2);
      const gapLeft  = (op.x - os.x / 2) - (pos.x + size.x / 2);
      if (gapRight >= 0) minGapX = Math.min(minGapX, gapRight);
      if (gapLeft  >= 0) minGapX = Math.min(minGapX, gapLeft);

      const gapFwd  = pos.z - size.z / 2 - (op.z + os.z / 2);
      const gapBack = (op.z - os.z / 2) - (pos.z + size.z / 2);
      if (gapFwd  >= 0) minGapZ = Math.min(minGapZ, gapFwd);
      if (gapBack >= 0) minGapZ = Math.min(minGapZ, gapBack);

      const gapAbove = pos.y - size.y / 2 - (op.y + os.y / 2);
      if (gapAbove >= 0) minGapY = Math.min(minGapY, gapAbove);
    }

    return minGapX + minGapZ + minGapY * 3 + pos.y * 2;
  }
}