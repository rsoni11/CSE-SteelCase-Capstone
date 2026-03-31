import * as THREE from 'three';

// Collision detection system - Yash (US5)
export class CollisionSystem {
  constructor(cargoBoxes = []) {
    this.cargoBoxes = cargoBoxes;
    this.overlapEpsilon = 1e-4;
    // Reused vectors to reduce allocations while dragging.
    this._half = new THREE.Vector3();
    this._aMin = new THREE.Vector3();
    this._aMax = new THREE.Vector3();
    this._bMin = new THREE.Vector3();
    this._bMax = new THREE.Vector3();
  }

  wouldCollide(movingMesh, testPosition, size) {
    for (const other of this.cargoBoxes) {
      if (other.mesh === movingMesh) continue;
      if (this.intersectsAABBs(size, testPosition, other.size, other.mesh.position)) {
        return true;
      }
    }
    return false;
  }

  intersectsAABBs(sizeA, posA, sizeB, posB) {
    const e = this.overlapEpsilon;
    this._half.set(sizeA.x / 2, sizeA.y / 2, sizeA.z / 2);
    this._aMin.copy(posA).sub(this._half);
    this._aMax.copy(posA).add(this._half);

    this._half.set(sizeB.x / 2, sizeB.y / 2, sizeB.z / 2);
    this._bMin.copy(posB).sub(this._half);
    this._bMax.copy(posB).add(this._half);

    return (
      this._aMin.x < this._bMax.x - e &&
      this._aMax.x > this._bMin.x + e &&
      this._aMin.y < this._bMax.y - e &&
      this._aMax.y > this._bMin.y + e &&
      this._aMin.z < this._bMax.z - e &&
      this._aMax.z > this._bMin.z + e
    );
  }
}