import React from 'react';
import { ArrowLeftCircle, ArrowRightCircle, Zap } from 'lucide-react';

const BulkApplySection = ({ onApplyTo, showSectionLabel = true }) => {
  return (
    <section className="control-section">
      {showSectionLabel ? (
        <h3 className="section-label">Bulk Apply Current Settings</h3>
      ) : (
        <h4 className="subsection-label">Bulk Apply</h4>
      )}
      <div className="apply-grid">
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => onApplyTo('prev')}
        >
          <ArrowLeftCircle size={14} />
          <span>Previous</span>
        </button>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => onApplyTo('rest')}
        >
          <span>Rest</span>
          <ArrowRightCircle size={14} />
        </button>
        <button
          className="btn btn-primary btn-sm btn-glow"
          onClick={() => onApplyTo('all')}
        >
          <Zap size={14} />
          <span>All Images</span>
        </button>
      </div>
    </section>
  );
};

export default React.memo(BulkApplySection);
