import React from 'react';
import { Check, Square } from 'lucide-react';
import type { IfFileExistsMode } from '../../../types/app';

type ExportResizeSectionProps = {
  outputWidth: number | null;
  handleResizeToggle: () => void;
  manualOutputWidth: string | number;
  handleOutputWidthChange: (value: string) => void;
  handleOutputWidthBlur: () => void;
  aspect: number | null;
  currentPixelWidth: number;
  currentPixelHeight: number;
  ifFileExists: IfFileExistsMode;
  onIfFileExistsChange: (mode: IfFileExistsMode) => void;
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
  ifFileExists,
  onIfFileExistsChange,
  showSectionLabel = true,
}: ExportResizeSectionProps) => {
  const fileExistModes = [
    { value: 'skip' as const, label: 'Skip' },
    { value: 'append' as const, label: 'Append' },
    { value: 'overwrite' as const, label: 'Overwrite' },
  ];

  return (
    <section className="control-section">
      <div className="section-header">
        {showSectionLabel ? (
          <h3 className="section-label">Export Resize</h3>
        ) : (
          <h4 className="subsection-label">Resize</h4>
        )}
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

      <div className="if-exists-control">
        <div className="if-exists-label">If file exists -&gt;</div>
        <div className="if-exists-mode-grid" role="radiogroup" aria-label="If file exists behavior">
          {fileExistModes.map((mode) => (
            <button
              key={mode.value}
              type="button"
              role="radio"
              aria-checked={ifFileExists === mode.value}
              className={`if-exists-mode-btn ${ifFileExists === mode.value ? 'active' : ''}`}
              onClick={() => onIfFileExistsChange(mode.value)}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
};

export default React.memo(ExportResizeSection);
