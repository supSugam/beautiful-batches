import React, { useCallback, useRef, useState } from 'react';
import { usePointerDrag } from '../hooks/usePointerDrag';

/**
 * CropOverlay — interactive crop zone rendered as positioned DOM elements
 * over the editor canvas.
 */
const HANDLES = [
  { id: 'tl', cursor: 'nwse-resize', style: { top: -5, left: -5 } },
  { id: 'tr', cursor: 'nesw-resize', style: { top: -5, right: -5 } },
  { id: 'bl', cursor: 'nesw-resize', style: { bottom: -5, left: -5 } },
  { id: 'br', cursor: 'nwse-resize', style: { bottom: -5, right: -5 } },
  { id: 't', cursor: 'ns-resize', style: { top: -4, left: '50%', transform: 'translateX(-50%)' } },
  { id: 'b', cursor: 'ns-resize', style: { bottom: -4, left: '50%', transform: 'translateX(-50%)' } },
  { id: 'l', cursor: 'ew-resize', style: { left: -4, top: '50%', transform: 'translateY(-50%)' } },
  { id: 'r', cursor: 'ew-resize', style: { right: -4, top: '50%', transform: 'translateY(-50%)' } },
];

const CropOverlay = ({
  crop,
  fitLayout,
  zoom = 1,
  onCropMove,
  onCropResize,
  onDragStart,
  onDragEnd,
  centerStatus,
}) => {
  // ── ALL hooks must be called unconditionally (before any early return) ──

  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const activeHandle = useRef(null);
  const startCropRef = useRef(null);

  // Keep displayScale in a ref so drag callbacks always see the latest value
  // without needing to be in the dependency array
  const displayScaleRef = useRef(1);
  const cropRef = useRef(crop);
  const onCropMoveRef = useRef(onCropMove);
  const onCropResizeRef = useRef(onCropResize);
  const onDragStartRef = useRef(onDragStart);
  const onDragEndRef = useRef(onDragEnd);

  // Keep refs up to date each render
  cropRef.current = crop;
  onCropMoveRef.current = onCropMove;
  onCropResizeRef.current = onCropResize;
  onDragStartRef.current = onDragStart;
  onDragEndRef.current = onDragEnd;

  const dragHandlers = usePointerDrag({
    onMoveStart: () => {
      setIsDragging(true);
      onDragStartRef.current?.();
    },
    onMove: ({ deltaX, deltaY }) => {
      const s = displayScaleRef.current;
      onCropMoveRef.current?.(deltaX / s, deltaY / s);
    },
    onMoveEnd: () => {
      setIsDragging(false);
      onDragEndRef.current?.();
    },
  });

  const makeResizeHandler = useCallback((handleId) => {
    return {
      onPointerDown: (e) => {
        e.preventDefault();
        e.stopPropagation();
        activeHandle.current = handleId;
        startCropRef.current = { ...cropRef.current };
        setIsResizing(true);
        onDragStartRef.current?.();

        const target = e.currentTarget;
        target.setPointerCapture(e.pointerId);

        const startX = e.clientX;
        const startY = e.clientY;

        const handleMove = (moveEvent) => {
          moveEvent.preventDefault();
          const s = displayScaleRef.current;
          const totalDx = (moveEvent.clientX - startX) / s;
          const totalDy = (moveEvent.clientY - startY) / s;
          onCropResizeRef.current?.(handleId, totalDx, totalDy, startCropRef.current);
        };

        const handleUp = (upEvent) => {
          target.releasePointerCapture(upEvent.pointerId);
          target.removeEventListener('pointermove', handleMove);
          target.removeEventListener('pointerup', handleUp);
          target.removeEventListener('pointercancel', handleUp);
          activeHandle.current = null;
          startCropRef.current = null;
          setIsResizing(false);
          onDragEndRef.current?.();
        };

        target.addEventListener('pointermove', handleMove);
        target.addEventListener('pointerup', handleUp);
        target.addEventListener('pointercancel', handleUp);
      },
    };
  }, []); // stable — uses only refs

  // ── Early return AFTER all hooks ──────────────────────

  if (!fitLayout || fitLayout.displayW <= 0) return null;

  const { scale, offsetX, offsetY, displayW, displayH } = fitLayout;
  const displayScale = scale * zoom;

  // Update ref for drag callbacks
  displayScaleRef.current = displayScale;

  // Convert crop from effective-image pixels to screen pixels
  const screenX = offsetX + crop.x * displayScale;
  const screenY = offsetY + crop.y * displayScale;
  const screenW = crop.w * displayScale;
  const screenH = crop.h * displayScale;

  const isActive = isDragging || isResizing;

  const imageLeft = offsetX;
  const imageTop = offsetY;
  const imageRight = offsetX + displayW;
  const imageBottom = offsetY + displayH;

  const cropLeft = Math.max(imageLeft, Math.min(screenX, imageRight));
  const cropTop = Math.max(imageTop, Math.min(screenY, imageBottom));
  const cropRight = Math.max(cropLeft, Math.min(screenX + screenW, imageRight));
  const cropBottom = Math.max(cropTop, Math.min(screenY + screenH, imageBottom));
  const cropWidth = cropRight - cropLeft;
  const cropHeight = cropBottom - cropTop;

  const dimRects = [
    {
      key: 'top',
      left: imageLeft,
      top: imageTop,
      width: displayW,
      height: Math.max(0, cropTop - imageTop),
    },
    {
      key: 'left',
      left: imageLeft,
      top: cropTop,
      width: Math.max(0, cropLeft - imageLeft),
      height: cropHeight,
    },
    {
      key: 'right',
      left: cropRight,
      top: cropTop,
      width: Math.max(0, imageRight - cropRight),
      height: cropHeight,
    },
    {
      key: 'bottom',
      left: imageLeft,
      top: cropBottom,
      width: displayW,
      height: Math.max(0, imageBottom - cropBottom),
    },
  ];

  return (
    <div
      className="crop-overlay-root"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 5,
      }}
    >
      {/* Dim overlay outside crop */}
      {dimRects.map((rect) => {
        if (rect.width <= 0 || rect.height <= 0) return null;
        return (
          <div
            key={rect.key}
            className="crop-dim-overlay"
            style={{
              position: 'absolute',
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
              background: 'rgba(0,0,0,0.55)',
              pointerEvents: 'none',
              transition: isActive ? 'none' : 'all 0.1s ease',
            }}
          />
        );
      })}

      {/* Center guide lines */}
      <div
        className={`center-guide-line center-guide-line--vertical ${
          centerStatus?.horizontal
            ? 'visible snapped'
            : isDragging
              ? 'visible hint'
              : ''
        }`}
        style={{
          top: offsetY,
          height: displayH,
          left: offsetX + displayW / 2,
        }}
      />
      <div
        className={`center-guide-line center-guide-line--horizontal ${
          centerStatus?.vertical
            ? 'visible snapped'
            : isDragging
              ? 'visible hint'
              : ''
        }`}
        style={{
          left: offsetX,
          width: displayW,
          top: offsetY + displayH / 2,
        }}
      />

      {/* Crop selection box */}
      <div
        className={`crop-selection ${isActive ? 'crop-selection--active' : ''}`}
        style={{
          position: 'absolute',
          left: screenX,
          top: screenY,
          width: screenW,
          height: screenH,
          pointerEvents: 'auto',
          cursor: 'move',
          touchAction: 'none',
        }}
        {...dragHandlers}
      >
        {/* Border */}
        <div className="crop-selection-border" />

        {/* Rule-of-thirds grid (visible during drag/resize) */}
        {isActive && (
          <div className="crop-grid">
            <div className="crop-grid-line crop-grid-h1" />
            <div className="crop-grid-line crop-grid-h2" />
            <div className="crop-grid-line crop-grid-v1" />
            <div className="crop-grid-line crop-grid-v2" />
          </div>
        )}

        {/* Corner brackets */}
        <div className="crop-bracket crop-bracket-tl" />
        <div className="crop-bracket crop-bracket-tr" />
        <div className="crop-bracket crop-bracket-bl" />
        <div className="crop-bracket crop-bracket-br" />

        {/* Resize handles */}
        {HANDLES.map(({ id, cursor, style }) => {
          const isEdge = id.length === 1;
          return (
            <div
              key={id}
              className={`crop-handle crop-handle-${id} ${isEdge ? 'crop-handle-edge' : 'crop-handle-corner'}`}
              style={{
                position: 'absolute',
                cursor,
                ...style,
                touchAction: 'none',
                pointerEvents: 'auto',
              }}
              {...makeResizeHandler(id)}
            />
          );
        })}
      </div>
    </div>
  );
};

export default React.memo(CropOverlay);
