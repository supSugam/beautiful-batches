
import React, { useMemo } from 'react';
import { cropToScreen } from './utils/geometry';

const HANDLE_SIZE = 24; // Touch target size
const VISIBLE_HANDLE_RADIUS = 5;

const CropOverlay = ({ editorState, onResizeStart, onMoveStart }) => {
  const { state, containerSize } = editorState;
  const { crop } = state;

  const screenCrop = useMemo(() => {
    if (!containerSize.width || !containerSize.height) return null;
    return cropToScreen(crop, state, containerSize);
  }, [crop, state, containerSize]);

  if (!screenCrop) return null;

  const { x, y, width, height } = screenCrop;

  // SVG Path for the "hole" in the dim overlay
  // M 0 0 h w v h h -w Z returns to 0,0 (outer rect)
  // M x y v h h -w v -h Z (inner rect, counter-clockwise to create hole)
  const overlayPath = `
    M 0 0 
    H ${containerSize.width} 
    V ${containerSize.height} 
    H 0 
    Z
    M ${x} ${y}
    v ${height}
    h ${width}
    v -${height}
    Z
  `;

  // Helper for resize handles
  const renderHandle = (position, cursor, hx, hy) => (
    <rect
      key={position}
      x={hx - HANDLE_SIZE / 2}
      y={hy - HANDLE_SIZE / 2}
      width={HANDLE_SIZE}
      height={HANDLE_SIZE}
      fill="transparent"
      style={{ cursor }}
      onPointerDown={(e) => onResizeStart(e, position)}
    >
      <title>{position}</title>
    </rect>
  );

  // Visual knobs (smaller than touch targets)
  const renderKnob = (hx, hy) => (
    <circle
      cx={hx}
      cy={hy}
      r={VISIBLE_HANDLE_RADIUS}
      fill="white"
      stroke="rgba(0,0,0,0.2)"
      strokeWidth="1"
    />
  );
  
  // Rule of thirds grid lines
  const renderGrid = () => (
    <g stroke="rgba(255, 255, 255, 0.5)" strokeWidth="1" vectorEffect="non-scaling-stroke">
      <line x1={x + width / 3} y1={y} x2={x + width / 3} y2={y + height} />
      <line x1={x + (width * 2) / 3} y1={y} x2={x + (width * 2) / 3} y2={y + height} />
      <line x1={x} y1={y + height / 3} x2={x + width} y2={y + height / 3} />
      <line x1={x} y1={y + (height * 2) / 3} x2={x + width} y2={y + (height * 2) / 3} />
    </g>
  );

  return (
    <svg
      width="100%"
      height="100%"
      style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
    >
      <defs>
        <mask id="crop-mask">
          <path d={overlayPath} fill="white" fillRule="evenodd" />
        </mask>
      </defs>

      {/* Dimmed Background */}
      <path
        d={overlayPath}
        fill="rgba(0, 0, 0, 0.6)"
        fillRule="evenodd"
        style={{ pointerEvents: 'auto' }}
      />
      
      {/* Crop Area (transparent but catches events for move) */}
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill="transparent"
        style={{ cursor: 'move', pointerEvents: 'all' }}
        onPointerDown={onMoveStart}
      />

      {/* Grid */}
      {renderGrid()}
      
      {/* Border */}
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill="none"
        stroke="white"
        strokeWidth="2"
      />

      {/* Interactive Layer (Handles) */}
      <g style={{ pointerEvents: 'all' }}>
        {/* Corners */}
        {renderHandle('nw', 'nw-resize', x, y)}
        {renderHandle('ne', 'ne-resize', x + width, y)}
        {renderHandle('sw', 'sw-resize', x, y + height)}
        {renderHandle('se', 'se-resize', x + width, y + height)}
        
        {/* Sides */}
        {renderHandle('n', 'n-resize', x + width / 2, y)}
        {renderHandle('e', 'e-resize', x + width, y + height / 2)}
        {renderHandle('s', 's-resize', x + width / 2, y + height)}
        {renderHandle('w', 'w-resize', x, y + height / 2)}
      </g>
      
      {/* Visual Knobs Layer (Pointer events none to let clicks pass to handles) */}
      <g style={{ pointerEvents: 'none' }}>
        {renderKnob(x, y)}
        {renderKnob(x + width, y)}
        {renderKnob(x, y + height)}
        {renderKnob(x + width, y + height)}
        
        {/* Optional: Side knobs? usually just corners have knobs, sides are invisible or bars */}
        <rect x={x + width / 2 - 10} y={y - 2} width={20} height={4} fill="white" rx={2} />
        <rect x={x + width / 2 - 10} y={y + height - 2} width={20} height={4} fill="white" rx={2} />
        <rect x={x - 2} y={y + height/2 - 10} width={4} height={20} fill="white" rx={2} />
        <rect x={x + width - 2} y={y + height/2 - 10} width={4} height={20} fill="white" rx={2} />
      </g>

    </svg>
  );
};

export default CropOverlay;
