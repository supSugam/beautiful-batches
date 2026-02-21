import React from 'react';
import { ChevronLeft, ChevronRight, RotateCcw, Trash2, X } from 'lucide-react';

type InspectorHeaderProps = {
  imageName: string;
  onOpenImageInExplorer?: () => void;
  canOpenImageInExplorer?: boolean;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onReset: () => void;
  onDelete: () => void;
  hasPrev: boolean;
  hasNext: boolean;
};

const InspectorHeader = ({
  imageName,
  onOpenImageInExplorer,
  canOpenImageInExplorer = false,
  onClose,
  onPrev,
  onNext,
  onReset,
  onDelete,
  hasPrev,
  hasNext,
}: InspectorHeaderProps) => {
  return (
    <div className="inspector-header">
      <div className="inspector-title">
        <span>Editing Selection</span>
        <button
          type="button"
          className={`inspector-title-file ${canOpenImageInExplorer ? 'is-openable' : ''}`}
          onClick={onOpenImageInExplorer}
          disabled={!canOpenImageInExplorer || typeof onOpenImageInExplorer !== 'function'}
          title={
            canOpenImageInExplorer
              ? `Reveal in file explorer: ${imageName}`
              : imageName
          }
        >
          {imageName}
        </button>
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
