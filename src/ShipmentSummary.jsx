import React, { useState } from 'react';

const ShipmentSummary = ({ availableBoxes, activeStopFilter, setActiveStopFilter }) => {
  const [isOpen, setIsOpen] = useState(false);
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
    <div style={{
      position: 'absolute', top: 150, right: 30, 
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
        {isOpen ? '✕ Close Summary' : '📋 Shipment Summary'}
      </button>

      {isOpen && (
        <div style={{
          background: 'rgba(255,255,255,0.97)',
          borderRadius: '12px 0 12px 12px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
          padding: '16px 20px', fontSize: '13px', color: '#666',
          width: '320px', maxHeight: '50vh', overflowY: 'auto',
          border: '2px solid #667eea', borderTop: 'none'
        }}>
          
          <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
            <div style={{ flex: 1, background: '#f0f4f8', padding: '10px', borderRadius: '8px', textAlign: 'center' }}>
              <div style={{ fontSize: '20px', fontWeight: 800, color: '#667eea' }}>{totalBoxes}</div>
              <div style={{ fontSize: '11px', color: '#666', fontWeight: 600, textTransform: 'uppercase' }}>Total Pieces</div>
            </div>
            <div style={{ flex: 1, background: '#f0f4f8', padding: '10px', borderRadius: '8px', textAlign: 'center' }}>
              <div style={{ fontSize: '20px', fontWeight: 800, color: '#1AA37A' }}>{totalVolume.toFixed(1)}</div>
              <div style={{ fontSize: '11px', color: '#666', fontWeight: 600, textTransform: 'uppercase' }}>Volume (ft³)</div>
            </div>
          </div>

          {sortedStops.map(stop => {
            const isExpanded = expandedStops[stop];
            const stopData = stopsData[stop];
            const isActive = activeStopFilter === stop;

            return (
              <div key={stop} style={{ 
                marginBottom: '8px', background: '#fff', borderRadius: '8px', 
                border: '1px solid #e0e0e0', overflow: 'hidden' 
              }}>
                <div 
                  onClick={() => toggleStop(stop)}
                  style={{
                    padding: '10px 12px',
                    background: isExpanded ? '#f8f9fa' : '#ffffff',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    borderBottom: isExpanded ? '1px solid #e0e0e0' : 'none',
                    transition: 'background 0.2s ease'
                  }}
                >
                  <div style={{ fontWeight: 700, color: '#1a1a1a', fontSize: '13px' }}>
                    Stop {stop}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: '#888' }}>
                    <span style={{ background: '#eef2f5', padding: '2px 6px', borderRadius: '4px', fontWeight: 600, color: '#004E89' }}>
                      {stopData.stopTotalBoxes} pcs
                    </span>
                    <span style={{ background: '#eef2f5', padding: '2px 6px', borderRadius: '4px', fontWeight: 600, color: '#1AA37A' }}>
                      {stopData.stopTotalVolume.toFixed(1)} ft³
                    </span>
                    <span style={{ fontSize: '10px', marginLeft: '4px', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                      ▼
                    </span>
                  </div>
                </div>

                {isExpanded && (
                  <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    
                    {stop !== 'Unassigned' && (
                      <button
                        onClick={() => setActiveStopFilter(isActive ? null : stop)}
                        style={{
                          width: '100%', padding: '8px', marginBottom: '8px',
                          background: isActive ? '#e8f6f3' : '#f0f4f8',
                          color: isActive ? '#1AA37A' : '#004E89',
                          border: `1px solid ${isActive ? '#1AA37A' : '#ced4da'}`,
                          borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '12px',
                          transition: 'all 0.2s ease'
                        }}
                      >
                        {isActive ? `✓ Stop ${stop} loaded in Panel` : `Load Stop ${stop} into Panel ➔`}
                      </button>
                    )}

                    {/* SORTING APPLIED HERE! */}
                    {Object.values(stopData.packages)
                      .sort((a, b) => {
                        // Push 0x0x0 items to the very top
                        if (a.isZeroDim && !b.isZeroDim) return -1;
                        if (!a.isZeroDim && b.isZeroDim) return 1;
                        // Sort the remaining items alphabetically by their dimensions
                        return a.dimensions.localeCompare(b.dimensions);
                      })
                      .map(group => (
                      <div key={group.dimensions} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                        <div style={{ width: '12px', height: '12px', background: group.color, borderRadius: '3px', flexShrink: 0 }} />
                        <div style={{ 
                          flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', 
                          fontWeight: 500, color: group.isZeroDim ? '#999' : '#1a1a1a'
                        }}>
                          {group.isZeroDim ? group.dimensions : `Package: ${group.dimensions}`}
                        </div>
                        <div style={{ fontWeight: 700, color: group.isZeroDim ? '#999' : '#1AA37A' }}>
                          x{group.qty}
                        </div>
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