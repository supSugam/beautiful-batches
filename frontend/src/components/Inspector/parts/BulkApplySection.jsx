import React from 'react';
import { ArrowLeftCircle, ArrowRightCircle, Zap } from 'lucide-react';

const BulkApplySection = ({
  isDirty,
  handleSave,
  onApplyTo
}) => {
  return (
    <section className="control-section">
      <h3 className="section-label">Bulk Apply Current Settings</h3>
      <div className="apply-grid">
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => {
            if (isDirty) handleSave();
            onApplyTo('prev');
          }}
        >
          <ArrowLeftCircle size={14} />
          <span>Previous</span>
        </button>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => {
            if (isDirty) handleSave();
            onApplyTo('rest');
          }}
        >
          <span>Rest</span>
          <ArrowRightCircle size={14} />
        </button>
        <button
          className="btn btn-primary btn-sm btn-glow"
          onClick={() => {
            if (isDirty) handleSave();
            onApplyTo('all');
          }}
        >
          <Zap size={14} />
          <span>All Images</span>
        </button>
      </div>
    </section>
  );
};

export default BulkApplySection;
