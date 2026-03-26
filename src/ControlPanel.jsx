import React, { useState, useEffect } from 'react';
import { BOX_CONFIGS, MAX_BOXES } from './constants';

// Draggable, minimizable control panel for adding/clearing boxes
const ControlPanel = ({
  boxes,
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
  dragControllerRef,
  handleCameraView
}) => {
  const [isPanelMinimized, setIsPanelMinimized] = useState(false);
  const [panelPosition, setPanelPosition] = useState({
    x: 30,
    y: window.innerHeight - 500
  });
  const [isDraggingPanel, setIsDraggingPanel] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const handleMouseDown = (e) => {
    if (e.target.closest('.panel-header')) {
      setIsDraggingPanel(true);
      setDragOffset({
        x: e.clientX - panelPosition.x,
        y: e.clientY - panelPosition.y
      });
    }
  };

  const handleMouseMove = (e) => {
    if (isDraggingPanel) {
      setPanelPosition({
        x: e.clientX - dragOffset.x,
        y: e.clientY - dragOffset.y
      });
    }
  };

  const handleMouseUp = () => setIsDraggingPanel(false);

  useEffect(() => {
    if (isDraggingPanel) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);

      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDraggingPanel, dragOffset]);

  const btnBase = {
    width: '100%',
    padding: '12px 24px',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 600,
    transition: 'all 0.2s ease',
    marginBottom: '8px'
  };

  return (
    <div
      style={{
        position: 'absolute',
        left: `${panelPosition.x}px`,
        top: `${panelPosition.y}px`,
        background: '#ffffff',
        borderRadius: '12px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
        minWidth: '320px',
        zIndex: 10,
        userSelect: 'none'
      }}
      onMouseDown={handleMouseDown}
    >
      <div
        className="panel-header"
        style={{
          padding: '16px 20px',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          borderTopLeftRadius: '12px',
          borderTopRightRadius: '12px',
          cursor: 'move',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: '16px',
            fontWeight: 600,
            color: '#ffffff'
          }}
        >
          Add Boxes
        </h3>

        <button
          onClick={() => setIsPanelMinimized(!isPanelMinimized)}
          style={{
            background: 'rgba(255,255,255,0.2)',
            border: 'none',
            borderRadius: '4px',
            color: '#ffffff',
            cursor: 'pointer',
            padding: '4px 12px',
            fontSize: '14px',
            fontWeight: 600
          }}
        >
          {isPanelMinimized ? '□' : '−'}
        </button>
      </div>

      {!isPanelMinimized && (
        <div style={{ padding: '24px' }}>
          <div style={{ marginBottom: '20px' }}>
            {BOX_CONFIGS.map((config) => (
              <div
                key={config.id}
                onClick={() => setSelectedBoxType(config)}
                style={{
                  padding: '12px 16px',
                  marginBottom: '8px',
                  border: `2px solid ${
                    selectedBoxType.id === config.id ? config.color : '#e0e0e0'
                  }`,
                  borderRadius: '8px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  background:
                    selectedBoxType.id === config.id
                      ? `${config.color}10`
                      : '#ffffff',
                  transform:
                    selectedBoxType.id === config.id ? 'scale(1.02)' : 'scale(1)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div
                    style={{
                      width: '24px',
                      height: '24px',
                      background: config.color,
                      borderRadius: '4px',
                      flexShrink: 0
                    }}
                  />
                  <div
                    style={{
                      fontSize: '14px',
                      fontWeight: 600,
                      color: '#1a1a1a'
                    }}
                  >
                    {config.label}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={addBox}
            disabled={boxes.length >= MAX_BOXES}
            style={{
              ...btnBase,
              background: selectedBoxType.color,
              color: '#ffffff',
              border: 'none',
              cursor: boxes.length >= MAX_BOXES ? 'not-allowed' : 'pointer',
              opacity: boxes.length >= MAX_BOXES ? 0.5 : 1
            }}
          >
            Add Box
          </button>

          <button
            onClick={clearBoxes}
            disabled={boxes.length === 0}
            style={{
              ...btnBase,
              background: '#ffffff',
              color: '#666',
              border: '2px solid #e0e0e0',
              cursor: boxes.length === 0 ? 'not-allowed' : 'pointer',
              opacity: boxes.length === 0 ? 0.5 : 1
            }}
          >
            Clear All Boxes
          </button>

          <button
            onClick={exportLoadPlan}
            disabled={boxes.length === 0}
            style={{
              ...btnBase,
              background: '#004E89',
              color: '#ffffff',
              border: 'none',
              cursor: boxes.length === 0 ? 'not-allowed' : 'pointer',
              opacity: boxes.length === 0 ? 0.5 : 1
            }}
          >
            Export Load Plan
          </button>

          <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
            <button
              onClick={undo}
              disabled={historyIndex < 0}
              style={{
                flex: 1,
                padding: '12px 16px',
                background: '#ffffff',
                color: historyIndex < 0 ? '#ccc' : '#667eea',
                border: `2px solid ${historyIndex < 0 ? '#e0e0e0' : '#667eea'}`,
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: historyIndex < 0 ? 'not-allowed' : 'pointer',
                opacity: historyIndex < 0 ? 0.5 : 1,
                transition: 'all 0.2s ease'
              }}
            >
              ↶ Undo
            </button>

            <button
              onClick={redo}
              disabled={historyIndex >= history.length - 1}
              style={{
                flex: 1,
                padding: '12px 16px',
                background: '#ffffff',
                color: historyIndex >= history.length - 1 ? '#ccc' : '#667eea',
                border: `2px solid ${
                  historyIndex >= history.length - 1 ? '#e0e0e0' : '#667eea'
                }`,
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 600,
                cursor:
                  historyIndex >= history.length - 1 ? 'not-allowed' : 'pointer',
                opacity: historyIndex >= history.length - 1 ? 0.5 : 1,
                transition: 'all 0.2s ease'
              }}
            >
              Redo ↷
            </button>
          </div>

          <button
            onClick={() => dragControllerRef.current?.rotateSelected()}
            disabled={!isBoxDragging}
            style={{
              ...btnBase,
              background: '#ffffff',
              color: isBoxDragging ? '#1AA37A' : '#aaa',
              border: `2px solid ${isBoxDragging ? '#1AA37A' : '#e0e0e0'}`,
              cursor: isBoxDragging ? 'pointer' : 'not-allowed',
              marginBottom: '16px'
            }}
          >
            ↻ Rotate Box 90° (R)
          </button>

          <div style={{ marginBottom: '8px' }}>
            <h4
              style={{
                margin: '0 0 8px 0',
                fontSize: '12px',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                color: '#666'
              }}
            >
              Camera Views
            </h4>

            <div style={{ display: 'flex', gap: '8px' }}>
              {['top', 'side', 'back', 'default'].map((view) => (
                <button
                  key={view}
                  onClick={() => handleCameraView(view)}
                  style={{
                    flex: 1,
                    padding: '8px 0',
                    background: '#f8f9fa',
                    color: '#495057',
                    border: '1px solid #dee2e6',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    textTransform: 'capitalize',
                    transition: 'all 0.2s ease'
                  }}
                >
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