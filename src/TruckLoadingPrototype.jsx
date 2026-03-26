import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

import {
  BOX_CONFIGS,
  TRUCK_DIMENSIONS,
  TRUCK_VOLUME,
  MAX_BOXES
} from './constants';
import { initScene } from './TruckScene';
import { useHistory } from './useHistory';
import Header from './Header';
import ControlPanel from './ControlPanel';
import ControlsGuide from './ControlsGuide';

const TruckLoadingPrototype = () => {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const dragControllerRef = useRef(null);
  const cargoRegistryRef = useRef([]);
  const saveToHistoryRef = useRef(null);
  const physicsEnabledRef = useRef(true);
  const physicsApiRef = useRef(null);

  const [boxes, setBoxes] = useState([]);
  const [selectedBoxType, setSelectedBoxType] = useState(BOX_CONFIGS[0]);
  const [stats, setStats] = useState({ fps: 60, boxCount: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [isBoxDragging, setIsBoxDragging] = useState(false);

  const { history, historyIndex, saveToHistory, undo, redo, clearHistory } =
    useHistory(cargoRegistryRef, rendererRef, sceneRef, cameraRef);

  saveToHistoryRef.current = saveToHistory;

  const usedVolume = boxes.reduce((total, box) => {
    const pos = box.mesh.position;
    const isInsideTruck =
      pos.x > -TRUCK_DIMENSIONS.length / 2 &&
      pos.x < TRUCK_DIMENSIONS.length / 2 &&
      pos.z > -TRUCK_DIMENSIONS.width / 2 &&
      pos.z < TRUCK_DIMENSIONS.width / 2;

    if (!isInsideTruck) return total;

    const config = BOX_CONFIGS.find((c) => c.id === box.type);
    if (!config) return total;

    const { width, height, depth } = config.dimensions;
    return total + width * height * depth;
  }, 0);

  const volumePercentage = ((usedVolume / TRUCK_VOLUME) * 100).toFixed(2);

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
      saveToHistoryRef
    });

    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;
    dragControllerRef.current = dragController;

    return cleanup;
  }, []);

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

  const createBoxBody = (boxType, boxMesh) => {
    const physicsApi = physicsApiRef.current;
    if (!physicsApi?.world) return null;

    const { width, height, depth } = boxType.dimensions;
    const shape = new CANNON.Box(
      new CANNON.Vec3(width / 2, height / 2, depth / 2)
    );

    const bodyMaterial = new CANNON.Material(`box-${boxType.id}-${Date.now()}`);
    const friction = boxType.physics?.friction ?? 0.9;
    const restitution = boxType.physics?.restitution ?? 0.0;

    if (physicsApi.materials?.defaultMaterial) {
      physicsApi.world.addContactMaterial(
        new CANNON.ContactMaterial(
          bodyMaterial,
          physicsApi.materials.defaultMaterial,
          {
            friction,
            restitution
          }
        )
      );
    }

    if (physicsApi.materials?.wallMaterial) {
      physicsApi.world.addContactMaterial(
        new CANNON.ContactMaterial(
          bodyMaterial,
          physicsApi.materials.wallMaterial,
          {
            friction: Math.max(friction, 0.95),
            restitution
          }
        )
      );
    }

    const body = new CANNON.Body({
      mass: boxType.physics?.mass ?? 20,
      material: bodyMaterial,
      shape,
      position: new CANNON.Vec3(
        boxMesh.position.x,
        boxMesh.position.y,
        boxMesh.position.z
      ),
      angularDamping: 0.92,
      linearDamping: 0.45,
      allowSleep: true,
      sleepSpeedLimit: 0.08,
      sleepTimeLimit: 0.5
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

  const addBox = () => {
    if (!sceneRef.current) return;

    if (boxes.length >= MAX_BOXES) {
      alert(`Maximum ${MAX_BOXES} boxes reached for performance`);
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

    const spawnX = -TRUCK_DIMENSIONS.length / 2 + 3.5;
    const spawnZ = ((boxes.length % 5) - 2) * 1.2;
    const spawnY =
      selectedBoxType.dimensions.height / 2 +
      0.5 +
      Math.floor(boxes.length / 5) * 0.2;

    box.position.set(spawnX, spawnY, spawnZ);

    box.castShadow = true;
    box.receiveShadow = true;

    box.add(
      new THREE.LineSegments(
        new THREE.EdgesGeometry(boxGeometry),
        new THREE.LineBasicMaterial({ color: 0x000000 })
      )
    );

    sceneRef.current.add(box);

    const body = createBoxBody(selectedBoxType, box);

    const entry = {
      id: `${selectedBoxType.id}-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      type: selectedBoxType.id,
      label: selectedBoxType.label,
      mesh: box,
      body,
      size: {
        x: selectedBoxType.dimensions.width,
        y: selectedBoxType.dimensions.height,
        z: selectedBoxType.dimensions.depth
      },
      dimensions: { ...selectedBoxType.dimensions },
      physics: { ...selectedBoxType.physics },
      baseMaterial: boxMaterial
    };

    cargoRegistryRef.current.push(entry);

    setBoxes((prev) => [
      ...prev,
      {
        id: entry.id,
        mesh: box,
        type: selectedBoxType.id
      }
    ]);

    setStats((prev) => ({ ...prev, boxCount: prev.boxCount + 1 }));
  };

  const exportLoadPlan = () => {
    const boxesPayload = cargoRegistryRef.current.map((entry, index) => {
      const volume =
        entry.dimensions.width *
        entry.dimensions.height *
        entry.dimensions.depth;

      return {
        index: index + 1,
        id: entry.id,
        type: entry.type,
        label: entry.label,
        dimensions: {
          width: Number(entry.dimensions.width.toFixed(3)),
          height: Number(entry.dimensions.height.toFixed(3)),
          depth: Number(entry.dimensions.depth.toFixed(3))
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
        totalBoxes: boxesPayload.length,
        totalVolumeUsedFt3: Number(usedVolume.toFixed(3)),
        utilizationPercent: Number(volumePercentage)
      },
      boxes: boxesPayload
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json'
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'load-plan.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const clearBoxes = () => {
    const physicsWorld = physicsApiRef.current?.world;

    boxes.forEach((boxEntry) => {
      const registryEntry = cargoRegistryRef.current.find(
        (entry) => entry.mesh === boxEntry.mesh
      );

      if (registryEntry?.body && physicsWorld) {
        physicsWorld.removeBody(registryEntry.body);
      }

      if (sceneRef.current) {
        sceneRef.current.remove(boxEntry.mesh);
      }

      boxEntry.mesh.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
      });

      if (registryEntry?.baseMaterial) {
        registryEntry.baseMaterial.dispose();
      }
    });

    cargoRegistryRef.current.length = 0;
    dragControllerRef.current?.clearRegistry();
    setBoxes([]);
    setStats((prev) => ({ ...prev, boxCount: 0 }));
    clearHistory();
  };

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
      />

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
      />

      <ControlsGuide />

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