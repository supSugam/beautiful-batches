import React from 'react';
import { ChevronLeft, ChevronRight, RotateCcw, Trash2, X } from 'lucide-react';

const InspectorHeader = ({
  imageName,
  onClose,
  onPrev,
  onNext,
  onReset,
  onDelete,
  hasPrev,
  hasNext,
}) => {
  return (
    <div className="inspector-header">
      <div className="inspector-title">
        <span>Editing Selection</span>
        <strong>{imageName}</strong>
      </div>
      <div className="header-actions">
        <div className="nav-arrows">
          <button className="btn-icon" onClick={onPrev} disabled={!hasPrev}>
            <ChevronLeft size={18} />
          </button>
          <button className="btn-icon" onClick={onNext} disabled={!hasNext}>
            <ChevronRight size={18} />
          </button>
        </div>
        <div className="toolbar-divider" />
        <div className="header-tools">
          <button
            className="btn-icon"
            onClick={onReset}
            title="Reset current draft"
          >
            <RotateCcw size={16} />
          </button>
          <button
            className="btn-icon btn-icon-danger"
            onClick={onDelete}
            title="Delete current file"
          >
            <Trash2 size={16} />
          </button>
        </div>
        <div className="toolbar-divider" />
        <button className="btn-icon" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
    </div>
  );
};

export default InspectorHeader;
