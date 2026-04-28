import * as THREE from 'three';

export class GhostPreview {
  constructor(scene) {
    this.scene = scene;
    this.mesh  = null;
  }

  show(position, size, hexColor = '#00ff88') {
    this.hide();

    const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);

    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(hexColor),
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      emissive: new THREE.Color(hexColor),
      emissiveIntensity: 0.35,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.copy(position);

    const edgesMaterial = new THREE.LineBasicMaterial({
      color: new THREE.Color(hexColor),
      linewidth: 2,
      transparent: true,
      opacity: 0.9,
    });
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      edgesMaterial
    );
    this.mesh.add(edges);

    this.mesh.userData.isGhost = true;
    this.scene.add(this.mesh);
  }

  hide() {
    if (!this.mesh) return;
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.children.forEach(c => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    });
    this.mesh = null;
  }

  getPosition() {
    return this.mesh ? this.mesh.position.clone() : null;
  }
}