//RS 2/17
//combined with Yash code
//US1,2,3,5

import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

//box configs based on top 5 sizes from shipment- RS
//box sizes- RS
const BOX_CONFIGS = [
  { 
    id: 'box1', 
    dimensions: { width: 17.5/12, height: 5.75/12, depth: 13.0/12 }, //inches to feet
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

//YASH CODE HERE

//collisions detection system
//us5
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

//drag controller
//us3
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
    
    this.heightOffset = 0; //vertical offset controlled by scroll wheel

    
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
      this.selectedEntry = this.cargoRegistry.find(
        entry => entry.mesh === hits[0].object
      );
      if (!this.selectedEntry) return;

      //save position BEFORE drag starts for undo/redo
      this.originalPosition = this.selectedEntry.mesh.position.clone();
      
      this.dragPlane.constant = this.selectedEntry.mesh.position.y;
      this.heightOffset = 0; //reset height offset
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
    
    //apply height offset from scroll wheel
    const groundY = 0.1; //floor level
    const minY = groundY + size.y / 2; //bottom of box touches floor
    const maxY = 15; //max height (about 15 feet)
    
    point.y = THREE.MathUtils.clamp(
      this.originalPosition.y + this.heightOffset,
      minY,
      maxY
    );

    
    point.x = Math.round(point.x / 0.05) * 0.05;
    point.z = Math.round(point.z / 0.05) * 0.05;
    point.y = Math.round(point.y / 0.1) * 0.1; //snap Y to 0.1ft grid

    //collision check- Yash (US5)
    const collides = this.collisionSystem.wouldCollide(
      this.selectedEntry.mesh,
      point,
      size
    );

    
    this.selectedEntry.mesh.material = collides
      ? this.collisionMaterial
      : this.highlightMaterial;

    if (!collides) {
      this.selectedEntry.mesh.position.copy(point);
    }
  }

  onWheel(e) {
    //only handle wheel when dragging a box
    if (!this.dragging || !this.selectedEntry) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    //scroll up = raise box, scroll down = lower box
    const delta = e.deltaY > 0 ? -0.2 : 0.2; //0.2 feet per scroll
    this.heightOffset += delta;
  }

  
  onUp() {
    if (!this.dragging || !this.selectedEntry) return;

    this.selectedEntry.mesh.material = this.selectedEntry.baseMaterial;
    
    //save position change to history for undo/redo (old -> new)
    if (this.onPositionChanged && this.originalPosition) {
      const newPosition = this.selectedEntry.mesh.position.clone();
      //only save if position actually changed
      if (!this.originalPosition.equals(newPosition)) {
        this.onPositionChanged(
          this.selectedEntry.mesh,
          this.originalPosition,
          newPosition
        );
      }
    }
    
    this.dragging = false;
    this.selectedEntry = null;
    this.originalPosition = null;
    this.onDragStateChange(false);
  }

  //called when boxes are cleared so controller stays in sync- RS
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


const TruckLoadingPrototype = () => {
  const mountRef = useRef(null);
    const sceneRef = useRef(null);
    const cameraRef = useRef(null);
    const rendererRef = useRef(null);
    const controlsRef = useRef(null);
    const dragControllerRef = useRef(null);   //Yash drag controller ref- RS
    const cargoRegistryRef = useRef([]);      //shared cargo list for collision- RS+Yash
    const collisionSystemRef = useRef(null);  //Yash collision system ref- RS
    const saveToHistoryRef = useRef(null);    //ref to saveToHistory function for callbacks- RS
    const physicsEnabledRef = useRef(true);   //toggle physics on/off during drag- RS
  
    const [boxes, setBoxes] = useState([]);
    const [selectedBoxType, setSelectedBoxType] = useState(BOX_CONFIGS[0]);
    const [stats, setStats] = useState({ fps: 60, boxCount: 0 });
    const [isLoading, setIsLoading] = useState(true);
    const [isPanelMinimized, setIsPanelMinimized] = useState(false);
    const [panelPosition, setPanelPosition] = useState({ x: 30, y: window.innerHeight - 420 });
    const [isDraggingPanel, setIsDraggingPanel] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
    const [isBoxDragging, setIsBoxDragging] = useState(false); //track 3D drag for UI hint- RS
    
    //UNDO REDO FUNCTION HERE
    const [history, setHistory] = useState([]);
    const [historyIndex, setHistoryIndex] = useState(-1);

  useEffect(() => {
    if (!mountRef.current) return;

    //scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf5f5f5);
    sceneRef.current = scene;

    //camera set up- RS
    const camera = new THREE.PerspectiveCamera(
      60,
      mountRef.current.clientWidth / mountRef.current.clientHeight,
      0.1,
      1000
    );
    camera.position.set(20, 25, 40);
    cameraRef.current = camera;

    //renderer setup- RS
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    //orbit controls with constraints- RS
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 5;
    controls.maxDistance = 80;
    controls.maxPolarAngle = Math.PI / 2;
    controls.target.set(-20, TRUCK_DIMENSIONS.height / 2, 0); 
    controlsRef.current = controls;

    //lighting setup- RS
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

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

    //truck/ container dim- 53' × 8.5' × 9'- RS
    const truckGroup = new THREE.Group();

    //floor setup - RS
    const floorGeometry = new THREE.BoxGeometry(
      TRUCK_DIMENSIONS.length,
      0.2,
      TRUCK_DIMENSIONS.width
    );
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: 0x8B7355,
      roughness: 0.8,
      metalness: 0.2
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.position.y = 0.1;
    floor.receiveShadow = true;
    truckGroup.add(floor);

    //semi-transparent wall material- edit RS
    //2/15 change
    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0xC0C0C0,
      roughness: 0.7,
      metalness: 0.3,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide
    });
    //RS Walls
    //left wall
    const sideWallGeometry = new THREE.BoxGeometry(
      TRUCK_DIMENSIONS.length,
      TRUCK_DIMENSIONS.height,
      0.2
    );
    const leftWall = new THREE.Mesh(sideWallGeometry, wallMaterial);
    leftWall.position.set(0, TRUCK_DIMENSIONS.height / 2, -TRUCK_DIMENSIONS.width / 2);
    leftWall.receiveShadow = true;
    truckGroup.add(leftWall);

    //right wall
    const rightWall = new THREE.Mesh(sideWallGeometry, wallMaterial);
    rightWall.position.set(0, TRUCK_DIMENSIONS.height / 2, TRUCK_DIMENSIONS.width / 2);
    rightWall.receiveShadow = true;
    truckGroup.add(rightWall);

    //ceiling
    const ceilingGeometry = new THREE.BoxGeometry(
      TRUCK_DIMENSIONS.length,
      0.2,
      TRUCK_DIMENSIONS.width
    );
    const ceiling = new THREE.Mesh(ceilingGeometry, wallMaterial);
    ceiling.position.y = TRUCK_DIMENSIONS.height - 0.1;
    ceiling.receiveShadow = true;
    truckGroup.add(ceiling);

     const edgesGeometry = new THREE.EdgesGeometry(floorGeometry);
    const edgesMaterial = new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 2 });
    const floorEdges = new THREE.LineSegments(edgesGeometry, edgesMaterial);
    floorEdges.position.copy(floor.position);
    truckGroup.add(floorEdges);

    scene.add(truckGroup);

    //bay1 loading/ box are - RS
    const bayGroup = new THREE.Group();
    
    //bay 1 floor- RS
    const bayFloorGeometry = new THREE.PlaneGeometry(20, 15);
    const bayFloorMaterial = new THREE.MeshStandardMaterial({
      color: 0xF39C12,
      roughness: 0.9,
      metalness: 0.1,
      transparent: true,
      opacity: 0.3
    });
    const bayFloor = new THREE.Mesh(bayFloorGeometry, bayFloorMaterial);
    bayFloor.rotation.x = -Math.PI / 2;
    bayFloor.position.set(-40, 0.01, 0); 
    bayFloor.receiveShadow = true;
    bayGroup.add(bayFloor);

    //bay 1 border - RS
    const bayBorderPoints = [
      new THREE.Vector3(-50, 0.02, -7.5),
      new THREE.Vector3(-30, 0.02, -7.5),
      new THREE.Vector3(-30, 0.02, 7.5),
      new THREE.Vector3(-50, 0.02, 7.5),
      new THREE.Vector3(-50, 0.02, -7.5)
    ];
    const bayBorderGeometry = new THREE.BufferGeometry().setFromPoints(bayBorderPoints);
    const bayBorderMaterial = new THREE.LineBasicMaterial({ 
      color: 0xF39C12, 
      linewidth: 3 
    });
    const bayBorder = new THREE.Line(bayBorderGeometry, bayBorderMaterial);
    bayGroup.add(bayBorder);

    //bay 1 sign- RS
    const labelPostGeometry = new THREE.BoxGeometry(0.6, 8, 0.6);
    const labelPostMaterial = new THREE.MeshStandardMaterial({
      color: 0xF39C12,
      roughness: 0.5,
      metalness: 0.5
    });
    const labelPost = new THREE.Mesh(labelPostGeometry, labelPostMaterial);
    labelPost.position.set(-52, 4, -8);
    labelPost.castShadow = true;
    bayGroup.add(labelPost);

   //edit 2/15 bay 1 sign RS
    const signGeometry = new THREE.BoxGeometry(5, 2.5, 0.3);
    const signMaterial = new THREE.MeshStandardMaterial({
      color: 0xF39C12,
      roughness: 0.3,
      metalness: 0.1
    });
    const sign = new THREE.Mesh(signGeometry, signMaterial);
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
    

    const texture = new THREE.CanvasTexture(canvas);
    const textMaterial = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.2
    });
  
    const textGeometry = new THREE.BoxGeometry(4.8, 2.3, 0.1);
    const bayText = new THREE.Mesh(textGeometry, textMaterial);
    bayText.position.set(-51.85, 9.25, -8); 
    bayText.rotation.y = Math.PI / 2; 
    bayGroup.add(bayText);

    scene.add(bayGroup);

    //ground plane RS
    const groundGeometry = new THREE.PlaneGeometry(200, 200);
    const groundMaterial = new THREE.MeshStandardMaterial({
      color: 0xe0e0e0,
      roughness: 0.9
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.1;
    ground.receiveShadow = true;
    scene.add(ground);

   
    const gridHelper = new THREE.GridHelper(100, 50, 0xcccccc, 0xdddddd);
    gridHelper.position.y = 0;
    scene.add(gridHelper);

    //init Yash's collision system with shared cargo registry-Yash
    collisionSystemRef.current = new CollisionSystem(cargoRegistryRef.current);

    //init Yash's drag controller-Yash
    //disables orbit controls during drag so camera stays still
    dragControllerRef.current = new DragController({
      camera,
      domElement: renderer.domElement,
      truckDimensions: TRUCK_DIMENSIONS,
      cargoRegistry: cargoRegistryRef.current,
      collisionSystem: collisionSystemRef.current,
      onDragStateChange: (dragging) => {
        controls.enabled = !dragging;
        setIsBoxDragging(dragging);
        physicsEnabledRef.current = !dragging; //disable physics while dragging
      },
      onPositionChanged: (mesh, oldPos, newPos) => {
        if (saveToHistoryRef.current) {
          saveToHistoryRef.current(mesh, oldPos, newPos);
        }
      }
    });
    //fps counter...add?keep? RS
    let lastTime = performance.now();
    let frames = 0;

    
    const animate = () => {
      requestAnimationFrame(animate);
      
      //GRAVITY PHYSICS - apply gravity to all boxes
      if (physicsEnabledRef.current && cargoRegistryRef.current.length > 0) {
        const gravity = -0.03; //gravity strength (feet per frame squared)
        const groundY = 0.1; //floor height
        
        cargoRegistryRef.current.forEach(entry => {
          const mesh = entry.mesh;
          const size = entry.size;
          
          //check if box is floating (nothing below it)
          const boxBottom = mesh.position.y - size.y / 2;
          
          if (boxBottom > groundY + 0.01) { //not on ground
            //check if box is resting on another box
            let restingOnBox = false;
            
            for (const other of cargoRegistryRef.current) {
              if (other.mesh === mesh) continue;
              
              const otherTop = other.mesh.position.y + other.size.y / 2;
              const otherBottom = other.mesh.position.y - other.size.y / 2;
              
              //check if this box is directly above the other box
              const horizontalOverlap = 
                Math.abs(mesh.position.x - other.mesh.position.x) < (size.x / 2 + other.size.x / 2) &&
                Math.abs(mesh.position.z - other.mesh.position.z) < (size.z / 2 + other.size.z / 2);
              
              const verticallyClose = Math.abs(boxBottom - otherTop) < 0.05;
              
              if (horizontalOverlap && verticallyClose) {
                restingOnBox = true;
                //snap to exact top of other box
                mesh.position.y = otherTop + size.y / 2;
                break;
              }
            }
            
            //if not resting on anything, apply gravity
            if (!restingOnBox) {
              mesh.position.y += gravity;
              
              //don't fall through floor
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

      //FPS calculation- RS...add?keep?
      frames++;
      const currentTime = performance.now();
      if (currentTime >= lastTime + 1000) {
        setStats(prev => ({ ...prev, fps: Math.round(frames * 1000 / (currentTime - lastTime)) }));
        frames = 0;
        lastTime = currentTime;
      }
    };

    //window resize- RS
    const handleResize = () => {
      if (!mountRef.current) return;
      camera.aspect = mountRef.current.clientWidth / mountRef.current.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    };

    window.addEventListener('resize', handleResize);
    animate();
    setTimeout(() => setIsLoading(false), 100);

    //cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      mountRef.current?.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, []);

  //add box - RS, final this works
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
    
    //spawn boxes in Bay 1- RS
    //this works 2/15
    const boxesPerRow = 4;
    const row = Math.floor(boxes.length / boxesPerRow);
    const col = boxes.length % boxesPerRow;
    
    //bay 1- x=-40, z=0 dime 20×15
    const bayStartX = -50; //left edge of bay
    const bayStartZ = -6;  //front edge of bay
    const spacingX = 4.5;
    const spacingZ = 3.5;
    
    box.position.set(
      bayStartX + col * spacingX + 2,
      selectedBoxType.dimensions.height / 2, 
      bayStartZ + row * spacingZ + 2
    );
    
    box.castShadow = true;
    box.receiveShadow = true;

    
    const edges = new THREE.EdgesGeometry(boxGeometry);
    const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 2 });
    const edgeLines = new THREE.LineSegments(edges, edgeMaterial);
    box.add(edgeLines);

    sceneRef.current.add(box);

    //collision system- RS
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

    const newBox = {
      id: Date.now(),
      mesh: box,
      type: selectedBoxType.id
    };
    
    setBoxes(prev => [...prev, newBox]);
    setStats(prev => ({ ...prev, boxCount: prev.boxCount + 1 }));
  };

  const clearBoxes = () => {
    boxes.forEach(box => {
      sceneRef.current.remove(box.mesh);
      box.mesh.geometry.dispose();
      box.mesh.material.dispose();
    });
    //clear collision registry- rhea
    cargoRegistryRef.current.length = 0;
    dragControllerRef.current?.clearRegistry();
    setBoxes([]);
    setStats(prev => ({ ...prev, boxCount: 0 }));
    //clear history when clearing all boxes
    setHistory([]);
    setHistoryIndex(-1);
  };

  //UNDO REDO FUNCTION HERE
  const saveToHistory = (mesh, oldPos, newPos) => {
    const move = {
      meshId: mesh.uuid,
      oldPosition: oldPos.clone(),
      newPosition: newPos.clone()
    };
    
    setHistory(prev => {
      //discard any "future" history when making new move
      const newHistory = prev.slice(0, historyIndex + 1);
      newHistory.push(move);
      return newHistory;
    });
    setHistoryIndex(prev => prev + 1);
  };
  
  //store in ref so DragController callback can access it
  saveToHistoryRef.current = saveToHistory;

  const undo = () => {
    if (historyIndex < 0 || historyIndex >= history.length) return;
    
    const move = history[historyIndex];
    if (!move) return; //safety check
    
    const entry = cargoRegistryRef.current.find(e => e.mesh.uuid === move.meshId);
    if (entry) {
      entry.mesh.position.copy(move.oldPosition);
    }
    setHistoryIndex(prev => prev - 1);
    
    //force scene update
    if (rendererRef.current && sceneRef.current && cameraRef.current) {
      rendererRef.current.render(sceneRef.current, cameraRef.current);
    }
  };

  const redo = () => {
    if (historyIndex >= history.length - 1) return;
    
    const move = history[historyIndex + 1];
    if (!move) return; //safety check
    
    const entry = cargoRegistryRef.current.find(e => e.mesh.uuid === move.meshId);
    if (entry) {
      entry.mesh.position.copy(move.newPosition);
    }
    setHistoryIndex(prev => prev + 1);
    
    //force scene update
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



  
  const handleMouseDown = (e) => {
    if (e.target.closest('.panel-header')) {
      setIsDraggingPanel(true)
      setDragOffset({
        x: e.clientX - panelPosition.x,
        y: e.clientY - panelPosition.y
      });
    }
  };

  const handleMouseMove = (e) => {
    if (isDraggingPanel) {
      setPanelPosition({
        x: e.clientX - dragOffset.x,
        y: e.clientY - dragOffset.y
      });
    }
  };

  const handleMouseUp = () => {
    setIsDraggingPanel(false);
  };

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

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      margin: 0,
      padding: 0,
      overflow: 'hidden',
      fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      background: '#ffffff'
    }}>
      {/* Header */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        padding: '20px 30px',
        background: 'linear-gradient(to bottom, rgba(255,255,255,0.98), rgba(255,255,255,0.92))',
        backdropFilter: 'blur(10px)',
        borderBottom: '1px solid rgba(0,0,0,0.1)',
        zIndex: 10,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div>
          <h1 style={{
            margin: 0,
            fontSize: '24px',
            fontWeight: 700,
            color: '#1a1a1a',
            letterSpacing: '-0.5px'
          }}>
            Truck Loading Simulator
          </h1>
          <p style={{
            margin: '4px 0 0 0',
            fontSize: '13px',
            color: '#666',
            fontWeight: 400
          }}>
            53' × 8.5' × 9' Standard Trailer
          </p>
        </div>
        
        {/* Performance Stats */}
        <div style={{
          display: 'flex',
          gap: '20px',
          fontSize: '13px',
          color: '#666'
        }}>
          <div>
            <strong style={{ color: stats.fps >= 60 ? '#1AA37A' : '#FF6B35' }}>
              {stats.fps || 60} FPS
            </strong>
          </div>
          <div>
             Boxes: <strong>{stats.boxCount || 0}</strong>
          </div>
          {/* show drag mode indicator when dragging a box- RS */}
          {isBoxDragging && (
            <div>
              <strong style={{ color: '#9B59B6' }}>● Dragging</strong>
            </div>
          )}
        </div>
      </div>

      {/* 3D Canvas */}
      <div 
        ref={mountRef} 
        style={{
          width: '100%',
          height: '100%',
          position: 'absolute',
          top: 0,
          left: 0
        }}
      />

      {/* Loading Overlay */}
      {isLoading && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: '#ffffff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{
              width: '40px',
              height: '40px',
              border: '3px solid #e0e0e0',
              borderTop: '3px solid #004E89',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              margin: '0 auto 16px'
            }} />
            <p style={{ color: '#666', fontSize: '14px' }}>Loading 3D Environment...</p>
          </div>
        </div>
      )}

      {/* Control Panel - Draggable & Minimizable */}
      <div 
        style={{
          position: 'absolute',
          left: `${panelPosition.x}px`,
          top: `${panelPosition.y}px`,
          background: '#ffffff',
          borderRadius: '12px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
          minWidth: '320px',
          zIndex: 10,
          userSelect: 'none'
        }}
        onMouseDown={handleMouseDown}
      >
        {/* Draggable Header */}
        <div 
          className="panel-header"
          style={{
            padding: '16px 20px',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            borderTopLeftRadius: '12px',
            borderTopRightRadius: '12px',
            cursor: 'move',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <h3 style={{
            margin: 0,
            fontSize: '16px',
            fontWeight: 600,
            color: '#ffffff'
          }}>
            Add Boxes
          </h3>
          <button
            onClick={() => setIsPanelMinimized(!isPanelMinimized)}
            style={{
              background: 'rgba(255,255,255,0.2)',
              border: 'none',
              borderRadius: '4px',
              color: '#ffffff',
              cursor: 'pointer',
              padding: '4px 12px',
              fontSize: '14px',
              fontWeight: 600
            }}
          >
            {isPanelMinimized ? '□' : '−'}
          </button>
        </div>

        {/* Panel Content (collapsible) */}
        {!isPanelMinimized && (
          <div style={{ padding: '24px' }}>
            {/* Box Type Selector */}
            <div style={{ marginBottom: '20px' }}>
              {BOX_CONFIGS.map(config => (
                <div
                  key={config.id}
                  onClick={() => setSelectedBoxType(config)}
                  style={{
                    padding: '12px 16px',
                    marginBottom: '8px',
                    border: `2px solid ${selectedBoxType.id === config.id ? config.color : '#e0e0e0'}`,
                    borderRadius: '8px',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    background: selectedBoxType.id === config.id ? `${config.color}10` : '#ffffff',
                    transform: selectedBoxType.id === config.id ? 'scale(1.02)' : 'scale(1)'
                  }}
                >
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px'
                  }}>
                    <div style={{
                      width: '24px',
                      height: '24px',
                      background: config.color,
                      borderRadius: '4px',
                      flexShrink: 0
                    }} />
                    <div style={{ flex: 1 }}>
                      <div style={{
                        fontSize: '14px',
                        fontWeight: 600,
                        color: '#1a1a1a'
                      }}>
                        {config.label}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Action Buttons */}
            <button
              onClick={addBox}
              disabled={boxes.length >= 50}
              style={{
                width: '100%',
                padding: '12px 24px',
                background: selectedBoxType.color,
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: boxes.length >= 50 ? 'not-allowed' : 'pointer',
                opacity: boxes.length >= 50 ? 0.5 : 1,
                transition: 'all 0.2s ease',
                marginBottom: '8px'
              }}
              onMouseEnter={(e) => {
                if (boxes.length < 50) {
                  e.target.style.transform = 'translateY(-2px)';
                  e.target.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)';
                }
              }}
              onMouseLeave={(e) => {
                e.target.style.transform = 'translateY(0)';
                e.target.style.boxShadow = 'none';
              }}
            >
              Add Box ({selectedBoxType.label.split(' ')[0]}″)
            </button>

            <button
              onClick={clearBoxes}
              disabled={boxes.length === 0}
              style={{
                width: '100%',
                padding: '12px 24px',
                background: '#ffffff',
                color: '#666',
                border: '2px solid #e0e0e0',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: boxes.length === 0 ? 'not-allowed' : 'pointer',
                opacity: boxes.length === 0 ? 0.5 : 1,
                transition: 'all 0.2s ease',
                marginBottom: '8px'
              }}
              onMouseEnter={(e) => {
                if (boxes.length > 0) {
                  e.target.style.borderColor = '#FF6B35';
                  e.target.style.color = '#FF6B35';
                }
              }}
              onMouseLeave={(e) => {
                e.target.style.borderColor = '#e0e0e0';
                e.target.style.color = '#666';
              }}
            >
              Clear All Boxes
            </button>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={undo}
                disabled={historyIndex < 0}
                style={{
                  flex: 1,
                  padding: '12px 16px',
                  background: '#ffffff',
                  color: '#667eea',
                  border: '2px solid #667eea',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: historyIndex < 0 ? 'not-allowed' : 'pointer',
                  opacity: historyIndex < 0 ? 0.5 : 1,
                  transition: 'all 0.2s ease'
                }}
              >
                ↶ Undo
              </button>
              <button
                onClick={redo}
                disabled={historyIndex >= history.length - 1}
                style={{
                  flex: 1,
                  padding: '12px 16px',
                  background: '#ffffff',
                  color: '#667eea',
                  border: '2px solid #667eea',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: historyIndex >= history.length - 1 ? 'not-allowed' : 'pointer',
                  opacity: historyIndex >= history.length - 1 ? 0.5 : 1,
                  transition: 'all 0.2s ease'
                }}
              >
                Redo ↷
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Controls Guide - updated with drag instructions- RS+Yash */}
      <div style={{
        position: 'absolute',
        top: 100,
        right: 30,
        background: 'rgba(255,255,255,0.95)',
        borderRadius: '12px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
        padding: '16px 20px',
        fontSize: '13px',
        color: '#666',
        maxWidth: '220px',
        zIndex: 10
      }}>
        <h4 style={{
          margin: '0 0 12px 0',
          fontSize: '14px',
          fontWeight: 600,
          color: '#1a1a1a'
        }}>
          Camera Controls
        </h4>
        <div style={{ lineHeight: '1.8' }}>
          <div><strong>Rotate:</strong> Left click + drag</div>
          <div><strong>Zoom:</strong> Scroll wheel</div>
          <div><strong>Pan:</strong> Right click + drag</div>
        </div>
        <hr style={{ border: 'none', borderTop: '1px solid #e0e0e0', margin: '12px 0' }} />
        <h4 style={{
          margin: '0 0 8px 0',
          fontSize: '14px',
          fontWeight: 600,
          color: '#1a1a1a'
        }}>
          Box Controls
        </h4>
        <div style={{ lineHeight: '1.8' }}>
          <div><strong>Move box:</strong> Click + drag</div>
          <div><strong>Raise/Lower:</strong> Scroll while dragging</div>
          <div><strong style={{ color: '#4aa3ff' }}>Blue:</strong> Valid placement</div>
          <div><strong style={{ color: '#ff0000' }}>Red:</strong> Collision!</div>
        </div>
      </div>

      {/* Animation keyframes */}
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
//RS 2/15
