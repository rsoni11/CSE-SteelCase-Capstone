import React, { useState } from 'react';
import { MAX_BOXES } from './constants';
import LoadExampleSelector from './LoadExampleSelector';
import Icon from './Icons';

// Left sidebar (bottom sheet on phones) — all user stories combined.
// Undo/redo live in the header, so they are not repeated here.
const ControlPanel = ({
  boxes,
  availableBoxes,
  selectedBoxType,
  setSelectedBoxType,
  addBox,
  clearBoxes,
  exportLoadPlan,
  isBoxDragging,
  orientEntry = null,
  onRotateBox,
  dragControllerRef,
  handleCameraView,
  handleCSVUpload,
  // US1 Yash
  loadExamples,
  onSelectLoadExample,
  selectedExampleId,
  queueCount,
  queueSummary,
  addNextQueuedBox,
  sortQueueForPacking,
  // US6 Yash
  runStressTest,
  isStressTestRunning,
  stressResult,
  // AI Best Fit
  onSuggestPlacement,
  onSnapToSuggestion,
  hasSuggestion,
  isCalcSuggestion,
  suggestionCount = 0,
  suggestionReasons = [],
  suggestionOrientation = null,
  searchDiagnostics = null,
  activeStopFilter,
  setActiveStopFilter,
  onFinishSession,
  selectedGroupCount = 0,
  onClearGroup,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isDropOver, setIsDropOver] = useState(false);

  // Becky: check if selected box still has remaining quantity
  const selectedLoadedCount = selectedBoxType ? boxes.filter(b => b.type === selectedBoxType.id).length : 0;
  const selectedRemaining   = selectedBoxType ? ((selectedBoxType.availableQty ?? Infinity) - selectedLoadedCount) : 0;
  const canAddBox           = selectedBoxType && selectedRemaining > 0 && boxes.length < MAX_BOXES;
  const hasBoxes            = boxes.length > 0;
  const canSnap             = hasSuggestion && hasBoxes;
  const canRotate           = isBoxDragging || !!orientEntry;

  const addLabel = boxes.length >= MAX_BOXES
    ? 'Truck full'
    : (selectedRemaining <= 0 && selectedBoxType
        ? 'Quantity depleted'
        : ((queueCount ?? 0) > 0
            ? (selectedBoxType?.fragile ? 'Add next box (fragile)' : 'Add next box')
            : (selectedBoxType?.fragile ? 'Add fragile box' : 'Add box')));

  return (
    <aside className={`sidebar${isCollapsed ? ' is-collapsed' : ''}`}>
      <button type="button" className="sidebar-handle" onClick={() => setIsCollapsed(c => !c)}>
        {isCollapsed ? 'Show controls' : 'Hide controls'}
      </button>

      <div className="sidebar-scroll">
        {/* ── 1. Load ─────────────────────────────────────────────────────── */}
        <section className="section">
          <div className="section-title">1 · Choose a load</div>
          <label
            className={`dropzone${isDropOver ? ' is-over' : ''}`}
            onDragOver={e => { e.preventDefault(); setIsDropOver(true); }}
            onDragLeave={e => { e.preventDefault(); setIsDropOver(false); }}
            onDrop={e => { e.preventDefault(); setIsDropOver(false); handleCSVUpload(e); }}
          >
            <input type="file" accept=".csv" onChange={handleCSVUpload} style={{ display: 'none' }} />
            <Icon name="upload" size={20} />
            <div>
              <div className="dropzone-title">Upload Steelcase CSV</div>
              <div className="dropzone-sub">Drop a file here or click to browse</div>
            </div>
          </label>

          {/* US1 Yash: Load Example Selector */}
          {loadExamples && (
            <LoadExampleSelector
              examples={loadExamples}
              selectedExampleId={selectedExampleId}
              onSelect={onSelectLoadExample}
            />
          )}
        </section>

        {/* US1 Yash: queue status + summary */}
        {queueSummary?.length > 0 && (
          <section className="section">
            <div className="queue-card">
              <div className="queue-head">
                <span>Boxes waiting in queue</span>
                <strong>{queueCount ?? 0}</strong>
              </div>
              <div className="queue-list">
                {queueSummary.map(item => (
                  <div key={`${item.label}-${item.count}`} className="queue-item">
                    <span className="swatch" style={{ background: item.color, width: 10, height: 10 }} />
                    <span>{item.label}</span>
                    <strong>×{item.count}</strong>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ── 2. Stop + box type ──────────────────────────────────────────── */}
        <section className="section">
          <div className="section-title">2 · Pick a stop and box</div>

          {/* Becky: Active Stop Filter banner / empty state */}
          {activeStopFilter ? (
            <div className="callout callout-active">
              <span>Loading stop {activeStopFilter}</span>
              <button type="button" className="btn btn-sm" onClick={() => setActiveStopFilter(null)}>Clear</button>
            </div>
          ) : (
            <div className="callout callout-info">
              <span>Open <strong>Shipment summary</strong> (top right) and pick a stop to see its packages.</span>
            </div>
          )}

          {/* Becky: Box Type Selector with qty tracking (stop-filtered) */}
          {activeStopFilter && availableBoxes.length > 0 && (
            <div className="option-list" style={{ marginTop: 8, maxHeight: 260, overflowY: 'auto' }}>
              {availableBoxes.map((config) => {
                const isFragile    = config.fragile ?? false;
                const loadedCount  = boxes.filter(b => b.type === config.id).length;
                const remainingQty = (config.availableQty ?? Infinity) - loadedCount;
                const isDepleted   = remainingQty <= 0;
                const isSelected   = selectedBoxType?.id === config.id;
                return (
                  <button
                    type="button"
                    key={config.id}
                    className={`option${isSelected ? ' is-selected' : ''}${isDepleted ? ' is-disabled' : ''}`}
                    onClick={() => { if (!isDepleted) setSelectedBoxType(config); }}
                    disabled={isDepleted}
                  >
                    <div className="option-row">
                      {/* US5 Rhea: fragile swatch is ringed */}
                      <span className={`swatch${isFragile ? ' fragile' : ''}`} style={{ background: config.color }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="option-title">{config.label}</div>
                        {isFragile && (
                          <span className="chip chip-fragile" style={{ marginTop: 4 }}>
                            <Icon name="alert" size={11} /> Fragile
                          </span>
                        )}
                      </div>
                      {/* Becky: quantity indicator */}
                      <span className={`chip ${isDepleted ? 'chip-muted' : 'chip-success'}`}>
                        {remainingQty === Infinity ? '∞' : remainingQty} left
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Add Box (Becky qty-aware / Yash queue-aware) */}
          <button
            type="button"
            className="btn btn-primary btn-block btn-lg"
            style={{ marginTop: 10 }}
            onClick={addNextQueuedBox ?? addBox}
            disabled={!canAddBox}
          >
            <Icon name="plus" /> {addLabel}
          </button>

          {/* Load order — heaviest to the deck first, fragile on top */}
          {(queueCount ?? 0) > 1 && sortQueueForPacking && (
            <button
              type="button"
              className="btn btn-ghost btn-block"
              style={{ marginTop: 6 }}
              onClick={sortQueueForPacking}
              title="Reorder the remaining queue: heaviest and bulkiest first, fragile last"
            >
              <Icon name="sort" /> Sort queue by weight
            </button>
          )}
        </section>

        {/* ── 3. AI Best Fit ──────────────────────────────────────────────── */}
        <section className="section ai-card">
          <div className="section-title">
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="sparkles" size={13} /> AI best fit</span>
          </div>
          <button
            type="button"
            className="btn btn-success btn-block"
            onClick={onSuggestPlacement}
            disabled={isCalcSuggestion}
          >
            {isCalcSuggestion
              ? <><span className="spinner" /> Calculating…</>
              : <><Icon name="sparkles" /> Suggest best placement</>}
          </button>
          <button
            type="button"
            className="btn btn-block btn-pulse"
            style={{ marginTop: 8, color: canSnap ? 'var(--success)' : undefined, borderColor: canSnap ? 'var(--success)' : undefined }}
            onClick={onSnapToSuggestion}
            disabled={!canSnap}
          >
            <Icon name="target" /> Snap last box to suggestion
          </button>
          <div className={`ai-status${hasSuggestion ? ' ok' : ''}`}>
            {hasSuggestion
              ? `Ghost preview shown in the trailer · ${suggestionCount} ranked option${suggestionCount === 1 ? '' : 's'}`
              : 'Add a box, then ask for a suggestion'}
          </div>

          {/* US2: say which rotation won; US1: and how long the search took */}
          {hasSuggestion && searchDiagnostics && (
            <div className="ai-diag">
              {suggestionOrientation ? `Orientation: ${suggestionOrientation} · ` : ''}
              {searchDiagnostics.orientationsTried}/{searchDiagnostics.orientationsAvailable} rotations tried
              {' · '}{Math.round(searchDiagnostics.elapsedMs)} ms
            </div>
          )}

          {/* Why this spot — makes the ranking auditable instead of a black box */}
          {hasSuggestion && suggestionReasons.length > 0 && (
            <div className="reasons">
              <div className="section-title" style={{ marginBottom: 4 }}>Why this spot</div>
              {suggestionReasons.map((reason) => {
                const warn = reason.startsWith('Warning');
                return (
                  <div key={reason} className={`reason${warn ? ' warn' : ''}`}>
                    <Icon name={warn ? 'alert' : 'check'} size={13} style={{ marginTop: 3, flexShrink: 0 }} />
                    <span>{reason}</span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── 4. Arrange ──────────────────────────────────────────────────── */}
        <section className="section">
          <div className="section-title">Arrange</div>
          {selectedGroupCount > 0 && (
            <div className="callout callout-group" style={{ marginBottom: 8 }}>
              <span>{selectedGroupCount} boxes grouped</span>
              <button type="button" className="btn btn-sm" onClick={onClearGroup}>Clear</button>
            </div>
          )}
          <button
            type="button"
            className="btn btn-block"
            onClick={() => (onRotateBox ? onRotateBox() : dragControllerRef.current?.rotateSelected())}
            disabled={!canRotate}
            title={canRotate ? 'Rotate 90°' : 'Drag a box or double-click one to rotate it'}
          >
            <Icon name="rotate" /> Rotate box 90° <kbd>R</kbd>
          </button>

          <div className="section-title" style={{ marginTop: 16 }}>Camera</div>
          <div className="segmented">
            {['default', 'top', 'side', 'back'].map(view => (
              <button key={view} type="button" onClick={() => handleCameraView(view)}>
                {view === 'default' ? '3D' : view}
              </button>
            ))}
          </div>
        </section>

        {/* US6 Yash: Stress Test — a developer tool, so tucked away */}
        <details className="dev-tools">
          <summary>Developer tools</summary>
          <button type="button" className="btn btn-block btn-sm" onClick={runStressTest} disabled={isStressTestRunning}>
            <Icon name="gauge" /> {isStressTestRunning ? 'Running 55-box stress test…' : 'Run 55-box stress test'}
          </button>
          {stressResult && (
            <div style={{ marginTop: 6, color: stressResult.passed ? 'var(--success)' : 'var(--warning)', fontWeight: 600 }}>
              Avg {stressResult.avgFps} FPS (min {stressResult.minFps}) — {stressResult.passed ? 'pass' : 'check'}
            </div>
          )}
        </details>
      </div>

      <div className="sidebar-footer">
        <button type="button" className="btn btn-primary" onClick={onFinishSession} disabled={!hasBoxes}>
          <Icon name="flag" /> Finish &amp; see results
        </button>
        <button type="button" className="btn" onClick={exportLoadPlan} disabled={!hasBoxes}>
          <Icon name="download" /> Export
        </button>
        <button type="button" className="btn btn-danger-text" onClick={clearBoxes} disabled={!hasBoxes}>
          <Icon name="trash" /> Clear all
        </button>
      </div>
    </aside>
  );
};

export default ControlPanel;
