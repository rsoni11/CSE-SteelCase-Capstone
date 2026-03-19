import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';

import { BOX_CONFIGS, TRUCK_DIMENSIONS, TRUCK_VOLUME } from './constants';
import { initScene } from './TruckScene';
import { useHistory } from './useHistory';
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

  // ── State ──────────────────────────────────────────────────────────────────
  const [boxes, setBoxes]                     = useState([]);
  const [selectedBoxType, setSelectedBoxType] = useState(BOX_CONFIGS[0]);
  const [stats, setStats]                     = useState({ fps: 60, boxCount: 0 });
  const [isLoading, setIsLoading]             = useState(true);
  const [isBoxDragging, setIsBoxDragging]     = useState(false);

  // ── History (undo/redo) ────────────────────────────────────────────────────
  const { history, historyIndex, saveToHistory, undo, redo, clearHistory } =
    useHistory(cargoRegistryRef, rendererRef, sceneRef, cameraRef);

  saveToHistoryRef.current = saveToHistory;

  // ── Space utilization ──────────────────────────────────────────────────────
  const usedVolume = boxes.reduce((total, box) => {
    const pos = box.mesh.position;
    const isInsideTruck = pos.x > -30 && pos.x < 30 && pos.z > -10 && pos.z < 10;
    if (!isInsideTruck) return total;

    const config = BOX_CONFIGS.find(c => c.id === box.type);
    if (!config) return total;
    const { width, height, depth } = config.dimensions;
    return total + width * height * depth;
  }, 0);
  const volumePercentage = ((usedVolume / TRUCK_VOLUME) * 100).toFixed(2);

  // ── Scene init ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mountRef.current) return;

    const { scene, camera, renderer, dragController, cleanup } = initScene({
      mountEl:         mountRef.current,
      cargoRegistry:   cargoRegistryRef.current,
      physicsEnabledRef,
      setStats,
      setIsLoading,
      setIsBoxDragging,
      saveToHistoryRef,
    });

    sceneRef.current          = scene;
    cameraRef.current         = camera;
    rendererRef.current       = renderer;
    dragControllerRef.current = dragController;

    return cleanup;
  }, []);

  // ── Camera View ────────────────────────────────────────────────────────────
  const handleCameraView = (view) => {
    if (!cameraRef.current) return;
    const camera = cameraRef.current;

    switch(view) {
      case 'top':
        camera.position.set(0, 80, 0.1);
        break;
      case 'side':
        camera.position.set(0, 4.5, 60);
        break;
      case 'back':
        camera.position.set(-60, 4.5, 40);
        break;
      case 'default':
        break;
    }
  };
  
  // ── Add Box ────────────────────────────────────────────────────────────────
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
      color: selectedBoxType.color, roughness: 0.5, metalness: 0.1
    });
    const box = new THREE.Mesh(boxGeometry, boxMaterial);

    // Spawn in Bay 1 grid
    const boxesPerRow = 4;
    const row = Math.floor(boxes.length / boxesPerRow);
    const col = boxes.length % boxesPerRow;
    box.position.set(
      -50 + col * 4.5 + 2,
      selectedBoxType.dimensions.height / 2,
      -6  + row * 3.5 + 2
    );
    box.castShadow = true;
    box.receiveShadow = true;
    box.add(new THREE.LineSegments(
      new THREE.EdgesGeometry(boxGeometry),
      new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 2 })
    ));

    sceneRef.current.add(box);

    // Register with collision system
    cargoRegistryRef.current.push({
      mesh: box,
      size: {
        x: selectedBoxType.dimensions.width,
        y: selectedBoxType.dimensions.height,
        z: selectedBoxType.dimensions.depth
      },
      baseMaterial: boxMaterial
    });

    setBoxes(prev => [...prev, { id: Date.now(), mesh: box, type: selectedBoxType.id }]);
    setStats(prev => ({ ...prev, boxCount: prev.boxCount + 1 }));
  };

  // ── Clear Boxes ────────────────────────────────────────────────────────────
  const clearBoxes = () => {
    boxes.forEach(box => {
      sceneRef.current.remove(box.mesh);
      box.mesh.geometry.dispose();
      box.mesh.material.dispose();
    });
    cargoRegistryRef.current.length = 0;
    dragControllerRef.current?.clearRegistry();
    setSelectedBox(null);
    setBoxes([]);
    setStats(prev => ({ ...prev, boxCount: 0 }));
    clearHistory();
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{
      width: '100vw', height: '100vh', margin: 0, padding: 0,
      overflow: 'hidden',
      fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      background: '#ffffff'
    }}>

      <Header
        stats={stats}
        usedVolume={usedVolume}
        volumePercentage={volumePercentage}
        isBoxDragging={isBoxDragging}
        historyIndex={historyIndex}
        history={history}
        undo={undo}
        redo={redo}
      />

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

      <ControlPanel
        boxes={boxes}
        selectedBoxType={selectedBoxType}
        setSelectedBoxType={setSelectedBoxType}
        addBox={addBox}
        clearBoxes={clearBoxes}
        historyIndex={historyIndex}
        history={history}
        undo={undo}
        redo={redo}
        isBoxDragging={isBoxDragging}
        dragControllerRef={dragControllerRef}
        handleCameraView={handleCameraView}
      />

      <ControlsGuide />

      <style>{`
        @keyframes spin {
          0%   { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default TruckLoadingPrototype;