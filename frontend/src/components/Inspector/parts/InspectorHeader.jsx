import React from 'react';
import { ChevronLeft, ChevronRight, Check, Loader2, Save, X } from 'lucide-react';
import useStore from '../../../store/useStore';

const InspectorHeader = ({ 
  imageName, 
  isDirty, 
  saved, 
  isProcessing, 
  handleSave, 
  onClose,
  onPrev,
  onNext,
  hasPrev,
  hasNext
}) => {
  return (
    <div className="inspector-header">
      <div className="inspector-title">
        <span>Editing Selection</span>
        <strong>{imageName}</strong>
      </div>
      <div className="header-actions">
        <div className="nav-arrows">
          <button
            className="btn-icon"
            onClick={onPrev}
            disabled={!hasPrev}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            className="btn-icon"
            onClick={onNext}
            disabled={!hasNext}
          >
            <ChevronRight size={18} />
          </button>
        </div>
        <div className="toolbar-divider" />
        <button
          className={`btn btn-sm ${isDirty ? 'btn-primary' : 'btn-ghost'}`}
          onClick={handleSave}
          disabled={(!isDirty && !saved) || isProcessing}
        >
          {saved ? (
            <Check size={14} />
          ) : isProcessing ? (
            <Loader2 size={14} className="spin" />
          ) : (
            <Save size={14} />
          )}
          <span>{saved ? 'Saved' : 'Save'}</span>
        </button>
        <button className="btn-icon" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
    </div>
  );
};

export default InspectorHeader;
