import React, { useState } from 'react';

// Toggleable controls guide panel
const ControlsGuide = () => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div style={{
      position: 'absolute', top: 100, right: 30,
      zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'flex-end'
    }}>
      <button
        onClick={() => setIsOpen(prev => !prev)}
        style={{
          background: isOpen ? '#667eea' : 'rgba(255,255,255,0.95)',
          color: isOpen ? '#fff' : '#667eea',
          border: '2px solid #667eea',
          borderRadius: isOpen ? '12px 12px 0 0' : '12px',
          padding: '8px 16px',
          fontSize: '13px', fontWeight: 600, cursor: 'pointer',
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
          transition: 'all 0.2s ease'
        }}
      >
        {isOpen ? '✕ Close Guide' : '? Controls'}
      </button>

      {isOpen && (
        <div style={{
          background: 'rgba(255,255,255,0.97)',
          borderRadius: '12px 0 12px 12px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
          padding: '16px 20px', fontSize: '13px', color: '#666', maxWidth: '220px',
          border: '2px solid #667eea', borderTop: 'none'
        }}>
          <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', fontWeight: 600, color: '#1a1a1a' }}>Camera Controls</h4>
          <div style={{ lineHeight: '1.8' }}>
            <div><strong>Rotate:</strong> Left click + drag</div>
            <div><strong>Zoom:</strong> Scroll wheel</div>
            <div><strong>Pan:</strong> Right click + drag</div>
          </div>
          <hr style={{ border: 'none', borderTop: '1px solid #e0e0e0', margin: '10px 0' }} />
          <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', fontWeight: 600, color: '#1a1a1a' }}>Box Controls</h4>
          <div style={{ lineHeight: '1.8' }}>
            <div><strong>Move box:</strong> Click + drag</div>
            <div><strong>Raise:</strong> W / ↑ while dragging</div>
            <div><strong>Lower:</strong> S / ↓ while dragging</div>
            <div><strong>Rotate:</strong> Double-click box</div>
            <div><strong style={{ color: '#4aa3ff' }}>Blue:</strong> Valid placement</div>
            <div><strong style={{ color: '#ff0000' }}>Red:</strong> Collision!</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ControlsGuide;
