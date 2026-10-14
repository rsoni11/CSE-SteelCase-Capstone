import React from 'react';

const LoadExampleSelector = ({ examples, selectedExampleId, onSelect }) => {
  return (
    <div className="option-list" style={{ marginTop: 10 }}>
      {examples.map((example) => {
        const totalBoxes = example.boxes.reduce((sum, box) => sum + box.quantity, 0);
        const isSelected = selectedExampleId === example.id;

        return (
          <button
            type="button"
            key={example.id}
            className={`option${isSelected ? ' is-selected' : ''}`}
            onClick={() => onSelect(example.id)}
            aria-pressed={isSelected}
          >
            <div className="option-row">
              <div style={{ flex: 1 }}>
                <div className="option-title">{example.name}</div>
                <div className="option-desc">{example.description}</div>
              </div>
              <span className="chip chip-primary">{totalBoxes} boxes</span>
            </div>
          </button>
        );
      })}
    </div>
  );
};

export default LoadExampleSelector;
