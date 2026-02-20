import React from 'react';
import { Lock, Unlock, Link, Crosshair } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type AspectPreset = {
  label: string;
  value: number | null;
  icon: LucideIcon;
};

type SelectionControlsProps = {
  aspect: number | null;
  handleLockToggle: () => void;
  manualW: string | number;
  currentPixelWidth: number;
  handleSelectionDimChange: (dim: 'w' | 'h', value: string) => void;
  handleDimBlur: (dim: 'w' | 'h') => void;
  manualH: string | number;
  currentPixelHeight: number;
  aspectPresets: AspectPreset[];
  handleAspectClick: (value: number | null) => void;
  handleCenterCrop: () => void;
  centerStatus?: { horizontal: boolean; vertical: boolean };
};

const SelectionControls = ({
  aspect,
  handleLockToggle,
  manualW,
  currentPixelWidth,
  handleSelectionDimChange,
  handleDimBlur,
  manualH,
  currentPixelHeight,
  aspectPresets,
  handleAspectClick,
  handleCenterCrop,
  centerStatus,
}: SelectionControlsProps) => {
  const centerStateClass = centerStatus?.horizontal && centerStatus?.vertical
    ? 'center-both'
    : centerStatus?.horizontal
      ? 'center-x'
      : centerStatus?.vertical
        ? 'center-y'
        : '';

  return (
    <section className="control-section" style={{ marginTop: 'auto' }}>
      <div className="section-header">
        <h3 className="section-label">Selection (Crop)</h3>
        <div className="section-header-tools">
          <button
            className={`btn-icon-subtle center-align-btn ${centerStateClass}`}
            onClick={handleCenterCrop}
            title="Center Crop Box"
          >
            <Crosshair size={12} />
          </button>
          <button
            className={`btn-icon-subtle ${aspect ? 'active' : ''}`}
            onClick={handleLockToggle}
            title={aspect ? 'Unlock Ratio' : 'Lock Ratio'}
          >
            {aspect ? <Lock size={12} /> : <Unlock size={12} />}
          </button>
        </div>
      </div>

      <div className="dims-grid">
        <div className="dim-input-group">
          <label>W</label>
          <input
            type="number"
            value={manualW !== '' ? manualW : currentPixelWidth || ''}
            onChange={(e) => handleSelectionDimChange('w', e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            onBlur={() => handleDimBlur('w')}
          />
        </div>
        <div className="dim-link-icon">
          <Link size={10} className={aspect ? 'active' : ''} />
        </div>
        <div className="dim-input-group">
          <label>H</label>
          <input
            type="number"
            value={manualH !== '' ? manualH : currentPixelHeight || ''}
            onChange={(e) => handleSelectionDimChange('h', e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            onBlur={() => handleDimBlur('h')}
          />
        </div>
      </div>

      <div className="aspect-grid">
        {aspectPresets.map(({ label, value, icon: Icon }) => {
          const isActive = aspect === value;
          return (
            <button
              key={label}
              className={`aspect-option ${isActive ? 'active' : ''}`}
              onClick={() => handleAspectClick(value)}
            >
              <Icon size={14} />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
};

export default React.memo(SelectionControls);
