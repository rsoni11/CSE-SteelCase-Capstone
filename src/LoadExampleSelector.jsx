import React from 'react';

const LoadExampleSelector = ({ examples, selectedExampleId, onSelect }) => {
  return (
    <div style={{ marginBottom: '16px' }}>
      <h4
        style={{
          margin: '0 0 8px 0',
          fontSize: '12px',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          color: '#666'
        }}
      >
        Load Example
      </h4>
      <div style={{ display: 'grid', gap: '8px' }}>
        {examples.map((example) => {
          const totalBoxes = example.boxes.reduce((sum, box) => sum + box.quantity, 0);
          const isSelected = selectedExampleId === example.id;

          return (
            <button
              key={example.id}
              onClick={() => onSelect(example.id)}
              style={{
                textAlign: 'left',
                border: `2px solid ${isSelected ? '#004E89' : '#e0e0e0'}`,
                background: isSelected ? '#eef5fb' : '#ffffff',
                color: '#1a1a1a',
                borderRadius: '8px',
                cursor: 'pointer',
                padding: '10px 12px'
              }}
            >
              <div style={{ fontSize: '13px', fontWeight: 700 }}>{example.name}</div>
              <div style={{ fontSize: '11px', color: '#666', marginTop: '2px' }}>
                {example.description}
              </div>
              <div style={{ fontSize: '11px', color: '#004E89', marginTop: '4px', fontWeight: 600 }}>
                {totalBoxes} queued boxes
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default LoadExampleSelector;
