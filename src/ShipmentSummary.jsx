import React, { useState } from 'react';
import Icon from './Icons';

// Open state is owned by the parent so only one stage popover shows at a time
const ShipmentSummary = ({ availableBoxes, activeStopFilter, setActiveStopFilter, isOpen, onToggle }) => {
  const [expandedStops, setExpandedStops] = useState({});

  const toggleStop = (stop) => {
    setExpandedStops(prev => ({
      ...prev,
      [stop]: !prev[stop]
    }));
  };

  let totalBoxes = 0;
  let totalVolume = 0;
  const stopsData = {};

  availableBoxes.forEach((box) => {
    const qty = box.availableQty || 1;
    totalBoxes += qty;
    
    const vol = box.dimensions.width * box.dimensions.height * box.dimensions.depth;
    totalVolume += (vol * qty);

    const stopKey = box.stop || 'Unassigned';
    
    if (!stopsData[stopKey]) {
      stopsData[stopKey] = {
        packages: {},
        stopTotalBoxes: 0,
        stopTotalVolume: 0
      };
    }

    stopsData[stopKey].stopTotalBoxes += qty;
    stopsData[stopKey].stopTotalVolume += (vol * qty);

    const dimString = box.dimString || 'Unknown';

    if (!stopsData[stopKey].packages[dimString]) {
      stopsData[stopKey].packages[dimString] = {
        dimensions: dimString,
        qty: 0,
        color: box.color,
        isZeroDim: box.isZeroDim
      };
    }

    stopsData[stopKey].packages[dimString].qty += qty;
  });

  const sortedStops = Object.keys(stopsData).sort();

  return (
    <div className="popover-wrap">
      <button
        type="button"
        className={`btn floating-btn${isOpen ? ' is-active' : ''}`}
        onClick={onToggle}
        aria-expanded={isOpen}
        title="Shipment summary"
      >
        <Icon name={isOpen ? 'x' : 'list'} /> <span className="btn-label">Shipment summary</span>
      </button>

      {isOpen && (
        <div className="popover">
          <div className="metric-grid">
            <div className="metric">
              <div className="metric-value" style={{ color: 'var(--primary)' }}>{totalBoxes}</div>
              <div className="metric-label">Pieces</div>
            </div>
            <div className="metric">
              <div className="metric-value" style={{ color: 'var(--success)' }}>{totalVolume.toFixed(1)}</div>
              <div className="metric-label">Volume ft³</div>
            </div>
          </div>

          {sortedStops.length === 0 && (
            <div className="callout callout-info">Choose a load example or upload a CSV to see its stops.</div>
          )}

          {sortedStops.map(stop => {
            const isExpanded = expandedStops[stop];
            const stopData = stopsData[stop];
            const isActive = activeStopFilter === stop;

            return (
              <div key={stop} className={`stop${isActive ? ' is-active' : ''}`}>
                <button type="button" className="stop-head" onClick={() => toggleStop(stop)} aria-expanded={!!isExpanded}>
                  <span className="stop-name">Stop {stop}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="chip chip-primary">{stopData.stopTotalBoxes} pcs</span>
                    <span className="chip chip-success">{stopData.stopTotalVolume.toFixed(1)} ft³</span>
                    <Icon name="chevronDown" size={14} className={`chevron${isExpanded ? ' open' : ''}`} />
                  </span>
                </button>

                {isExpanded && (
                  <div className="stop-body">
                    {stop !== 'Unassigned' && (
                      <button
                        type="button"
                        className={`btn btn-sm btn-block ${isActive ? 'is-active' : 'btn-primary'}`}
                        style={{ marginBottom: 4 }}
                        onClick={() => setActiveStopFilter(isActive ? null : stop)}
                      >
                        {isActive ? <><Icon name="check" size={14} /> Loading stop {stop}</> : `Load stop ${stop}`}
                      </button>
                    )}

                    {/* 0x0x0 items first, then alphabetical by dimensions */}
                    {Object.values(stopData.packages)
                      .sort((a, b) => {
                        if (a.isZeroDim && !b.isZeroDim) return -1;
                        if (!a.isZeroDim && b.isZeroDim) return 1;
                        return a.dimensions.localeCompare(b.dimensions);
                      })
                      .map(group => (
                        <div key={group.dimensions} className="queue-item" style={{ padding: '2px 0' }}>
                          <span className="swatch" style={{ background: group.color, width: 10, height: 10 }} />
                          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            color: group.isZeroDim ? 'var(--muted)' : 'var(--text)' }}>
                            {group.dimensions}
                          </span>
                          <strong style={{ color: group.isZeroDim ? 'var(--muted)' : 'var(--text)' }}>×{group.qty}</strong>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ShipmentSummary;
