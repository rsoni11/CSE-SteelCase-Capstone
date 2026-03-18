import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { TRUCK_DIMENSIONS } from './constants';
import { CollisionSystem } from './CollisionSystem';
import { DragController } from './DragController';

// Sets up the full Three.js scene and returns refs + a cleanup function
export function initScene({
  mountEl,
  cargoRegistry,
  physicsEnabledRef,
  setStats,
  setIsLoading,
  setIsBoxDragging,
  saveToHistoryRef,
}) {
  // ── Scene ──────────────────────────────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf5f5f5);

  // ── Camera ─────────────────────────────────────────────────────────────────
  const camera = new THREE.PerspectiveCamera(
    60, mountEl.clientWidth / mountEl.clientHeight, 0.1, 1000
  );
  camera.position.set(20, 25, 40);

  // ── Renderer ───────────────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(mountEl.clientWidth, mountEl.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  mountEl.appendChild(renderer.domElement);

  // ── Orbit Controls ─────────────────────────────────────────────────────────
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.minDistance = 5;
  controls.maxDistance = 80;
  controls.maxPolarAngle = Math.PI / 2;
  controls.target.set(-20, TRUCK_DIMENSIONS.height / 2, 0);

  // ── Lighting ───────────────────────────────────────────────────────────────
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(20, 30, 20);
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.width = 2048;
  directionalLight.shadow.mapSize.height = 2048;
  directionalLight.shadow.camera.near = 0.5;
  directionalLight.shadow.camera.far = 100;
  directionalLight.shadow.camera.left = -30;
  directionalLight.shadow.camera.right = 30;
  directionalLight.shadow.camera.top = 30;
  directionalLight.shadow.camera.bottom = -30;
  scene.add(directionalLight);

  // ── Truck Container ────────────────────────────────────────────────────────
  const truckGroup = new THREE.Group();

  const floorGeometry = new THREE.BoxGeometry(TRUCK_DIMENSIONS.length, 0.2, TRUCK_DIMENSIONS.width);
  const floor = new THREE.Mesh(
    floorGeometry,
    new THREE.MeshStandardMaterial({ color: 0x8B7355, roughness: 0.8, metalness: 0.2 })
  );
  floor.position.y = 0.1;
  floor.receiveShadow = true;
  truckGroup.add(floor);

  const wallMaterial = new THREE.MeshStandardMaterial({
    color: 0xC0C0C0, roughness: 0.7, metalness: 0.3,
    transparent: true, opacity: 0.3, side: THREE.DoubleSide
  });

  const sideWallGeometry = new THREE.BoxGeometry(TRUCK_DIMENSIONS.length, TRUCK_DIMENSIONS.height, 0.2);

  const leftWall = new THREE.Mesh(sideWallGeometry, wallMaterial);
  leftWall.position.set(0, TRUCK_DIMENSIONS.height / 2, -TRUCK_DIMENSIONS.width / 2);
  leftWall.receiveShadow = true;
  truckGroup.add(leftWall);

  const rightWall = new THREE.Mesh(sideWallGeometry, wallMaterial);
  rightWall.position.set(0, TRUCK_DIMENSIONS.height / 2, TRUCK_DIMENSIONS.width / 2);
  rightWall.receiveShadow = true;
  truckGroup.add(rightWall);

  const ceiling = new THREE.Mesh(
    new THREE.BoxGeometry(TRUCK_DIMENSIONS.length, 0.2, TRUCK_DIMENSIONS.width),
    wallMaterial
  );
  ceiling.position.y = TRUCK_DIMENSIONS.height - 0.1;
  ceiling.receiveShadow = true;
  truckGroup.add(ceiling);

  const floorEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(floorGeometry),
    new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 2 })
  );
  floorEdges.position.copy(floor.position);
  truckGroup.add(floorEdges);

  scene.add(truckGroup);

  // ── Bay 1 ──────────────────────────────────────────────────────────────────
  const bayGroup = new THREE.Group();

  const bayFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 15),
    new THREE.MeshStandardMaterial({ color: 0xF39C12, roughness: 0.9, metalness: 0.1, transparent: true, opacity: 0.3 })
  );
  bayFloor.rotation.x = -Math.PI / 2;
  bayFloor.position.set(-40, 0.01, 0);
  bayFloor.receiveShadow = true;
  bayGroup.add(bayFloor);

  const bayBorderPoints = [
    new THREE.Vector3(-50, 0.02, -7.5), new THREE.Vector3(-30, 0.02, -7.5),
    new THREE.Vector3(-30, 0.02, 7.5),  new THREE.Vector3(-50, 0.02, 7.5),
    new THREE.Vector3(-50, 0.02, -7.5)
  ];
  bayGroup.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(bayBorderPoints),
    new THREE.LineBasicMaterial({ color: 0xF39C12, linewidth: 3 })
  ));

  const labelPost = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 8, 0.6),
    new THREE.MeshStandardMaterial({ color: 0xF39C12, roughness: 0.5, metalness: 0.5 })
  );
  labelPost.position.set(-52, 4, -8);
  labelPost.castShadow = true;
  bayGroup.add(labelPost);

  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(5, 2.5, 0.3),
    new THREE.MeshStandardMaterial({ color: 0xF39C12, roughness: 0.3, metalness: 0.1 })
  );
  sign.position.set(-52, 9.25, -8);
  sign.rotation.y = Math.PI / 2;
  sign.castShadow = true;
  bayGroup.add(sign);

  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#F39C12';
  ctx.fillRect(0, 0, 512, 256);
  ctx.fillStyle = '#2C3E50';
  ctx.font = 'bold 120px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('BAY 1', 256, 128);

  const bayText = new THREE.Mesh(
    new THREE.BoxGeometry(4.8, 2.3, 0.1),
    new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(canvas), roughness: 0.2 })
  );
  bayText.position.set(-51.85, 9.25, -8);
  bayText.rotation.y = Math.PI / 2;
  bayGroup.add(bayText);

  scene.add(bayGroup);

  // ── Ground & Grid ──────────────────────────────────────────────────────────
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ color: 0xe0e0e0, roughness: 0.9 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.1;
  ground.receiveShadow = true;
  scene.add(ground);

  const gridHelper = new THREE.GridHelper(100, 50, 0xcccccc, 0xdddddd);
  gridHelper.position.y = 0;
  scene.add(gridHelper);

  // ── Collision + Drag Systems ───────────────────────────────────────────────
  const collisionSystem = new CollisionSystem(cargoRegistry);
  const dragController = new DragController({
    camera,
    domElement: renderer.domElement,
    truckDimensions: TRUCK_DIMENSIONS,
    cargoRegistry,
    collisionSystem,
    onDragStateChange: (dragging) => {
      controls.enabled = !dragging;
      setIsBoxDragging(dragging);
      physicsEnabledRef.current = !dragging;
    },
    onPositionChanged: (mesh, oldPos, newPos) => {
      if (saveToHistoryRef.current) saveToHistoryRef.current(mesh, oldPos, newPos);
    },
  });

  // ── Animation Loop ─────────────────────────────────────────────────────────
  let lastTime = performance.now();
  let frames = 0;

  const animate = () => {
    requestAnimationFrame(animate);

    // Gravity physics
    if (physicsEnabledRef.current && cargoRegistry.length > 0) {
      const gravity = -0.03;
      const groundY = 0.1;
      cargoRegistry.forEach(entry => {
        const { mesh, size } = entry;
        const boxBottom = mesh.position.y - size.y / 2;
        if (boxBottom > groundY + 0.01) {
          let restingOnBox = false;
          for (const other of cargoRegistry) {
            if (other.mesh === mesh) continue;
            const otherTop = other.mesh.position.y + other.size.y / 2;
            const horizontalOverlap =
              Math.abs(mesh.position.x - other.mesh.position.x) < (size.x / 2 + other.size.x / 2) &&
              Math.abs(mesh.position.z - other.mesh.position.z) < (size.z / 2 + other.size.z / 2);
            const verticallyClose = Math.abs(boxBottom - otherTop) < 0.05;
            if (horizontalOverlap && verticallyClose) {
              restingOnBox = true;
              mesh.position.y = otherTop + size.y / 2;
              break;
            }
          }
          if (!restingOnBox) {
            mesh.position.y += gravity;
            if (mesh.position.y - size.y / 2 < groundY) {
              mesh.position.y = groundY + size.y / 2;
            }
          }
        }
      });
    }

    controls.update();
    renderer.render(scene, camera);

    frames++;
    const now = performance.now();
    if (now >= lastTime + 1000) {
      setStats(prev => ({ ...prev, fps: Math.round(frames * 1000 / (now - lastTime)) }));
      frames = 0;
      lastTime = now;
    }
  };

  // ── Resize Handler ─────────────────────────────────────────────────────────
  const handleResize = () => {
    if (!mountEl) return;
    camera.aspect = mountEl.clientWidth / mountEl.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(mountEl.clientWidth, mountEl.clientHeight);
  };

  window.addEventListener('resize', handleResize);
  animate();
  setTimeout(() => setIsLoading(false), 100);

  // ── Cleanup ────────────────────────────────────────────────────────────────
  const cleanup = () => {
    window.removeEventListener('resize', handleResize);
    dragController.destroy();
    mountEl.removeChild(renderer.domElement);
    renderer.dispose();
  };

  return { scene, camera, renderer, controls, collisionSystem, dragController, cleanup };
}
