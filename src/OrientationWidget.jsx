import React from 'react';
import * as THREE from 'three';
import { TRUCK_DIMENSIONS } from './constants';

const OrientationWidget = ({
  selectedBox,
  widgetPos,
  dragControllerRef,
  setSelectedBox,
  onPhysicsSync
}) => {
  if (!selectedBox) return null;

  const rotateBox = (axis, dir = 1) => {
    const mesh = selectedBox.mesh;
    const size = selectedBox.size;
    const angle = (Math.PI / 2) * dir;

    if (axis === 'y') {
      mesh.rotation.y += angle;
      const tmp = size.x; size.x = size.z; size.z = tmp;
    } else if (axis === 'x') {
      mesh.rotation.x += angle;
      const tmp = size.y; size.y = size.z; size.z = tmp;
    } else if (axis === 'z') {
      mesh.rotation.z += angle;
      const tmp = size.x; size.x = size.y; size.y = tmp;
    }

    const halfL = TRUCK_DIMENSIONS.length / 2;
    const halfW = TRUCK_DIMENSIONS.width / 2;
    mesh.position.x = THREE.MathUtils.clamp(mesh.position.x, -halfL + size.x / 2, halfL - size.x / 2);
    mesh.position.z = THREE.MathUtils.clamp(mesh.position.z, -halfW + size.z / 2, halfW - size.z / 2);
    mesh.position.y = Math.max(mesh.position.y, 0.1 + size.y / 2);
    mesh.updateMatrixWorld(true);
    onPhysicsSync?.(selectedBox);
  };

  const handleDone = () => {
    dragControllerRef.current?.exitOrientMode(selectedBox);
    setSelectedBox(null);
  };

  const axes = [
    { label: 'Turn', axis: 'y', key: 'R', left: '↺ Left', right: '↻ Right' },
    { label: 'Tilt', axis: 'x', key: 'T', left: '▲ Forward', right: '▼ Back' },
    { label: 'Roll', axis: 'z', key: 'Y', left: '◀ Left', right: '▶ Right' },
  ];

  return (
    <div
      className="orient"
      style={{
        left: `${Math.max(8, Math.min(widgetPos.x + 16, window.innerWidth - 220))}px`,
        top: `${Math.max(8, Math.min(widgetPos.y - 80, window.innerHeight - 240))}px`,
      }}
    >
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Orientation</div>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>Turn, tilt or roll the box 90°</div>
      </div>

      {axes.map(({ label, axis, key, left, right }) => (
        <div key={axis} style={{ marginBottom: 10 }}>
          <div className="section-title" style={{ marginBottom: 4 }}>{label} <kbd>{key}</kbd></div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="btn btn-sm" style={{ flex: 1 }} title={key} onClick={() => rotateBox(axis, 1)}>{left}</button>
            <button type="button" className="btn btn-sm" style={{ flex: 1 }} title={`Shift + ${key}`} onClick={() => rotateBox(axis, -1)}>{right}</button>
          </div>
        </div>
      ))}

      <button type="button" className="btn btn-primary btn-block" style={{ marginTop: 4 }} onClick={handleDone}>
        Done
      </button>
    </div>
  );
};

export default OrientationWidget;
