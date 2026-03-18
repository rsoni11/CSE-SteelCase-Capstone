import * as THREE from 'three';
import { TRUCK_DIMENSIONS } from './constants';

// Drag controller - Yash (US3)
export class DragController {
  constructor({ camera, domElement, truckDimensions, cargoRegistry, collisionSystem, onDragStateChange, onPositionChanged }) {
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

    this.currentY = 0;
    this.dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this.highlightMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0x4aa3ff, emissiveIntensity: 0.8
    });
    this.collisionMaterial = new THREE.MeshStandardMaterial({
      color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 0.6
    });

    this._onDown  = e => this.onDown(e);
    this._onMove  = e => this.onMove(e);
    this._onUp    = () => this.onUp();
    this._onWheel = e => this.onWheel(e);
    this._onKey   = e => this.onKeyDown(e);

    domElement.addEventListener('pointerdown', this._onDown);
    window.addEventListener('pointermove',     this._onMove);
    window.addEventListener('pointerup',       this._onUp);
    domElement.addEventListener('wheel',       this._onWheel, { passive: false });
    window.addEventListener('keydown',         this._onKey);
  }

  setMouse(e) {
    const rect = this.domElement.getBoundingClientRect();
    this.mouse.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
  }

  getMeshes() { return this.cargoRegistry.map(e => e.mesh); }

  clampY(y) {
    const size = this.selectedEntry?.size || { y: 0 };
    const minY = 0.1 + size.y / 2;
    const maxY = TRUCK_DIMENSIONS.height - size.y / 2;
    return Math.round(THREE.MathUtils.clamp(y, minY, maxY) / 0.1) * 0.1;
  }

  clampToTruck(point, size) {
    const halfL = TRUCK_DIMENSIONS.length / 2;
    const halfW = TRUCK_DIMENSIONS.width / 2;
    point.x = THREE.MathUtils.clamp(point.x, -halfL + size.x / 2, halfL - size.x / 2);
    point.z = THREE.MathUtils.clamp(point.z, -halfW + size.z / 2, halfW - size.z / 2);
    return point;
  }

  onDown(e) {
    this.setMouse(e);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.raycaster.intersectObjects(this.getMeshes(), false);
    if (hits.length) {
      this.selectedEntry = this.cargoRegistry.find(en => en.mesh === hits[0].object);
      if (!this.selectedEntry) return;
      this.originalPosition = this.selectedEntry.mesh.position.clone();
      this.currentY = this.selectedEntry.mesh.position.y;
      this.dragPlane.constant = -this.currentY;
      this.selectedEntry.mesh.material = this.highlightMaterial;
      this.dragging = true;
      this.onDragStateChange(true);
    }
  }

  onMove(e) {
    if (!this.dragging || !this.selectedEntry) return;
    this.setMouse(e);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const point = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(this.dragPlane, point);
    point.y = this.currentY;
    point.x = Math.round(point.x / 0.05) * 0.05;
    point.z = Math.round(point.z / 0.05) * 0.05;
    this.clampToTruck(point, this.selectedEntry.size);
    const collides = this.collisionSystem.wouldCollide(
      this.selectedEntry.mesh, point, this.selectedEntry.size
    );
    this.selectedEntry.mesh.material = collides ? this.collisionMaterial : this.highlightMaterial;
    if (!collides) this.selectedEntry.mesh.position.copy(point);
  }

  adjustHeight(delta) {
    if (!this.dragging || !this.selectedEntry) return;
    this.currentY = this.clampY(this.currentY + delta);
    this.dragPlane.constant = -this.currentY;
    const pos = this.selectedEntry.mesh.position.clone();
    pos.y = this.currentY;
    const collides = this.collisionSystem.wouldCollide(
      this.selectedEntry.mesh, pos, this.selectedEntry.size
    );
    this.selectedEntry.mesh.material = collides ? this.collisionMaterial : this.highlightMaterial;
    if (!collides) this.selectedEntry.mesh.position.y = this.currentY;
  }

  onWheel(e) {
    if (!this.dragging || !this.selectedEntry) return;
    e.preventDefault();
    e.stopPropagation();
    this.adjustHeight(e.deltaY > 0 ? -0.3 : 0.3);
  }

  // W/ArrowUp = raise, S/ArrowDown = lower
  onKeyDown(e) {
    if (!this.dragging || !this.selectedEntry) return;
    if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') {
      e.preventDefault(); this.adjustHeight(0.5);
    } else if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') {
      e.preventDefault(); this.adjustHeight(-0.5);
    }
  }

  onUp() {
    if (!this.dragging || !this.selectedEntry) return;
    this.selectedEntry.mesh.material = this.selectedEntry.baseMaterial;
    if (this.onPositionChanged && this.originalPosition) {
      const newPos = this.selectedEntry.mesh.position.clone();
      if (!this.originalPosition.equals(newPos)) {
        this.onPositionChanged(this.selectedEntry.mesh, this.originalPosition, newPos);
      }
    }
    this.dragging = false;
    this.selectedEntry = null;
    this.originalPosition = null;
    this.onDragStateChange(false);
  }

  clearRegistry() {
    this.dragging = false;
    this.selectedEntry = null;
  }

  destroy() {
    this.domElement.removeEventListener('pointerdown', this._onDown);
    window.removeEventListener('pointermove',          this._onMove);
    window.removeEventListener('pointerup',            this._onUp);
    this.domElement.removeEventListener('wheel',       this._onWheel);
    window.removeEventListener('keydown',              this._onKey);
  }
}
