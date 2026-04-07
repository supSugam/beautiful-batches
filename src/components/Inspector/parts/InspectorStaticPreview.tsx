import React, { useEffect, useRef, useState } from 'react';
import EditorCanvas from './EditorCanvas';
import type { ImageEditorApi } from '../hooks/useImageEditor';
import type { PaddingFillType } from '../../../types/app';

type InspectorStaticPreviewProps = {
  isProcessing: boolean;
  imageObjectUrl: string;
  editor: ImageEditorApi;
  paddingPx: number;
  cornerRadius: unknown;
  paddingFillType: PaddingFillType;
  paddingFillValue: string;
  paddingImageUrl: string | null;
};

const InspectorStaticPreview = ({
  isProcessing,
  imageObjectUrl,
  editor,
  paddingPx,
  cornerRadius,
  paddingFillType,
  paddingFillValue,
  paddingImageUrl,
}: InspectorStaticPreviewProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setLocalContainerSize] = useState({
    width: 0,
    height: 0,
  });

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
        zoomAnchor={editor.zoomAnchor}
        fitLayout={editor.fitLayout}
        containerWidth={containerSize.width}
        containerHeight={containerSize.height}
        paddingPx={paddingPx}
        cornerRadius={cornerRadius}
        paddingFillType={paddingFillType}
        paddingFillValue={paddingFillValue}
        paddingImageUrl={paddingImageUrl}
      />
    </div>
  );
};

export default React.memo(InspectorStaticPreview);
