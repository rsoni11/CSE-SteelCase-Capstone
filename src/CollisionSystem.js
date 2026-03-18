import * as THREE from 'three';

// Collision detection system - Yash (US5)
export class CollisionSystem {
  constructor(cargoBoxes = []) {
    this.cargoBoxes = cargoBoxes;
  }

  wouldCollide(movingMesh, testPosition, size) {
    const a = this.createAABB(size, testPosition);
    for (const other of this.cargoBoxes) {
      if (other.mesh === movingMesh) continue;
      const b = this.createAABB(other.size, other.mesh.position);
      if (this.intersects(a, b)) return true;
    }
    return false;
  }

  createAABB(size, pos) {
    const half = new THREE.Vector3(size.x / 2, size.y / 2, size.z / 2);
    return {
      min: pos.clone().sub(half),
      max: pos.clone().add(half)
    };
  }

  intersects(a, b) {
    return (
      a.min.x <= b.max.x && a.max.x >= b.min.x &&
      a.min.y <= b.max.y && a.max.y >= b.min.y &&
      a.min.z <= b.max.z && a.max.z >= b.min.z
    );
  }
}
