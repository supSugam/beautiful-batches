import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  const [containerSize, setLocalContainerSize] = useState({
    width: 0,
    height: 0,
  });

  // Observe container size changes
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      const w = Math.floor(width);
      const h = Math.floor(height);
      setLocalContainerSize({ width: w, height: h });
      editor.setContainerSize({ width: w, height: h });
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [editor]);

  return (
    <div
      className="inspector-crop-container"
      ref={containerRef}
      style={{ overflow: 'hidden' }}
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
        fitLayout={editor.fitLayout}
        containerWidth={containerSize.width}
        containerHeight={containerSize.height}
      />

      <CropOverlay
        crop={editor.crop}
        effectiveWidth={editor.effectiveWidth}
        effectiveHeight={editor.effectiveHeight}
        fitLayout={editor.fitLayout}
        zoom={editor.zoom}
        aspect={editor.aspect}
        onCropMove={editor.moveCrop}
        onCropResize={editor.resizeCrop}
        onDragStart={editor.onDragStart}
        onDragEnd={editor.onDragEnd}
        centerStatus={editor.centerStatus}
      />
    </div>
  );
};

export default React.memo(InspectorPreview);
