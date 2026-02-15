import React from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import useStore from '../../../store/useStore';

const InspectorHeader = ({
  imageName,
  onClose,
  onPrev,
  onNext,
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
        <div className="toolbar-divider" />
        <button className="btn-icon" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
    </div>
  );
};

export default InspectorHeader;
