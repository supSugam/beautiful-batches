import React from 'react';
import {
  FolderOpen,
  Image as ImageIcon,
  Grid3x3,
  Maximize,
  Settings,
  FolderPlus,
  XCircle,
  Download,
  Loader2,
} from 'lucide-react';
import './Toolbar.css';

const Toolbar = ({
  folderName,
  imageCount,
  format,
  setFormat,
  quality,
  setQuality,
  rowHeight,
  setRowHeight,
  showAllFooters,
  setShowAllFooters,
  onAddMore,
  onClearAll,
  onExport,
  processing,
}) => {
  return (
    <header className="toolbar">
      <div className="toolbar-section">
        <FolderOpen size={15} className="toolbar-dim" />
        <span className="toolbar-title">{folderName}</span>
        <span className="toolbar-badge-muted">
          <ImageIcon size={11} />
          {imageCount.toLocaleString()}
        </span>
      </div>

      <div className="toolbar-section toolbar-controls">
        <div className="control-group">
          <label className="control-label">Format</label>
          <select
            className="select"
            value={format}
            onChange={(e) => setFormat(e.target.value)}
          >
            <option value="png">PNG</option>
            <option value="jpg">JPEG</option>
            <option value="webp">WebP</option>
          </select>
        </div>

        {format !== 'png' && (
          <div className="control-group">
            <label className="control-label">Quality</label>
            <input
              type="range"
              className="quality-slider"
              min={10}
              max={100}
              value={quality}
              onChange={(e) => setQuality(Number(e.target.value))}
            />
            <span className="quality-value">{quality}%</span>
          </div>
        )}

        <div className="control-group">
          <Grid3x3 size={13} className="toolbar-dim" />
          <input
            type="range"
            className="size-slider"
            min={150}
            max={500}
            value={rowHeight}
            onChange={(e) => setRowHeight(Number(e.target.value))}
          />
          <Maximize size={14} className="toolbar-dim" />
        </div>

        <div className="toolbar-divider" />

        <button
          className={`btn btn-sm ${showAllFooters ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setShowAllFooters(!showAllFooters)}
          title={showAllFooters ? 'Hide Settings' : 'Show Settings'}
        >
          <Settings size={14} />
          <span>Settings</span>
        </button>
      </div>

      <div className="toolbar-section toolbar-actions">
        <button
          className="btn btn-ghost btn-sm"
          onClick={onAddMore}
        >
          <FolderPlus size={14} />
          <span>Add</span>
        </button>
        <button
          className="btn btn-ghost btn-danger-ghost btn-sm"
          onClick={onClearAll}
        >
          <XCircle size={14} />
          <span>Clear</span>
        </button>

        <div className="toolbar-divider" />

        <button
          className="btn btn-primary"
          onClick={onExport}
          disabled={!!processing}
        >
          {processing ? (
            <>
              <Loader2 size={14} className="spin" />
              <span>
                {processing.current}/{processing.total}
              </span>
            </>
          ) : (
            <>
              <Download size={14} />
              <span>Export All</span>
            </>
          )}
        </button>
      </div>
    </header>
  );
};

export default Toolbar;
