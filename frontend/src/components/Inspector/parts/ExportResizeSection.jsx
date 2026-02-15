import React from 'react';
import { Check, Square } from 'lucide-react';

const ExportResizeSection = ({
  outputWidth,
  handleResizeToggle,
  manualOutputWidth,
  handleOutputWidthChange,
  handleOutputWidthBlur,
  aspect,
  currentPixelWidth,
  currentPixelHeight
}) => {
  return (
    <section className="control-section">
      <div className="section-header">
        <h3 className="section-label">Export Resize</h3>
        <button
          className={`btn-icon-subtle ${outputWidth ? 'active' : ''}`}
          onClick={handleResizeToggle}
          title="Enable/Disable Resize"
        >
          {outputWidth ? <Check size={12} /> : <Square size={12} />}
        </button>
      </div>

      {outputWidth !== null && (
        <div className="dims-grid">
          <div className="dim-input-group">
            <label>W</label>
            <input
              type="number"
              value={
                manualOutputWidth !== ''
                  ? manualOutputWidth
                  : outputWidth || ''
              }
              onChange={(e) => handleOutputWidthChange(e.target.value)}
              onBlur={handleOutputWidthBlur}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </div>
          <div className="dim-link-icon">
            <span style={{ fontSize: 10, opacity: 0.5 }}>×</span>
          </div>
          <div className="dim-input-group disabled">
            <label>H</label>
            <input
              type="number"
              disabled
              value={(() => {
                const ratio = aspect || currentPixelWidth / currentPixelHeight;
                return Math.round(outputWidth / ratio) || 0;
              })()}
            />
          </div>
        </div>
      )}
    </section>
  );
};

export default React.memo(ExportResizeSection);
