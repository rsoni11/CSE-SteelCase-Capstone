import React, { useEffect, useState } from 'react';
import { TRUCK_VOLUME } from './constants';

// US2 (Rhea): Session complete overlay with animated score, grade, and Try Again
const getGrade = (score) => {
  if (score >= 90) return { letter: 'A+', color: 'var(--success)', label: 'Outstanding!' };
  if (score >= 80) return { letter: 'A',  color: 'var(--success)', label: 'Excellent!' };
  if (score >= 70) return { letter: 'B',  color: 'var(--primary)', label: 'Good Job!' };
  if (score >= 60) return { letter: 'C',  color: 'var(--warning)', label: 'Keep Practicing' };
  if (score >= 50) return { letter: 'D',  color: 'var(--danger)', label: 'Needs Improvement' };
  return               { letter: 'F',  color: 'var(--danger)', label: 'Try Again!' };
};

const SessionCompleteScreen = ({ usedVolume, totalBoxes, onTryAgain, onDismiss }) => {
  const [animScore, setAnimScore] = useState(0);
  const score = Math.min(100, parseFloat(((usedVolume / TRUCK_VOLUME) * 100).toFixed(2)));
  const wastedVolume = (TRUCK_VOLUME - usedVolume).toFixed(2);
  const grade = getGrade(score);

  useEffect(() => {
    let current = 0;
    const duration = 1200;
    const step = 16;
    const increment = score / (duration / step);
    const timer = setInterval(() => {
      current += increment;
      if (current >= score) { setAnimScore(score); clearInterval(timer); }
      else setAnimScore(parseFloat(current.toFixed(1)));
    }, step);
    return () => clearInterval(timer);
  }, [score]);

  return (
    <div className="modal-backdrop" style={{ zIndex: 200 }} role="dialog" aria-modal="true" aria-labelledby="complete-title">
      <div className="modal" style={{ textAlign: 'center', width: 'min(460px, 100%)' }}>
        <div className="modal-eyebrow" style={{ color: 'var(--muted)' }}>Session complete</div>
        <h2 id="complete-title" className="modal-title">Load plan results</h2>

        {/* Grade badge */}
        <div className="grade" style={{ color: grade.color }}>{grade.letter}</div>
        <div style={{ fontSize: 15, fontWeight: 600, color: grade.color, marginBottom: 24 }}>{grade.label}</div>

        {/* Animated score */}
        <div style={{ marginBottom: 24 }}>
          <div className="score">{animScore.toFixed(1)}<small>%</small></div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>Space utilization</div>
          <div className="progress" style={{ height: 10, marginTop: 14 }}>
            <div className="progress-bar" style={{ width: `${animScore}%`, background: grade.color, transition: 'width 0.05s linear' }} />
          </div>
        </div>

        {/* Stats grid */}
        <div className="metric-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          {[
            { label: 'Boxes', value: totalBoxes, unit: '' },
            { label: 'Used', value: usedVolume.toFixed(1), unit: 'ft³' },
            { label: 'Empty', value: wastedVolume, unit: 'ft³' },
          ].map(({ label, value, unit }) => (
            <div key={label} className="metric">
              <div className="metric-value" style={{ fontSize: 18 }}>
                {value}<span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 2 }}>{unit}</span>
              </div>
              <div className="metric-label">{label}</div>
            </div>
          ))}
        </div>

        <div className="modal-actions row">
          <button type="button" className="btn btn-primary btn-lg" onClick={onTryAgain}>Try again</button>
          <button type="button" className="btn btn-lg" onClick={onDismiss}>Keep editing</button>
        </div>
      </div>
    </div>
  );
};

export default SessionCompleteScreen;
