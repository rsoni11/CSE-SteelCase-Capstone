//RS 2/17 - Combined: collision system (Yash) + space utilization stats
//US1,2,3,5

import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

//box configs based on top 5 sizes from shipment- RS
const BOX_CONFIGS = [
  { 
    id: 'box1', 
    dimensions: { width: 17.5/12, height: 5.75/12, depth: 13.0/12 },
    color: '#FF6B35', 
    label: '17.5″ × 13″ × 5.75″'
  },
  { 
    id: 'box2', 
    dimensions: { width: 9.5/12, height: 48.0/12, depth: 4.5/12 }, 
    color: '#004E89', 
    label: '9.5″ × 4.5″ × 48″'
  },
  { 
    id: 'box3', 
    dimensions: { width: 30.25/12, height: 13.5/12, depth: 25.63/12 }, 
    color: '#1AA37A', 
    label: '30.25″ × 25.63″ × 13.5″'
  },
  { 
    id: 'box4', 
    dimensions: { width: 29.0/12, height: 5.5/12, depth: 26.0/12 }, 
    color: '#9B59B6', 
    label: '29″ × 26″ × 5.5″'
  },
  { 
    id: 'box5', 
    dimensions: { width: 12.75/12, height: 5.75/12, depth: 7.5/12 }, 
    color: '#E74C3C', 
    label: '12.75″ × 7.5″ × 5.75″'
  }
];

//standard 53' trailer dimensions- feet- RS
const TRUCK_DIMENSIONS = {
  length: 53,
  width: 8.5,
  height: 9
};

const TRUCK_VOLUME = TRUCK_DIMENSIONS.length * TRUCK_DIMENSIONS.height * TRUCK_DIMENSIONS.width;

// ─── Collision System (Yash - US5) ───────────────────────────────────────────
class CollisionSystem {
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

// ─── Drag Controller (Yash - US3) ────────────────────────────────────────────
class DragController {
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
    this.dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.heightOffset = 0;

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

    domElement.addEventListener('pointerdown', e => this.onDown(e));
    window.addEventListener('pointermove', e => this.onMove(e));
    window.addEventListener('pointerup', () => this.onUp());
    domElement.addEventListener('wheel', e => this.onWheel(e), { passive: false });
  }

  setMouse(e) {
    const rect = this.domElement.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  getMeshes() {
    return this.cargoRegistry.map(entry => entry.mesh);
  }

  onDown(e) {
    this.setMouse(e);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.raycaster.intersectObjects(this.getMeshes(), false);

    if (hits.length) {
      this.selectedEntry = this.cargoRegistry.find(entry => entry.mesh === hits[0].object);
      if (!this.selectedEntry) return;

      this.originalPosition = this.selectedEntry.mesh.position.clone();
      this.dragPlane.constant = this.selectedEntry.mesh.position.y;
      this.heightOffset = 0;
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

    const size = this.selectedEntry.size;
    const groundY = 0.1;
    const minY = groundY + size.y / 2;
    const maxY = 15;

    point.y = THREE.MathUtils.clamp(
      this.originalPosition.y + this.heightOffset,
      minY,
      maxY
    );

    point.x = Math.round(point.x / 0.05) * 0.05;
    point.z = Math.round(point.z / 0.05) * 0.05;
    point.y = Math.round(point.y / 0.1) * 0.1;

    const collides = this.collisionSystem.wouldCollide(this.selectedEntry.mesh, point, size);
    this.selectedEntry.mesh.material = collides ? this.collisionMaterial : this.highlightMaterial;

    if (!collides) {
      this.selectedEntry.mesh.position.copy(point);
    }
  }

  onWheel(e) {
    if (!this.dragging || !this.selectedEntry) return;
    e.preventDefault();
    e.stopPropagation();
    const delta = e.deltaY > 0 ? -0.2 : 0.2;
    this.heightOffset += delta;
  }

  onUp() {
    if (!this.dragging || !this.selectedEntry) return;

    this.selectedEntry.mesh.material = this.selectedEntry.baseMaterial;

    if (this.onPositionChanged && this.originalPosition) {
      const newPosition = this.selectedEntry.mesh.position.clone();
      if (!this.originalPosition.equals(newPosition)) {
        this.onPositionChanged(this.selectedEntry.mesh, this.originalPosition, newPosition);
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
    this.domElement.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    this.domElement.removeEventListener('wheel', this.onWheel);
  }
}

// ─── Main Component ───────────────────────────────────────────────────────────
const TruckLoadingPrototype = () => {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const controlsRef = useRef(null);
  const dragControllerRef = useRef(null);
  const cargoRegistryRef = useRef([]);
  const collisionSystemRef = useRef(null);
  const saveToHistoryRef = useRef(null);
  const physicsEnabledRef = useRef(true);

  const [boxes, setBoxes] = useState([]);
  const [selectedBoxType, setSelectedBoxType] = useState(BOX_CONFIGS[0]);
  const [stats, setStats] = useState({ fps: 60, boxCount: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [isPanelMinimized, setIsPanelMinimized] = useState(false);
  const [panelPosition, setPanelPosition] = useState({ x: 30, y: window.innerHeight - 420 });
  const [isDraggingPanel, setIsDraggingPanel] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isBoxDragging, setIsBoxDragging] = useState(false);

  // Undo/Redo state
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // ── Space utilization (derived from boxes state) ──
  const usedVolume = boxes.reduce((total, box) => {
    const config = BOX_CONFIGS.find(c => c.id === box.type);
    if (!config) return total;
    const { width, height, depth } = config.dimensions;
    return total + width * height * depth;
  }, 0);
  const volumePercentage = ((usedVolume / TRUCK_VOLUME) * 100).toFixed(2);

  // ── Three.js scene setup ──────────────────────────────────────────────────
  useEffect(() => {
    if (!mountRef.current) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf5f5f5);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      60,
      mountRef.current.clientWidth / mountRef.current.clientHeight,
      0.1,
      1000
    );
    camera.position.set(20, 25, 40);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 5;
    controls.maxDistance = 80;
    controls.maxPolarAngle = Math.PI / 2;
    controls.target.set(-20, TRUCK_DIMENSIONS.height / 2, 0);
    controlsRef.current = controls;

    // Lighting
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

    // Truck container
    const truckGroup = new THREE.Group();

    const floorGeometry = new THREE.BoxGeometry(TRUCK_DIMENSIONS.length, 0.2, TRUCK_DIMENSIONS.width);
    const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x8B7355, roughness: 0.8, metalness: 0.2 });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
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

    const ceilingGeometry = new THREE.BoxGeometry(TRUCK_DIMENSIONS.length, 0.2, TRUCK_DIMENSIONS.width);
    const ceiling = new THREE.Mesh(ceilingGeometry, wallMaterial);
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

    // Bay 1
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
    canvas.width = 512;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    context.fillStyle = '#F39C12';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#2C3E50';
    context.font = 'bold 120px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('BAY 1', canvas.width / 2, canvas.height / 2);

    const bayText = new THREE.Mesh(
      new THREE.BoxGeometry(4.8, 2.3, 0.1),
      new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(canvas), roughness: 0.2 })
    );
    bayText.position.set(-51.85, 9.25, -8);
    bayText.rotation.y = Math.PI / 2;
    bayGroup.add(bayText);

    scene.add(bayGroup);

    // Ground & grid
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

    // Init collision + drag systems (Yash)
    collisionSystemRef.current = new CollisionSystem(cargoRegistryRef.current);
    dragControllerRef.current = new DragController({
      camera,
      domElement: renderer.domElement,
      truckDimensions: TRUCK_DIMENSIONS,
      cargoRegistry: cargoRegistryRef.current,
      collisionSystem: collisionSystemRef.current,
      onDragStateChange: (dragging) => {
        controls.enabled = !dragging;
        setIsBoxDragging(dragging);
        physicsEnabledRef.current = !dragging;
      },
      onPositionChanged: (mesh, oldPos, newPos) => {
        if (saveToHistoryRef.current) {
          saveToHistoryRef.current(mesh, oldPos, newPos);
        }
      }
    });

    // Animation loop
    let lastTime = performance.now();
    let frames = 0;

    const animate = () => {
      requestAnimationFrame(animate);

      // Gravity physics
      if (physicsEnabledRef.current && cargoRegistryRef.current.length > 0) {
        const gravity = -0.03;
        const groundY = 0.1;

        cargoRegistryRef.current.forEach(entry => {
          const mesh = entry.mesh;
          const size = entry.size;
          const boxBottom = mesh.position.y - size.y / 2;

          if (boxBottom > groundY + 0.01) {
            let restingOnBox = false;
            for (const other of cargoRegistryRef.current) {
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
              const newBottom = mesh.position.y - size.y / 2;
              if (newBottom < groundY) {
                mesh.position.y = groundY + size.y / 2;
              }
            }
          }
        });
      }

      controls.update();
      renderer.render(scene, camera);

      frames++;
      const currentTime = performance.now();
      if (currentTime >= lastTime + 1000) {
        setStats(prev => ({ ...prev, fps: Math.round(frames * 1000 / (currentTime - lastTime)) }));
        frames = 0;
        lastTime = currentTime;
      }
    };

    const handleResize = () => {
      if (!mountRef.current) return;
      camera.aspect = mountRef.current.clientWidth / mountRef.current.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    };

    window.addEventListener('resize', handleResize);
    animate();
    setTimeout(() => setIsLoading(false), 100);

    return () => {
      window.removeEventListener('resize', handleResize);
      mountRef.current?.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, []);

  // ── Add Box ───────────────────────────────────────────────────────────────
  const addBox = () => {
    if (boxes.length >= 50) {
      alert('Maximum 50 boxes reached for performance');
      return;
    }

    const boxGeometry = new THREE.BoxGeometry(
      selectedBoxType.dimensions.width,
      selectedBoxType.dimensions.height,
      selectedBoxType.dimensions.depth
    );
    const boxMaterial = new THREE.MeshStandardMaterial({
      color: selectedBoxType.color,
      roughness: 0.5,
      metalness: 0.1
    });
    const box = new THREE.Mesh(boxGeometry, boxMaterial);

    const boxesPerRow = 4;
    const row = Math.floor(boxes.length / boxesPerRow);
    const col = boxes.length % boxesPerRow;
    const bayStartX = -50;
    const bayStartZ = -6;
    const spacingX = 4.5;
    const spacingZ = 3.5;

    box.position.set(
      bayStartX + col * spacingX + 2,
      selectedBoxType.dimensions.height / 2,
      bayStartZ + row * spacingZ + 2
    );
    box.castShadow = true;
    box.receiveShadow = true;

    const edgeLines = new THREE.LineSegments(
      new THREE.EdgesGeometry(boxGeometry),
      new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 2 })
    );
    box.add(edgeLines);

    sceneRef.current.add(box);

    // Register for collision system (Yash)
    const cargoEntry = {
      mesh: box,
      size: {
        x: selectedBoxType.dimensions.width,
        y: selectedBoxType.dimensions.height,
        z: selectedBoxType.dimensions.depth
      },
      baseMaterial: boxMaterial
    };
    cargoRegistryRef.current.push(cargoEntry);

    setBoxes(prev => [...prev, { id: Date.now(), mesh: box, type: selectedBoxType.id }]);
    setStats(prev => ({ ...prev, boxCount: prev.boxCount + 1 }));
  };

  // ── Clear Boxes ───────────────────────────────────────────────────────────
  const clearBoxes = () => {
    boxes.forEach(box => {
      sceneRef.current.remove(box.mesh);
      box.mesh.geometry.dispose();
      box.mesh.material.dispose();
    });
    cargoRegistryRef.current.length = 0;
    dragControllerRef.current?.clearRegistry();
    setBoxes([]);
    setStats(prev => ({ ...prev, boxCount: 0 }));
    setHistory([]);
    setHistoryIndex(-1);
  };

  // ── Undo / Redo ───────────────────────────────────────────────────────────
  const saveToHistory = (mesh, oldPos, newPos) => {
    const move = {
      meshId: mesh.uuid,
      oldPosition: oldPos.clone(),
      newPosition: newPos.clone()
    };
    setHistory(prev => {
      const newHistory = prev.slice(0, historyIndex + 1);
      newHistory.push(move);
      return newHistory;
    });
    setHistoryIndex(prev => prev + 1);
  };
  saveToHistoryRef.current = saveToHistory;

  const undo = () => {
    if (historyIndex < 0 || historyIndex >= history.length) return;
    const move = history[historyIndex];
    if (!move) return;
    const entry = cargoRegistryRef.current.find(e => e.mesh.uuid === move.meshId);
    if (entry) entry.mesh.position.copy(move.oldPosition);
    setHistoryIndex(prev => prev - 1);
    if (rendererRef.current && sceneRef.current && cameraRef.current) {
      rendererRef.current.render(sceneRef.current, cameraRef.current);
    }
  };

  const redo = () => {
    if (historyIndex >= history.length - 1) return;
    const move = history[historyIndex + 1];
    if (!move) return;
    const entry = cargoRegistryRef.current.find(e => e.mesh.uuid === move.meshId);
    if (entry) entry.mesh.position.copy(move.newPosition);
    setHistoryIndex(prev => prev + 1);
    if (rendererRef.current && sceneRef.current && cameraRef.current) {
      rendererRef.current.render(sceneRef.current, cameraRef.current);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [historyIndex, history]);

  // ── Panel Drag ────────────────────────────────────────────────────────────
  const handleMouseDown = (e) => {
    if (e.target.closest('.panel-header')) {
      setIsDraggingPanel(true);
      setDragOffset({ x: e.clientX - panelPosition.x, y: e.clientY - panelPosition.y });
    }
  };

  const handleMouseMove = (e) => {
    if (isDraggingPanel) {
      setPanelPosition({ x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y });
    }
  };

  const handleMouseUp = () => setIsDraggingPanel(false);

  useEffect(() => {
    if (isDraggingPanel) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDraggingPanel, dragOffset]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{
      width: '100vw', height: '100vh', margin: 0, padding: 0,
      overflow: 'hidden',
      fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      background: '#ffffff'
    }}>

      {/* Header */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        padding: '20px 30px',
        background: 'linear-gradient(to bottom, rgba(255,255,255,0.98), rgba(255,255,255,0.92))',
        backdropFilter: 'blur(10px)',
        borderBottom: '1px solid rgba(0,0,0,0.1)',
        zIndex: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center'
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 700, color: '#1a1a1a', letterSpacing: '-0.5px' }}>
            Truck Loading Simulator
          </h1>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#666', fontWeight: 400 }}>
            53' × 8.5' × 9' Standard Trailer
          </p>
        </div>

        {/* Stats bar */}
        <div style={{ display: 'flex', gap: '20px', fontSize: '13px', color: '#666', alignItems: 'center' }}>
          <div>
            <strong style={{ color: stats.fps >= 60 ? '#1AA37A' : '#FF6B35' }}>{stats.fps || 60} FPS</strong>
          </div>
          <div>Boxes: <strong>{stats.boxCount || 0}</strong></div>
          {/* Space utilization */}
          <div style={{
            background: 'rgba(0,0,0,0.05)', padding: '4px 10px', borderRadius: '6px'
          }}>
            Space Used: <strong>{usedVolume.toFixed(2)} ft³</strong> / {TRUCK_VOLUME} ft³
            <strong style={{ color: '#004E89', marginLeft: '6px' }}>({volumePercentage}%)</strong>
          </div>
          {isBoxDragging && (
            <div><strong style={{ color: '#9B59B6' }}>● Dragging</strong></div>
          )}
        </div>
      </div>

      {/* 3D Canvas */}
      <div ref={mountRef} style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }} />

      {/* Loading Overlay */}
      {isLoading && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          background: '#ffffff', display: 'flex', alignItems: 'center',
          justifyContent: 'center', zIndex: 100
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{
              width: '40px', height: '40px',
              border: '3px solid #e0e0e0', borderTop: '3px solid #004E89',
              borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 16px'
            }} />
            <p style={{ color: '#666', fontSize: '14px' }}>Loading 3D Environment...</p>
          </div>
        </div>
      )}

      {/* Control Panel */}
      <div
        style={{
          position: 'absolute', left: `${panelPosition.x}px`, top: `${panelPosition.y}px`,
          background: '#ffffff', borderRadius: '12px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)', minWidth: '320px', zIndex: 10, userSelect: 'none'
        }}
        onMouseDown={handleMouseDown}
      >
        {/* Draggable Header */}
        <div className="panel-header" style={{
          padding: '16px 20px',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          borderTopLeftRadius: '12px', borderTopRightRadius: '12px',
          cursor: 'move', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
        }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#ffffff' }}>Add Boxes</h3>
          <button
            onClick={() => setIsPanelMinimized(!isPanelMinimized)}
            style={{
              background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: '4px',
              color: '#ffffff', cursor: 'pointer', padding: '4px 12px', fontSize: '14px', fontWeight: 600
            }}
          >
            {isPanelMinimized ? '□' : '−'}
          </button>
        </div>

        {/* Panel Content */}
        {!isPanelMinimized && (
          <div style={{ padding: '24px' }}>
            {/* Box Type Selector */}
            <div style={{ marginBottom: '20px' }}>
              {BOX_CONFIGS.map(config => (
                <div
                  key={config.id}
                  onClick={() => setSelectedBoxType(config)}
                  style={{
                    padding: '12px 16px', marginBottom: '8px',
                    border: `2px solid ${selectedBoxType.id === config.id ? config.color : '#e0e0e0'}`,
                    borderRadius: '8px', cursor: 'pointer', transition: 'all 0.2s ease',
                    background: selectedBoxType.id === config.id ? `${config.color}10` : '#ffffff',
                    transform: selectedBoxType.id === config.id ? 'scale(1.02)' : 'scale(1)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ width: '24px', height: '24px', background: config.color, borderRadius: '4px', flexShrink: 0 }} />
                    <div style={{ fontSize: '14px', fontWeight: 600, color: '#1a1a1a' }}>{config.label}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Add Box */}
            <button
              onClick={addBox}
              disabled={boxes.length >= 50}
              style={{
                width: '100%', padding: '12px 24px', background: selectedBoxType.color,
                color: '#ffffff', border: 'none', borderRadius: '8px',
                fontSize: '14px', fontWeight: 600,
                cursor: boxes.length >= 50 ? 'not-allowed' : 'pointer',
                opacity: boxes.length >= 50 ? 0.5 : 1,
                transition: 'all 0.2s ease', marginBottom: '8px'
              }}
              onMouseEnter={(e) => { if (boxes.length < 50) { e.target.style.transform = 'translateY(-2px)'; e.target.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)'; } }}
              onMouseLeave={(e) => { e.target.style.transform = 'translateY(0)'; e.target.style.boxShadow = 'none'; }}
            >
              Add Box ({selectedBoxType.label.split(' ')[0]}″)
            </button>

            {/* Clear All */}
            <button
              onClick={clearBoxes}
              disabled={boxes.length === 0}
              style={{
                width: '100%', padding: '12px 24px', background: '#ffffff',
                color: '#666', border: '2px solid #e0e0e0', borderRadius: '8px',
                fontSize: '14px', fontWeight: 600,
                cursor: boxes.length === 0 ? 'not-allowed' : 'pointer',
                opacity: boxes.length === 0 ? 0.5 : 1,
                transition: 'all 0.2s ease', marginBottom: '8px'
              }}
              onMouseEnter={(e) => { if (boxes.length > 0) { e.target.style.borderColor = '#FF6B35'; e.target.style.color = '#FF6B35'; } }}
              onMouseLeave={(e) => { e.target.style.borderColor = '#e0e0e0'; e.target.style.color = '#666'; }}
            >
              Clear All Boxes
            </button>

            {/* Undo / Redo */}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={undo}
                disabled={historyIndex < 0}
                style={{
                  flex: 1, padding: '12px 16px', background: '#ffffff',
                  color: '#667eea', border: '2px solid #667eea', borderRadius: '8px',
                  fontSize: '14px', fontWeight: 600,
                  cursor: historyIndex < 0 ? 'not-allowed' : 'pointer',
                  opacity: historyIndex < 0 ? 0.5 : 1, transition: 'all 0.2s ease'
                }}
              >
                ↶ Undo
              </button>
              <button
                onClick={redo}
                disabled={historyIndex >= history.length - 1}
                style={{
                  flex: 1, padding: '12px 16px', background: '#ffffff',
                  color: '#667eea', border: '2px solid #667eea', borderRadius: '8px',
                  fontSize: '14px', fontWeight: 600,
                  cursor: historyIndex >= history.length - 1 ? 'not-allowed' : 'pointer',
                  opacity: historyIndex >= history.length - 1 ? 0.5 : 1, transition: 'all 0.2s ease'
                }}
              >
                Redo ↷
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Controls Guide */}
      <div style={{
        position: 'absolute', top: 100, right: 30,
        background: 'rgba(255,255,255,0.95)', borderRadius: '12px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
        padding: '16px 20px', fontSize: '13px', color: '#666', maxWidth: '220px', zIndex: 10
      }}>
        <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: 600, color: '#1a1a1a' }}>Camera Controls</h4>
        <div style={{ lineHeight: '1.8' }}>
          <div><strong>Rotate:</strong> Left click + drag</div>
          <div><strong>Zoom:</strong> Scroll wheel</div>
          <div><strong>Pan:</strong> Right click + drag</div>
        </div>
        <hr style={{ border: 'none', borderTop: '1px solid #e0e0e0', margin: '12px 0' }} />
        <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 600, color: '#1a1a1a' }}>Box Controls</h4>
        <div style={{ lineHeight: '1.8' }}>
          <div><strong>Move box:</strong> Click + drag</div>
          <div><strong>Raise/Lower:</strong> Scroll while dragging</div>
          <div><strong style={{ color: '#4aa3ff' }}>Blue:</strong> Valid placement</div>
          <div><strong style={{ color: '#ff0000' }}>Red:</strong> Collision!</div>
        </div>
      </div>

      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default TruckLoadingPrototype;