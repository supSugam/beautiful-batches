import React, { useEffect, useRef, useState } from 'react';
import EditorCanvas from './EditorCanvas';
import CropOverlay from './CropOverlay';

/**
 * InspectorPreview — the editor zone that hosts canvas + crop overlay.
 *
 * Props:
 *  - isProcessing     — shows processing overlay
 *  - imageObjectUrl   — objectURL for the source image
 *  - editor           — useImageEditor() return value
 *  - naturalWidth     — original image width (optional, reads from editor)
 *  - naturalHeight    — original image height (optional, reads from editor)
 */
const InspectorPreview = ({ isProcessing, imageObjectUrl, editor }) => {
  const containerRef = useRef(null);
  const editorRef = useRef(editor);
  editorRef.current = editor;

  const [containerSize, setLocalContainerSize] = useState({
    width: 0,
    height: 0,
  });
  const [isPinching, setIsPinching] = useState(false);

  // Observe container size changes
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      const w = Math.floor(width);
      const h = Math.floor(height);
      setLocalContainerSize({ width: w, height: h });
      editorRef.current.setContainerSize({ width: w, height: h });
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Native listeners keep wheel + touch pinch consistent (passive false).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    const pinchState = {
      active: false,
      startDistance: 0,
      startZoom: editorRef.current.zoom,
    };

    const getTouchDistance = (touchList) => {
      if (!touchList || touchList.length < 2) return 0;
      const first = touchList[0];
      const second = touchList[1];
      return Math.hypot(
        second.clientX - first.clientX,
        second.clientY - first.clientY,
      );
    };

    const getTouchCenter = (touchList) => {
      if (!touchList || touchList.length < 2) return null;
      const first = touchList[0];
      const second = touchList[1];
      return {
        x: (first.clientX + second.clientX) / 2,
        y: (first.clientY + second.clientY) / 2,
      };
    };

    const clearPinch = () => {
      pinchState.active = false;
      pinchState.startDistance = 0;
      pinchState.startZoom = editorRef.current.zoom;
      setIsPinching(false);
    };

    const handleWheel = (event) => {
      editorRef.current.handleWheel(event);
    };

    const handleTouchStart = (event) => {
      if (event.touches.length < 2) return;
      const distance = getTouchDistance(event.touches);
      if (distance <= 0) return;

      pinchState.active = true;
      pinchState.startDistance = distance;
      pinchState.startZoom = editorRef.current.zoom;
      setIsPinching(true);
      event.preventDefault();
    };

    const handleTouchMove = (event) => {
      if (!pinchState.active || event.touches.length < 2) return;

      const distance = getTouchDistance(event.touches);
      if (distance <= 0 || pinchState.startDistance <= 0) return;
      const center = getTouchCenter(event.touches);
      if (!center) return;

      const zoomFactor = distance / pinchState.startDistance;
      editorRef.current.setZoomAtClientPoint(
        pinchState.startZoom * zoomFactor,
        center.x,
        center.y,
        el,
      );
      event.preventDefault();
    };

    const handleTouchEnd = (event) => {
      if (event.touches.length >= 2) return;
      clearPinch();
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    el.addEventListener('touchstart', handleTouchStart, { passive: false });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd, { passive: false });
    el.addEventListener('touchcancel', handleTouchEnd, { passive: false });

    return () => {
      el.removeEventListener('wheel', handleWheel);
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
      el.removeEventListener('touchcancel', handleTouchEnd);
      clearPinch();
    };
  }, []);

  return (
    <div
      className="inspector-crop-container"
      ref={containerRef}
      style={{ overflow: 'hidden', touchAction: 'none' }}
    >
      {isProcessing && (
        <div className="editor-processing-overlay">
          <div className="editor-processing-spinner" />
        </div>
      )}

      <EditorCanvas
        imageUrl={imageObjectUrl}
        naturalWidth={editor.naturalWidth}
        naturalHeight={editor.naturalHeight}
        rotation={editor.rotation}
        flipH={editor.flipH}
        flipV={editor.flipV}
        zoom={editor.zoom}
        zoomAnchor={editor.zoomAnchor}
        fitLayout={editor.fitLayout}
        containerWidth={containerSize.width}
        containerHeight={containerSize.height}
      />

      <CropOverlay
        crop={editor.crop}
        fitLayout={editor.fitLayout}
        zoom={editor.zoom}
        onPanImage={editor.panZoomByScreenDelta}
        onCropMove={editor.moveCrop}
        onCropResize={editor.resizeCrop}
        onDragStart={editor.onDragStart}
        onDragEnd={editor.onDragEnd}
        isPinching={isPinching}
        centerStatus={editor.centerStatus}
      />
    </div>
  );
};

export default React.memo(InspectorPreview);
