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
      <label className="bulk-caption-toggle">
        <input
          type="checkbox"
          checked={includeCaption}
          onChange={(event) => setIncludeCaption(event.target.checked)}
        />
        <span>Include caption override</span>
      </label>
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
