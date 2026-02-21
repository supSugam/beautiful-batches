import React, { useState } from 'react';
import { ArrowLeftCircle, ArrowRightCircle, Zap } from 'lucide-react';

type BulkApplySectionProps = {
  onApplyTo: (
    target: 'prev' | 'rest' | 'all',
    options?: { includeCaption?: boolean },
  ) => void;
  showSectionLabel?: boolean;
};

const BulkApplySection = ({ onApplyTo, showSectionLabel = true }: BulkApplySectionProps) => {
  const [includeCaption, setIncludeCaption] = useState(false);
  const apply = (target: 'prev' | 'rest' | 'all') =>
    onApplyTo(target, { includeCaption });

  return (
    <section className="control-section">
      {showSectionLabel ? (
        <h3 className="section-label">Bulk Apply Current Settings</h3>
      ) : (
        <h4 className="subsection-label">Bulk Apply</h4>
      )}
      <div
        className="metadata-toggle-row bulk-caption-switch-row"
        title="Bulk apply will copy the current caption override too."
      >
        <span className="metadata-toggle-label">Include Caption Override</span>
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
