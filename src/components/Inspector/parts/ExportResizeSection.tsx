import React from 'react';

type ExportResizeSectionProps = {
  outputWidth: number | null;
  handleResizeToggle: () => void;
  manualOutputWidth: string | number;
  handleOutputWidthChange: (value: string) => void;
  handleOutputWidthBlur: () => void;
  aspect: number | null;
  currentPixelWidth: number;
  currentPixelHeight: number;
  showSectionLabel?: boolean;
};

const ExportResizeSection = ({
  outputWidth,
  handleResizeToggle,
  manualOutputWidth,
  handleOutputWidthChange,
  handleOutputWidthBlur,
  aspect,
  currentPixelWidth,
  currentPixelHeight,
  showSectionLabel = true,
}: ExportResizeSectionProps) => {
  return (
    <section className="control-section">
      <div className="section-header">
        {showSectionLabel ? (
          <h3 className="section-label">Export Resize</h3>
        ) : (
          <h4 className="subsection-label">Resize</h4>
        )}
        <label className="metadata-checkbox-row">
          <input
            type="checkbox"
            className="metadata-checkbox-input"
            checked={outputWidth !== null}
            onChange={handleResizeToggle}
            aria-label="Enable/Disable Resize"
          />
          <span className="metadata-checkbox-indicator" aria-hidden="true">
            <svg
              className="metadata-checkbox-mark"
              viewBox="0 0 24 24"
              fill="none"
              style={{ transform: 'scale(1.2)' }}
            >
              <path
                className="metadata-checkbox-mark-path"
                d="M5 12l4.5 4.5L19 7"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </label>
      </div>

      {outputWidth !== null && (
        <div className="dims-grid">
          <div className="dim-input-group">
            <label>W</label>
            <input
              type="number"
              value={
                manualOutputWidth !== '' ? manualOutputWidth : outputWidth || ''
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
