import React, { useCallback, useRef, useState } from 'react';
import { usePointerDrag } from '../hooks/usePointerDrag';
import type { EditorCropCoordinates } from '../../../types/app';
import useStore from '../../../store/useStore';
import { MonitorCheck } from 'lucide-react';

/**
 * CropOverlay — interactive crop zone rendered as positioned DOM elements
 * over the editor canvas.
 */
const HANDLES = [
  { id: 'tl', cursor: 'nwse-resize', style: { top: -8, left: -8 } },
  { id: 'tr', cursor: 'nesw-resize', style: { top: -8, right: -8 } },
  { id: 'bl', cursor: 'nesw-resize', style: { bottom: -8, left: -8 } },
  { id: 'br', cursor: 'nwse-resize', style: { bottom: -8, right: -8 } },
  { id: 't', cursor: 'ns-resize', style: { top: -6, left: '50%', transform: 'translateX(-50%)' } },
  { id: 'b', cursor: 'ns-resize', style: { bottom: -6, left: '50%', transform: 'translateX(-50%)' } },
  { id: 'l', cursor: 'ew-resize', style: { left: -6, top: '50%', transform: 'translateY(-50%)' } },
  { id: 'r', cursor: 'ew-resize', style: { right: -6, top: '50%', transform: 'translateY(-50%)' } },
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
  onCropMove?: (totalDx: number, totalDy: number, startCrop: EditorCropCoordinates | null, bypassSnap: boolean, lockRatio: boolean) => void;
  onCropResize?: (
    handleId: string,
    totalDx: number,
    totalDy: number,
    startCrop: EditorCropCoordinates | null,
    bypassSnap: boolean,
    lockRatio: boolean,
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
  const selectedId = useStore((state) => state.selectedId);
  const cropData = useStore((state) => state.cropData);

  const currentRegion = selectedId ? cropData.get(selectedId)?.detectionRegion : null;

  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const activeHandle = useRef<string | null>(null);
  const startCropRef = useRef<EditorCropCoordinates | null>(null);

  const displayScaleRef = useRef(1);
  const cropRef = useRef(crop);
  const onCropMoveRef = useRef(onCropMove);
  const onPanImageRef = useRef(onPanImage);
  const onCropResizeRef = useRef(onCropResize);
  const onDragStartRef = useRef(onDragStart);
  const onDragEndRef = useRef(onDragEnd);
  const isPinchingRef = useRef(isPinching);

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
      startCropRef.current = { ...cropRef.current };
      onDragStartRef.current?.();
    },
    onMove: ({ deltaX, deltaY, totalDeltaX, totalDeltaY, ctrlKey, metaKey, shiftKey }) => {
      if (isPinchingRef.current) return;
      if (zoom > 1.0001) {
        onPanImageRef.current?.(deltaX, deltaY);
        return;
      }
      const s = displayScaleRef.current;
      const bypassSnap = shiftKey;
      const lockRatio = ctrlKey || metaKey;
      onCropMoveRef.current?.(totalDeltaX / s, totalDeltaY / s, startCropRef.current, bypassSnap, lockRatio);
    },
    onMoveEnd: () => {
      setIsDragging(false);
      startCropRef.current = null;
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
          const bypassSnap = moveEvent.shiftKey;
          const lockRatio = moveEvent.ctrlKey || moveEvent.metaKey;
          onCropResizeRef.current?.(handleId, totalDx, totalDy, startCropRef.current, bypassSnap, lockRatio);
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
  }, []);

  if (!fitLayout || fitLayout.displayW <= 0) return null;

  const { scale, offsetX, offsetY, displayW, displayH } = fitLayout;
  displayScaleRef.current = scale;

  const screenX = offsetX + crop.x * scale;
  const screenY = offsetY + crop.y * scale;
  const screenW = crop.w * scale;
  const screenH = crop.h * scale;

  // AI ROI Screen Coords
  let roiScreenX = 0, roiScreenY = 0, roiScreenW = 0, roiScreenH = 0;
  if (currentRegion) {
    roiScreenW = (currentRegion.x2 - currentRegion.x1) * displayW;
    roiScreenH = (currentRegion.y2 - currentRegion.y1) * displayH;
    roiScreenX = offsetX + currentRegion.x1 * displayW;
    roiScreenY = offsetY + currentRegion.y1 * displayH;
  }

  const isActive = isDragging || isResizing;
  const containerWidth = displayW + offsetX * 2;
  const containerHeight = displayH + offsetY * 2;

  const cropLeft = Math.max(0, Math.min(screenX, containerWidth));
  const cropTop = Math.max(0, Math.min(screenY, containerHeight));
  const cropRight = Math.max(cropLeft, Math.min(screenX + screenW, containerWidth));
  const cropBottom = Math.max(cropTop, Math.min(screenY + screenH, containerHeight));
  const cropWidth = cropRight - cropLeft;
  const cropHeight = cropBottom - cropTop;

  const DIM_TRANSITION = isActive ? 'all 0.04s linear' : 'all 0.15s ease';

  const dimRects = [
    { key: 'top', left: 0, top: 0, width: containerWidth, height: cropTop },
    { key: 'left', left: 0, top: cropTop, width: cropLeft, height: cropHeight },
    { key: 'right', left: cropRight, top: cropTop, width: containerWidth - cropRight, height: cropHeight },
    { key: 'bottom', left: 0, top: cropBottom, width: containerWidth, height: containerHeight - cropBottom },
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

      {/* Guide lines */}
      <div
        className={`center-guide-line center-guide-line--vertical ${centerStatus?.horizontal ? 'visible snapped' : (isActive ? 'visible hint' : '')}`}
        style={{ top: offsetY, height: displayH, left: offsetX + displayW / 2 }}
      />
      <div
        className={`center-guide-line center-guide-line--horizontal ${centerStatus?.vertical ? 'visible snapped' : (isActive ? 'visible hint' : '')}`}
        style={{ left: offsetX, width: displayW, top: offsetY + displayH / 2 }}
      />

      {/* Content guides */}
      {contentRect && contentRect.w > 0 && contentRect.h > 0 && (
        <>
          <div
            className={`padding-guide-line padding-guide-line--vertical ${contentGuideStatus?.left ? 'visible snapped' : (isActive ? 'visible hint' : '')}`}
            style={{ top: offsetY, height: displayH, left: offsetX + contentRect.x * scale }}
          />
          <div
            className={`padding-guide-line padding-guide-line--vertical ${contentGuideStatus?.right ? 'visible snapped' : (isActive ? 'visible hint' : '')}`}
            style={{ top: offsetY, height: displayH, left: offsetX + (contentRect.x + contentRect.w) * scale }}
          />
          <div
            className={`padding-guide-line padding-guide-line--horizontal ${contentGuideStatus?.top ? 'visible snapped' : (isActive ? 'visible hint' : '')}`}
            style={{ left: offsetX, width: displayW, top: offsetY + contentRect.y * scale }}
          />
          <div
            className={`padding-guide-line padding-guide-line--horizontal ${contentGuideStatus?.bottom ? 'visible snapped' : (isActive ? 'visible hint' : '')}`}
            style={{ left: offsetX, width: displayW, top: offsetY + (contentRect.y + contentRect.h) * scale }}
          />
        </>
      )}

      {/* Crop Box */}
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
        <div className="crop-selection-border" />
        <div className={`crop-grid ${isActive ? 'crop-grid--active' : ''}`}>
          <div className="crop-grid-line crop-grid-h1" />
          <div className="crop-grid-line crop-grid-h2" />
          <div className="crop-grid-line crop-grid-v1" />
          <div className="crop-grid-line crop-grid-v2" />
        </div>
        <div className="crop-bracket crop-bracket-tl" />
        <div className="crop-bracket crop-bracket-tr" />
        <div className="crop-bracket crop-bracket-bl" />
        <div className="crop-bracket crop-bracket-br" />

        {/* Crop dimension label */}
        {isActive && screenW > 60 && (
          <div className="crop-dimension-label">
            {Math.round(crop.w)} × {Math.round(crop.h)}
          </div>
        )}

        {HANDLES.map(({ id, cursor, style }) => (
          <div
            key={id}
            className={`crop-handle crop-handle-${id} ${id.length === 1 ? 'crop-handle-edge' : 'crop-handle-corner'}`}
            style={{ position: 'absolute', cursor, ...style, touchAction: 'none', pointerEvents: 'auto' }}
            {...makeResizeHandler(id)}
          />
        ))}
      </div>

      {/* ROI Indicator */}
      {currentRegion && (
        <div 
          className="roi-indicator-box"
          style={{
            position: 'absolute',
            left: roiScreenX,
            top: roiScreenY,
            width: roiScreenW,
            height: roiScreenH,
            pointerEvents: 'none',
            zIndex: 10
          }}
        >
          <div className="roi-indicator-label">
            <MonitorCheck size={10} />
            AI Detection Area
          </div>
        </div>
      )}
    </div>
  );
};

export default React.memo(CropOverlay);
