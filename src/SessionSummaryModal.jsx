import React from 'react';

const metricCardStyle = {
  background: '#f8f9fa',
  borderRadius: '12px',
  padding: '14px 12px',
  textAlign: 'center'
};

const SessionSummaryModal = ({ open, metrics, onClose }) => {
  if (!open || !metrics) return null;

  const {
    totalBoxes,
    userSpaceUsedPct,
    optimalSpaceUsedPct,
    wastedSpacePct,
    efficiencyDeltaPct
  } = metrics;

  const deltaColor = efficiencyDeltaPct >= 0 ? '#1AA37A' : '#E74C3C';
  const deltaLabel = efficiencyDeltaPct >= 0 ? 'above' : 'below';

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.62)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 250,
      backdropFilter: 'blur(3px)'
    }}>
      <div style={{
        width: 'min(640px, calc(100vw - 32px))',
        background: '#ffffff',
        borderRadius: '18px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
        padding: '28px'
      }}>
        <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: '#667eea' }}>
          Session Results
        </div>
        <h2 style={{ margin: '8px 0 20px', fontSize: '26px', color: '#1a1a1a' }}>
          Packing Efficiency Feedback
        </h2>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '18px' }}>
          <div style={metricCardStyle}>
            <div style={{ fontSize: '26px', fontWeight: 800, color: '#004E89' }}>{userSpaceUsedPct.toFixed(2)}%</div>
            <div style={{ fontSize: '12px', color: '#777' }}>Your Space Used</div>
          </div>
          <div style={metricCardStyle}>
            <div style={{ fontSize: '26px', fontWeight: 800, color: '#1AA37A' }}>{optimalSpaceUsedPct.toFixed(2)}%</div>
            <div style={{ fontSize: '12px', color: '#777' }}>Optimal Benchmark</div>
          </div>
          <div style={metricCardStyle}>
            <div style={{ fontSize: '26px', fontWeight: 800, color: '#E67E22' }}>{wastedSpacePct.toFixed(2)}%</div>
            <div style={{ fontSize: '12px', color: '#777' }}>Wasted Space</div>
          </div>
          <div style={metricCardStyle}>
            <div style={{ fontSize: '26px', fontWeight: 800, color: deltaColor }}>
              {efficiencyDeltaPct >= 0 ? '+' : ''}{efficiencyDeltaPct.toFixed(2)}%
            </div>
            <div style={{ fontSize: '12px', color: '#777' }}>Efficiency vs Optimal</div>
          </div>
        </div>

        <div style={{
          marginBottom: '20px',
          background: '#eef2f5',
          color: '#3f4a56',
          borderRadius: '10px',
          padding: '12px',
          fontSize: '13px',
          lineHeight: 1.4
        }}>
          Loaded <strong>{totalBoxes}</strong> boxes. Your arrangement is{' '}
          <strong style={{ color: deltaColor }}>{Math.abs(efficiencyDeltaPct).toFixed(2)}% {deltaLabel}</strong>{' '}
          the theoretical benchmark based on total box volume.
        </div>

        <button
          onClick={onClose}
          style={{
            width: '100%',
            border: 'none',
            borderRadius: '10px',
            padding: '12px',
            fontSize: '15px',
            fontWeight: 700,
            color: '#fff',
            background: 'linear-gradient(135deg, #667eea, #764ba2)',
            cursor: 'pointer'
          }}
        >
          Close Results
        </button>
      </div>
    </div>
  );
};

export default SessionSummaryModal;
