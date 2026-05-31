import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { TRUCK_DIMENSIONS } from './constants';
import { CollisionSystem } from './CollisionSystem';
import { DragController } from './DragController';

export function initScene({
  mountEl,
  cargoRegistry,
  physicsEnabledRef,
  physicsApiRef,
  setStats,
  setIsLoading,
  setIsBoxDragging,
  saveToHistoryRef,
}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf5f5f5);

  const camera = new THREE.PerspectiveCamera(
    60,
    mountEl.clientWidth / mountEl.clientHeight,
    0.1,
    1000
  );
  camera.position.set(20, 25, 40);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(mountEl.clientWidth, mountEl.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  mountEl.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.minDistance = 5;
  controls.maxDistance = 100;
  controls.maxPolarAngle = Math.PI / 2;
  controls.target.set(0, TRUCK_DIMENSIONS.height / 2, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.65));

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.9);
  directionalLight.position.set(20, 30, 20);
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.width = 2048;
  directionalLight.shadow.mapSize.height = 2048;
  directionalLight.shadow.camera.near = 0.5;
  directionalLight.shadow.camera.far = 140;
  directionalLight.shadow.camera.left = -40;
  directionalLight.shadow.camera.right = 40;
  directionalLight.shadow.camera.top = 35;
  directionalLight.shadow.camera.bottom = -35;
  scene.add(directionalLight);

  const world = new CANNON.World();
  world.gravity.set(0, -24, 0);
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = true;
  world.solver.iterations = 20;
  world.solver.tolerance = 0.001;

  const defaultMaterial = new CANNON.Material('default');
  const wallMaterial = new CANNON.Material('wall');

  world.defaultContactMaterial = new CANNON.ContactMaterial(
    defaultMaterial,
    defaultMaterial,
    {
      friction: 0.95,
      restitution: 0.0
    }
  );

  world.addContactMaterial(
    new CANNON.ContactMaterial(defaultMaterial, wallMaterial, {
      friction: 1.0,
      restitution: 0.0
    })
  );

  physicsApiRef.current = {
    world,
    materials: { defaultMaterial, wallMaterial }
  };

  const truckGroup = new THREE.Group();

  const floorGeometry = new THREE.BoxGeometry(
    TRUCK_DIMENSIONS.length,
    0.2,
    TRUCK_DIMENSIONS.width
  );
  const floor = new THREE.Mesh(
    floorGeometry,
    new THREE.MeshStandardMaterial({
      color: 0x8b7355,
      roughness: 0.8,
      metalness: 0.2
    })
  );
  floor.position.y = 0.1;
  floor.receiveShadow = true;
  truckGroup.add(floor);

  const visualWallMaterial = new THREE.MeshStandardMaterial({
    color: 0xc0c0c0,
    roughness: 0.7,
    metalness: 0.3,
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide
  });

  const sideWallGeometry = new THREE.BoxGeometry(
    TRUCK_DIMENSIONS.length,
    TRUCK_DIMENSIONS.height,
    0.2
  );

  const leftWall = new THREE.Mesh(sideWallGeometry, visualWallMaterial);
  leftWall.position.set(
    0,
    TRUCK_DIMENSIONS.height / 2,
    -TRUCK_DIMENSIONS.width / 2
  );
  leftWall.receiveShadow = true;
  truckGroup.add(leftWall);

  const rightWall = new THREE.Mesh(sideWallGeometry, visualWallMaterial);
  rightWall.position.set(
    0,
    TRUCK_DIMENSIONS.height / 2,
    TRUCK_DIMENSIONS.width / 2
  );
  rightWall.receiveShadow = true;
  truckGroup.add(rightWall);

  const frontWall = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, TRUCK_DIMENSIONS.height, TRUCK_DIMENSIONS.width),
    visualWallMaterial
  );
  frontWall.position.set(
    TRUCK_DIMENSIONS.length / 2,
    TRUCK_DIMENSIONS.height / 2,
    0
  );
  frontWall.receiveShadow = true;
  truckGroup.add(frontWall);

  const backWall = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, TRUCK_DIMENSIONS.height, TRUCK_DIMENSIONS.width),
    visualWallMaterial
  );
  backWall.position.set(
    -TRUCK_DIMENSIONS.length / 2,
    TRUCK_DIMENSIONS.height / 2,
    0
  );
  backWall.receiveShadow = true;
  truckGroup.add(backWall);

  const ceiling = new THREE.Mesh(
    new THREE.BoxGeometry(TRUCK_DIMENSIONS.length, 0.2, TRUCK_DIMENSIONS.width),
    visualWallMaterial
  );
  ceiling.position.y = TRUCK_DIMENSIONS.height - 0.1;
  ceiling.receiveShadow = true;
  truckGroup.add(ceiling);

  const floorEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(floorGeometry),
    new THREE.LineBasicMaterial({ color: 0x000000 })
  );
  floorEdges.position.copy(floor.position);
  truckGroup.add(floorEdges);

  scene.add(truckGroup);

  const floorBody = new CANNON.Body({
    mass: 0,
    material: wallMaterial,
    shape: new CANNON.Box(
      new CANNON.Vec3(
        TRUCK_DIMENSIONS.length / 2,
        0.1,
        TRUCK_DIMENSIONS.width / 2
      )
    ),
    position: new CANNON.Vec3(0, 0.1, 0)
  });
  world.addBody(floorBody);

  const ceilingBody = new CANNON.Body({
    mass: 0,
    material: wallMaterial,
    shape: new CANNON.Box(
      new CANNON.Vec3(
        TRUCK_DIMENSIONS.length / 2,
        0.1,
        TRUCK_DIMENSIONS.width / 2
      )
    ),
    position: new CANNON.Vec3(0, TRUCK_DIMENSIONS.height - 0.1, 0)
  });
  world.addBody(ceilingBody);

  const leftWallBody = new CANNON.Body({
    mass: 0,
    material: wallMaterial,
    shape: new CANNON.Box(
      new CANNON.Vec3(
        TRUCK_DIMENSIONS.length / 2,
        TRUCK_DIMENSIONS.height / 2,
        0.1
      )
    ),
    position: new CANNON.Vec3(
      0,
      TRUCK_DIMENSIONS.height / 2,
      -TRUCK_DIMENSIONS.width / 2
    )
  });
  world.addBody(leftWallBody);

  const rightWallBody = new CANNON.Body({
    mass: 0,
    material: wallMaterial,
    shape: new CANNON.Box(
      new CANNON.Vec3(
        TRUCK_DIMENSIONS.length / 2,
        TRUCK_DIMENSIONS.height / 2,
        0.1
      )
    ),
    position: new CANNON.Vec3(
      0,
      TRUCK_DIMENSIONS.height / 2,
      TRUCK_DIMENSIONS.width / 2
    )
  });
  world.addBody(rightWallBody);

  const frontWallBody = new CANNON.Body({
    mass: 0,
    material: wallMaterial,
    shape: new CANNON.Box(
      new CANNON.Vec3(
        0.1,
        TRUCK_DIMENSIONS.height / 2,
        TRUCK_DIMENSIONS.width / 2
      )
    ),
    position: new CANNON.Vec3(
      TRUCK_DIMENSIONS.length / 2,
      TRUCK_DIMENSIONS.height / 2,
      0
    )
  });
  world.addBody(frontWallBody);

  const backWallBody = new CANNON.Body({
    mass: 0,
    material: wallMaterial,
    shape: new CANNON.Box(
      new CANNON.Vec3(
        0.1,
        TRUCK_DIMENSIONS.height / 2,
        TRUCK_DIMENSIONS.width / 2
      )
    ),
    position: new CANNON.Vec3(
      -TRUCK_DIMENSIONS.length / 2,
      TRUCK_DIMENSIONS.height / 2,
      0
    )
  });
  world.addBody(backWallBody);

  const bayGroup = new THREE.Group();

  const bayFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 15),
    new THREE.MeshStandardMaterial({
      color: 0xf39c12,
      roughness: 0.9,
      metalness: 0.1,
      transparent: true,
      opacity: 0.3
    })
  );
  bayFloor.rotation.x = -Math.PI / 2;
  bayFloor.position.set(-40, 0.01, 0);
  bayFloor.receiveShadow = true;
  bayGroup.add(bayFloor);

  const bayBorderPoints = [
    new THREE.Vector3(-50, 0.02, -7.5),
    new THREE.Vector3(-30, 0.02, -7.5),
    new THREE.Vector3(-30, 0.02, 7.5),
    new THREE.Vector3(-50, 0.02, 7.5),
    new THREE.Vector3(-50, 0.02, -7.5)
  ];

  bayGroup.add(
    new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(bayBorderPoints),
      new THREE.LineBasicMaterial({ color: 0xf39c12 })
    )
  );

  const labelPost = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 8, 0.6),
    new THREE.MeshStandardMaterial({
      color: 0xf39c12,
      roughness: 0.5,
      metalness: 0.5
    })
  );
  labelPost.position.set(-52, 4, -8);
  labelPost.castShadow = true;
  bayGroup.add(labelPost);

  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(5, 2.5, 0.3),
    new THREE.MeshStandardMaterial({
      color: 0xf39c12,
      roughness: 0.3,
      metalness: 0.1
    })
  );
  sign.position.set(-52, 9.25, -8);
  sign.rotation.y = Math.PI / 2;
  sign.castShadow = true;
  bayGroup.add(sign);

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
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
    new THREE.MeshStandardMaterial({
      map: new THREE.CanvasTexture(canvas),
      roughness: 0.2
    })
  );
  bayText.position.set(-51.85, 9.25, -8);
  bayText.rotation.y = Math.PI / 2;
  bayGroup.add(bayText);

  scene.add(bayGroup);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ color: 0xe0e0e0, roughness: 0.9 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.1;
  ground.receiveShadow = true;
  scene.add(ground);

  const gridHelper = new THREE.GridHelper(120, 60, 0xcccccc, 0xdddddd);
  gridHelper.position.y = 0;
  scene.add(gridHelper);

  const collisionSystem = new CollisionSystem(cargoRegistry);

  const dragController = new DragController({
    camera,
    domElement: renderer.domElement,
    truckDimensions: TRUCK_DIMENSIONS,
    cargoRegistry,
    collisionSystem,
    physicsWorld: world,
    onDragStateChange: (dragging) => {
      controls.enabled = !dragging;
      setIsBoxDragging(dragging);
    },
    onPositionChanged: (mesh, oldPos, newPos) => {
      if (saveToHistoryRef.current) {
        saveToHistoryRef.current(mesh, oldPos, newPos);
      }
    }
  });

  let lastTime = performance.now();
  let frames = 0;
  let animationFrameId = null;
  const clock = new THREE.Clock();

  const animate = () => {
    animationFrameId = requestAnimationFrame(animate);

    const delta = Math.min(clock.getDelta(), 1 / 20);

    if (physicsEnabledRef.current && cargoRegistry.length > 0) {
      world.step(1 / 60, delta, 5);
    }

    for (const entry of cargoRegistry) {
      if (!entry.body || !entry.mesh) continue;

      entry.mesh.position.set(
        entry.body.position.x,
        entry.body.position.y,
        entry.body.position.z
      );

      entry.mesh.quaternion.set(
        entry.body.quaternion.x,
        entry.body.quaternion.y,
        entry.body.quaternion.z,
        entry.body.quaternion.w
      );
    }

    controls.update();
    renderer.render(scene, camera);

    frames += 1;
    const now = performance.now();
    if (now >= lastTime + 1000) {
      setStats((prev) => ({
        ...prev,
        fps: Math.round((frames * 1000) / (now - lastTime))
      }));
      frames = 0;
      lastTime = now;
    }
  };

  const handleResize = () => {
    if (!mountEl) return;
    camera.aspect = mountEl.clientWidth / mountEl.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(mountEl.clientWidth, mountEl.clientHeight);
  };

  window.addEventListener('resize', handleResize);
  animate();
  setTimeout(() => setIsLoading(false), 100);

  const cleanup = () => {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    window.removeEventListener('resize', handleResize);
    controls.dispose();
    dragController.destroy();

    for (const entry of cargoRegistry) {
      if (entry.body) world.removeBody(entry.body);
      if (entry.mesh?.geometry) entry.mesh.geometry.dispose();
      if (entry.baseMaterial) entry.baseMaterial.dispose();
    }

    renderer.dispose();

    if (mountEl.contains(renderer.domElement)) {
      mountEl.removeChild(renderer.domElement);
    }

    physicsApiRef.current = null;
  };

  return {
    scene,
    camera,
    renderer,
    dragController,
    cleanup
  };
}