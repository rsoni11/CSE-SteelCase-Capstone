import React, { useState, useEffect } from 'react';
import { MAX_BOXES } from './constants';
import LoadExampleSelector from './LoadExampleSelector';

// Draggable, minimizable control panel — all user stories combined
const ControlPanel = ({
  boxes,
  availableBoxes,
  selectedBoxType,
  setSelectedBoxType,
  addBox,
  clearBoxes,
  exportLoadPlan,
  historyIndex,
  history,
  undo,
  redo,
  isBoxDragging,
  orientEntry = null,
  onRotateBox,
  dragControllerRef,
  handleCameraView,
  handleCSVUpload,
  // US1 Yash
  loadExamples,
  onSelectLoadExample,
  selectedExampleName,
  selectedExampleId,
  queueCount,
  queueSummary,
  addNextQueuedBox,
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
  activeStopFilter,
  setActiveStopFilter,
  onFinishSession,
  selectedGroupCount = 0,
  onClearGroup,
}) => {
  const [isPanelMinimized, setIsPanelMinimized] = useState(false);
  const [panelPosition, setPanelPosition] = useState({ x: 30, y: window.innerHeight - 500 });
  const [isDraggingPanel, setIsDraggingPanel] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const handleMouseDown = (e) => {
    if (e.target.closest('.panel-header')) {
      setIsDraggingPanel(true);
      setDragOffset({ x: e.clientX - panelPosition.x, y: e.clientY - panelPosition.y });
    }
  };
  const handleMouseMove = (e) => {
    if (isDraggingPanel) setPanelPosition({ x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y });
  };
  const handleMouseUp = () => setIsDraggingPanel(false);

  useEffect(() => {
    if (isDraggingPanel) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
    }
  }, [isDraggingPanel, dragOffset]);

  const btnBase = {
    width: '100%', padding: '12px 24px', borderRadius: '8px',
    fontSize: '14px', fontWeight: 600, transition: 'all 0.2s ease', marginBottom: '8px'
  };

  // Becky: check if selected box still has remaining quantity
  const selectedLoadedCount  = selectedBoxType ? boxes.filter(b => b.type === selectedBoxType.id).length : 0;
  const selectedRemaining    = selectedBoxType ? ((selectedBoxType.availableQty ?? Infinity) - selectedLoadedCount) : 0;
  const canAddBox            = selectedBoxType && selectedRemaining > 0 && boxes.length < MAX_BOXES;

  return (
    <div
      style={{ position: 'absolute', left: `${panelPosition.x}px`, top: `${panelPosition.y}px`,
        background: '#ffffff', borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
        minWidth: '320px', zIndex: 10, userSelect: 'none' }}
      onMouseDown={handleMouseDown}
    >
      {/* Draggable Header */}
      <div className="panel-header" style={{
        padding: '16px 20px',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        borderTopLeftRadius: '12px', borderTopRightRadius: '12px',
        cursor: 'move', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
      }}>
        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#ffffff' }}>Add Boxes</h3>
        <button
          onClick={() => setIsPanelMinimized(!isPanelMinimized)}
          style={{ background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: '4px',
            color: '#ffffff', cursor: 'pointer', padding: '4px 12px', fontSize: '14px', fontWeight: 600 }}
        >{isPanelMinimized ? '□' : '−'}</button>
      </div>

      {/* Panel Content */}
      {!isPanelMinimized && (
        <div style={{ padding: '24px', maxHeight: '85vh', overflowY: 'auto' }}>

          {/* ── CSV Upload ───────────────────────────────────────────────── */}
          <div style={{ marginBottom: '16px' }}>
            <label
              onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor='#1AA37A'; e.currentTarget.style.background='#e8f6f3'; }}
              onDragLeave={e => { e.preventDefault(); e.currentTarget.style.borderColor='#ced4da'; e.currentTarget.style.background='#f8f9fa'; }}
              onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor='#ced4da'; e.currentTarget.style.background='#f8f9fa'; handleCSVUpload(e); }}
              style={{ display: 'block', width: '100%', padding: '20px 10px', background: '#f8f9fa',
                color: '#495057', border: '2px dashed #ced4da', borderRadius: '8px',
                fontSize: '13px', fontWeight: 600, cursor: 'pointer', textAlign: 'center',
                transition: 'all 0.2s ease', boxSizing: 'border-box' }}
            >
              <input type="file" accept=".csv" onChange={handleCSVUpload} style={{ display: 'none' }} />
              <div style={{ fontSize: '18px', marginBottom: '4px' }}>📥</div>
              Drag & Drop your Steelcase CSV here<br/>
              <span style={{ fontSize: '11px', color: '#888', fontWeight: 400 }}>or click to browse</span>
            </label>
          </div>

          {/* ── US1 Yash: Load Example Selector ─────────────────────────── */}
          {loadExamples && (
            <LoadExampleSelector
              examples={loadExamples}
              selectedExampleId={selectedExampleId}
              onSelect={onSelectLoadExample}
            />
          )}

          {/* US1 Yash: queue status */}
          {selectedExampleName && (
            <div style={{ marginBottom: '12px', fontSize: '12px', color: '#495057', background: '#f8f9fa', borderRadius: '8px', padding: '10px' }}>
              Selected Example: <strong>{selectedExampleName}</strong><br/>
              Queue Remaining: <strong>{queueCount ?? 0}</strong>
            </div>
          )}

          {/* US1 Yash: queue summary pills */}
          {queueSummary?.length > 0 && (
            <div style={{ marginBottom: '12px', background: '#ffffff', border: '1px solid #e9ecef', borderRadius: '8px', padding: '8px', maxHeight: '120px', overflowY: 'auto' }}>
              {queueSummary.map(item => (
                <div key={`${item.label}-${item.count}`} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', fontSize: '11px' }}>
                  <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: item.color, flexShrink: 0 }} />
                  <span style={{ color: '#495057' }}>{item.label}</span>
                  <strong style={{ marginLeft: 'auto', color: '#212529' }}>x{item.count}</strong>
                </div>
              ))}
            </div>
          )}

          {/* ── Becky: Active Stop Filter banner / empty state ───────────── */}
          {activeStopFilter ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '10px 12px', marginBottom: '16px', background: '#eef2f5',
              borderLeft: '4px solid #1AA37A', borderRadius: '6px', fontSize: '12px', fontWeight: 600, color: '#004E89' }}>
              <span>Currently Loading: Stop {activeStopFilter}</span>
              <button onClick={() => setActiveStopFilter(null)} style={{
                background: '#ffffff', border: '1px solid #ced4da', color: '#666',
                borderRadius: '4px', cursor: 'pointer', fontSize: '11px', padding: '4px 8px' }}>
                Clear
              </button>
            </div>
          ) : (
            <div style={{ padding: '16px 14px', marginBottom: '16px', background: '#f8f9fa',
              border: '1px dashed #ced4da', borderRadius: '8px',
              fontSize: '13px', color: '#666', textAlign: 'center', lineHeight: '1.5' }}>
              Select a Stop from the <strong>Shipment Summary</strong> panel ↗<br/>to view and load packages.
            </div>
          )}

          {/* ── Becky: Box Type Selector with qty tracking (stop-filtered) ── */}
          {activeStopFilter && availableBoxes.length > 0 && (
            <div style={{ marginBottom: '20px', maxHeight: '250px', overflowY: 'auto' }}>
              {availableBoxes.map((config) => {
                const isFragile    = config.fragile ?? false;
                const loadedCount  = boxes.filter(b => b.type === config.id).length;
                const remainingQty = (config.availableQty ?? Infinity) - loadedCount;
                const isDepleted   = remainingQty <= 0;
                const isSelected   = selectedBoxType?.id === config.id;
                return (
                  <div key={config.id}
                    onClick={() => { if (!isDepleted) setSelectedBoxType(config); }}
                    style={{
                      padding: '12px 16px', marginBottom: '8px',
                      border: `2px solid ${isSelected ? (isFragile ? '#ff0066' : config.color) : '#e0e0e0'}`,
                      borderRadius: '8px', cursor: isDepleted ? 'not-allowed' : 'pointer',
                      transition: 'all 0.2s ease',
                      background: isSelected ? (isFragile ? '#fff0f5' : `${config.color}10`) : '#ffffff',
                      opacity: isDepleted ? 0.6 : 1,
                      transform: isSelected && !isDepleted ? 'scale(1.02)' : 'scale(1)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        {/* US5 Rhea: pink swatch + warning icon for fragile */}
                        <div style={{ position: 'relative', flexShrink: 0 }}>
                          <div style={{ width: '20px', height: '20px',
                            background: isFragile ? '#ff69b4' : config.color,
                            borderRadius: '4px',
                            border: isFragile ? '2px solid #ff0066' : 'none' }} />
                          {isFragile && <span style={{ position: 'absolute', top: '-6px', right: '-6px', fontSize: '10px', lineHeight: 1 }}>⚠️</span>}
                        </div>
                        <div>
                          <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a' }}>{config.label}</div>
                          {/* US5 Rhea: fragile label */}
                          {isFragile && <div style={{ fontSize: '11px', color: '#e74c3c', fontWeight: 600, marginTop: '1px' }}>⚠ FRAGILE</div>}
                        </div>
                      </div>
                      {/* Becky: quantity indicator */}
                      <div style={{ fontSize: '11px', fontWeight: 700,
                        background: isDepleted ? '#f1f3f5' : '#e8f6f3',
                        color: isDepleted ? '#adb5bd' : '#1AA37A',
                        padding: '4px 8px', borderRadius: '12px' }}>
                        {remainingQty === Infinity ? '∞' : remainingQty} left
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Add Box (Becky qty-aware / Yash queue-aware) ─────────────── */}
          <button
            onClick={addNextQueuedBox ?? addBox}
            disabled={!canAddBox}
            style={{
              ...btnBase,
              background: selectedBoxType && canAddBox
                ? ((selectedBoxType.fragile ?? false) ? '#ff69b4' : selectedBoxType.color)
                : '#e0e0e0',
              color:  canAddBox ? '#ffffff' : '#999',
              border: (selectedBoxType?.fragile && canAddBox) ? '2px solid #ff0066' : 'none',
              cursor: canAddBox ? 'pointer' : 'not-allowed',
              opacity: canAddBox ? 1 : 0.5
            }}
          >
            {boxes.length >= MAX_BOXES
              ? 'Truck Full (Limit Reached)'
              : (selectedRemaining <= 0 && selectedBoxType
                  ? 'Quantity Depleted'
                  : ((queueCount ?? 0) > 0
                      ? ((selectedBoxType?.fragile ? '⚠ Add Next Fragile Box' : 'Add Next Box From Queue'))
                      : ((selectedBoxType?.fragile ? '⚠ Add Fragile Box' : 'Add Box'))))}
          </button>

          {/* ── US6 Yash: Stress Test ────────────────────────────────────── */}
          <button onClick={runStressTest} disabled={isStressTestRunning}
            style={{ ...btnBase, background: '#2C3E50', color: '#ffffff', border: 'none',
              cursor: isStressTestRunning ? 'not-allowed' : 'pointer', opacity: isStressTestRunning ? 0.6 : 1 }}>
            {isStressTestRunning ? 'Running 55-Box Stress Test...' : 'Run 55-Box Stress Test'}
          </button>
          {stressResult && (
            <div style={{ marginBottom: '10px', fontSize: '12px', color: stressResult.passed ? '#1AA37A' : '#FF6B35', fontWeight: 600 }}>
              Stress Result: Avg {stressResult.avgFps} FPS (Min {stressResult.minFps}) — {stressResult.passed ? 'PASS ✓' : 'CHECK ⚠'}
            </div>
          )}

          {/* ── AI Best Fit ──────────────────────────────────────────────── */}
          <div style={{ marginBottom: '8px', background: 'linear-gradient(135deg, #e8f8f2 0%, #d4f1e8 100%)',
            border: '1.5px solid #1AA37A', borderRadius: '10px', padding: '14px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.6px', color: '#1AA37A',
              textTransform: 'uppercase', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>✦</span> AI Best Fit
            </div>
            <button onClick={onSuggestPlacement} disabled={isCalcSuggestion}
              style={{ ...btnBase, marginBottom: '8px',
                background: isCalcSuggestion ? '#a0d9c4' : 'linear-gradient(135deg, #1AA37A 0%, #13815f 100%)',
                color: '#ffffff', border: 'none', cursor: isCalcSuggestion ? 'wait' : 'pointer',
                opacity: isCalcSuggestion ? 0.8 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              {isCalcSuggestion ? (
                <><span style={{ display: 'inline-block', width: '14px', height: '14px',
                  border: '2px solid rgba(255,255,255,0.4)', borderTop: '2px solid #fff',
                  borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />Calculating…</>
              ) : <>✦ Suggest Best Placement</>}
            </button>
            <button onClick={onSnapToSuggestion} disabled={!hasSuggestion || boxes.length === 0}
              style={{ ...btnBase, marginBottom: 0,
                background: hasSuggestion && boxes.length > 0 ? '#ffffff' : '#f5f5f5',
                color: hasSuggestion && boxes.length > 0 ? '#1AA37A' : '#aaa',
                border: `2px solid ${hasSuggestion && boxes.length > 0 ? '#1AA37A' : '#e0e0e0'}`,
                cursor: hasSuggestion && boxes.length > 0 ? 'pointer' : 'not-allowed',
                animation: hasSuggestion && boxes.length > 0 ? 'pulse-suggest 1.8s ease-in-out infinite' : 'none' }}>
              ⬇ Snap Last Box to Suggestion
            </button>
            <div style={{ marginTop: '8px', fontSize: '11px', color: hasSuggestion ? '#1AA37A' : '#999', textAlign: 'center', fontStyle: 'italic' }}>
              {hasSuggestion
                ? `● Ghost preview visible in truck (${suggestionCount} ranked suggestion${suggestionCount === 1 ? '' : 's'})`
                : 'No valid recommendation for current box'}
            </div>
          </div>

          {selectedGroupCount > 0 && (
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              marginBottom: '12px', padding: '10px 12px', background: '#eef2ff',
              borderRadius: '8px', fontSize: '12px', fontWeight: 600, color: '#4338ca'
            }}>
              <span>Group selected: {selectedGroupCount} boxes</span>
              <button
                type="button"
                onClick={onClearGroup}
                style={{
                  background: '#ffffff', border: '1px solid #c7d2fe', color: '#4338ca',
                  borderRadius: '6px', cursor: 'pointer', fontSize: '11px', padding: '4px 10px'
                }}
              >
                Clear
              </button>
            </div>
          )}

          {/* Session summary */}
          <button type="button" onClick={onFinishSession} disabled={boxes.length === 0}
            style={{ ...btnBase,
              background: boxes.length > 0 ? 'linear-gradient(135deg, #f39c12, #e67e22)' : '#f5f5f5',
              color: boxes.length > 0 ? '#ffffff' : '#aaa', border: 'none',
              cursor: boxes.length === 0 ? 'not-allowed' : 'pointer',
              opacity: boxes.length === 0 ? 0.5 : 1, fontWeight: 700 }}>
            📊 Finish Session / View Results
          </button>

          {/* Clear All */}
          <button onClick={clearBoxes} disabled={boxes.length === 0}
            style={{ ...btnBase, background: '#ffffff', color: '#666', border: '2px solid #e0e0e0',
              cursor: boxes.length === 0 ? 'not-allowed' : 'pointer', opacity: boxes.length === 0 ? 0.5 : 1 }}>
            Clear All Boxes
          </button>

          {/* Export Load Plan */}
          <button onClick={exportLoadPlan} disabled={boxes.length === 0}
            style={{ ...btnBase, background: '#004E89', color: '#ffffff', border: 'none',
              cursor: boxes.length === 0 ? 'not-allowed' : 'pointer', opacity: boxes.length === 0 ? 0.5 : 1 }}>
            Export Load Plan
          </button>

          {/* Undo / Redo */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
            <button onClick={undo} disabled={historyIndex < 0}
              style={{ flex: 1, padding: '12px 16px', background: '#ffffff',
                color: historyIndex < 0 ? '#ccc' : '#667eea',
                border: `2px solid ${historyIndex < 0 ? '#e0e0e0' : '#667eea'}`,
                borderRadius: '8px', fontSize: '14px', fontWeight: 600,
                cursor: historyIndex < 0 ? 'not-allowed' : 'pointer',
                opacity: historyIndex < 0 ? 0.5 : 1, transition: 'all 0.2s ease' }}>
              ↶ Undo
            </button>
            <button onClick={redo} disabled={historyIndex >= history.length - 1}
              style={{ flex: 1, padding: '12px 16px', background: '#ffffff',
                color: historyIndex >= history.length - 1 ? '#ccc' : '#667eea',
                border: `2px solid ${historyIndex >= history.length - 1 ? '#e0e0e0' : '#667eea'}`,
                borderRadius: '8px', fontSize: '14px', fontWeight: 600,
                cursor: historyIndex >= history.length - 1 ? 'not-allowed' : 'pointer',
                opacity: historyIndex >= history.length - 1 ? 0.5 : 1, transition: 'all 0.2s ease' }}>
              Redo ↷
            </button>
          </div>

          {/* Rotate Box — while dragging, or when orientation panel is open */}
          <button
            type="button"
            onClick={() => (onRotateBox ? onRotateBox() : dragControllerRef.current?.rotateSelected())}
            disabled={!isBoxDragging && !orientEntry}
            style={{ ...btnBase, background: '#ffffff',
              color: (isBoxDragging || orientEntry) ? '#1AA37A' : '#aaa',
              border: `2px solid ${(isBoxDragging || orientEntry) ? '#1AA37A' : '#e0e0e0'}`,
              cursor: (isBoxDragging || orientEntry) ? 'pointer' : 'not-allowed', marginBottom: '16px' }}>
            ↻ Rotate Box 90° (R)
          </button>

          {/* Camera Views */}
          <div style={{ marginBottom: '8px' }}>
            <h4 style={{ margin: '0 0 8px 0', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#666' }}>
              Camera Views
            </h4>
            <div style={{ display: 'flex', gap: '8px' }}>
              {['top', 'side', 'back', 'default'].map(view => (
                <button key={view} onClick={() => handleCameraView(view)}
                  style={{ flex: 1, padding: '8px 0', background: '#f8f9fa', color: '#495057',
                    border: '1px solid #dee2e6', borderRadius: '6px', fontSize: '12px', fontWeight: 600,
                    cursor: 'pointer', textTransform: 'capitalize', transition: 'all 0.2s ease' }}>
                  {view}
                </button>
              ))}
            </div>
          </div>

        </div>
      )}
    </div>
  );
};

export default ControlPanel;
