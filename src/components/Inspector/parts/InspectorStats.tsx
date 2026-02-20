import React from 'react';
import { Maximize, Layers } from 'lucide-react';

type InspectorStatsProps = {
  rotation: number;
  naturalWidth: number;
  naturalHeight: number;
  outputWidth: number | null;
  aspect: number | null;
  currentPixelWidth: number;
  currentPixelHeight: number;
};

const InspectorStats = ({
  rotation,
  naturalWidth,
  naturalHeight,
  outputWidth,
  aspect,
  currentPixelWidth,
  currentPixelHeight
}: InspectorStatsProps) => {
  return (
    <div className="inspector-stats">
      <div className="stat-pill">
        <Maximize size={10} />
        <span>
          Original:{' '}
          {rotation % 180 === 90 ? naturalHeight : naturalWidth} ×{' '}
          {rotation % 180 === 90 ? naturalWidth : naturalHeight}
        </span>
      </div>
      <div className={`stat-pill ${outputWidth ? 'active' : ''}`}>
        <Layers size={10} />
        <span>
          {outputWidth
            ? (() => {
                const ratio = aspect || currentPixelWidth / currentPixelHeight;
                const h = Math.round(outputWidth / ratio) || 0;
                const scale = (outputWidth / (currentPixelWidth || 1)).toFixed(2);
                return `Output: ${outputWidth} × ${h} (${scale}x)`;
              })()
            : `Selection: ${currentPixelWidth} × ${currentPixelHeight}`}
        </span>
      </div>
    </div>
  );
};

export default React.memo(InspectorStats);
