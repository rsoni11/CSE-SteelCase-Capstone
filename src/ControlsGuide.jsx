import React from 'react';
import Icon from './Icons';

const CAMERA = [
  ['Rotate view', 'Left drag'],
  ['Zoom', 'Scroll'],
  ['Pan', 'Right drag'],
];

const BOXES = [
  ['Move box', 'Click + drag'],
  ['Raise / lower', 'W / S  or  ↑ / ↓'],
  ['Rotate 90°', 'R'],
  ['Tilt / roll', 'Double-click'],
  ['Group select', 'Shift + click'],
  ['Clear group', 'Esc'],
];

// Toggleable controls guide, shown from the stage toolbar
// Open state is owned by the parent so only one stage popover shows at a time
const ControlsGuide = ({ isOpen, onToggle }) => {

  return (
    <div className="popover-wrap">
      <button
        type="button"
        className={`btn floating-btn${isOpen ? ' is-active' : ''}`}
        onClick={onToggle}
        aria-expanded={isOpen}
        title="Controls"
      >
        <Icon name={isOpen ? 'x' : 'keyboard'} /> <span className="btn-label">Controls</span>
      </button>

      {isOpen && (
        <div className="popover" style={{ width: 280 }}>
          <h4>Camera</h4>
          <div className="kbd-list">
            {CAMERA.map(([action, keys]) => (
              <div key={action} className="kbd-row"><span>{action}</span><kbd>{keys}</kbd></div>
            ))}
          </div>
          <hr />
          <h4>Boxes</h4>
          <div className="kbd-list">
            {BOXES.map(([action, keys]) => (
              <div key={action} className="kbd-row"><span>{action}</span><kbd>{keys}</kbd></div>
            ))}
          </div>
          <hr />
          <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="swatch" style={{ background: '#4aa3ff', width: 10, height: 10 }} /> Valid spot
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="swatch" style={{ background: '#ff3b30', width: 10, height: 10 }} /> Collision
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default ControlsGuide;
