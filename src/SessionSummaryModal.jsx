import React from 'react';

const SessionSummaryModal = ({ open, metrics, onClose, onTryAgain, onContinueToGrade }) => {
  if (!open || !metrics) return null;

  const {
    totalBoxes,
    userSpaceUsedPct,
    optimalSpaceUsedPct,
    wastedSpacePct,
    efficiencyDeltaPct
  } = metrics;

  const deltaColor = efficiencyDeltaPct >= 0 ? 'var(--success)' : 'var(--danger)';
  const deltaLabel = efficiencyDeltaPct >= 0 ? 'above' : 'below';

  const cards = [
    { label: 'Space your load spans', value: `${userSpaceUsedPct.toFixed(1)}%`, color: 'var(--primary)' },
    { label: 'Cargo volume (ideal)', value: `${optimalSpaceUsedPct.toFixed(1)}%`, color: 'var(--success)' },
    { label: 'Gaps inside your load', value: `${wastedSpacePct.toFixed(1)}%`, color: 'var(--warning)' },
    { label: 'vs ideal', value: `${efficiencyDeltaPct >= 0 ? '+' : ''}${efficiencyDeltaPct.toFixed(1)}%`, color: deltaColor },
  ];

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="summary-title">
      <div className="modal">
        <div className="modal-eyebrow">Session results</div>
        <h2 id="summary-title" className="modal-title">Packing efficiency</h2>

        <div className="metric-grid">
          {cards.map(({ label, value, color }) => (
            <div key={label} className="metric" style={{ padding: 16 }}>
              <div className="metric-value" style={{ color }}>{value}</div>
              <div className="metric-label">{label}</div>
            </div>
          ))}
        </div>

        <div className="modal-note">
          You loaded <strong>{totalBoxes}</strong> boxes. Your arrangement is{' '}
          <strong style={{ color: deltaColor }}>{Math.abs(efficiencyDeltaPct).toFixed(1)}% {deltaLabel}</strong>{' '}
          the ideal, where the boxes would fill their space with no gaps. All values are % of the trailer.
        </div>

        <div className="modal-actions">
          {onContinueToGrade && (
            <button type="button" className="btn btn-primary btn-lg" onClick={onContinueToGrade}>
              See utilization grade
            </button>
          )}
          <div className="modal-actions row" style={{ marginTop: 0 }}>
            {onTryAgain && (
              <button type="button" className="btn btn-lg" onClick={() => { onTryAgain(); onClose(); }}>
                Try again
              </button>
            )}
            <button type="button" className="btn btn-lg btn-ghost" onClick={onClose} style={{ gridColumn: onTryAgain ? 'auto' : '1 / -1' }}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SessionSummaryModal;
