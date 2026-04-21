import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

import {
  BOX_CONFIGS,
  TRUCK_DIMENSIONS,
  TRUCK_VOLUME,
  MAX_BOXES,
  STRESS_TEST_TARGET,         // US6 Yash
  HEAVY_BOX_MASS_THRESHOLD    // US5 Rhea
} from './constants';
import { STEELCASE_LOAD_EXAMPLES } from './loadExamples';   // US1 Yash
import { initScene } from './TruckScene';
import { useHistory } from './useHistory';
import { FitSuggestionSystem } from './FitSuggestionSystem';
import { GhostPreview } from './GhostPreview';
import Header from './Header';
import ControlPanel from './ControlPanel';
import ControlsGuide from './ControlsGuide';
import ShipmentSummary from './ShipmentSummary';             // Becky
import SessionCompleteScreen from './SessionCompleteScreen'; // US2 Rhea

// ── US5 Rhea: floating FRAGILE sprite ─────────────────────────────────────
function createFragileLabel(heightFt) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(231,76,60,0.88)';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(4, 4, 248, 56, 10);
  else ctx.rect(4, 4, 248, 56);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 26px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('⚠ FRAGILE', 128, 32);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false })
  );
  sprite.scale.set(1.2, 0.3, 1);
  sprite.position.set(0, heightFt / 2 + 0.28, 0);
  return sprite;
}

const TruckLoadingPrototype = () => {
  // ── Refs ───────────────────────────────────────────────────────────────────
  const mountRef           = useRef(null);
  const sceneRef           = useRef(null);
  const cameraRef          = useRef(null);
  const rendererRef        = useRef(null);
  const dragControllerRef  = useRef(null);
  const cargoRegistryRef   = useRef([]);
  const saveToHistoryRef   = useRef(null);
  const physicsEnabledRef  = useRef(true);
  const physicsApiRef      = useRef(null);
  const ghostPreviewRef    = useRef(null);
  const fitSystemRef       = useRef(null);
  // US6 Yash: geometry/material caches
  const geometryCacheRef   = useRef(new Map());
  const edgeCacheRef       = useRef(new Map());
  const materialCacheRef   = useRef(new Map());
  const lineMaterialRef    = useRef(new THREE.LineBasicMaterial({ color: 0x000000 }));
  const fragilePinkLineRef = useRef(new THREE.LineBasicMaterial({ color: 0xff0066 })); // US5
  const statsRef           = useRef({ fps: 60, boxCount: 0 });
  // US2 Rhea: snapshot for Try Again
  const initialLoadSnapshotRef = useRef(null);

  // ── State ──────────────────────────────────────────────────────────────────
  const [boxes, setBoxes]                             = useState([]);
  const [availableBoxes, setAvailableBoxes]           = useState(BOX_CONFIGS);
  const [selectedBoxType, setSelectedBoxType]         = useState(BOX_CONFIGS[0]);
  const [stats, setStats]                             = useState({ fps: 60, boxCount: 0 });
  const [isLoading, setIsLoading]                     = useState(true);
  const [isBoxDragging, setIsBoxDragging]             = useState(false);
  const [suggestion, setSuggestion]                   = useState(null);
  const [isCalcSuggestion, setIsCalcSuggestion]       = useState(false);
  // US1 Yash: load examples + queue
  const [boxQueue, setBoxQueue]                       = useState([]);
  const [selectedExampleName, setSelectedExampleName] = useState('Manual');
  const [selectedExampleId, setSelectedExampleId]     = useState(null);
  const [queueSummary, setQueueSummary]               = useState([]);
  // US6 Yash: stress test
  const [stressResult, setStressResult]               = useState(null);
  const [isStressTestRunning, setIsStressTestRunning] = useState(false);
  // Becky: stop filter (ShipmentSummary)
  const [activeStopFilter, setActiveStopFilter]       = useState(null);
  // US2 Rhea: session complete
  const [showSessionComplete, setShowSessionComplete] = useState(false);
  // US5 Rhea: fragile warning toast
  const [fragileWarning, setFragileWarning]           = useState(null);

  // ── History ────────────────────────────────────────────────────────────────
  const { history, historyIndex, saveToHistory, undo, redo, clearHistory } =
    useHistory(cargoRegistryRef, rendererRef, sceneRef, cameraRef);
  saveToHistoryRef.current = saveToHistory;

  // ── Space utilization ──────────────────────────────────────────────────────
  const usedVolume = boxes.reduce((total, box) => {
    const pos = box.mesh.position;
    const isInsideTruck =
      pos.x > -TRUCK_DIMENSIONS.length / 2 && pos.x < TRUCK_DIMENSIONS.length / 2 &&
      pos.z > -TRUCK_DIMENSIONS.width  / 2 && pos.z < TRUCK_DIMENSIONS.width  / 2;
    if (!isInsideTruck) return total;
    const config = availableBoxes.find(c => c.id === box.type) || BOX_CONFIGS.find(c => c.id === box.type);
    if (!config) return total;
    return total + config.dimensions.width * config.dimensions.height * config.dimensions.depth;
  }, 0);

  const volumePercentage = ((usedVolume / TRUCK_VOLUME) * 100).toFixed(2);

  useEffect(() => { statsRef.current = stats; }, [stats]);

  // ── US5 Rhea: auto-dismiss fragile warning after 4 s ─────────────────────
  useEffect(() => {
    if (!fragileWarning) return;
    const t = setTimeout(() => setFragileWarning(null), 4000);
    return () => clearTimeout(t);
  }, [fragileWarning]);

  // ── Becky: update selectedBoxType when stop filter changes ────────────────
  const filteredBoxes = activeStopFilter
    ? availableBoxes.filter(box => box.stop === activeStopFilter && !box.isZeroDim)
    : availableBoxes;

  useEffect(() => {
    if (activeStopFilter) {
      const boxesForStop = availableBoxes.filter(box => box.stop === activeStopFilter && !box.isZeroDim);
      if (boxesForStop.length > 0) setSelectedBoxType(boxesForStop[0]);
      else setSelectedBoxType(null);
    }
    // When filter cleared, restore first available box
    else if (availableBoxes.length > 0) {
      setSelectedBoxType(availableBoxes[0]);
    }
  }, [activeStopFilter, availableBoxes]);

  // ── US6 Yash: geometry / material caches ──────────────────────────────────
  const getDimensionKey = (d) => `${d.width.toFixed(3)}-${d.height.toFixed(3)}-${d.depth.toFixed(3)}`;

  const getSharedGeometry = (dimensions) => {
    const key = getDimensionKey(dimensions);
    if (!geometryCacheRef.current.has(key))
      geometryCacheRef.current.set(key, new THREE.BoxGeometry(dimensions.width, dimensions.height, dimensions.depth));
    return geometryCacheRef.current.get(key);
  };

  const getSharedEdges = (dimensions) => {
    const key = getDimensionKey(dimensions);
    if (!edgeCacheRef.current.has(key))
      edgeCacheRef.current.set(key, new THREE.EdgesGeometry(getSharedGeometry(dimensions)));
    return edgeCacheRef.current.get(key);
  };

  // US5: fragile boxes get pink material, cached separately
  const getSharedMaterial = (boxType) => {
    const isFragile = boxType.fragile ?? false;
    const key = isFragile ? `fragile-${boxType.color}` : `${boxType.color}`;
    if (!materialCacheRef.current.has(key)) {
      materialCacheRef.current.set(key, new THREE.MeshStandardMaterial({
        color:     isFragile ? 0xff69b4 : boxType.color,
        roughness: 0.5,
        metalness: 0.1,
        ...(isFragile && { emissive: new THREE.Color(0xff0066), emissiveIntensity: 0.08 })
      }));
    }
    return materialCacheRef.current.get(key);
  };

  const disposeSharedResources = () => {
    geometryCacheRef.current.forEach(g => g.dispose());
    edgeCacheRef.current.forEach(g => g.dispose());
    materialCacheRef.current.forEach(m => m.dispose());
    lineMaterialRef.current?.dispose();
    fragilePinkLineRef.current?.dispose();
  };

  // ── US1 Yash: load-example helpers ────────────────────────────────────────
  const mapSteelcaseBoxToRuntimeType = (exampleId, boxDef, index) => ({
    id:         `${exampleId}-${boxDef.typeId}-${index}`,
    label:      boxDef.label,
    color:      boxDef.color,
    dimensions: {
      width:  boxDef.dimensionsInches.width  / 12,
      height: boxDef.dimensionsInches.height / 12,
      depth:  boxDef.dimensionsInches.depth  / 12
    },
    physics: { mass: 20, friction: 0.9, restitution: 0.0 },
    fragile: boxDef.fragile ?? false  // US5
  });

  const buildQueueFromExample = useCallback((example) => {
    const queue = [];
    example.boxes.forEach((boxDef, index) => {
      const rt = mapSteelcaseBoxToRuntimeType(example.id, boxDef, index);
      for (let i = 0; i < boxDef.quantity; i++) queue.push(rt);
    });
    return queue;
  }, []);

  const buildQueueSummary = useCallback((queue) => {
    const grouped = new Map();
    queue.forEach(item => {
      if (!grouped.has(item.id)) grouped.set(item.id, { label: item.label, color: item.color, count: 0 });
      grouped.get(item.id).count += 1;
    });
    return Array.from(grouped.values());
  }, []);

  // ── Scene init ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mountRef.current) return;
    const { scene, camera, renderer, dragController, cleanup } = initScene({
      mountEl: mountRef.current, cargoRegistry: cargoRegistryRef.current,
      physicsEnabledRef, physicsApiRef, setStats, setIsLoading, setIsBoxDragging, saveToHistoryRef
    });
    sceneRef.current          = scene;
    cameraRef.current         = camera;
    rendererRef.current       = renderer;
    dragControllerRef.current = dragController;
    ghostPreviewRef.current   = new GhostPreview(scene);
    fitSystemRef.current      = new FitSuggestionSystem(cargoRegistryRef.current);
    return () => { ghostPreviewRef.current?.hide(); cleanup(); disposeSharedResources(); };
  }, []);

  // US1: auto-select first load example on mount
  useEffect(() => {
    if (STEELCASE_LOAD_EXAMPLES.length > 0 && !selectedExampleId)
      handleLoadExampleSelect(STEELCASE_LOAD_EXAMPLES[0].id);
  }, []);

  useEffect(() => { ghostPreviewRef.current?.hide(); setSuggestion(null); }, [selectedBoxType]);

  // ── Camera View ────────────────────────────────────────────────────────────
  const handleCameraView = (view) => {
    if (!cameraRef.current) return;
    const c = cameraRef.current;
    if      (view === 'top')  c.position.set(0, 80, 0.1);
    else if (view === 'side') c.position.set(0, 5, 60);
    else if (view === 'back') c.position.set(-60, 8, 0);
    else                      c.position.set(20, 25, 40);
  };

  // ── Create Physics Body ────────────────────────────────────────────────────
  const createBoxBody = (boxType, boxMesh) => {
    const physicsApi = physicsApiRef.current;
    if (!physicsApi?.world) return null;
    const { width, height, depth } = boxType.dimensions;
    const bodyMaterial = new CANNON.Material(`box-${boxType.id}-${Date.now()}`);
    const friction     = boxType.physics?.friction    ?? 0.9;
    const restitution  = boxType.physics?.restitution ?? 0.0;
    if (physicsApi.materials?.defaultMaterial)
      physicsApi.world.addContactMaterial(new CANNON.ContactMaterial(bodyMaterial, physicsApi.materials.defaultMaterial, { friction, restitution }));
    if (physicsApi.materials?.wallMaterial)
      physicsApi.world.addContactMaterial(new CANNON.ContactMaterial(bodyMaterial, physicsApi.materials.wallMaterial, { friction: Math.max(friction, 0.95), restitution }));
    const body = new CANNON.Body({
      mass: boxType.physics?.mass ?? 20, material: bodyMaterial,
      shape: new CANNON.Box(new CANNON.Vec3(width / 2, height / 2, depth / 2)),
      position: new CANNON.Vec3(boxMesh.position.x, boxMesh.position.y, boxMesh.position.z),
      angularDamping: 0.98, linearDamping: 0.55,
      allowSleep: true, sleepSpeedLimit: 0.08, sleepTimeLimit: 0.5
    });
    body.quaternion.set(boxMesh.quaternion.x, boxMesh.quaternion.y, boxMesh.quaternion.z, boxMesh.quaternion.w);
    body.fixedRotation = false;
    body.updateMassProperties();
    body.angularFactor.set(0.08, 1.0, 0.08);
    body.angularVelocity.set(0, 0, 0);
    body.velocity.set(0, 0, 0);
    physicsApi.world.addBody(body);
    return body;
  };

  // ── Becky: enhanced CSV upload with stop/dimString/isZeroDim/availableQty ─
  const handleCSVUpload = (event) => {
    event?.preventDefault();
    const file = event.dataTransfer ? event.dataTransfer.files[0] : event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const lines = text.split(/\r?\n|\r/).map(l => l.trim()).filter(l => l);
      if (lines.length < 2) { alert('This CSV file is empty!'); return; }
      const headers = lines[0].split(',').map(h => h.trim());
      const lenIdx  = headers.indexOf('Length');
      const widIdx  = headers.indexOf('Width');
      const hgtIdx  = headers.indexOf('Height');
      const qtyIdx  = headers.indexOf('# Pieces');
      const stopIdx = headers.indexOf('Stop');
      const descIdx = headers.indexOf('Parcel Descript');
      if (lenIdx === -1 || widIdx === -1 || hgtIdx === -1) {
        alert('Error: CSV missing Length, Width, or Height columns.'); return;
      }
      const parsedGroups = {};
      const colors = ['#FF6B35', '#004E89', '#1AA37A', '#9B59B6', '#E74C3C', '#F39C12', '#2C3E50'];
      for (let i = 1; i < lines.length; i++) {
        try {
          const cols     = lines[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
          if (cols.length < Math.max(lenIdx, widIdx, hgtIdx)) continue;
          const l        = parseFloat(cols[lenIdx]) || 0;
          const w        = parseFloat(cols[widIdx])  || 0;
          const h        = parseFloat(cols[hgtIdx])  || 0;
          const isZeroDim = l === 0 && w === 0 && h === 0;
          const qty      = qtyIdx  !== -1 ? parseInt(cols[qtyIdx])  || 1 : 1;
          const stopVal  = stopIdx !== -1 && cols[stopIdx] ? cols[stopIdx].replace(/"/g, '').trim() : 'Unassigned';
          const dimString = isZeroDim ? `0″ × 0″ × 0″` : `${l}″ × ${w}″ × ${h}″`;
          const groupKey  = `${stopVal}_${dimString}`;
          if (!parsedGroups[groupKey]) {
            parsedGroups[groupKey] = {
              id:           `csv_${groupKey.replace(/[^a-zA-Z0-9]/g, '_')}`,
              dimensions:   { width: l / 12, height: h / 12, depth: w / 12 },
              color:        isZeroDim ? '#ced4da' : colors[Object.keys(parsedGroups).length % colors.length],
              label:        `Package: ${dimString}`,
              dimString,
              isZeroDim,
              availableQty: 0,
              stop:         stopVal,
              physics:      { mass: 20, friction: 0.9, restitution: 0.0 },
              fragile:      false
            };
          }
          parsedGroups[groupKey].availableQty += qty;
        } catch (err) { console.warn(`Skipped row ${i}:`, lines[i]); }
      }
      const parsedBoxes = Object.values(parsedGroups);
      if (parsedBoxes.length > 0) {
        setSelectedExampleName('Manual CSV');
        setSelectedExampleId(null);
        setBoxQueue([]);
        setQueueSummary([]);
        setAvailableBoxes(parsedBoxes);
        setSelectedBoxType(null);
        setActiveStopFilter(null);
      } else { alert('No valid box dimensions found in this CSV.'); }
    };
    reader.readAsText(file);
    if (event.target?.value) event.target.value = null;
  };

  // ── US5 Rhea: check if a newly-placed heavy box sits on a fragile one ─────
  const checkFragileStacking = useCallback((newEntry) => {
    const isHeavy = (newEntry.physics?.mass ?? 0) >= HEAVY_BOX_MASS_THRESHOLD;
    if (!isHeavy) return;
    const newBottom = newEntry.mesh.position.y - newEntry.size.y / 2;
    const eps = 0.15;
    for (const other of cargoRegistryRef.current) {
      if (other === newEntry || !(other.fragile ?? false)) continue;
      const otherTop = other.mesh.position.y + other.size.y / 2;
      if (Math.abs(newBottom - otherTop) > eps) continue;
      const dx = Math.abs(newEntry.mesh.position.x - other.mesh.position.x);
      const dz = Math.abs(newEntry.mesh.position.z - other.mesh.position.z);
      if (dx < (newEntry.size.x / 2 + other.size.x / 2) - 0.05 &&
          dz < (newEntry.size.z / 2 + other.size.z / 2) - 0.05) {
        const cfg = availableBoxes.find(c => c.id === other.type) || BOX_CONFIGS.find(c => c.id === other.type);
        setFragileWarning(`⚠️ Heavy box (${newEntry.physics.mass} lbs) placed on FRAGILE box "${cfg?.label ?? other.label}"! Move it to avoid damage.`);
        return;
      }
    }
  }, [availableBoxes]);

  // ── US6 Yash + US5 Rhea: core box spawner ─────────────────────────────────
  const addBoxFromType = useCallback((boxType) => {
    if (!sceneRef.current || !boxType) return false;
    if (cargoRegistryRef.current.length >= MAX_BOXES) {
      alert(`Maximum ${MAX_BOXES} boxes reached`); return false;
    }
    const isFragile      = boxType.fragile ?? false;
    const boxGeometry    = getSharedGeometry(boxType.dimensions);
    const boxMaterial    = getSharedMaterial(boxType);
    const box            = new THREE.Mesh(boxGeometry, boxMaterial);
    const currentCount   = cargoRegistryRef.current.length;

    // Wide-grid spawn (US6)
    const halfLen = TRUCK_DIMENSIONS.length / 2;
    const halfW   = TRUCK_DIMENSIONS.width  / 2;
    const marginX = 3.2, marginZ = 0.85;
    const usableX = TRUCK_DIMENSIONS.length - marginX * 2;
    const usableZ = TRUCK_DIMENSIONS.width  - marginZ * 2;
    const COLS_X  = 9, ROWS_Z = 3;
    const layer   = Math.floor(currentCount / (COLS_X * ROWS_Z));
    const slotIdx = currentCount % (COLS_X * ROWS_Z);
    const col     = slotIdx % COLS_X;
    const row     = Math.floor(slotIdx / COLS_X);
    const spawnX  = -halfLen + marginX + (col + 0.5) * (usableX / COLS_X) + layer * 0.35;
    const spawnZ  = -halfW   + marginZ + (row + 0.5) * (usableZ / ROWS_Z);

    // Lay long-thin parcels flat
    const isLongAndThin = boxType.dimensions.height > 2.5 && Math.min(boxType.dimensions.width, boxType.dimensions.depth) < 1.0;
    if (isLongAndThin) box.quaternion.setFromEuler(new THREE.Euler(0, 0, Math.PI / 2));

    box.position.set(spawnX, 8, spawnZ);
    box.updateMatrixWorld(true);
    const bbox = new THREE.Box3().setFromObject(box);
    box.position.y += 0.22 - bbox.min.y;
    if (layer > 0) box.position.y += layer * 1.15;
    box.updateMatrixWorld(true);

    box.castShadow    = currentCount < 30; // US6: skip distant shadow casters
    box.receiveShadow = true;

    // US5: pink edge lines for fragile boxes
    box.add(new THREE.LineSegments(
      getSharedEdges(boxType.dimensions),
      isFragile ? fragilePinkLineRef.current : lineMaterialRef.current
    ));
    // US5: floating FRAGILE sprite
    if (isFragile) box.add(createFragileLabel(boxType.dimensions.height));

    sceneRef.current.add(box);
    const body = createBoxBody(boxType, box);

    const entry = {
      id:           `${boxType.id}-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      type:         boxType.id,
      label:        boxType.label,
      mesh:         box,
      body,
      size:         { x: boxType.dimensions.width, y: boxType.dimensions.height, z: boxType.dimensions.depth },
      dimensions:   { ...boxType.dimensions },
      physics:      { ...boxType.physics },
      fragile:      isFragile,   // US5
      baseMaterial: boxMaterial
    };

    cargoRegistryRef.current.push(entry);
    setBoxes(prev => [...prev, { id: entry.id, mesh: box, type: boxType.id }]);
    setStats(prev => ({ ...prev, boxCount: prev.boxCount + 1 }));
    ghostPreviewRef.current?.hide();
    setSuggestion(null);

    // US5: check stacking after state settles
    setTimeout(() => checkFragileStacking(entry), 100);
    return true;
  }, [checkFragileStacking]);

  const addBox = useCallback(() => {
    addBoxFromType(selectedBoxType);
  }, [selectedBoxType, addBoxFromType]);

  // ── Export Load Plan ───────────────────────────────────────────────────────
  const exportLoadPlan = () => {
    const boxesPayload = cargoRegistryRef.current.map((entry, index) => {
      const volume = entry.dimensions.width * entry.dimensions.height * entry.dimensions.depth;
      return {
        index: index + 1, id: entry.id, type: entry.type, label: entry.label,
        fragile: entry.fragile ?? false,  // US5
        dimensions: {
          width:  Number(entry.dimensions.width.toFixed(3)),
          height: Number(entry.dimensions.height.toFixed(3)),
          depth:  Number(entry.dimensions.depth.toFixed(3))
        },
        position: {
          x: Number(entry.mesh.position.x.toFixed(3)),
          y: Number(entry.mesh.position.y.toFixed(3)),
          z: Number(entry.mesh.position.z.toFixed(3))
        },
        rotation: {
          x: Number(entry.mesh.rotation.x.toFixed(3)),
          y: Number(entry.mesh.rotation.y.toFixed(3)),
          z: Number(entry.mesh.rotation.z.toFixed(3))
        },
        volumeFt3: Number(volume.toFixed(3))
      };
    });
    const payload = {
      generatedAt: new Date().toISOString(),
      truck: { ...TRUCK_DIMENSIONS, totalVolumeFt3: Number(TRUCK_VOLUME.toFixed(3)) },
      summary: {
        totalBoxes: boxesPayload.length,
        totalVolumeUsedFt3: Number(usedVolume.toFixed(3)),
        utilizationPercent: Number(volumePercentage)
      },
      boxes: boxesPayload
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = 'load-plan.json';
    document.body.appendChild(link); link.click();
    document.body.removeChild(link); URL.revokeObjectURL(url);
  };

  // ── Clear Boxes ────────────────────────────────────────────────────────────
  const clearBoxes = useCallback(({ clearQueue = true } = {}) => {
    const physicsWorld = physicsApiRef.current?.world;
    [...cargoRegistryRef.current].forEach(e => {
      if (e?.body && physicsWorld) physicsWorld.removeBody(e.body);
      if (sceneRef.current && e?.mesh) sceneRef.current.remove(e.mesh);
      e.mesh?.clear();
    });
    cargoRegistryRef.current.length = 0;
    dragControllerRef.current?.clearRegistry();
    ghostPreviewRef.current?.hide();
    setSuggestion(null);
    setBoxes([]);
    setStats(prev => ({ ...prev, boxCount: 0 }));
    setFragileWarning(null);
    if (clearQueue) {
      setBoxQueue([]); setQueueSummary([]);
      setSelectedExampleName('Manual'); setSelectedExampleId(null);
    }
    clearHistory();
  }, [clearHistory]);

  // ── US1 Yash: load example select ─────────────────────────────────────────
  const handleLoadExampleSelect = useCallback((exampleId) => {
    const example = STEELCASE_LOAD_EXAMPLES.find(e => e.id === exampleId);
    if (!example) return;
    clearBoxes({ clearQueue: false });
    const queued       = buildQueueFromExample(example);
    const runtimeTypes = example.boxes.map((boxDef, i) => mapSteelcaseBoxToRuntimeType(example.id, boxDef, i));
    setSelectedExampleName(example.name);
    setSelectedExampleId(example.id);
    setAvailableBoxes(runtimeTypes);
    setSelectedBoxType(runtimeTypes[0]);
    setBoxQueue(queued);
    setQueueSummary(buildQueueSummary(queued));
    setActiveStopFilter(null);
  }, [buildQueueFromExample, buildQueueSummary, clearBoxes]);

  // ── US1 Yash: add next queued box ─────────────────────────────────────────
  const addNextQueuedBox = useCallback(() => {
    if (boxQueue.length === 0) { addBox(); return; }
    const nextType = boxQueue[0];
    if (addBoxFromType(nextType)) {
      setBoxQueue(prev => {
        const updated = prev.slice(1);
        setQueueSummary(buildQueueSummary(updated));
        if (updated.length > 0) setSelectedBoxType(updated[0]);
        return updated;
      });
    }
  }, [boxQueue, addBox, addBoxFromType, buildQueueSummary]);

  // ── US6 Yash: stress test ──────────────────────────────────────────────────
  const runStressTest = useCallback(() => {
    if (isStressTestRunning) return;
    setIsStressTestRunning(true); setStressResult(null);
    clearBoxes({ clearQueue: false });
    const sourceTypes = boxQueue.length > 0 ? [...boxQueue] : [...availableBoxes];
    if (!sourceTypes.length) { setIsStressTestRunning(false); return; }
    let i = 0;
    const startFpsSampling = () => {
      const samples = []; const start = performance.now();
      const iv = window.setInterval(() => {
        samples.push(statsRef.current.fps);
        if (performance.now() - start >= 5000) {
          window.clearInterval(iv);
          const avgFps = Math.round(samples.reduce((s, f) => s + f, 0) / Math.max(samples.length, 1));
          const minFps = samples.length ? Math.min(...samples) : 0;
          setStressResult({ boxCount: STRESS_TEST_TARGET, avgFps, minFps, passed: avgFps >= 30 && minFps >= 30 });
          setIsStressTestRunning(false);
        }
      }, 500);
    };
    const spawnStep = () => {
      if (i < STRESS_TEST_TARGET) { addBoxFromType(sourceTypes[i % sourceTypes.length]); i++; requestAnimationFrame(spawnStep); }
      else startFpsSampling();
    };
    requestAnimationFrame(spawnStep);
  }, [availableBoxes, boxQueue, isStressTestRunning, addBoxFromType, clearBoxes]);

  // ── US2 Rhea: complete session ─────────────────────────────────────────────
  const handleCompleteSession = useCallback(() => {
    initialLoadSnapshotRef.current = cargoRegistryRef.current.map(e => ({
      type:       e.type, fragile: e.fragile, label: e.label,
      position:   e.mesh.position.clone(), rotation: e.mesh.rotation.clone(),
      dimensions: { ...e.dimensions }, physics: { ...e.physics },
      color:      e.baseMaterial?.color ? '#' + e.baseMaterial.color.getHexString() : '#888'
    }));
    setShowSessionComplete(true);
  }, []);

  // ── US2 Rhea: try again ────────────────────────────────────────────────────
  const handleTryAgain = useCallback(() => {
    const snapshot = initialLoadSnapshotRef.current;
    clearBoxes({ clearQueue: false });
    setShowSessionComplete(false);
    if (!snapshot?.length) return;
    setTimeout(() => {
      snapshot.forEach(({ type, fragile, label, position, rotation, dimensions, physics, color }) => {
        if (!sceneRef.current) return;
        const boxType = { id: type, label, color, dimensions, physics, fragile: fragile ?? false };
        const isFragile = fragile ?? false;
        const mesh = new THREE.Mesh(getSharedGeometry(dimensions), getSharedMaterial(boxType));
        mesh.position.copy(position); mesh.rotation.copy(rotation);
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.add(new THREE.LineSegments(getSharedEdges(dimensions), isFragile ? fragilePinkLineRef.current : lineMaterialRef.current));
        if (isFragile) mesh.add(createFragileLabel(dimensions.height));
        sceneRef.current.add(mesh);
        const body = createBoxBody(boxType, mesh);
        const entry = {
          id: `${type}-tryagain-${Date.now()}-${Math.random()}`,
          type, label, mesh, body,
          size:         { x: dimensions.width, y: dimensions.height, z: dimensions.depth },
          dimensions:   { ...dimensions }, physics: { ...physics },
          fragile:      isFragile,
          baseMaterial: getSharedMaterial(boxType)
        };
        cargoRegistryRef.current.push(entry);
        setBoxes(prev => [...prev, { id: entry.id, mesh, type }]);
        setStats(prev => ({ ...prev, boxCount: prev.boxCount + 1 }));
      });
    }, 50);
  }, [clearBoxes]);

  // ── AI Best Fit ────────────────────────────────────────────────────────────
  const handleSuggestPlacement = useCallback(() => {
    if (!fitSystemRef.current || !ghostPreviewRef.current || !sceneRef.current || !selectedBoxType) return;
    setIsCalcSuggestion(true);
    ghostPreviewRef.current.hide(); setSuggestion(null);
    setTimeout(() => {
      const size = { x: selectedBoxType.dimensions.width, y: selectedBoxType.dimensions.height, z: selectedBoxType.dimensions.depth };
      const pos  = fitSystemRef.current.findBestFit(size);
      if (pos) { ghostPreviewRef.current.show(pos, size, selectedBoxType.color); setSuggestion({ position: pos, size }); }
      else { setSuggestion(null); alert('No valid placement found — the truck may be full!'); }
      setIsCalcSuggestion(false);
    }, 30);
  }, [selectedBoxType]);

  const handleSnapToSuggestion = useCallback(() => {
    if (!suggestion || boxes.length === 0) return;
    const lastEntry = cargoRegistryRef.current[cargoRegistryRef.current.length - 1];
    if (!lastEntry) return;
    const oldPos = lastEntry.mesh.position.clone();
    lastEntry.mesh.position.copy(suggestion.position);
    lastEntry.size.x = suggestion.size.x; lastEntry.size.y = suggestion.size.y; lastEntry.size.z = suggestion.size.z;
    if (lastEntry.body) {
      lastEntry.body.position.set(suggestion.position.x, suggestion.position.y, suggestion.position.z);
      lastEntry.body.velocity.set(0, 0, 0); lastEntry.body.angularVelocity.set(0, 0, 0); lastEntry.body.wakeUp();
    }
    saveToHistoryRef.current?.(lastEntry.mesh, oldPos, suggestion.position);
    ghostPreviewRef.current?.hide(); setSuggestion(null);
    setTimeout(() => checkFragileStacking(lastEntry), 100);
  }, [suggestion, boxes.length, checkFragileStacking]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{
      width: '100vw', height: '100vh', margin: 0, padding: 0, overflow: 'hidden',
      fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      background: '#ffffff'
    }}>
      <Header
        stats={stats} usedVolume={usedVolume} volumePercentage={volumePercentage}
        isBoxDragging={isBoxDragging} historyIndex={historyIndex} history={history}
        undo={undo} redo={redo} selectedExampleName={selectedExampleName} stressResult={stressResult}
      />

      {/* 3D Canvas */}
      <div ref={mountRef} style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }} />

      {/* Loading overlay */}
      {isLoading && (
        <div style={{ position: 'absolute', inset: 0, background: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ width: '40px', height: '40px', border: '3px solid #e0e0e0', borderTop: '3px solid #004E89', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
            <p style={{ color: '#666', fontSize: '14px' }}>Loading 3D Environment...</p>
          </div>
        </div>
      )}

      {/* Becky: Shipment Summary panel */}
      <ShipmentSummary
        availableBoxes={availableBoxes}
        activeStopFilter={activeStopFilter}
        setActiveStopFilter={setActiveStopFilter}
      />

      <ControlPanel
        boxes={boxes}
        availableBoxes={filteredBoxes}
        selectedBoxType={selectedBoxType}
        setSelectedBoxType={setSelectedBoxType}
        addBox={addBox}
        clearBoxes={clearBoxes}
        exportLoadPlan={exportLoadPlan}
        historyIndex={historyIndex}
        history={history}
        undo={undo}
        redo={redo}
        isBoxDragging={isBoxDragging}
        dragControllerRef={dragControllerRef}
        handleCameraView={handleCameraView}
        handleCSVUpload={handleCSVUpload}
        loadExamples={STEELCASE_LOAD_EXAMPLES}
        onSelectLoadExample={handleLoadExampleSelect}
        selectedExampleName={selectedExampleName}
        selectedExampleId={selectedExampleId}
        queueCount={boxQueue.length}
        queueSummary={queueSummary}
        addNextQueuedBox={addNextQueuedBox}
        runStressTest={runStressTest}
        isStressTestRunning={isStressTestRunning}
        stressResult={stressResult}
        onSuggestPlacement={handleSuggestPlacement}
        onSnapToSuggestion={handleSnapToSuggestion}
        hasSuggestion={!!suggestion}
        isCalcSuggestion={isCalcSuggestion}
        activeStopFilter={activeStopFilter}
        setActiveStopFilter={setActiveStopFilter}
        onCompleteSession={handleCompleteSession}    // US2
      />

      <ControlsGuide />

      {/* US5 Rhea: fragile stacking warning toast */}
      {fragileWarning && (
        <div style={{
          position: 'absolute', bottom: '32px', left: '50%', transform: 'translateX(-50%)',
          background: 'linear-gradient(135deg, #e74c3c, #c0392b)', color: '#fff',
          borderRadius: '12px', padding: '14px 24px', fontSize: '14px', fontWeight: 700,
          boxShadow: '0 6px 24px rgba(231,76,60,0.45)', zIndex: 50,
          maxWidth: '520px', textAlign: 'center', animation: 'toastSlideUp 0.3s ease'
        }}>
          {fragileWarning}
          <button onClick={() => setFragileWarning(null)} style={{
            marginLeft: '16px', background: 'rgba(255,255,255,0.25)', border: 'none',
            borderRadius: '6px', color: '#fff', padding: '2px 10px', cursor: 'pointer',
            fontSize: '13px', fontWeight: 700
          }}>✕</button>
        </div>
      )}

      {/* US2 Rhea: session complete overlay */}
      {showSessionComplete && (
        <SessionCompleteScreen
          usedVolume={usedVolume}
          totalBoxes={boxes.length}
          onTryAgain={handleTryAgain}
          onDismiss={() => setShowSessionComplete(false)}
        />
      )}

      <style>{`
        @keyframes spin { 0% { transform:rotate(0deg) } 100% { transform:rotate(360deg) } }
        @keyframes pulse-suggest {
          0%,100% { box-shadow:0 0 0 0 rgba(26,163,122,0.5) }
          50%      { box-shadow:0 0 0 6px rgba(26,163,122,0) }
        }
        @keyframes toastSlideUp {
          from { transform:translateX(-50%) translateY(20px); opacity:0 }
          to   { transform:translateX(-50%) translateY(0);    opacity:1 }
        }
      `}</style>
    </div>
  );
};

export default TruckLoadingPrototype;
