import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

import {
  BOX_CONFIGS,
  TRUCK_DIMENSIONS,
  TRUCK_VOLUME,
  MAX_BOXES,
  STRESS_TEST_TARGET
} from './constants';
import { STEELCASE_LOAD_EXAMPLES } from './loadExamples';
import { initScene } from './TruckScene';
import { useHistory } from './useHistory';
import { FitSuggestionSystem } from './FitSuggestionSystem';
import { GhostPreview } from './GhostPreview';
import Header from './Header';
import ControlPanel from './ControlPanel';
import ControlsGuide from './ControlsGuide';

const TruckLoadingPrototype = () => {
  // ── Refs ───────────────────────────────────────────────────────────────────
  const mountRef          = useRef(null);
  const sceneRef          = useRef(null);
  const cameraRef         = useRef(null);
  const rendererRef       = useRef(null);
  const dragControllerRef = useRef(null);
  const cargoRegistryRef  = useRef([]);
  const saveToHistoryRef  = useRef(null);
  const physicsEnabledRef = useRef(true);
  const physicsApiRef     = useRef(null);
  const ghostPreviewRef   = useRef(null);
  const fitSystemRef      = useRef(null);
  const geometryCacheRef  = useRef(new Map());
  const edgeCacheRef      = useRef(new Map());
  const materialCacheRef  = useRef(new Map());
  const lineMaterialRef   = useRef(new THREE.LineBasicMaterial({ color: 0x000000 }));
  const statsRef          = useRef({ fps: 60, boxCount: 0 });

  // ── State ──────────────────────────────────────────────────────────────────
  const [boxes, setBoxes]                       = useState([]);
  const [availableBoxes, setAvailableBoxes]     = useState(BOX_CONFIGS);
  const [selectedBoxType, setSelectedBoxType]   = useState(BOX_CONFIGS[0]);
  const [stats, setStats]                       = useState({ fps: 60, boxCount: 0 });
  const [isLoading, setIsLoading]               = useState(true);
  const [isBoxDragging, setIsBoxDragging]       = useState(false);
  const [suggestion, setSuggestion]             = useState(null);
  const [isCalcSuggestion, setIsCalcSuggestion] = useState(false);
  const [boxQueue, setBoxQueue]                 = useState([]);
  const [selectedExampleName, setSelectedExampleName] = useState('Manual');
  const [selectedExampleId, setSelectedExampleId] = useState(null);
  const [stressResult, setStressResult]         = useState(null);
  const [isStressTestRunning, setIsStressTestRunning] = useState(false);
  const [queueSummary, setQueueSummary]         = useState([]);

  // ── History (undo/redo) ────────────────────────────────────────────────────
  const { history, historyIndex, saveToHistory, undo, redo, clearHistory } =
    useHistory(cargoRegistryRef, rendererRef, sceneRef, cameraRef);

  saveToHistoryRef.current = saveToHistory;

  // ── Space utilization ──────────────────────────────────────────────────────
  const usedVolume = boxes.reduce((total, box) => {
    const pos = box.mesh.position;
    const isInsideTruck =
      pos.x > -TRUCK_DIMENSIONS.length / 2 &&
      pos.x < TRUCK_DIMENSIONS.length / 2 &&
      pos.z > -TRUCK_DIMENSIONS.width / 2 &&
      pos.z < TRUCK_DIMENSIONS.width / 2;

    if (!isInsideTruck) return total;

    // Use availableBoxes instead of just BOX_CONFIGS so uploaded items count!
    const config = availableBoxes.find((c) => c.id === box.type) || BOX_CONFIGS.find((c) => c.id === box.type);
    if (!config) return total;

    const { width, height, depth } = config.dimensions;
    return total + width * height * depth;
  }, 0);

  const volumePercentage = ((usedVolume / TRUCK_VOLUME) * 100).toFixed(2);

  useEffect(() => {
    statsRef.current = stats;
  }, [stats]);

  const getDimensionKey = (dimensions) =>
    `${dimensions.width.toFixed(3)}-${dimensions.height.toFixed(3)}-${dimensions.depth.toFixed(3)}`;

  const getSharedGeometry = (dimensions) => {
    const key = getDimensionKey(dimensions);
    if (!geometryCacheRef.current.has(key)) {
      geometryCacheRef.current.set(
        key,
        new THREE.BoxGeometry(dimensions.width, dimensions.height, dimensions.depth)
      );
    }
    return geometryCacheRef.current.get(key);
  };

  const getSharedEdges = (dimensions) => {
    const key = getDimensionKey(dimensions);
    if (!edgeCacheRef.current.has(key)) {
      edgeCacheRef.current.set(key, new THREE.EdgesGeometry(getSharedGeometry(dimensions)));
    }
    return edgeCacheRef.current.get(key);
  };

  const getSharedMaterial = (boxType) => {
    const key = `${boxType.color}`;
    if (!materialCacheRef.current.has(key)) {
      materialCacheRef.current.set(
        key,
        new THREE.MeshStandardMaterial({
          color: boxType.color,
          roughness: 0.5,
          metalness: 0.1
        })
      );
    }
    return materialCacheRef.current.get(key);
  };

  const disposeSharedResources = () => {
    geometryCacheRef.current.forEach((geometry) => geometry.dispose());
    edgeCacheRef.current.forEach((edgeGeometry) => edgeGeometry.dispose());
    materialCacheRef.current.forEach((material) => material.dispose());
    lineMaterialRef.current?.dispose();
  };

  const mapSteelcaseBoxToRuntimeType = (exampleId, boxDef, index) => {
    // Map Steelcase row values (inches + quantity) into the runtime box type format used by addBox().
    return {
      id: `${exampleId}-${boxDef.typeId}-${index}`,
      label: boxDef.label,
      color: boxDef.color,
      dimensions: {
        width: boxDef.dimensionsInches.width / 12,
        height: boxDef.dimensionsInches.height / 12,
        depth: boxDef.dimensionsInches.depth / 12
      },
      physics: { mass: 20, friction: 0.9, restitution: 0.0 }
    };
  };

  const buildQueueFromExample = useCallback((example) => {
    const queue = [];

    example.boxes.forEach((boxDef, index) => {
      const runtimeType = mapSteelcaseBoxToRuntimeType(example.id, boxDef, index);
      for (let i = 0; i < boxDef.quantity; i += 1) {
        queue.push(runtimeType);
      }
    });

    return queue;
  }, []);

  const buildQueueSummary = useCallback((queue) => {
    const grouped = new Map();
    queue.forEach((item) => {
      if (!grouped.has(item.id)) {
        grouped.set(item.id, { label: item.label, color: item.color, count: 0 });
      }
      grouped.get(item.id).count += 1;
    });
    return Array.from(grouped.values());
  }, []);

  // ── Scene init ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mountRef.current) return;

    const { scene, camera, renderer, dragController, cleanup } = initScene({
      mountEl:          mountRef.current,
      cargoRegistry:    cargoRegistryRef.current,
      physicsEnabledRef,
      physicsApiRef,
      setStats,
      setIsLoading,
      setIsBoxDragging,
      saveToHistoryRef
    });

    sceneRef.current          = scene;
    cameraRef.current         = camera;
    rendererRef.current       = renderer;
    dragControllerRef.current = dragController;

    ghostPreviewRef.current = new GhostPreview(scene);
    fitSystemRef.current    = new FitSuggestionSystem(cargoRegistryRef.current);

    return () => {
      ghostPreviewRef.current?.hide();
      cleanup();
      disposeSharedResources();
    };
  }, []);

  // ── Hide ghost on box type change ─────────────────────────────────────────
  useEffect(() => {
    ghostPreviewRef.current?.hide();
    setSuggestion(null);
  }, [selectedBoxType]);

  useEffect(() => {
    if (STEELCASE_LOAD_EXAMPLES.length > 0 && !selectedExampleId) {
      handleLoadExampleSelect(STEELCASE_LOAD_EXAMPLES[0].id);
    }
  }, [selectedExampleId]);

  // ── Camera View ────────────────────────────────────────────────────────────
  const handleCameraView = (view) => {
    if (!cameraRef.current) return;

    const camera = cameraRef.current;

    switch (view) {
      case 'top':
        camera.position.set(0, 80, 0.1);
        break;
      case 'side':
        camera.position.set(0, 5, 60);
        break;
      case 'back':
        camera.position.set(-60, 8, 0);
        break;
      case 'default':
      default:
        camera.position.set(20, 25, 40);
        break;
    }
  };

  // ── Create Physics Body ────────────────────────────────────────────────────
  const createBoxBody = (boxType, boxMesh) => {
    const physicsApi = physicsApiRef.current;
    if (!physicsApi?.world) return null;

    const { width, height, depth } = boxType.dimensions;
    const shape = new CANNON.Box(
      new CANNON.Vec3(width / 2, height / 2, depth / 2)
    );

    const bodyMaterial = new CANNON.Material(`box-${boxType.id}-${Date.now()}`);
    const friction    = boxType.physics?.friction ?? 0.9;
    const restitution = boxType.physics?.restitution ?? 0.0;

    if (physicsApi.materials?.defaultMaterial) {
      physicsApi.world.addContactMaterial(
        new CANNON.ContactMaterial(
          bodyMaterial,
          physicsApi.materials.defaultMaterial,
          { friction, restitution }
        )
      );
    }

    if (physicsApi.materials?.wallMaterial) {
      physicsApi.world.addContactMaterial(
        new CANNON.ContactMaterial(
          bodyMaterial,
          physicsApi.materials.wallMaterial,
          { friction: Math.max(friction, 0.95), restitution }
        )
      );
    }

    const body = new CANNON.Body({
      mass:            boxType.physics?.mass ?? 20,
      material:        bodyMaterial,
      shape,
      position:        new CANNON.Vec3(boxMesh.position.x, boxMesh.position.y, boxMesh.position.z),
      angularDamping:  0.98,
      linearDamping:   0.55,
      allowSleep:      true,
      sleepSpeedLimit: 0.08,
      sleepTimeLimit:  0.5
    });

    body.quaternion.set(
      boxMesh.quaternion.x,
      boxMesh.quaternion.y,
      boxMesh.quaternion.z,
      boxMesh.quaternion.w
    );

    body.fixedRotation = false;
    body.updateMassProperties();
    body.angularFactor.set(0.08, 1.0, 0.08);
    body.angularVelocity.set(0, 0, 0);
    body.velocity.set(0, 0, 0);

    physicsApi.world.addBody(body);
    return body;
  };

  // ── Drag & Drop CSV Upload Handler ─────────────────────────────────────────
  const handleCSVUpload = (event) => {
    event?.preventDefault(); 
    const file = event.dataTransfer ? event.dataTransfer.files[0] : event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      
      const lines = text.split(/\r?\n|\r/).map(l => l.trim()).filter(l => l);
      
      if (lines.length < 2) {
        alert("This CSV file is empty! Please upload a file with actual box data.");
        return;
      }

      const headers = lines[0].split(',').map(h => h.trim());
      const lenIdx = headers.indexOf('Length');
      const widIdx = headers.indexOf('Width');
      const hgtIdx = headers.indexOf('Height');
      const descIdx = headers.indexOf('Parcel Descript');
      const qtyIdx = headers.indexOf('# Pieces');

      if (lenIdx === -1 || widIdx === -1 || hgtIdx === -1) {
        alert('Error: This CSV is missing the Length, Width, or Height columns.');
        return;
      }

      const parsedBoxes = [];
      const colors = ['#FF6B35', '#004E89', '#1AA37A', '#9B59B6', '#E74C3C', '#F39C12', '#2C3E50'];

      for (let i = 1; i < lines.length; i++) {
        try {
          const cols = lines[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
          if (cols.length < Math.max(lenIdx, widIdx, hgtIdx)) continue;

          const l = parseFloat(cols[lenIdx]) || 0;
          const w = parseFloat(cols[widIdx]) || 0;
          const h = parseFloat(cols[hgtIdx]) || 0;
          
          if (l === 0 && w === 0 && h === 0) continue; 

          const qty = qtyIdx !== -1 ? parseInt(cols[qtyIdx]) || 1 : 1;
          const desc = descIdx !== -1 ? cols[descIdx].replace(/"/g, '') : `Custom Box ${i}`;

          parsedBoxes.push({
            id: `csv_box_${i}_${Date.now()}`,
            dimensions: { width: l / 12, height: h / 12, depth: w / 12 }, 
            color: colors[i % colors.length],
            label: `${desc} (${l}″×${w}″×${h}″) - Qty: ${qty}`,
            availableQty: qty,
            physics: { mass: 20, friction: 0.9, restitution: 0.0 }
          });
        } catch (err) {
          console.warn(`Skipped malformed row ${i}:`, lines[i]);
        }
      }

      if (parsedBoxes.length > 0) {
        setSelectedExampleName('Manual CSV');
        setSelectedExampleId(null);
        setBoxQueue([]);
        setQueueSummary([]);
        setAvailableBoxes(parsedBoxes);
        setSelectedBoxType(parsedBoxes[0]);
      } else {
        alert("No valid box dimensions found in this CSV. All rows were 0x0x0.");
      }
    };
    
    reader.readAsText(file);
    if(event.target.value) event.target.value = null; 
  };

  // ── Add Box ────────────────────────────────────────────────────────────────
  const addBoxFromType = (boxType) => {
    if (!sceneRef.current) return;

    if (cargoRegistryRef.current.length >= MAX_BOXES) {
      alert(`Maximum ${MAX_BOXES} boxes reached for performance`);
      return false;
    }

    const boxGeometry = getSharedGeometry(boxType.dimensions);
    const boxMaterial = getSharedMaterial(boxType);
    const box = new THREE.Mesh(boxGeometry, boxMaterial);
    const currentCount = cargoRegistryRef.current.length;

    // Truck deck inner usable area (must stay inside physics floor; leave margin from walls).
    const halfLen = TRUCK_DIMENSIONS.length / 2;
    const halfW = TRUCK_DIMENSIONS.width / 2;
    const marginX = 3.2;
    const marginZ = 0.85;
    const usableX = TRUCK_DIMENSIONS.length - marginX * 2;
    const usableZ = TRUCK_DIMENSIONS.width - marginZ * 2;

    // Wide grid: spacing must exceed largest SKU footprint (Steelcase furniture ~2.5 ft).
    const COLS_X = 9;
    const ROWS_Z = 3;
    const cellX = usableX / COLS_X;
    const cellZ = usableZ / ROWS_Z;
    const slotsPerLayer = COLS_X * ROWS_Z;
    const layer = Math.floor(currentCount / slotsPerLayer);
    const slotIdx = currentCount % slotsPerLayer;
    const col = slotIdx % COLS_X;
    const row = Math.floor(slotIdx / COLS_X);

    const spawnX = -halfLen + marginX + (col + 0.5) * cellX + layer * 0.35;
    const spawnZ = -halfW + marginZ + (row + 0.5) * cellZ;

    // Cannon truck floor top ~0.2; align mesh bottom after orientation via world AABB.
    const FLOOR_TOP = 0.22;

    // Long-and-thin items are laid flat by default so they don't appear like vertical poles.
    const isLongAndThin =
      boxType.dimensions.height > 2.5 &&
      Math.min(boxType.dimensions.width, boxType.dimensions.depth) < 1.0;

    if (isLongAndThin) {
      box.quaternion.setFromEuler(new THREE.Euler(0, 0, Math.PI / 2));
    }
    box.position.set(spawnX, 8, spawnZ);
    box.updateMatrixWorld(true);
    const bbox = new THREE.Box3().setFromObject(box);
    box.position.y += FLOOR_TOP - bbox.min.y;
    // Second+ layers: slight vertical offset so 28+ boxes don't share exact coordinates.
    if (layer > 0) {
      box.position.y += layer * 1.15;
    }
    box.updateMatrixWorld(true);

    box.castShadow = currentCount < 30;
    box.receiveShadow = true;

    box.add(
      new THREE.LineSegments(
        getSharedEdges(boxType.dimensions),
        lineMaterialRef.current
      )
    );

    sceneRef.current.add(box);

    const body = createBoxBody(boxType, box);

    const entry = {
      id:           `${boxType.id}-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      type:         boxType.id,
      label:        boxType.label,
      mesh:         box,
      body,
      size: {
        x: boxType.dimensions.width,
        y: boxType.dimensions.height,
        z: boxType.dimensions.depth
      },
      dimensions:   { ...boxType.dimensions },
      physics:      { ...boxType.physics },
      baseMaterial: boxMaterial
    };

    cargoRegistryRef.current.push(entry);

    setBoxes((prev) => [
      ...prev,
      { id: entry.id, mesh: box, type: boxType.id }
    ]);

    setStats((prev) => ({ ...prev, boxCount: prev.boxCount + 1 }));

    ghostPreviewRef.current?.hide();
    setSuggestion(null);
    return true;
  };

  const addBox = () => {
    addBoxFromType(selectedBoxType);
  };

  // ── Export Load Plan ───────────────────────────────────────────────────────
  const exportLoadPlan = () => {
    const boxesPayload = cargoRegistryRef.current.map((entry, index) => {
      const volume =
        entry.dimensions.width *
        entry.dimensions.height *
        entry.dimensions.depth;

      return {
        index: index + 1,
        id:    entry.id,
        type:  entry.type,
        label: entry.label,
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
      truck: {
        ...TRUCK_DIMENSIONS,
        totalVolumeFt3: Number(TRUCK_VOLUME.toFixed(3))
      },
      summary: {
        totalBoxes:         boxesPayload.length,
        totalVolumeUsedFt3: Number(usedVolume.toFixed(3)),
        utilizationPercent: Number(volumePercentage)
      },
      boxes: boxesPayload
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json'
    });

    const url  = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href     = url;
    link.download = 'load-plan.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // ── Clear Boxes ────────────────────────────────────────────────────────────
  const clearBoxes = ({ clearQueue = true } = {}) => {
    const physicsWorld = physicsApiRef.current?.world;

    // Use registry ref (not React `boxes` state) so clears always match spawned meshes,
    // including when handlers are called from stale closures.
    const toRemove = [...cargoRegistryRef.current];
    toRemove.forEach((registryEntry) => {
      if (registryEntry?.body && physicsWorld) {
        physicsWorld.removeBody(registryEntry.body);
      }
      if (sceneRef.current && registryEntry?.mesh) {
        sceneRef.current.remove(registryEntry.mesh);
      }
      registryEntry.mesh?.clear();
    });

    cargoRegistryRef.current.length = 0;
    dragControllerRef.current?.clearRegistry();
    ghostPreviewRef.current?.hide();
    setSuggestion(null);
    setBoxes([]);
    setStats((prev) => ({ ...prev, boxCount: 0 }));
    if (clearQueue) {
      setBoxQueue([]);
      setQueueSummary([]);
      setSelectedExampleName('Manual');
      setSelectedExampleId(null);
    }
    clearHistory();
  };

  const handleLoadExampleSelect = useCallback(
    (exampleId) => {
      const selectedExample = STEELCASE_LOAD_EXAMPLES.find((example) => example.id === exampleId);
      if (!selectedExample) return;

      clearBoxes({ clearQueue: false });

      const queued = buildQueueFromExample(selectedExample);
      const runtimeTypes = selectedExample.boxes.map((boxDef, index) =>
        mapSteelcaseBoxToRuntimeType(selectedExample.id, boxDef, index)
      );

      setSelectedExampleName(selectedExample.name);
      setSelectedExampleId(selectedExample.id);
      setAvailableBoxes(runtimeTypes);
      setSelectedBoxType(runtimeTypes[0]);
      setBoxQueue(queued);
      setQueueSummary(buildQueueSummary(queued));
    },
    [buildQueueFromExample, buildQueueSummary]
  );

  const addNextQueuedBox = useCallback(() => {
    if (boxQueue.length === 0) {
      addBox();
      return;
    }

    const nextType = boxQueue[0];
    const didAdd = addBoxFromType(nextType);

    if (didAdd) {
      setBoxQueue((prev) => {
        const updated = prev.slice(1);
        setQueueSummary(buildQueueSummary(updated));
        if (updated.length > 0) {
          setSelectedBoxType(updated[0]);
        }
        return updated;
      });
    }
  }, [boxQueue, buildQueueSummary]);

  const runStressTest = useCallback(() => {
    if (isStressTestRunning) return;

    setIsStressTestRunning(true);
    setStressResult(null);
    clearBoxes({ clearQueue: false });

    const sourceTypes = boxQueue.length > 0 ? [...boxQueue] : [...availableBoxes];
    if (sourceTypes.length === 0) {
      setIsStressTestRunning(false);
      return;
    }

    let i = 0;
    const startFpsSampling = () => {
      const samples = [];
      const start = performance.now();
      const sampleInterval = window.setInterval(() => {
        samples.push(statsRef.current.fps);
        if (performance.now() - start >= 5000) {
          window.clearInterval(sampleInterval);
          const avgFps = Math.round(
            samples.reduce((sum, fps) => sum + fps, 0) / Math.max(samples.length, 1)
          );
          const minFps = samples.length ? Math.min(...samples) : 0;

          setStressResult({
            boxCount: STRESS_TEST_TARGET,
            avgFps,
            minFps,
            passed: avgFps >= 30 && minFps >= 30
          });
          setIsStressTestRunning(false);
        }
      }, 500);
    };

    const spawnStep = () => {
      if (i < STRESS_TEST_TARGET) {
        addBoxFromType(sourceTypes[i % sourceTypes.length]);
        i += 1;
        requestAnimationFrame(spawnStep);
      } else {
        startFpsSampling();
      }
    };
    requestAnimationFrame(spawnStep);
  }, [availableBoxes, boxQueue, isStressTestRunning]);

  // ── Suggest Placement ─────────────────────────────────────────────────────
  const handleSuggestPlacement = useCallback(() => {
    if (!fitSystemRef.current || !ghostPreviewRef.current || !sceneRef.current) return;

    setIsCalcSuggestion(true);
    ghostPreviewRef.current.hide();
    setSuggestion(null);

    setTimeout(() => {
      const size = {
        x: selectedBoxType.dimensions.width,
        y: selectedBoxType.dimensions.height,
        z: selectedBoxType.dimensions.depth
      };

      const pos = fitSystemRef.current.findBestFit(size);

      if (pos) {
        ghostPreviewRef.current.show(pos, size, selectedBoxType.color);
        setSuggestion({ position: pos, size });
      } else {
        setSuggestion(null);
        alert('No valid placement found — the truck may be full!');
      }

      setIsCalcSuggestion(false);
    }, 30);
  }, [selectedBoxType]);

  // ── Snap to Suggestion ────────────────────────────────────────────────────
  const handleSnapToSuggestion = useCallback(() => {
    if (!suggestion || boxes.length === 0) return;

    const lastEntry = cargoRegistryRef.current[cargoRegistryRef.current.length - 1];
    if (!lastEntry) return;

    const oldPos = lastEntry.mesh.position.clone();
    lastEntry.mesh.position.copy(suggestion.position);
    lastEntry.size.x = suggestion.size.x;
    lastEntry.size.y = suggestion.size.y;
    lastEntry.size.z = suggestion.size.z;

    if (lastEntry.body) {
      lastEntry.body.position.set(
        suggestion.position.x,
        suggestion.position.y,
        suggestion.position.z
      );
      lastEntry.body.velocity.set(0, 0, 0);
      lastEntry.body.angularVelocity.set(0, 0, 0);
      lastEntry.body.wakeUp();
    }

    saveToHistoryRef.current?.(lastEntry.mesh, oldPos, suggestion.position);

    ghostPreviewRef.current?.hide();
    setSuggestion(null);
  }, [suggestion, boxes.length]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        margin: 0,
        padding: 0,
        overflow: 'hidden',
        fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        background: '#ffffff'
      }}
    >
      <Header
        stats={stats}
        usedVolume={usedVolume}
        volumePercentage={volumePercentage}
        isBoxDragging={isBoxDragging}
        historyIndex={historyIndex}
        history={history}
        undo={undo}
        redo={redo}
        selectedExampleName={selectedExampleName}
        stressResult={stressResult}
      />

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

      {isLoading && (
        <div
          style={{
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
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                border: '3px solid #e0e0e0',
                borderTop: '3px solid #004E89',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
                margin: '0 auto 16px'
              }}
            />
            <p style={{ color: '#666', fontSize: '14px' }}>
              Loading 3D Environment...
            </p>
          </div>
        </div>
      )}

      <ControlPanel
        boxes={boxes}
        availableBoxes={availableBoxes}
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
      />

      <ControlsGuide />

      <style>{`
        @keyframes spin {
          0%   { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes pulse-suggest {
          0%, 100% { box-shadow: 0 0 0 0 rgba(26,163,122,0.5); }
          50%       { box-shadow: 0 0 0 6px rgba(26,163,122,0); }
        }
      `}</style>
    </div>
  );
};

export default TruckLoadingPrototype;