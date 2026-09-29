import React, { useEffect, useState } from 'react';

// US4 Rhea (Sprint 6 carry-over): Import Confirmation Preview
//
// Two-step guard in front of applying an imported load-plan.json:
//   Step 'preview' — always shown first. Box count / total volume / per-type
//                    breakdown, so the loader knows what they're about to get
//                    before anything in the scene changes.
//   Step 'replace' — only entered if boxes are already placed in the current
//                    session (Task 2). A second, explicit confirmation is
//                    required before the current layout is torn down.
//
// Nothing in TruckLoadingPrototype is touched until onConfirm fires, and
// onCancel (from either step, or the backdrop / Escape) never calls it — so a
// cancelled import is a no-op against the live session by construction
// (Task 3), not something this component has to guarantee by cleaning up
// after itself.

const cardStyle = {
  background: '#f8f9fa',
  borderRadius: '12px',
  padding: '14px 12px',
  textAlign: 'center'
};

const primaryBtn = {
  width: '100%', border: 'none', borderRadius: '10px', padding: '12px',
  fontSize: '15px', fontWeight: 700, color: '#fff',
  background: 'linear-gradient(135deg, #1AA37A, #13815f)', cursor: 'pointer'
};

const dangerBtn = {
  ...primaryBtn,
  background: 'linear-gradient(135deg, #e67e22, #c0392b)'
};

const secondaryBtn = {
  width: '100%', border: '2px solid #ced4da', borderRadius: '10px', padding: '12px',
  fontSize: '15px', fontWeight: 700, color: '#495057', background: '#ffffff', cursor: 'pointer'
};

const ImportConfirmModal = ({ open, preview, onConfirm, onCancel }) => {
  // Always start back on the preview step for a fresh import — otherwise a
  // second import right after a cancelled 'replace' step could open straight
  // onto the destructive step without the user ever seeing the new preview.
  const [step, setStep] = useState('preview');
  useEffect(() => {
    if (open) setStep('preview');
  }, [open, preview]);

  if (!open || !preview) return null;

  const { totalBoxes, totalVolumeFt3, typeBreakdown, hasExistingBoxes, existingBoxCount, fileName } = preview;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.62)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 260, backdropFilter: 'blur(3px)'
      }}
      onClick={onCancel}
    >
      <div
        style={{
          width: 'min(560px, calc(100vw - 32px))', background: '#ffffff',
          borderRadius: '18px', boxShadow: '0 20px 60px rgba(0,0,0,0.35)', padding: '28px'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {step === 'preview' && (
          <>
            <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: '#004E89' }}>
              Import Load Plan
            </div>
            <h2 style={{ margin: '8px 0 4px', fontSize: '24px', color: '#1a1a1a' }}>
              Restore {totalBoxes} box{totalBoxes === 1 ? '' : 'es'}?
            </h2>
            {fileName && (
              <div style={{ fontSize: '12px', color: '#888', marginBottom: '18px' }}>{fileName}</div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
              <div style={cardStyle}>
                <div style={{ fontSize: '26px', fontWeight: 800, color: '#004E89' }}>{totalBoxes}</div>
                <div style={{ fontSize: '12px', color: '#777' }}>Boxes to Restore</div>
              </div>
              <div style={cardStyle}>
                <div style={{ fontSize: '26px', fontWeight: 800, color: '#1AA37A' }}>{totalVolumeFt3.toFixed(1)} ft³</div>
                <div style={{ fontSize: '12px', color: '#777' }}>Total Volume</div>
              </div>
            </div>

            <div style={{
              marginBottom: '18px', background: '#eef2f5', borderRadius: '10px',
              padding: '10px 12px', maxHeight: '220px', overflowY: 'auto'
            }}>
              <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', color: '#495057', textTransform: 'uppercase', marginBottom: '8px' }}>
                Box Type Breakdown
              </div>
              {typeBreakdown.length === 0 && (
                <div style={{ fontSize: '13px', color: '#888' }}>No boxes found in this file.</div>
              )}
              {typeBreakdown.map((row) => (
                <div key={row.label} style={{
                  display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', fontSize: '12px'
                }}>
                  <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: row.color || '#999', flexShrink: 0 }} />
                  <span style={{ color: '#3f4a56', flex: 1 }}>
                    {row.label}
                    {row.fragile && <span style={{ color: '#e74c3c', fontWeight: 700 }}> ⚠</span>}
                    {row.noStack && <span style={{ color: '#e67e22', fontWeight: 700 }}> 🔒</span>}
                    {row.thisSideUp && <span style={{ color: '#2980b9', fontWeight: 700 }}> ⬆</span>}
                  </span>
                  <strong style={{ color: '#212529' }}>x{row.count}</strong>
                </div>
              ))}
            </div>

            {hasExistingBoxes && (
              <div style={{
                marginBottom: '18px', background: '#fdf2ec', border: '1px solid #e67e22',
                borderRadius: '10px', padding: '12px', fontSize: '13px', color: '#8a4413', lineHeight: 1.4
              }}>
                ⚠ You currently have <strong>{existingBoxCount}</strong> box{existingBoxCount === 1 ? '' : 'es'} placed.
                Importing will <strong>replace</strong> your current layout — you'll confirm this once more before anything changes.
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button
                type="button"
                onClick={() => (hasExistingBoxes ? setStep('replace') : onConfirm())}
                style={primaryBtn}
              >
                {hasExistingBoxes ? 'Continue' : `Confirm Import (${totalBoxes} box${totalBoxes === 1 ? '' : 'es'})`}
              </button>
              <button type="button" onClick={onCancel} style={secondaryBtn}>
                Cancel
              </button>
            </div>
          </>
        )}

        {step === 'replace' && (
          <>
            <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: '#c0392b' }}>
              Replace Current Session
            </div>
            <h2 style={{ margin: '8px 0 16px', fontSize: '24px', color: '#1a1a1a' }}>
              This will overwrite your in-progress load
            </h2>
            <div style={{
              marginBottom: '20px', background: '#fdecea', border: '1px solid #e74c3c',
              borderRadius: '10px', padding: '14px', fontSize: '13px', color: '#7b241c', lineHeight: 1.5
            }}>
              Your current session has <strong>{existingBoxCount}</strong> box{existingBoxCount === 1 ? '' : 'es'} placed.
              Confirming will permanently clear that layout and replace it with the <strong>{totalBoxes}</strong> box{totalBoxes === 1 ? '' : 'es'} from this file. This cannot be undone.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button type="button" onClick={onConfirm} style={dangerBtn}>
                Yes, Replace Current Layout
              </button>
              <button type="button" onClick={() => setStep('preview')} style={secondaryBtn}>
                ← Back
              </button>
              <button type="button" onClick={onCancel} style={{ ...secondaryBtn, border: '2px solid #f1f1f1', color: '#999' }}>
                Cancel Import
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ImportConfirmModal;
