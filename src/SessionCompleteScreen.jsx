import React, { useEffect, useState } from 'react';
import { TRUCK_VOLUME } from './constants';

// US2 (Rhea): Session complete overlay with animated score, grade, and Try Again
const getGrade = (score) => {
  if (score >= 90) return { letter: 'A+', color: '#1AA37A', label: 'Outstanding!' };
  if (score >= 80) return { letter: 'A',  color: '#1AA37A', label: 'Excellent!' };
  if (score >= 70) return { letter: 'B',  color: '#004E89', label: 'Good Job!' };
  if (score >= 60) return { letter: 'C',  color: '#FF6B35', label: 'Keep Practicing' };
  if (score >= 50) return { letter: 'D',  color: '#E74C3C', label: 'Needs Improvement' };
  return               { letter: 'F',  color: '#c0392b', label: 'Try Again!' };
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
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.65)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 200, backdropFilter: 'blur(4px)',
      animation: 'scFadeIn 0.3s ease'
    }}>
      <div style={{
        background: '#fff', borderRadius: '20px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        padding: '48px 52px', minWidth: '420px', maxWidth: '500px',
        textAlign: 'center', animation: 'scSlideUp 0.35s ease'
      }}>
        <div style={{ fontSize: '13px', fontWeight: 700, letterSpacing: '1.5px', color: '#999', textTransform: 'uppercase', marginBottom: '8px' }}>
          Session Complete
        </div>
        <h2 style={{ margin: '0 0 32px', fontSize: '28px', fontWeight: 800, color: '#1a1a1a' }}>
          🚛 Load Plan Results
        </h2>

        {/* Grade badge */}
        <div style={{
          display: 'inline-flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          width: '120px', height: '120px', borderRadius: '50%',
          background: `${grade.color}18`, border: `4px solid ${grade.color}`,
          margin: '0 auto 24px'
        }}>
          <div style={{ fontSize: '48px', fontWeight: 900, color: grade.color, lineHeight: 1 }}>
            {grade.letter}
          </div>
        </div>

        <div style={{ fontSize: '16px', fontWeight: 600, color: grade.color, marginBottom: '32px' }}>
          {grade.label}
        </div>

        {/* Animated score */}
        <div style={{ marginBottom: '32px' }}>
          <div style={{ fontSize: '52px', fontWeight: 900, color: '#1a1a1a', lineHeight: 1 }}>
            {animScore.toFixed(1)}<span style={{ fontSize: '24px', color: '#999', fontWeight: 600 }}>%</span>
          </div>
          <div style={{ fontSize: '13px', color: '#999', marginTop: '4px' }}>Space Utilization Score</div>
          <div style={{ background: '#f0f0f0', borderRadius: '99px', height: '10px', margin: '16px 0 0', overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${animScore}%`,
              background: `linear-gradient(90deg, ${grade.color}, ${grade.color}cc)`,
              borderRadius: '99px', transition: 'width 0.05s linear'
            }} />
          </div>
        </div>

        {/* Stats grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '36px' }}>
          {[
            { label: 'Boxes Placed', value: totalBoxes,              unit: '' },
            { label: 'Space Used',   value: usedVolume.toFixed(1),   unit: 'ft³' },
            { label: 'Wasted Space', value: wastedVolume,             unit: 'ft³' },
          ].map(({ label, value, unit }) => (
            <div key={label} style={{ background: '#f8f9fa', borderRadius: '12px', padding: '14px 10px' }}>
              <div style={{ fontSize: '20px', fontWeight: 800, color: '#1a1a1a' }}>
                {value}<span style={{ fontSize: '11px', color: '#999', marginLeft: '2px' }}>{unit}</span>
              </div>
              <div style={{ fontSize: '11px', color: '#999', marginTop: '2px' }}>{label}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <button onClick={onTryAgain} style={{
            flex: 1, padding: '14px',
            background: 'linear-gradient(135deg, #667eea, #764ba2)',
            color: '#fff', border: 'none', borderRadius: '10px',
            fontSize: '15px', fontWeight: 700, cursor: 'pointer'
          }}>🔄 Try Again</button>
          <button onClick={onDismiss} style={{
            flex: 1, padding: '14px', background: '#fff', color: '#555',
            border: '2px solid #e0e0e0', borderRadius: '10px',
            fontSize: '15px', fontWeight: 700, cursor: 'pointer'
          }}>Continue →</button>
        </div>
      </div>
      <style>{`
        @keyframes scFadeIn  { from { opacity:0 } to { opacity:1 } }
        @keyframes scSlideUp { from { transform:translateY(30px);opacity:0 } to { transform:translateY(0);opacity:1 } }
      `}</style>
    </div>
  );
};

export default SessionCompleteScreen;
