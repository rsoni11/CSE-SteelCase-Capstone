import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { TRUCK_DIMENSIONS } from './constants';

// ── US6 Rhea: Box Grouping & Bulk Movement ────────────────────────────────────
//
// Usage contract (called from TruckLoadingPrototype):
//
//   const gc = new GroupSelectionController({ scene, camera, domElement,
//                 cargoRegistry, collisionSystem, onGroupChanged });
//
//   // Wire pointer events AFTER DragController so we get shift-clicks:
//   gc.attach();
//
//   // Each frame / on drag end, sync physics bodies:
//   gc.syncBodies();
//
//   gc.destroy();   // cleanup on unmount

const HIGHLIGHT_COLOR  = 0x667eea;   // purple-blue tint for selected boxes
const HIGHLIGHT_EMISSIVE_INTENSITY = 0.45;

export class GroupSelectionController {
  /**
   * @param {{
   *   scene: THREE.Scene,
   *   camera: THREE.Camera,
   *   domElement: HTMLElement,
   *   cargoRegistry: Array,
   *   collisionSystem: import('./CollisionSystem').CollisionSystem,
   *   onGroupChanged: (selectedIds: string[]) => void
   * }} opts
   */
  constructor({ scene, camera, domElement, cargoRegistry, collisionSystem, onGroupChanged }) {
    this.scene           = scene;
    this.camera          = camera;
    this.domElement      = domElement;
    this.cargoRegistry   = cargoRegistry;
    this.collisionSystem = collisionSystem;
    this.onGroupChanged  = onGroupChanged ?? (() => {});

    // Set of entry ids currently in the selection group
    this.selectedIds = new Set();

    // Per-entry saved base-material so we can restore on deselect
    this._savedMaterials = new Map(); // entry.id → original material

    // Group drag state
    this._dragging        = false;
    this._dragStartMouse  = new THREE.Vector2();
    this._dragLastWorld   = null;
    this._dragPlane       = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._dragOffsets     = new Map(); // entry.id → THREE.Vector3 offset from drag anchor

    this.raycaster = new THREE.Raycaster();
    this.mouse     = new THREE.Vector2();

    // Highlight material (shared, disposed on destroy)
    this._highlightMat = new THREE.MeshStandardMaterial({
      color:             HIGHLIGHT_COLOR,
      emissive:          new THREE.Color(HIGHLIGHT_COLOR),
      emissiveIntensity: HIGHLIGHT_EMISSIVE_INTENSITY,
      roughness:         0.4,
      metalness:         0.1,
    });

    this._collisionMat = new THREE.MeshStandardMaterial({
      color:             0xff4444,
      emissive:          new THREE.Color(0xff0000),
      emissiveIntensity: 0.6,
    });

    // Bound handlers
    this._onPointerDown = this._handlePointerDown.bind(this);
    this._onPointerMove = this._handlePointerMove.bind(this);
    this._onPointerUp   = this._handlePointerUp.bind(this);
    this._onKeyDown     = this._handleKeyDown.bind(this);
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  attach() {
    this.domElement.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove',          this._onPointerMove);
    window.addEventListener('pointerup',            this._onPointerUp);
    window.addEventListener('keydown',              this._onKeyDown);
  }

  destroy() {
    this.domElement.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointermove',          this._onPointerMove);
    window.removeEventListener('pointerup',            this._onPointerUp);
    window.removeEventListener('keydown',              this._onKeyDown);
    this._highlightMat.dispose();
    this._collisionMat.dispose();
    this.clearSelection();
  }

  // ── Selection API ───────────────────────────────────────────────────────────

  clearSelection() {
    for (const id of this.selectedIds) {
      this._restoreMaterial(id);
    }
    this.selectedIds.clear();
    this._savedMaterials.clear();
    this.onGroupChanged([]);
  }

  /** Returns true if there are 2+ boxes selected (i.e. a real group). */
  get hasGroup() {
    return this.selectedIds.size >= 2;
  }

  /** Returns all selected registry entries. */
  get selectedEntries() {
    return this.cargoRegistry.filter(e => this.selectedIds.has(e.id));
  }

  // ── Pointer handlers ────────────────────────────────────────────────────────

  _setMouse(e) {
    const rect = this.domElement.getBoundingClientRect();
    this.mouse.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
  }

  _handlePointerDown(e) {
    // Only act on shift-click to avoid stealing normal drag
    if (!e.shiftKey) {
      // If user clicks without shift, clear current group
      if (this.selectedIds.size > 0) {
        this.clearSelection();
      }
      return;
    }

    this._setMouse(e);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const meshes = this.cargoRegistry.map(en => en.mesh);
    const hits   = this.raycaster.intersectObjects(meshes, true);
    if (!hits.length) return;

    // Walk up to find registry entry
    let entry = null;
    for (const hit of hits) {
      entry = this._findEntry(hit.object);
      if (entry) break;
    }
    if (!entry) return;

    e.stopPropagation(); // prevent DragController from picking this up

    if (this.selectedIds.has(entry.id)) {
      // Deselect
      this._restoreMaterial(entry.id);
      this.selectedIds.delete(entry.id);
    } else {
      // Select
      this._saveAndHighlight(entry);
      this.selectedIds.add(entry.id);
    }

    this.onGroupChanged([...this.selectedIds]);

    // If we now have a group and user starts dragging, record state
    if (this.selectedIds.size >= 2) {
      this._beginGroupDrag(entry.mesh.position.clone());
    }
  }

  _handlePointerMove(e) {
    if (!this._dragging || this.selectedIds.size < 2) return;

    this._setMouse(e);
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const point = new THREE.Vector3();
    const hit   = this.raycaster.ray.intersectPlane(this._dragPlane, point);
    if (!hit && !this._dragLastWorld) return;
    if (!hit) point.copy(this._dragLastWorld);

    // Snap to 0.05 ft grid
    point.x = Math.round(point.x / 0.05) * 0.05;
    point.z = Math.round(point.z / 0.05) * 0.05;

    const entries = this.selectedEntries;
    let anyCollision = false;

    // Compute proposed new positions
    const proposed = entries.map(entry => {
      const offset = this._dragOffsets.get(entry.id);
      const newPos = point.clone().add(offset);
      newPos.y     = entry.mesh.position.y; // keep each box's height

      // Clamp to truck bounds
      const half = TRUCK_DIMENSIONS;
      newPos.x = THREE.MathUtils.clamp(newPos.x, -half.length / 2 + entry.size.x / 2,  half.length / 2 - entry.size.x / 2);
      newPos.z = THREE.MathUtils.clamp(newPos.z, -half.width  / 2 + entry.size.z / 2,  half.width  / 2 - entry.size.z / 2);

      return { entry, newPos };
    });

    // Check collisions against non-selected boxes
    for (const { entry, newPos } of proposed) {
      if (this.collisionSystem.wouldCollideExcluding(entry.mesh, newPos, entry.size, this.selectedEntries.map(e => e.mesh))) {
        anyCollision = true;
        break;
      }
    }

    // Apply highlight colour
    for (const { entry } of proposed) {
      entry.mesh.material = anyCollision ? this._collisionMat : this._highlightMat;
    }

    if (!anyCollision) {
      for (const { entry, newPos } of proposed) {
        entry.mesh.position.copy(newPos);
      }
      this._dragLastWorld = point.clone();
    }
  }

  _handlePointerUp() {
    if (!this._dragging) return;
    this._dragging = false;

    // Restore highlight (not base) material to keep visual selection feedback
    for (const entry of this.selectedEntries) {
      entry.mesh.material = this._highlightMat;
    }

    // Sync physics bodies
    this.syncBodies();
  }

  _handleKeyDown(e) {
    // Escape clears the group
    if (e.key === 'Escape') this.clearSelection();
  }

  // ── Group drag helpers ───────────────────────────────────────────────────────

  _beginGroupDrag(anchorWorldPos) {
    this._dragging = true;
    this._dragPlane.constant = -anchorWorldPos.y;
    this._dragLastWorld      = anchorWorldPos.clone();
    this._dragOffsets.clear();

    for (const entry of this.selectedEntries) {
      // Offset = entry position relative to anchor
      this._dragOffsets.set(
        entry.id,
        entry.mesh.position.clone().sub(anchorWorldPos)
      );
    }
  }

  // ── Physics sync ────────────────────────────────────────────────────────────

  syncBodies() {
    for (const entry of this.selectedEntries) {
      if (!entry.body) continue;
      entry.body.position.set(
        entry.mesh.position.x,
        entry.mesh.position.y,
        entry.mesh.position.z
      );
      entry.body.velocity.set(0, 0, 0);
      entry.body.angularVelocity.set(0, 0, 0);
      entry.body.wakeUp();
    }
  }

  // ── Material helpers ─────────────────────────────────────────────────────────

  _saveAndHighlight(entry) {
    if (!this._savedMaterials.has(entry.id)) {
      this._savedMaterials.set(entry.id, entry.mesh.material);
    }
    entry.mesh.material = this._highlightMat;
  }

  _restoreMaterial(id) {
    const entry = this.cargoRegistry.find(e => e.id === id);
    if (!entry) return;
    const saved = this._savedMaterials.get(id);
    if (saved) {
      entry.mesh.material = saved;
      this._savedMaterials.delete(id);
    }
  }

  // ── Utility ──────────────────────────────────────────────────────────────────

  _findEntry(object) {
    let current = object;
    while (current) {
      const found = this.cargoRegistry.find(e => e.mesh === current);
      if (found) return found;
      current = current.parent;
    }
    return null;
  }
}