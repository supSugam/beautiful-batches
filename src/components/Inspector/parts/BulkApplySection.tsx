import React, { useState } from 'react';
import { ArrowLeftCircle, ArrowRightCircle, Zap } from 'lucide-react';

type BulkApplySectionProps = {
  onApplyTo: (
    target: 'prev' | 'rest' | 'all',
    options?: {
      includeCaption?: boolean;
      includeTransforms?: boolean;
      includeCropState?: boolean;
      includeUiTweaks?: boolean;
    },
  ) => void;
  showSectionLabel?: boolean;
};

const BulkApplySection = ({ onApplyTo, showSectionLabel = true }: BulkApplySectionProps) => {
  const [includeCaption, setIncludeCaption] = useState(false);
  const [includeTransforms, setIncludeTransforms] = useState(true);
  const [includeCropState, setIncludeCropState] = useState(true);
  const [includeUiTweaks, setIncludeUiTweaks] = useState(true);

  const apply = (target: 'prev' | 'rest' | 'all') =>
    onApplyTo(target, {
      includeCaption,
      includeTransforms,
      includeCropState,
      includeUiTweaks,
    });

  return (
    <section className="control-section">
      {showSectionLabel ? (
        <h3 className="section-label">Bulk Apply Current Settings</h3>
      ) : (
        <h4 className="subsection-label">Bulk Apply</h4>
      )}
      <div
        className="bulk-apply-options-list"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          marginBottom: '16px',
        }}
      >
        <div
          className="metadata-toggle-row bulk-caption-switch-row"
          title="Apply Rotation and Flip"
        >
          <span className="metadata-toggle-label">Include Transforms</span>
          <label className="metadata-checkbox-row">
            <input
              type="checkbox"
              className="metadata-checkbox-input"
              checked={includeTransforms}
              onChange={(event) => setIncludeTransforms(event.target.checked)}
              aria-label="Include transforms in bulk apply"
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

        <div
          className="metadata-toggle-row bulk-caption-switch-row"
          title="Apply Aspect Ratio, Coordinates, and Viewport"
        >
          <span className="metadata-toggle-label">Include Crop State</span>
          <label className="metadata-checkbox-row">
            <input
              type="checkbox"
              className="metadata-checkbox-input"
              checked={includeCropState}
              onChange={(event) => setIncludeCropState(event.target.checked)}
              aria-label="Include crop state in bulk apply"
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

        <div
          className="metadata-toggle-row bulk-caption-switch-row"
          title="Apply Padding, Corner Radius, and Export Limits"
        >
          <span className="metadata-toggle-label">Include UI Tweaks</span>
          <label className="metadata-checkbox-row">
            <input
              type="checkbox"
              className="metadata-checkbox-input"
              checked={includeUiTweaks}
              onChange={(event) => setIncludeUiTweaks(event.target.checked)}
              aria-label="Include UI tweaks in bulk apply"
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

        <div
          className="metadata-toggle-row bulk-caption-switch-row"
          title="Apply Caption Override"
        >
          <span className="metadata-toggle-label">Include Caption</span>
          <label className="metadata-checkbox-row">
            <input
              type="checkbox"
              className="metadata-checkbox-input"
              checked={includeCaption}
              onChange={(event) => setIncludeCaption(event.target.checked)}
              aria-label="Include caption override in bulk apply"
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
      </div>
      <div className="apply-grid">
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => apply('prev')}
        >
          <ArrowLeftCircle size={14} />
          <span>Previous</span>
        </button>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => apply('rest')}
        >
          <span>Rest</span>
          <ArrowRightCircle size={14} />
        </button>
        <button
          className="btn btn-primary btn-sm btn-glow"
          onClick={() => apply('all')}
        >
          <Zap size={14} />
          <span>All Images</span>
        </button>
      </div>
    </section>
  );
};

export default React.memo(BulkApplySection);
