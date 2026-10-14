import React from 'react';
import { TRUCK_VOLUME } from './constants';
import Icon from './Icons';

// FPS is a developer number; show it only with ?debug in the URL.
const SHOW_DEBUG = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug');

// Top bar: title, load stats, and undo/redo
const Header = ({
  stats,
  usedVolume,
  volumePercentage,
  isBoxDragging,
  historyIndex,
  history,
  undo,
  redo,
  selectedExampleName,
  stressResult
}) => {
  const pct = Math.min(100, Number(volumePercentage) || 0);
  const canUndo = historyIndex >= 0;
  const canRedo = historyIndex < history.length - 1;

  return (
    <header className="header">
      <div className="brand">
        <div className="brand-mark"><Icon name="truck" size={20} /></div>
        <div style={{ minWidth: 0 }}>
          <h1 className="brand-title">Truck Loading Simulator</h1>
          <div className="brand-sub">
            53′ × 8.5′ × 9′ trailer{selectedExampleName ? ` · ${selectedExampleName}` : ''}
          </div>
        </div>
      </div>

      <div className="header-stats">
        {isBoxDragging && (
          <span className="status-pill hide-sm"><span className="status-dot" />Moving box</span>
        )}
        {stressResult && (
          <span className={`status-pill hide-md ${stressResult.passed ? 'ok' : 'warn'}`}>
            Stress test: {stressResult.avgFps} FPS avg
          </span>
        )}
        {SHOW_DEBUG && (
          <div className="stat hide-sm">
            <span className="stat-label">FPS</span>
            <span className="stat-value">{stats.fps || '–'}</span>
          </div>
        )}
        <div className="stat">
          <span className="stat-label">Boxes</span>
          <span className="stat-value">{stats.boxCount || 0}</span>
        </div>
        <div className="stat fill" title={`${usedVolume.toFixed(1)} of ${TRUCK_VOLUME} ft³ used`}>
          <div className="fill-row">
            <span className="stat-label">Trailer fill</span>
            <span className="stat-value">{pct.toFixed(1)}%</span>
          </div>
          <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="progress-bar" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      <div className="header-actions">
        <button type="button" className="btn btn-icon" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
          <Icon name="undo" />
        </button>
        <button type="button" className="btn btn-icon" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)" aria-label="Redo">
          <Icon name="redo" />
        </button>
      </div>
    </header>
  );
};

export default Header;
