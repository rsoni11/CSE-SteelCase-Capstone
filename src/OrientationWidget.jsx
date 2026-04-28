import React from 'react';
import * as THREE from 'three';
import { TRUCK_DIMENSIONS } from './constants';

const btnStyle = (color) => ({
  flex: 1, padding: '6px 8px', background: '#fff',
  color, border: `1.5px solid ${color}`, borderRadius: '6px',
  fontSize: '12px', fontWeight: 600, cursor: 'pointer'
});

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

  return (
    <div style={{
      position: 'absolute',
      left: `${Math.min(widgetPos.x + 16, window.innerWidth - 210)}px`,
      top: `${Math.min(widgetPos.y - 80, window.innerHeight - 220)}px`,
      background: '#ffffff', borderRadius: '14px',
      boxShadow: '0 6px 30px rgba(0,0,0,0.2)',
      padding: '16px', zIndex: 20, minWidth: '185px',
      userSelect: 'none', border: '2px solid #f39c12'
    }}>
      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: '#1a1a1a', marginBottom: '2px' }}>
          🔄 Orientation
        </div>
        <div style={{ fontSize: '11px', color: '#999' }}>Opened with double-click on the box</div>
      </div>

      <div style={{ marginBottom: '10px' }}>
        <div style={{ fontSize: '11px', color: '#667eea', fontWeight: 600, marginBottom: '5px' }}>TURN</div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button onClick={() => rotateBox('y',  1)} style={btnStyle('#667eea')}>↺ Left</button>
          <button onClick={() => rotateBox('y', -1)} style={btnStyle('#667eea')}>↻ Right</button>
        </div>
      </div>

      <div style={{ marginBottom: '10px' }}>
        <div style={{ fontSize: '11px', color: '#1AA37A', fontWeight: 600, marginBottom: '5px' }}>TILT</div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button onClick={() => rotateBox('x',  1)} style={btnStyle('#1AA37A')}>▲ Fwd</button>
          <button onClick={() => rotateBox('x', -1)} style={btnStyle('#1AA37A')}>▼ Back</button>
        </div>
      </div>

      <div style={{ marginBottom: '14px' }}>
        <div style={{ fontSize: '11px', color: '#FF6B35', fontWeight: 600, marginBottom: '5px' }}>ROLL</div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button onClick={() => rotateBox('z',  1)} style={btnStyle('#FF6B35')}>◀ Left</button>
          <button onClick={() => rotateBox('z', -1)} style={btnStyle('#FF6B35')}>▶ Right</button>
        </div>
      </div>

      <button onClick={handleDone} style={{
        width: '100%', padding: '10px', background: '#f39c12',
        color: '#fff', border: 'none', borderRadius: '8px',
        fontSize: '13px', fontWeight: 700, cursor: 'pointer'
      }}>
        ✓ Done — Move Box
      </button>
    </div>
  );
};

export default OrientationWidget;
