import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { TRUCK_DIMENSIONS } from './constants';

// Drag controller - Yash (US3)
export class DragController {
  constructor({
    camera,
    domElement,
    truckDimensions,
    cargoRegistry,
    collisionSystem,
    onDragStateChange,
    onPositionChanged
  }) {
    this.camera = camera;
    this.domElement = domElement;
    this.truck = truckDimensions;
    this.cargoRegistry = cargoRegistry;
    this.collisionSystem = collisionSystem;
    this.onDragStateChange = onDragStateChange;
    this.onPositionChanged = onPositionChanged;

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.dragging = false;
    this.selectedEntry = null;
    this.originalPosition = null;

    this.currentY = 0;
    this.manualYOffset = 0;
    this.lastWorldPoint = null;
    this.dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this.highlightMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x4aa3ff,
      emissiveIntensity: 0.8
    });

    this.collisionMaterial = new THREE.MeshStandardMaterial({
      color: 0xff0000,
      emissive: 0xff0000,
      emissiveIntensity: 0.6
    });

    this._onDown = e => this.onDown(e);
    this._onMove = e => this.onMove(e);
    this._onUp = () => this.onUp();
    this._onWheel = e => this.onWheel(e);
    this._onKey = e => this.onKeyDown(e);

    domElement.addEventListener('pointerdown', this._onDown);
    window.addEventListener('pointermove', this._onMove);
    window.addEventListener('pointerup', this._onUp);
    domElement.addEventListener('wheel', this._onWheel, { passive: false });
    window.addEventListener('keydown', this._onKey);
  }

  setMouse(e) {
    const rect = this.domElement.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  getMeshes() {
    return this.cargoRegistry.map(e => e.mesh);
  }

  findEntryFromHitObject(hitObject) {
    let current = hitObject;
    while (current) {
      const entry = this.cargoRegistry.find((e) => e.mesh === current);
      if (entry) return entry;
      current = current.parent;
    }
    return null;
  }

  clampY(y) {
    const size = this.selectedEntry?.size || { y: 0 };
    const minY = 0.1 + size.y / 2;
    const maxY = TRUCK_DIMENSIONS.height - size.y / 2;
    return Math.round(THREE.MathUtils.clamp(y, minY, maxY) / 0.05) * 0.05;
  }

  clampToTruck(point, size) {
    const halfL = TRUCK_DIMENSIONS.length / 2;
    const halfW = TRUCK_DIMENSIONS.width / 2;

    point.x = THREE.MathUtils.clamp(
      point.x,
      -halfL + size.x / 2,
      halfL - size.x / 2
    );

    point.z = THREE.MathUtils.clamp(
      point.z,
      -halfW + size.z / 2,
      halfW - size.z / 2
    );

    return point;
  }

  syncBodyWithMesh(entry) {
    if (!entry?.body) return;
    entry.body.position.set(
      entry.mesh.position.x,
      entry.mesh.position.y,
      entry.mesh.position.z
    );
    entry.body.quaternion.set(
      entry.mesh.quaternion.x,
      entry.mesh.quaternion.y,
      entry.mesh.quaternion.z,
      entry.mesh.quaternion.w
    );
    entry.body.velocity.set(0, 0, 0);
    entry.body.angularVelocity.set(0, 0, 0);
    entry.body.wakeUp();
  }

  setDraggedBodyMode(entry, dragging) {
    if (!entry?.body) return;
    const { body } = entry;
    body.velocity.set(0, 0, 0);
    body.angularVelocity.set(0, 0, 0);
    body.type = dragging ? CANNON.Body.KINEMATIC : CANNON.Body.DYNAMIC;
    body.updateMassProperties();
    body.wakeUp();
  }

  computeBaseStackY(x, z) {
    if (!this.selectedEntry) return 0;

    const footprintEpsilon = 0.001;
    let baseY = this.selectedEntry.size.y / 2;

    for (const other of this.cargoRegistry) {
      if (other.mesh === this.selectedEntry.mesh) continue;

      const dx = Math.abs(x - other.mesh.position.x);
      const dz = Math.abs(z - other.mesh.position.z);

      const overlapX =
        dx < this.selectedEntry.size.x / 2 + other.size.x / 2 - footprintEpsilon;
      const overlapZ =
        dz < this.selectedEntry.size.z / 2 + other.size.z / 2 - footprintEpsilon;

      if (overlapX && overlapZ) {
        const otherTop = other.mesh.position.y + other.size.y / 2;
        const candidateY = otherTop + this.selectedEntry.size.y / 2;
        if (candidateY > baseY) baseY = candidateY;
      }
    }

    return baseY;
  }

  onDown(e) {
    this.setMouse(e);
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const hits = this.raycaster.intersectObjects(this.getMeshes(), true);
    if (!hits.length) return;

    let entry = null;
    for (const hit of hits) {
      entry = this.findEntryFromHitObject(hit.object);
      if (entry) break;
    }
    if (!entry) return;

    this.selectedEntry = entry;
    this.originalPosition = entry.mesh.position.clone();
    this.currentY = entry.mesh.position.y;
    this.manualYOffset = 0;
    this.lastWorldPoint = entry.mesh.position.clone();
    this.dragPlane.constant = -this.currentY;
    entry.mesh.material = this.highlightMaterial;
    this.setDraggedBodyMode(entry, true);
    this.syncBodyWithMesh(entry);
    this.dragging = true;

    if (this.onDragStateChange) {
      this.onDragStateChange(true);
    }
  }

  onMove(e) {
    if (!this.dragging || !this.selectedEntry) return;

    this.setMouse(e);
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const point = new THREE.Vector3();
    const hitPlane = this.raycaster.ray.intersectPlane(this.dragPlane, point);
    if (!hitPlane) {
      if (!this.lastWorldPoint) return;
      point.copy(this.lastWorldPoint);
    }

    point.x = Math.round(point.x / 0.05) * 0.05;
    point.z = Math.round(point.z / 0.05) * 0.05;

    this.clampToTruck(point, this.selectedEntry.size);

    const baseY = this.computeBaseStackY(point.x, point.z);
    point.y = this.clampY(baseY + this.manualYOffset);

    const collides = this.collisionSystem.wouldCollide(
      this.selectedEntry.mesh,
      point,
      this.selectedEntry.size
    );

    this.selectedEntry.mesh.material = collides
      ? this.collisionMaterial
      : this.highlightMaterial;

    if (!collides) {
      this.selectedEntry.mesh.position.copy(point);
      this.currentY = point.y;
      this.dragPlane.constant = -this.currentY;
      this.lastWorldPoint = point.clone();
      this.syncBodyWithMesh(this.selectedEntry);
    }
  }

  adjustHeight(delta) {
    if (!this.dragging || !this.selectedEntry) return;

    const pos = this.selectedEntry.mesh.position.clone();
    const baseY = this.computeBaseStackY(pos.x, pos.z);
    const nextY = this.clampY(this.currentY + delta);
    this.manualYOffset = nextY - baseY;
    pos.y = this.clampY(baseY + this.manualYOffset);

    const collides = this.collisionSystem.wouldCollide(
      this.selectedEntry.mesh,
      pos,
      this.selectedEntry.size
    );

    this.selectedEntry.mesh.material = collides
      ? this.collisionMaterial
      : this.highlightMaterial;

    if (!collides) {
      this.selectedEntry.mesh.position.y = pos.y;
      this.currentY = pos.y;
      this.dragPlane.constant = -this.currentY;
      this.syncBodyWithMesh(this.selectedEntry);
    }
  }

  rotateSelected() {
    if (!this.dragging || !this.selectedEntry) return;

    const mesh = this.selectedEntry.mesh;
    const original = mesh.quaternion.clone();
    mesh.rotation.y += Math.PI / 2;

    const pos = mesh.position.clone();
    const collides = this.collisionSystem.wouldCollide(
      mesh,
      pos,
      this.selectedEntry.size
    );

    if (collides) {
      mesh.quaternion.copy(original);
      mesh.material = this.collisionMaterial;
      return;
    }

    mesh.material = this.highlightMaterial;
    this.syncBodyWithMesh(this.selectedEntry);
  }

  onWheel(e) {
    if (!this.dragging || !this.selectedEntry) return;
    e.preventDefault();
    e.stopPropagation();
    this.adjustHeight(e.deltaY > 0 ? -0.3 : 0.3);
  }

  onKeyDown(e) {
    if (!this.dragging || !this.selectedEntry) return;

    if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') {
      e.preventDefault();
      this.adjustHeight(0.5);
    } else if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') {
      e.preventDefault();
      this.adjustHeight(-0.5);
    } else if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      this.rotateSelected();
    }
  }

  onUp() {
    if (!this.dragging || !this.selectedEntry) return;

    this.selectedEntry.mesh.material = this.selectedEntry.baseMaterial;
    this.setDraggedBodyMode(this.selectedEntry, false);
    this.syncBodyWithMesh(this.selectedEntry);

    if (this.onPositionChanged && this.originalPosition) {
      const newPos = this.selectedEntry.mesh.position.clone();
      if (!this.originalPosition.equals(newPos)) {
        this.onPositionChanged(
          this.selectedEntry.mesh,
          this.originalPosition,
          newPos
        );
      }
    }

    this.dragging = false;
    this.selectedEntry = null;
    this.originalPosition = null;
    this.manualYOffset = 0;
    this.lastWorldPoint = null;

    if (this.onDragStateChange) {
      this.onDragStateChange(false);
    }
  }

  clearRegistry() {
    this.dragging = false;
    this.selectedEntry = null;
    this.originalPosition = null;
    this.manualYOffset = 0;
    this.lastWorldPoint = null;
  }

  destroy() {
    this.domElement.removeEventListener('pointerdown', this._onDown);
    window.removeEventListener('pointermove', this._onMove);
    window.removeEventListener('pointerup', this._onUp);
    this.domElement.removeEventListener('wheel', this._onWheel);
    window.removeEventListener('keydown', this._onKey);
  }
}