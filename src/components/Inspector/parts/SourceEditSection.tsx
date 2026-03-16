import React from 'react';
import { Undo, Redo, Stamp, RotateCcw } from 'lucide-react';

/**
 * SourceEditSection — AI-powered edits like watermark removal and background removal.
 *
 * Props:
 *  - onRemoveWatermarks — handler for watermark removal
 *  - onRemoveBackground — handler for background removal
 */
type SourceEditSectionProps = {
  onRemoveWatermarks: () => void;
  onRemoveBackground: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onReset: () => void;
  canUndo: boolean;
  canRedo: boolean;
  canReset: boolean;
  isProcessing: boolean;
  isRemovingWatermark?: boolean;
  isRemovingBackground?: boolean;
  isWatermarkReady: boolean;
};

const BandageIcon = ({ size = 16 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M10 2l12 12-3.5 3.5-12-12Z" />
    <path d="M10 10l4 4" />
    <rect x="8" y="8" width="8" height="8" transform="rotate(45 12 12)" strokeWidth="1" />
    <circle cx="12" cy="12" r="0.5" fill="currentColor" stroke="none" />
    <circle cx="10.5" cy="10.5" r="0.5" fill="currentColor" stroke="none" />
    <circle cx="13.5" cy="13.5" r="0.5" fill="currentColor" stroke="none" />
    <circle cx="13.5" cy="10.5" r="0.5" fill="currentColor" stroke="none" />
    <circle cx="10.5" cy="13.5" r="0.5" fill="currentColor" stroke="none" />
  </svg>
);

const RemoveBackgroundIcon = ({ size = 16, style }: { size?: number; style?: React.CSSProperties }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={style}
  >
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M16 2h6" strokeDasharray="2 2" strokeWidth="1" />
    <path d="M16 6h6" strokeDasharray="2 2" strokeWidth="1" />
    <path d="M16 10h6" strokeDasharray="2 2" strokeWidth="1" />
  </svg>
);

const SourceEditSection = ({
  onRemoveWatermarks,
  onRemoveBackground,
  onUndo,
  onRedo,
  onReset,
  canUndo,
  canRedo,
  canReset,
  isProcessing,
  isRemovingWatermark = false,
  isRemovingBackground = false,
  isWatermarkReady,
}: SourceEditSectionProps) => {
  return (
    <section className="control-section source-edit-section">
      <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 className="section-label" style={{ display: 'flex', alignItems: 'center', margin: 0 }}>
          <BandageIcon size={15} />
          <span style={{ marginLeft: 8 }}>Source Edit</span>
        </h3>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button
            className="btn-icon-tiny"
            onClick={onUndo}
            disabled={!canUndo || isProcessing}
            title="Undo last edit"
            style={{ 
              opacity: canUndo ? 0.8 : 0.2,
              background: 'transparent',
              border: 'none',
              cursor: canUndo ? 'pointer' : 'default',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              color: 'inherit'
            }}
          >
            <Undo size={14} />
          </button>
          <button
            className="btn-icon-tiny"
            onClick={onReset}
            disabled={!canReset || isProcessing}
            title="Reset to original image"
            style={{ 
              opacity: canReset ? 0.8 : 0.2,
              background: 'transparent',
              border: 'none',
              cursor: canReset ? 'pointer' : 'default',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              color: 'inherit'
            }}
          >
            <RotateCcw size={14} />
          </button>
          <button
            className="btn-icon-tiny"
            onClick={onRedo}
            disabled={!canRedo || isProcessing}
            title="Redo last edit"
            style={{ 
              opacity: canRedo ? 0.8 : 0.2,
              background: 'transparent',
              border: 'none',
              cursor: canRedo ? 'pointer' : 'default',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              color: 'inherit'
            }}
          >
            <Redo size={14} />
          </button>
        </div>
      </div>

      <div className="icon-action-row">
        <div className="icon-action-row-inner" style={{ gap: '8px' }}>
          <button
            className={`btn-icon-box ${isWatermarkReady ? 'ai-magic-btn' : ''} ${isRemovingWatermark ? 'button-processing-glow' : ''}`}
            onClick={onRemoveWatermarks}
            disabled={isRemovingWatermark || !isWatermarkReady}
            title={isWatermarkReady ? 'Automatically remove watermarks (loads AI on first use)' : 'Watermark AI not set up — open Settings to deploy'}
            style={{ 
              display: 'flex', 
              flexDirection: 'column', 
              gap: '4px', 
              height: 'auto', 
              padding: '12px 0', 
              position: 'relative',
              overflow: 'hidden'
            }}
          >
            <Stamp size={20} style={{ zIndex: 2 }} />
            <span style={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', zIndex: 2 }}>Watermark</span>
          </button>

          <button
            className={`btn-icon-box ai-magic-btn ${isRemovingBackground ? 'button-processing-glow' : ''}`}
            onClick={onRemoveBackground}
            disabled={isRemovingBackground || isProcessing}
            title="Remove background (loads AI model on first use)"
            style={{ 
              display: 'flex', 
              flexDirection: 'column', 
              gap: '4px', 
              height: 'auto', 
              padding: '12px 0',
              position: 'relative',
              overflow: 'hidden'
            }}
          >
            <RemoveBackgroundIcon size={20} style={{ zIndex: 2 }} />
            <span style={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', zIndex: 2 }}>Background</span>
          </button>
        </div>
      </div>
    </section>
  );
};

export default React.memo(SourceEditSection);
