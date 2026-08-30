import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

import {
  BOX_CONFIGS,
  TRUCK_DIMENSIONS,
  TRUCK_VOLUME,
  MAX_BOXES,
  DECK_SURFACE_Y,
  STRESS_TEST_TARGET,         // US6 Yash
  HEAVY_BOX_MASS_THRESHOLD    // US5 Rhea
} from './constants';
import { STEELCASE_LOAD_EXAMPLES } from './loadExamples';   // US1 Yash
import { initScene } from './TruckScene';
import { useHistory } from './useHistory';
import { GhostPreview } from './GhostPreview';
import { getPlacementSuggestions } from './placementSuggestions';
import { estimateMass, suggestLoadOrder, makeAABB, withinBounds } from './packingScore';
import Header from './Header';
import ControlPanel from './ControlPanel';
import ControlsGuide from './ControlsGuide';
import ShipmentSummary from './ShipmentSummary';             // Becky
import SessionSummaryModal from './SessionSummaryModal';
import SessionCompleteScreen from './SessionCompleteScreen';
import OrientationWidget from './OrientationWidget';
import { StabilitySystem } from './StabilitySystem';

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
  const stabilitySystemRef = useRef(null);
  const initialLoadSnapshotRef = useRef(null);
  // US6 Yash: geometry/material caches
  const geometryCacheRef   = useRef(new Map());
  const edgeCacheRef       = useRef(new Map());
  const materialCacheRef   = useRef(new Map());
  const lineMaterialRef    = useRef(new THREE.LineBasicMaterial({ color: 0x000000 }));
  const fragilePinkLineRef = useRef(new THREE.LineBasicMaterial({ color: 0xff0066 })); // US5
  const statsRef           = useRef({ fps: 60, boxCount: 0 });

  // ── State ──────────────────────────────────────────────────────────────────
  const [boxes, setBoxes]                             = useState([]);
  const [availableBoxes, setAvailableBoxes]           = useState(BOX_CONFIGS);
  const [selectedBoxType, setSelectedBoxType]         = useState(BOX_CONFIGS[0]);
  const [stats, setStats]                             = useState({ fps: 60, boxCount: 0 });
  const [isLoading, setIsLoading]                     = useState(true);
  const [isBoxDragging, setIsBoxDragging]             = useState(false);
  const [suggestion, setSuggestion]                   = useState(null);
  const [suggestionCandidates, setSuggestionCandidates] = useState([]);
  const [isCalcSuggestion, setIsCalcSuggestion]       = useState(false);
  const [layoutVersion, setLayoutVersion]             = useState(0);
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
  const [showSessionSummary, setShowSessionSummary]   = useState(false);
  const [sessionSummaryMetrics, setSessionSummaryMetrics] = useState(null);
  // US5 Rhea: fragile warning toast
  const [fragileWarning, setFragileWarning]           = useState(null);
  const [orientEntry, setOrientEntry]                 = useState(null);
  const [orientWidgetPos, setOrientWidgetPos]         = useState({ x: 0, y: 0 });
  const [stabilityWarning, setStabilityWarning]       = useState(null);
  const [selectedGroupIds, setSelectedGroupIds]       = useState([]);
  const [showSessionComplete, setShowSessionComplete] = useState(false);

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

  useEffect(() => {
    if (!stabilityWarning || stabilityWarning.status === 'blocked') return;
    const t = setTimeout(() => setStabilityWarning(null), 5000);
    return () => clearTimeout(t);
  }, [stabilityWarning]);

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
  const mapSteelcaseBoxToRuntimeType = (exampleId, boxDef, index) => {
    const dimensions = {
      width:  boxDef.dimensionsInches.width  / 12,
      height: boxDef.dimensionsInches.height / 12,
      depth:  boxDef.dimensionsInches.depth  / 12
    };
    return {
      id:    `${exampleId}-${boxDef.typeId}-${index}`,
      label: boxDef.label,
      color: boxDef.color,
      dimensions,
      // Estimate from volume when the dataset carries no weight — a flat 20 lb
      // for every carton made the weight-aware ranking meaningless.
      physics: {
        mass: boxDef.mass ?? estimateMass({
          x: dimensions.width, y: dimensions.height, z: dimensions.depth
        }),
        friction: 0.9,
        restitution: 0.0
      },
      fragile: boxDef.fragile ?? false  // US5
    };
  };

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

  const checkStabilityAfterMove = useCallback((entry) => {
    if (!stabilitySystemRef.current) return;
    const result = stabilitySystemRef.current.evaluate(
      entry.mesh.position,
      entry.size,
      entry.mesh
    );
    if (result.status === 'ok') {
      setStabilityWarning(null);
    } else {
      setStabilityWarning({ message: result.message, status: result.status });
    }
  }, []);

  const checkStabilityOnPlace = useCallback((pos, size) => {
    if (!stabilitySystemRef.current) return true;
    const result = stabilitySystemRef.current.evaluate(pos, size);
    if (result.status === 'blocked') {
      setStabilityWarning({ message: result.message, status: 'blocked' });
      return false;
    }
    if (result.status === 'warn') {
      setStabilityWarning({ message: result.message, status: 'warn' });
    } else {
      setStabilityWarning(null);
    }
    return true;
  }, []);

  // ── Scene init ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mountRef.current) return;
    const { scene, camera, renderer, dragController, cleanup } = initScene({
      mountEl: mountRef.current,
      cargoRegistry: cargoRegistryRef.current,
      physicsEnabledRef,
      physicsApiRef,
      setStats,
      setIsLoading,
      setIsBoxDragging,
      saveToHistoryRef,
      onLayoutChanged: () => setLayoutVersion(prev => prev + 1),
      onOrientPick: (entry, cx, cy) => {
        setOrientEntry(entry);
        setOrientWidgetPos({ x: cx, y: cy });
      },
      onGroupChanged: (ids) => setSelectedGroupIds([...ids]),
      afterPositionChanged: (mesh) => {
        const entry = cargoRegistryRef.current.find(e => e.mesh === mesh);
        if (entry) checkStabilityAfterMove(entry);
      },
    });
    sceneRef.current           = scene;
    cameraRef.current          = camera;
    rendererRef.current        = renderer;
    dragControllerRef.current  = dragController;
    ghostPreviewRef.current    = new GhostPreview(scene);
    stabilitySystemRef.current = new StabilitySystem(cargoRegistryRef.current);

    return () => {
      ghostPreviewRef.current?.hide();
      stabilitySystemRef.current = null;
      cleanup();
      disposeSharedResources();
    };
  }, [checkStabilityAfterMove]);

  // US1: auto-select first load example on mount
  useEffect(() => {
    if (STEELCASE_LOAD_EXAMPLES.length > 0 && !selectedExampleId)
      handleLoadExampleSelect(STEELCASE_LOAD_EXAMPLES[0].id);
  }, []);

  const refreshPlacementSuggestions = useCallback((showNoFitAlert = false) => {
    if (!ghostPreviewRef.current) return;

    // The ghost must describe the carton "Snap Last Box" will actually move —
    // otherwise we were ranking spots for the NEXT queued SKU and then snapping
    // a different box into them (and overwriting its collision size to match).
    // The target is also excluded from the obstacle set: with it left in, every
    // suggestion had to dodge the box's own spawn position, which is what
    // scattered cartons down the trailer instead of packing them together.
    const target = cargoRegistryRef.current[cargoRegistryRef.current.length - 1] ?? null;
    const source = target ?? selectedBoxType;

    if (!source) {
      ghostPreviewRef.current.hide();
      setSuggestionCandidates([]);
      setSuggestion(null);
      return;
    }

    const dims = target ? target.dimensions : selectedBoxType.dimensions;
    const size = { x: dims.width, y: dims.height, z: dims.depth };
    const ghostColor = target
      ? (target.baseMaterial?.color
          ? `#${target.baseMaterial.color.getHexString()}`
          : '#00ff88')
      : selectedBoxType.color;

    const candidates = getPlacementSuggestions(size, cargoRegistryRef.current, 3, {
      mass: source.physics?.mass ?? estimateMass(size),
      fragile: source.fragile ?? false,
      exclude: target ? [target] : []
    });

    setSuggestionCandidates(candidates);
    const best = candidates[0] ?? null;
    setSuggestion(
      best
        ? { position: best.position, size: best.size, quaternion: best.quaternion }
        : null
    );

    if (best) {
      ghostPreviewRef.current.show(
        best.position,
        best.size,
        ghostColor,
        best.quaternion
      );
    } else {
      ghostPreviewRef.current.hide();
      if (showNoFitAlert) alert('No valid placement found — the truck may be full!');
    }
  }, [selectedBoxType]);

  useEffect(() => {
    refreshPlacementSuggestions(false);
  }, [selectedBoxType, layoutVersion, refreshPlacementSuggestions]);

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
    // Middle ground: allow tilt/roll without wild spinning (was 1,1,1).
    body.angularFactor.set(0.45, 1, 0.45);
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
          const wgtIdx   = headers.indexOf('Weight');
          const qty      = qtyIdx  !== -1 ? parseInt(cols[qtyIdx])  || 1 : 1;
          const rowWeight = wgtIdx !== -1 ? parseFloat(cols[wgtIdx]) || 0 : 0;
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
              // Use the CSV's Weight column when present, else estimate from
              // volume. A flat 20 lb made weight-aware ranking meaningless.
              physics: {
                mass: rowWeight > 0
                  ? rowWeight
                  : estimateMass({ x: l / 12, y: h / 12, z: w / 12 }),
                friction: 0.9,
                restitution: 0.0
              },
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

    // entry.size must be the WORLD-axis-aligned extent (see CollisionSystem /
    // DragController). Turning the parcel 90° about Z swaps its width and
    // height in world space; storing the unrotated dimensions here gave every
    // 48" parcel the wrong collision bounds.
    const worldSize = isLongAndThin
      ? { x: boxType.dimensions.height, y: boxType.dimensions.width, z: boxType.dimensions.depth }
      : { x: boxType.dimensions.width, y: boxType.dimensions.height, z: boxType.dimensions.depth };

    box.position.set(spawnX, 8, spawnZ);
    box.updateMatrixWorld(true);
    const bbox = new THREE.Box3().setFromObject(box);
    box.position.y += 0.22 - bbox.min.y;
    if (layer > 0) box.position.y += layer * 1.15;
    box.updateMatrixWorld(true);

    // The spawn grid is fixed and was not collision-checked. Once cargo has
    // been packed together (by AI Best Fit, or by hand) a later slot can land
    // *inside* an already-placed carton; the solver then ejects both, which
    // showed up as interpenetrating and toppled boxes. Rest the new carton on
    // top of whatever already occupies its column instead.
    const spawnBox = new THREE.Box3().setFromObject(box);
    let columnTop = DECK_SURFACE_Y;
    for (const other of cargoRegistryRef.current) {
      const o = makeAABB(other.mesh.position, other.size);
      if (spawnBox.min.x < o.max.x && spawnBox.max.x > o.min.x &&
          spawnBox.min.z < o.max.z && spawnBox.max.z > o.min.z) {
        columnTop = Math.max(columnTop, o.max.y);
      }
    }
    const clearance = columnTop + 0.02 - spawnBox.min.y;
    if (clearance > 0) {
      box.position.y += clearance;
      box.updateMatrixWorld(true);
    }

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
      size:         { ...worldSize },
      dimensions:   { ...boxType.dimensions },
      physics:      { ...boxType.physics },
      fragile:      isFragile,   // US5
      baseMaterial: boxMaterial
    };

    cargoRegistryRef.current.push(entry);
    setBoxes(prev => [...prev, { id: entry.id, mesh: box, type: boxType.id }]);
    setStats(prev => ({ ...prev, boxCount: prev.boxCount + 1 }));
    setLayoutVersion(prev => prev + 1);
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
    dragControllerRef.current?.clearRegistry();
    const physicsWorld = physicsApiRef.current?.world;
    [...cargoRegistryRef.current].forEach(e => {
      if (e?.body && physicsWorld) physicsWorld.removeBody(e.body);
      if (sceneRef.current && e?.mesh) sceneRef.current.remove(e.mesh);
      e.mesh?.clear();
    });
    cargoRegistryRef.current.length = 0;
    ghostPreviewRef.current?.hide();
    setSuggestion(null);
    setSuggestionCandidates([]);
    setBoxes([]);
    setStats(prev => ({ ...prev, boxCount: 0 }));
    setFragileWarning(null);
    setStabilityWarning(null);
    setOrientEntry(null);
    setSelectedGroupIds([]);
    setLayoutVersion(prev => prev + 1);
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

  // Reorder the pending queue heaviest-first, fragile last. Arrival order — not
  // the scoring function — is what strands heavy cartons near the roof, because
  // by the time they show up the deck is already full.
  const sortQueueForPacking = useCallback(() => {
    setBoxQueue(prev => {
      if (prev.length < 2) return prev;
      const sorted = suggestLoadOrder(prev);
      setQueueSummary(buildQueueSummary(sorted));
      setSelectedBoxType(sorted[0]);
      return sorted;
    });
  }, [buildQueueSummary]);

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

  const computeSessionSummaryMetrics = useCallback(() => {
    const entries = cargoRegistryRef.current;
    if (!entries.length) return null;

    const cargoVolume = entries.reduce(
      (total, e) => total + (e.dimensions.width * e.dimensions.height * e.dimensions.depth),
      0
    );
    const optimalSpaceUsedPct = (cargoVolume / TRUCK_VOLUME) * 100;

    const minX = Math.min(...entries.map(e => e.mesh.position.x - e.size.x / 2));
    const maxX = Math.max(...entries.map(e => e.mesh.position.x + e.size.x / 2));
    const minY = Math.min(...entries.map(e => e.mesh.position.y - e.size.y / 2));
    const maxY = Math.max(...entries.map(e => e.mesh.position.y + e.size.y / 2));
    const minZ = Math.min(...entries.map(e => e.mesh.position.z - e.size.z / 2));
    const maxZ = Math.max(...entries.map(e => e.mesh.position.z + e.size.z / 2));

    const arrangementVolume = Math.max(0, (maxX - minX) * (maxY - minY) * (maxZ - minZ));
    const userSpaceUsedPct = Math.min(100, (arrangementVolume / TRUCK_VOLUME) * 100);
    const wastedSpacePct = Math.max(0, ((arrangementVolume - cargoVolume) / TRUCK_VOLUME) * 100);
    const efficiencyDeltaPct = optimalSpaceUsedPct - userSpaceUsedPct;

    return {
      totalBoxes: entries.length,
      optimalSpaceUsedPct,
      userSpaceUsedPct,
      wastedSpacePct,
      efficiencyDeltaPct
    };
  }, []);

  const handleFinishSession = useCallback(() => {
    const metrics = computeSessionSummaryMetrics();
    if (!metrics) return;
    initialLoadSnapshotRef.current = cargoRegistryRef.current.map(e => ({
      type: e.type,
      fragile: e.fragile,
      label: e.label,
      position: e.mesh.position.clone(),
      rotation: e.mesh.rotation.clone(),
      dimensions: { ...e.dimensions },
      physics: { ...e.physics },
      color: e.baseMaterial?.color ? '#' + e.baseMaterial.color.getHexString() : '#888'
    }));
    setSessionSummaryMetrics(metrics);
    setShowSessionSummary(true);
  }, [computeSessionSummaryMetrics]);

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
        mesh.position.copy(position);
        mesh.rotation.copy(rotation);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.add(new THREE.LineSegments(getSharedEdges(dimensions), isFragile ? fragilePinkLineRef.current : lineMaterialRef.current));
        if (isFragile) mesh.add(createFragileLabel(dimensions.height));
        sceneRef.current.add(mesh);
        const body = createBoxBody(boxType, mesh);
        const entry = {
          id: `${type}-tryagain-${Date.now()}-${Math.random()}`,
          type,
          label,
          mesh,
          body,
          size: { x: dimensions.width, y: dimensions.height, z: dimensions.depth },
          dimensions: { ...dimensions },
          physics: { ...physics },
          fragile: isFragile,
          baseMaterial: getSharedMaterial(boxType)
        };
        cargoRegistryRef.current.push(entry);
        setBoxes(prev => [...prev, { id: entry.id, mesh, type }]);
        setStats(prev => ({ ...prev, boxCount: prev.boxCount + 1 }));
      });
    }, 50);
  }, [clearBoxes]);

  const handleClearGroup = useCallback(() => {
    dragControllerRef.current?.clearGroup();
    setSelectedGroupIds([]);
  }, []);

  // ── AI Best Fit ────────────────────────────────────────────────────────────
  const handleSuggestPlacement = useCallback(() => {
    if (!selectedBoxType) return;
    setIsCalcSuggestion(true);
    setTimeout(() => {
      refreshPlacementSuggestions(true);
      setIsCalcSuggestion(false);
    }, 30);
  }, [selectedBoxType, refreshPlacementSuggestions]);

  const handleSnapToSuggestion = useCallback(() => {
    if (!suggestion || boxes.length === 0) return;
    const lastEntry = cargoRegistryRef.current[cargoRegistryRef.current.length - 1];
    if (!lastEntry) return;

    // The stored suggestion was computed when the layout last changed, but the
    // physics world keeps settling afterwards. Applying a stale spot dropped
    // cartons into neighbours that had since drifted, so re-solve against the
    // current positions and fall back to the stored spot only if nothing fits.
    const dims = lastEntry.dimensions;
    const fresh = getPlacementSuggestions(
      { x: dims.width, y: dims.height, z: dims.depth },
      cargoRegistryRef.current,
      1,
      {
        mass: lastEntry.physics?.mass ?? estimateMass(lastEntry.size),
        fragile: lastEntry.fragile ?? false,
        exclude: [lastEntry]
      }
    )[0];

    // Do NOT fall back to the stored suggestion: it was ranked for whichever
    // carton was last previewed, so applying it here placed 48" parcels in a
    // pose that was never validated for them — through the trailer wall and
    // under the deck. If nothing fits this carton right now, say so.
    if (!fresh) {
      alert('No valid placement found for this box — try rotating it or freeing up space.');
      return;
    }
    const target = fresh;

    // Belt-and-braces: never commit a pose that is not physically inside the
    // trailer. The search already guarantees this, but a silent bad placement
    // (a 4 ft parcel through the sidewall) is far worse than a refused click.
    if (!withinBounds(target.position, target.size, TRUCK_DIMENSIONS)) {
      console.warn('Rejected out-of-bounds suggestion', target.position, target.size);
      alert('No valid placement found for this box — try rotating it or freeing up space.');
      return;
    }

    if (!checkStabilityOnPlace(target.position, target.size)) return;

    const oldPos = lastEntry.mesh.position.clone();
    lastEntry.mesh.position.copy(target.position);
    if (target.quaternion) lastEntry.mesh.quaternion.copy(target.quaternion);
    lastEntry.size.x = target.size.x; lastEntry.size.y = target.size.y; lastEntry.size.z = target.size.z;
    if (lastEntry.body) {
      lastEntry.body.position.set(target.position.x, target.position.y, target.position.z);
      lastEntry.body.quaternion.set(
        lastEntry.mesh.quaternion.x,
        lastEntry.mesh.quaternion.y,
        lastEntry.mesh.quaternion.z,
        lastEntry.mesh.quaternion.w
      );
      lastEntry.body.velocity.set(0, 0, 0);
      lastEntry.body.angularVelocity.set(0, 0, 0);
      // Put it to sleep rather than waking it: the placement is already a
      // resting, collision-free pose, so handing it to the solver awake just
      // let it be nudged off the stack and settle somewhere slightly wrong.
      // Contact from a dragged carton still wakes it normally.
      lastEntry.body.sleep();
    }
    saveToHistoryRef.current?.(lastEntry.mesh, oldPos, target.position);
    setLayoutVersion(prev => prev + 1);
    ghostPreviewRef.current?.hide();
    setSuggestion(null);
    setSuggestionCandidates([]);
    setTimeout(() => checkFragileStacking(lastEntry), 100);
  }, [suggestion, boxes.length, checkFragileStacking, checkStabilityOnPlace]);

  const handleUndo = useCallback(() => {
    undo();
    setTimeout(() => setLayoutVersion(prev => prev + 1), 0);
  }, [undo]);

  const handleRedo = useCallback(() => {
    redo();
    setTimeout(() => setLayoutVersion(prev => prev + 1), 0);
  }, [redo]);

  const handleRotateBox = useCallback(() => {
    const dc = dragControllerRef.current;
    if (!dc) return;
    if (orientEntry) dc.rotateEntry(orientEntry);
    else dc.rotateSelected();
  }, [orientEntry]);

  const syncOrientPhysics = useCallback((entry) => {
    dragControllerRef.current?.syncBodyWithMesh(entry);
    setLayoutVersion(prev => prev + 1);
  }, []);

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
        undo={handleUndo}
        redo={handleRedo}
        isBoxDragging={isBoxDragging}
        orientEntry={orientEntry}
        onRotateBox={handleRotateBox}
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
        sortQueueForPacking={sortQueueForPacking}
        runStressTest={runStressTest}
        isStressTestRunning={isStressTestRunning}
        stressResult={stressResult}
        onSuggestPlacement={handleSuggestPlacement}
        onSnapToSuggestion={handleSnapToSuggestion}
        hasSuggestion={!!suggestion}
        isCalcSuggestion={isCalcSuggestion}
        suggestionCount={suggestionCandidates.length}
        suggestionReasons={suggestionCandidates[0]?.reasons ?? []}
        activeStopFilter={activeStopFilter}
        setActiveStopFilter={setActiveStopFilter}
        onFinishSession={handleFinishSession}
        selectedGroupCount={selectedGroupIds.length}
        onClearGroup={handleClearGroup}
      />

      {orientEntry && (
        <OrientationWidget
          selectedBox={orientEntry}
          widgetPos={orientWidgetPos}
          dragControllerRef={dragControllerRef}
          setSelectedBox={setOrientEntry}
          onPhysicsSync={syncOrientPhysics}
        />
      )}

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

      <SessionSummaryModal
        open={showSessionSummary}
        metrics={sessionSummaryMetrics}
        onClose={() => setShowSessionSummary(false)}
        onTryAgain={handleTryAgain}
        onContinueToGrade={() => {
          setShowSessionSummary(false);
          setShowSessionComplete(true);
        }}
      />

      {stabilityWarning && (
        <div style={{
          position: 'absolute',
          bottom: fragileWarning ? '88px' : '32px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: stabilityWarning.status === 'blocked'
            ? 'linear-gradient(135deg, #c0392b, #922b21)'
            : 'linear-gradient(135deg, #f39c12, #d68910)',
          color: '#fff',
          borderRadius: '12px',
          padding: '14px 24px',
          fontSize: '14px',
          fontWeight: 700,
          boxShadow: stabilityWarning.status === 'blocked'
            ? '0 6px 24px rgba(192,57,43,0.5)'
            : '0 6px 24px rgba(243,156,18,0.5)',
          zIndex: 51,
          maxWidth: '560px',
          textAlign: 'center',
          animation: 'toastSlideUp 0.3s ease'
        }}>
          {stabilityWarning.message}
          {stabilityWarning.status !== 'blocked' && (
            <button
              type="button"
              onClick={() => setStabilityWarning(null)}
              style={{
                marginLeft: '16px',
                background: 'rgba(255,255,255,0.25)',
                border: 'none',
                borderRadius: '6px',
                color: '#fff',
                padding: '2px 10px',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: 700
              }}
            >
              ✕
            </button>
          )}
        </div>
      )}

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
