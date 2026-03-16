import React, { useCallback, useRef, useState } from 'react';
import { usePointerDrag } from '../hooks/usePointerDrag';
import type { EditorCropCoordinates } from '../../../types/app';

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

type FitLayout = {
  scale: number;
  offsetX: number;
  offsetY: number;
  displayW: number;
  displayH: number;
};

type CropOverlayProps = {
  crop: EditorCropCoordinates;
  fitLayout: FitLayout | null;
  zoom?: number;
  onPanImage?: (dx: number, dy: number) => void;
  onCropMove?: (dx: number, dy: number) => void;
  onCropResize?: (
    handleId: string,
    totalDx: number,
    totalDy: number,
    startCrop: EditorCropCoordinates | null,
  ) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  isPinching?: boolean;
  centerStatus?: { horizontal: boolean; vertical: boolean };
  contentRect?: { x: number; y: number; w: number; h: number } | null;
  contentGuideStatus?: {
    left: boolean;
    right: boolean;
    top: boolean;
    bottom: boolean;
  };
};

const CropOverlay = ({
  crop,
  fitLayout,
  zoom = 1,
  onPanImage,
  onCropMove,
  onCropResize,
  onDragStart,
  onDragEnd,
  isPinching = false,
  centerStatus,
  contentRect = null,
  contentGuideStatus,
}: CropOverlayProps) => {
  // ── ALL hooks must be called unconditionally (before any early return) ──

  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const activeHandle = useRef<string | null>(null);
  const startCropRef = useRef<EditorCropCoordinates | null>(null);

  // Keep displayScale in a ref so drag callbacks always see the latest value
  // without needing to be in the dependency array
  const displayScaleRef = useRef(1);
  const cropRef = useRef(crop);
  const onCropMoveRef = useRef(onCropMove);
  const onPanImageRef = useRef(onPanImage);
  const onCropResizeRef = useRef(onCropResize);
  const onDragStartRef = useRef(onDragStart);
  const onDragEndRef = useRef(onDragEnd);
  const isPinchingRef = useRef(isPinching);

  // Keep refs up to date each render
  cropRef.current = crop;
  onCropMoveRef.current = onCropMove;
  onPanImageRef.current = onPanImage;
  onCropResizeRef.current = onCropResize;
  onDragStartRef.current = onDragStart;
  onDragEndRef.current = onDragEnd;
  isPinchingRef.current = isPinching;

  const dragHandlers = usePointerDrag({
    onMoveStart: () => {
      if (isPinchingRef.current) return;
      setIsDragging(true);
      onDragStartRef.current?.();
    },
    onMove: ({ deltaX, deltaY }) => {
      if (isPinchingRef.current) return;
      if (zoom > 1.0001) {
        onPanImageRef.current?.(deltaX, deltaY);
        return;
      }
      const s = displayScaleRef.current;
      onCropMoveRef.current?.(deltaX / s, deltaY / s);
    },
    onMoveEnd: () => {
      setIsDragging(false);
      onDragEndRef.current?.();
    },
  });

  const makeResizeHandler = useCallback((handleId: string) => {
    return {
      onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
        if (isPinchingRef.current) return;
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

        const handleMove = (moveEvent: PointerEvent) => {
          if (isPinchingRef.current) return;
          moveEvent.preventDefault();
          const s = displayScaleRef.current;
          const totalDx = (moveEvent.clientX - startX) / s;
          const totalDy = (moveEvent.clientY - startY) / s;
          onCropResizeRef.current?.(handleId, totalDx, totalDy, startCropRef.current);
        };

        const handleUp = (upEvent: PointerEvent) => {
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
  const interactionScale = scale;

  // Update ref for drag callbacks
  displayScaleRef.current = interactionScale;

  // Keep crop UI in fit-layout coordinates so wheel/pinch zoom affects the
  // image only, not the crop frame geometry.
  const screenX = offsetX + crop.x * scale;
  const screenY = offsetY + crop.y * scale;
  const screenW = crop.w * scale;
  const screenH = crop.h * scale;

  const isActive = isDragging || isResizing;

  const containerWidth = displayW + offsetX * 2;
  const containerHeight = displayH + offsetY * 2;
  const overlayLeft = 0;
  const overlayTop = 0;
  const overlayRight = containerWidth;
  const overlayBottom = containerHeight;

  const cropLeft = Math.max(overlayLeft, Math.min(screenX, overlayRight));
  const cropTop = Math.max(overlayTop, Math.min(screenY, overlayBottom));
  const cropRight = Math.max(cropLeft, Math.min(screenX + screenW, overlayRight));
  const cropBottom = Math.max(cropTop, Math.min(screenY + screenH, overlayBottom));
  const cropWidth = cropRight - cropLeft;
  const cropHeight = cropBottom - cropTop;

  // Short CSS transition on dim overlays only (not the crop box itself)
  const DIM_TRANSITION = isActive ? 'none' : 'all 0.15s ease';

  const dimRects = [
    {
      key: 'top',
      left: overlayLeft,
      top: overlayTop,
      width: containerWidth,
      height: Math.max(0, cropTop - overlayTop),
    },
    {
      key: 'left',
      left: overlayLeft,
      top: cropTop,
      width: Math.max(0, cropLeft - overlayLeft),
      height: cropHeight,
    },
    {
      key: 'right',
      left: cropRight,
      top: cropTop,
      width: Math.max(0, overlayRight - cropRight),
      height: cropHeight,
    },
    {
      key: 'bottom',
      left: overlayLeft,
      top: cropBottom,
      width: containerWidth,
      height: Math.max(0, overlayBottom - cropBottom),
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
              transition: DIM_TRANSITION,
            }}
          />
        );
      })}

      {/* Center guide lines */}
      <div
        className={`center-guide-line center-guide-line--vertical ${
          centerStatus?.horizontal
            ? 'visible snapped'
            : isActive
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
            : isActive
              ? 'visible hint'
              : ''
        }`}
        style={{
          left: offsetX,
          width: displayW,
          top: offsetY + displayH / 2,
        }}
      />

      {/* Padding/content boundary guide lines */}
      {contentRect && contentRect.w > 0 && contentRect.h > 0 && (
        <>
          <div
            className={`padding-guide-line padding-guide-line--vertical ${
              contentGuideStatus?.left
                ? 'visible snapped'
                : isActive
                  ? 'visible hint'
                  : ''
            }`}
            style={{
              top: offsetY,
              height: displayH,
              left: offsetX + contentRect.x * scale,
            }}
          />
          <div
            className={`padding-guide-line padding-guide-line--vertical ${
              contentGuideStatus?.right
                ? 'visible snapped'
                : isActive
                  ? 'visible hint'
                  : ''
            }`}
            style={{
              top: offsetY,
              height: displayH,
              left: offsetX + (contentRect.x + contentRect.w) * scale,
            }}
          />
          <div
            className={`padding-guide-line padding-guide-line--horizontal ${
              contentGuideStatus?.top
                ? 'visible snapped'
                : isActive
                  ? 'visible hint'
                  : ''
            }`}
            style={{
              left: offsetX,
              width: displayW,
              top: offsetY + contentRect.y * scale,
            }}
          />
          <div
            className={`padding-guide-line padding-guide-line--horizontal ${
              contentGuideStatus?.bottom
                ? 'visible snapped'
                : isActive
                  ? 'visible hint'
                  : ''
            }`}
            style={{
              left: offsetX,
              width: displayW,
              top: offsetY + (contentRect.y + contentRect.h) * scale,
            }}
          />
        </>
      )}

      {/* Crop selection box */}
      <div
        className={`crop-selection ${isActive ? 'crop-selection--active' : ''}`}
        style={{
          position: 'absolute',
          left: screenX,
          top: screenY,
          width: screenW,
          height: screenH,
          pointerEvents: isPinching ? 'none' : 'auto',
          cursor: zoom > 1.0001 ? (isActive ? 'grabbing' : 'grab') : 'move',
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
