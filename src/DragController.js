import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { TRUCK_DIMENSIONS } from './constants';

// ─────────────────────────────────────────────────────────────────────────────
// DragController  –  single-box drag (original) + US6 group drag (Rhea)
//
// Group usage:
//   Shift+click a box  → add / remove it from the selection group (turns purple)
//   Drag any selected box (no shift needed) → moves ALL selected boxes together
//   Escape / plain click on empty space     → clear selection
// ─────────────────────────────────────────────────────────────────────────────

const GROUP_COLOR     = new THREE.Color(0x667eea);
const HIGHLIGHT_COLOR = new THREE.Color(0x4aa3ff);
const COLLISION_COLOR = new THREE.Color(0xff0000);

export class DragController {
  constructor({
    camera,
    domElement,
    truckDimensions,
    cargoRegistry,
    collisionSystem,
    onDragStateChange,
    onPositionChanged,
    onGroupChanged,       // (ids: string[]) => void   — optional, for React state
  }) {
    this.camera           = camera;
    this.domElement       = domElement;
    this.truck            = truckDimensions;
    this.cargoRegistry    = cargoRegistry;
    this.collisionSystem  = collisionSystem;
    this.onDragStateChange = onDragStateChange;
    this.onPositionChanged = onPositionChanged;
    this.onGroupChanged    = onGroupChanged ?? (() => {});

    this.raycaster       = new THREE.Raycaster();
    this.mouse           = new THREE.Vector2();
    this.dragging        = false;
    this.selectedEntry   = null;   // the box being dragged (anchor)
    this.originalPosition = null;

    this.currentY      = 0;
    this.manualYOffset = 0;
    this.lastWorldPoint = null;
    this.dragPlane     = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    // ── materials ────────────────────────────────────────────────────────────
    this.highlightMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: HIGHLIGHT_COLOR, emissiveIntensity: 0.8
    });
    this.collisionMaterial = new THREE.MeshStandardMaterial({
      color: 0xff0000, emissive: COLLISION_COLOR, emissiveIntensity: 0.6
    });
    this.groupMaterial = new THREE.MeshStandardMaterial({
      color: 0x8899ff, emissive: GROUP_COLOR, emissiveIntensity: 0.5
    });

    // ── US6: group selection state ────────────────────────────────────────────
    // Map<entry.id, { entry, savedMaterial, offset: THREE.Vector3 }>
    // `offset` is only filled during an active group drag.
    this._group = new Map();

    // ── bind handlers ─────────────────────────────────────────────────────────
    this._onDown  = e => this.onDown(e);
    this._onMove  = e => this.onMove(e);
    this._onUp    = () => this.onUp();
    this._onWheel = e => this.onWheel(e);
    this._onKey   = e => this.onKeyDown(e);

    domElement.addEventListener('pointerdown', this._onDown);
    window.addEventListener('pointermove',    this._onMove);
    window.addEventListener('pointerup',      this._onUp);
    domElement.addEventListener('wheel',      this._onWheel, { passive: false });
    window.addEventListener('keydown',        this._onKey);
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  setMouse(e) {
    const rect = this.domElement.getBoundingClientRect();
    this.mouse.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
  }

  getMeshes() { return this.cargoRegistry.map(e => e.mesh); }

  findEntryFromHitObject(hitObject) {
    let current = hitObject;
    while (current) {
      const entry = this.cargoRegistry.find(e => e.mesh === current);
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
    const halfW = TRUCK_DIMENSIONS.width  / 2;
    point.x = THREE.MathUtils.clamp(point.x, -halfL + size.x / 2, halfL - size.x / 2);
    point.z = THREE.MathUtils.clamp(point.z, -halfW + size.z / 2, halfW - size.z / 2);
    return point;
  }

  syncBodyWithMesh(entry) {
    if (!entry?.body) return;
    entry.body.position.set(entry.mesh.position.x, entry.mesh.position.y, entry.mesh.position.z);
    entry.body.quaternion.set(
      entry.mesh.quaternion.x, entry.mesh.quaternion.y,
      entry.mesh.quaternion.z, entry.mesh.quaternion.w
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
    const eps    = 0.001;
    let   baseY  = this.selectedEntry.size.y / 2;
    for (const other of this.cargoRegistry) {
      if (other.mesh === this.selectedEntry.mesh) continue;
      const dx = Math.abs(x - other.mesh.position.x);
      const dz = Math.abs(z - other.mesh.position.z);
      const overlapX = dx < this.selectedEntry.size.x / 2 + other.size.x / 2 - eps;
      const overlapZ = dz < this.selectedEntry.size.z / 2 + other.size.z / 2 - eps;
      if (overlapX && overlapZ) {
        const top = other.mesh.position.y + other.size.y / 2;
        const cy  = top + this.selectedEntry.size.y / 2;
        if (cy > baseY) baseY = cy;
      }
    }
    return baseY;
  }

  // ── US6: group helpers ────────────────────────────────────────────────────────

  get _groupEntries() {
    const out = [];
    for (const { entry } of this._group.values()) out.push(entry);
    return out;
  }

  get _isGroupDrag() {
    return this._group.size >= 2 && this.selectedEntry && this._group.has(this.selectedEntry.id);
  }

  _addToGroup(entry) {
    if (this._group.has(entry.id)) return;
    this._group.set(entry.id, { entry, savedMaterial: entry.mesh.material, offset: new THREE.Vector3() });
    entry.mesh.material = this.groupMaterial;
    this.onGroupChanged([...this._group.keys()]);
  }

  _removeFromGroup(entry) {
    const rec = this._group.get(entry.id);
    if (!rec) return;
    entry.mesh.material = rec.savedMaterial;
    this._group.delete(entry.id);
    this.onGroupChanged([...this._group.keys()]);
  }

  clearGroup() {
    for (const { entry, savedMaterial } of this._group.values()) {
      entry.mesh.material = savedMaterial;
    }
    this._group.clear();
    this.onGroupChanged([]);
  }

  // Compute XZ offsets from the anchor position for every grouped box
  _computeGroupOffsets(anchorPos) {
    for (const rec of this._group.values()) {
      rec.offset.set(
        rec.entry.mesh.position.x - anchorPos.x,
        0,
        rec.entry.mesh.position.z - anchorPos.z
      );
    }
  }

  // ── pointerdown ───────────────────────────────────────────────────────────────

  onDown(e) {
    this.setMouse(e);
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const hits = this.raycaster.intersectObjects(this.getMeshes(), true);

    // ── Shift+click: toggle group membership ────────────────────────────────
    if (e.shiftKey) {
      if (!hits.length) return;
      let entry = null;
      for (const hit of hits) {
        entry = this.findEntryFromHitObject(hit.object);
        if (entry) break;
      }
      if (!entry) return;

      if (this._group.has(entry.id)) {
        this._removeFromGroup(entry);
      } else {
        this._addToGroup(entry);
      }
      return; // don't start a drag on shift-click
    }

    // ── Plain click on empty space: clear group ──────────────────────────────
    if (!hits.length) {
      this.clearGroup();
      return;
    }

    // ── Plain click on a box: start drag ─────────────────────────────────────
    let entry = null;
    for (const hit of hits) {
      entry = this.findEntryFromHitObject(hit.object);
      if (entry) break;
    }
    if (!entry) return;

    this.selectedEntry    = entry;
    this.originalPosition = entry.mesh.position.clone();
    this.currentY         = entry.mesh.position.y;
    this.manualYOffset    = 0;
    this.lastWorldPoint   = entry.mesh.position.clone();
    this.dragPlane.constant = -this.currentY;

    // If the clicked box is part of the group, set up group drag offsets
    if (this._isGroupDrag) {
      this._computeGroupOffsets(entry.mesh.position);
      // Put all grouped boxes into kinematic mode
      for (const { entry: ge } of this._group.values()) {
        this.setDraggedBodyMode(ge, true);
      }
    } else {
      // Clear group if clicking a non-grouped box
      if (this._group.size > 0 && !this._group.has(entry.id)) {
        this.clearGroup();
      }
      entry.mesh.material = this.highlightMaterial;
      this.setDraggedBodyMode(entry, true);
      this.syncBodyWithMesh(entry);
    }

    this.dragging = true;
    this.onDragStateChange?.(true);
  }

  // ── pointermove ───────────────────────────────────────────────────────────────

  onMove(e) {
    if (!this.dragging || !this.selectedEntry) return;

    this.setMouse(e);
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const point = new THREE.Vector3();
    const hit   = this.raycaster.ray.intersectPlane(this.dragPlane, point);
    if (!hit) {
      if (!this.lastWorldPoint) return;
      point.copy(this.lastWorldPoint);
    }

    point.x = Math.round(point.x / 0.05) * 0.05;
    point.z = Math.round(point.z / 0.05) * 0.05;

    // ── Group drag ────────────────────────────────────────────────────────────
    if (this._isGroupDrag) {
      this.clampToTruck(point, this.selectedEntry.size);

      // Compute proposed positions for all group members
      const proposals = [];
      for (const rec of this._group.values()) {
        const newPos = new THREE.Vector3(
          point.x + rec.offset.x,
          rec.entry.mesh.position.y,   // preserve each box's individual height
          point.z + rec.offset.z
        );
        // Clamp each member to truck bounds
        this.clampToTruck(newPos, rec.entry.size);
        proposals.push({ rec, newPos });
      }

      // Check collisions: each box vs non-grouped boxes only
      const groupMeshes = this._groupEntries.map(e => e.mesh);
      let anyCollision = false;
      for (const { rec, newPos } of proposals) {
        if (this.collisionSystem.wouldCollideExcluding(rec.entry.mesh, newPos, rec.entry.size, groupMeshes)) {
          anyCollision = true;
          break;
        }
      }

      // Apply
      for (const { rec, newPos } of proposals) {
        rec.entry.mesh.material = anyCollision ? this.collisionMaterial : this.groupMaterial;
        if (!anyCollision) {
          rec.entry.mesh.position.set(newPos.x, newPos.y, newPos.z);
          this.syncBodyWithMesh(rec.entry);
        }
      }

      if (!anyCollision) this.lastWorldPoint = point.clone();
      return;
    }

    // ── Single-box drag (original logic) ─────────────────────────────────────
    this.clampToTruck(point, this.selectedEntry.size);

    const baseY    = this.computeBaseStackY(point.x, point.z);
    point.y        = this.clampY(baseY + this.manualYOffset);

    const collides = this.collisionSystem.wouldCollide(
      this.selectedEntry.mesh, point, this.selectedEntry.size
    );

    this.selectedEntry.mesh.material = collides ? this.collisionMaterial : this.highlightMaterial;

    if (!collides) {
      this.selectedEntry.mesh.position.copy(point);
      this.currentY = point.y;
      this.dragPlane.constant = -this.currentY;
      this.lastWorldPoint = point.clone();
      this.syncBodyWithMesh(this.selectedEntry);
    }
  }

  // ── pointerup ─────────────────────────────────────────────────────────────────

  onUp() {
    if (!this.dragging || !this.selectedEntry) return;

    if (this._isGroupDrag) {
      // Restore group material and release physics for all members
      for (const { entry, savedMaterial } of this._group.values()) {
        // Keep highlight (group material) so user can see selection persists
        entry.mesh.material = this.groupMaterial;
        this.setDraggedBodyMode(entry, false);
        this.syncBodyWithMesh(entry);
      }
    } else {
      this.selectedEntry.mesh.material = this.selectedEntry.baseMaterial;
      this.setDraggedBodyMode(this.selectedEntry, false);
      this.syncBodyWithMesh(this.selectedEntry);

      if (this.onPositionChanged && this.originalPosition) {
        const newPos = this.selectedEntry.mesh.position.clone();
        if (!this.originalPosition.equals(newPos)) {
          this.onPositionChanged(this.selectedEntry.mesh, this.originalPosition, newPos);
        }
      }
    }

    this.dragging      = false;
    this.selectedEntry = null;
    this.originalPosition = null;
    this.manualYOffset    = 0;
    this.lastWorldPoint   = null;

    this.onDragStateChange?.(false);
  }

  // ── height adjustment (W/S/wheel) ─────────────────────────────────────────────

  adjustHeight(delta) {
    if (!this.dragging || !this.selectedEntry) return;
    if (this._isGroupDrag) return; // height adjustment not supported for groups

    const pos   = this.selectedEntry.mesh.position.clone();
    const baseY = this.computeBaseStackY(pos.x, pos.z);
    const nextY = this.clampY(this.currentY + delta);
    this.manualYOffset = nextY - baseY;
    pos.y = this.clampY(baseY + this.manualYOffset);

    const collides = this.collisionSystem.wouldCollide(
      this.selectedEntry.mesh, pos, this.selectedEntry.size
    );
    this.selectedEntry.mesh.material = collides ? this.collisionMaterial : this.highlightMaterial;

    if (!collides) {
      this.selectedEntry.mesh.position.y = pos.y;
      this.currentY = pos.y;
      this.dragPlane.constant = -this.currentY;
      this.syncBodyWithMesh(this.selectedEntry);
    }
  }

  rotateSelected() {
    if (!this.dragging || !this.selectedEntry) return;

    const mesh     = this.selectedEntry.mesh;
    const original = mesh.quaternion.clone();
    mesh.rotation.y += Math.PI / 2;

    const collides = this.collisionSystem.wouldCollide(
      mesh, mesh.position.clone(), this.selectedEntry.size
    );
    if (collides) {
      mesh.quaternion.copy(original);
      mesh.material = this.collisionMaterial;
      return;
    }
    mesh.material = this.highlightMaterial;
    this.syncBodyWithMesh(this.selectedEntry);
  }

  // ── scroll / keys ─────────────────────────────────────────────────────────────

  onWheel(e) {
    if (!this.dragging || !this.selectedEntry) return;
    e.preventDefault();
    e.stopPropagation();
    this.adjustHeight(e.deltaY > 0 ? -0.3 : 0.3);
  }

  onKeyDown(e) {
    if (e.key === 'Escape') {
      this.clearGroup();
      return;
    }
    if (!this.dragging || !this.selectedEntry) return;
    if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') {
      e.preventDefault(); this.adjustHeight(0.5);
    } else if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') {
      e.preventDefault(); this.adjustHeight(-0.5);
    } else if (e.key === 'r' || e.key === 'R') {
      e.preventDefault(); this.rotateSelected();
    }
  }

  // ── cleanup ───────────────────────────────────────────────────────────────────

  clearRegistry() {
    this.dragging        = false;
    this.selectedEntry   = null;
    this.originalPosition = null;
    this.manualYOffset   = 0;
    this.lastWorldPoint  = null;
    this._group.clear();
  }

  destroy() {
    this.domElement.removeEventListener('pointerdown', this._onDown);
    window.removeEventListener('pointermove',          this._onMove);
    window.removeEventListener('pointerup',            this._onUp);
    this.domElement.removeEventListener('wheel',       this._onWheel);
    window.removeEventListener('keydown',              this._onKey);
  }
}