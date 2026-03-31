import React from 'react';
import { TRUCK_VOLUME } from './constants';

// Top header bar with title, stats, and undo/redo buttons
const Header = ({ stats, usedVolume, volumePercentage, isBoxDragging, historyIndex, history, undo, redo }) => {
  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0,
      padding: '20px 30px',
      background: 'linear-gradient(to bottom, rgba(255,255,255,0.98), rgba(255,255,255,0.92))',
      backdropFilter: 'blur(10px)',
      borderBottom: '1px solid rgba(0,0,0,0.1)',
      zIndex: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center'
    }}>
      {/* Title */}
      <div>
        <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 700, color: '#1a1a1a', letterSpacing: '-0.5px' }}>
          Truck Loading Simulator
        </h1>
        <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#666', fontWeight: 400 }}>
          53' × 8.5' × 9' Standard Trailer
        </p>
      </div>

      {/* Stats + controls */}
      <div style={{ display: 'flex', gap: '20px', fontSize: '13px', color: '#666', alignItems: 'center' }}>
        <div>
          <strong style={{ color: stats.fps >= 60 ? '#1AA37A' : '#FF6B35' }}>{stats.fps || 60} FPS</strong>
        </div>
        <div>Boxes: <strong>{stats.boxCount || 0}</strong></div>

        {/* Space utilization */}
        <div style={{ background: 'rgba(0,0,0,0.05)', padding: '4px 10px', borderRadius: '6px' }}>
          Space Used: <strong>{usedVolume.toFixed(2)} ft³</strong> / {TRUCK_VOLUME} ft³
          <strong style={{ color: '#004E89', marginLeft: '6px' }}>({volumePercentage}%)</strong>
        </div>

        {/* Undo / Redo buttons */}
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            onClick={undo}
            disabled={historyIndex < 0}
            title="Undo (Ctrl+Z)"
            style={{
              padding: '6px 14px', background: '#fff',
              color: historyIndex < 0 ? '#ccc' : '#667eea',
              border: `2px solid ${historyIndex < 0 ? '#e0e0e0' : '#667eea'}`,
              borderRadius: '8px', fontSize: '14px', fontWeight: 700,
              cursor: historyIndex < 0 ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s ease'
            }}
          >↶</button>
          <button
            onClick={redo}
            disabled={historyIndex >= history.length - 1}
            title="Redo (Ctrl+Y)"
            style={{
              padding: '6px 14px', background: '#fff',
              color: historyIndex >= history.length - 1 ? '#ccc' : '#667eea',
              border: `2px solid ${historyIndex >= history.length - 1 ? '#e0e0e0' : '#667eea'}`,
              borderRadius: '8px', fontSize: '14px', fontWeight: 700,
              cursor: historyIndex >= history.length - 1 ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s ease'
            }}
          >↷</button>
        </div>

        {isBoxDragging && (
          <div><strong style={{ color: '#9B59B6' }}>● Dragging</strong></div>
        )}
      </div>
    </div>
  );
};

export default Header;
