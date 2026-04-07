import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PlusCircle, Layers, Maximize, XCircle, FolderPlus } from 'lucide-react';
import './DropOverlay.css';

export type DropRegion = 'add' | 'batch' | 'single' | 'cancel' | null;

interface DragContext {
  files: number;
  folders: number;
}

interface DropOverlayProps {
  isVisible: boolean;
  onRegionChange?: (region: DropRegion) => void;
  isProjectOpen?: boolean;
  dragContext: DragContext | null;
}

const Border = () => (
  <div className="drop-overlay-svg-border">
    <svg width="100%" height="100%" preserveAspectRatio="none">
      <rect
        x="1"
        y="1"
        width="calc(100% - 2px)"
        height="calc(100% - 2px)"
        rx="24"
        fill="none"
        stroke="rgba(255, 255, 255, 0.4)"
        strokeWidth="2"
        strokeDasharray="20 10"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  </div>
);

const CurvyBackground: React.FC<{ activeRegion: DropRegion; isProjectOpen: boolean }> = ({ 
  activeRegion, 
  isProjectOpen 
}) => {
  const zoneCount = isProjectOpen ? 4 : 3;
  const unit = 100;
  const width = zoneCount * unit;

  const getDividerX = (index: number) => index * unit;
  
  const getRegionPath = (index: number) => {
    const leftX = getDividerX(index);
    const rightX = getDividerX(index + 1);
    let path = `M${leftX},0 L${rightX},0 `;
    if (index < zoneCount - 1) {
      path += `C${rightX + 25},250 ${rightX - 25},750 ${rightX},1000 `;
    } else {
      path += `L${rightX},1000 `;
    }
    path += `L${leftX},1000 `;
    if (index > 0) {
      path += `C${leftX - 25},750 ${leftX + 25},250 ${leftX},0 `;
    } else {
      path += `Z`;
    }
    return path;
  };

  const regions: DropRegion[] = isProjectOpen 
    ? ['add', 'batch', 'single', 'cancel'] 
    : ['batch', 'single', 'cancel'];

  return (
    <div className="drop-overlay-bg-container">
      <svg 
        width="100%" 
        height="100%" 
        viewBox={`0 0 ${width} 1000`} 
        preserveAspectRatio="none"
        className="drop-overlay-svg"
      >
        {regions.map((region, i) => (
          <path
            key={region}
            d={getRegionPath(i)}
            className={`region-fill ${region} ${activeRegion === region ? 'active' : ''}`}
          />
        ))}

        {Array.from({ length: zoneCount - 1 }).map((_, i) => {
          const x = getDividerX(i + 1);
          return (
            <path
              key={i}
              d={`M${x},0 C${x + 25},250 ${x - 25},750 ${x},1000`}
              fill="none"
              stroke="white"
              strokeWidth="2"
              strokeDasharray="20 10"
              className={`divider-line ${activeRegion === regions[i] || activeRegion === regions[i+1] ? 'active' : ''}`}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}

        <rect
          x="1"
          y="1"
          width={width - 2}
          height={998}
          rx="12"
          fill="none"
          stroke="rgba(255, 255, 255, 0.4)"
          strokeWidth="2"
          strokeDasharray="20 10"
          vectorEffect="non-scaling-stroke"
          className="outer-border"
        />
      </svg>
    </div>
  );
};

export const DropOverlay: React.FC<DropOverlayProps> = ({ 
  isVisible, 
  onRegionChange,
  isProjectOpen = false,
  dragContext
}) => {
  const [activeRegion, setActiveRegion] = useState<DropRegion>(null);

  const handleRegionHover = (region: DropRegion) => {
    setActiveRegion(region);
    onRegionChange?.(region);
  };

  const getLabels = (region: DropRegion) => {
    const isFolder = (dragContext?.folders || 0) > 0;
    const isMultiple = (dragContext?.files || 0) > 1 || (dragContext?.folders || 0) > 1;
    const count = (dragContext?.files || 0) + (dragContext?.folders || 0);

    switch (region) {
      case 'add':
        if (isFolder) return { title: 'Import Folders', sub: `Add images from ${count} folder(s)`, icon: FolderPlus };
        return { 
          title: isMultiple ? `Add ${count} Images` : 'Add Image', 
          sub: 'Append to current project',
          icon: PlusCircle 
        };
      case 'batch':
        if (isFolder) return { title: 'Batch Folders', sub: 'New session from folders', icon: Layers };
        return { 
          title: isMultiple ? `New Batch (${count})` : 'Process as Batch', 
          sub: 'Start a fresh session',
          icon: Layers 
        };
      case 'single':
        if (isFolder) return { title: 'Edit First', sub: 'Find first image in folder', icon: Maximize };
        return { 
          title: isMultiple ? 'Edit First Item' : 'Single Edit', 
          sub: 'Open immediately in editor',
          icon: Maximize 
        };
      case 'cancel':
        return { title: 'Cancel', sub: 'Ignore these items', icon: XCircle };
      default:
        return { title: '', sub: '', icon: XCircle };
    }
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          className="drop-overlay-fullscreen"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* Content Summary Pill */}
          <div className="drop-summary-container">
            <motion.div 
              className="drop-summary-pill"
              initial={{ y: -20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2 }}
            >
              {dragContext && (
                <>
                  <span className="summary-icon">📦</span>
                  <span>
                    {dragContext.folders > 0 && `${dragContext.folders} Folder${dragContext.folders > 1 ? 's' : ''}`}
                    {dragContext.folders > 0 && dragContext.files > 0 && ' + '}
                    {dragContext.files > 0 && `${dragContext.files} Image${dragContext.files > 1 ? 's' : ''}`}
                  </span>
                </>
              )}
            </motion.div>
          </div>

          <div className="drop-overlay-border-wrap">
            <CurvyBackground 
              activeRegion={activeRegion} 
              isProjectOpen={isProjectOpen} 
            />
            
            <div className="drop-columns">
              {isProjectOpen && (
                <div 
                  className={`drop-column ${activeRegion === 'add' ? 'active' : ''}`}
                  onDragEnter={() => handleRegionHover('add')}
                >
                  <div className="drop-column-content">
                    {React.createElement(getLabels('add').icon, { size: 48, className: "drop-icon" })}
                    <h2>{getLabels('add').title}</h2>
                    <p>{getLabels('add').sub}</p>
                  </div>
                </div>
              )}

              <div 
                className={`drop-column ${activeRegion === 'batch' ? 'active' : ''}`}
                onDragEnter={() => handleRegionHover('batch')}
              >
                <div className="drop-column-content">
                  {React.createElement(getLabels('batch').icon, { size: 48, className: "drop-icon" })}
                  <h2>{getLabels('batch').title}</h2>
                  <p>{getLabels('batch').sub}</p>
                </div>
              </div>

              <div 
                className={`drop-column ${activeRegion === 'single' ? 'active' : ''}`}
                onDragEnter={() => handleRegionHover('single')}
              >
                <div className="drop-column-content">
                  {React.createElement(getLabels('single').icon, { size: 48, className: "drop-icon" })}
                  <h2>{getLabels('single').title}</h2>
                  <p>{getLabels('single').sub}</p>
                </div>
              </div>

              <div 
                className={`drop-column cancel ${activeRegion === 'cancel' ? 'active' : ''}`}
                onDragEnter={() => handleRegionHover('cancel')}
              >
                <div className="drop-column-content">
                  {React.createElement(getLabels('cancel').icon, { size: 48, className: "drop-icon" })}
                  <h2>{getLabels('cancel').title}</h2>
                  <p>{getLabels('cancel').sub}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="drop-overlay-hint">
            Release to execute action
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
