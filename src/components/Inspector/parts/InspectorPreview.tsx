import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { MonitorCheck, Trash2 } from 'lucide-react';

import EditorCanvas from './EditorCanvas';
import CropOverlay from './CropOverlay';
import type { ImageEditorApi } from '../hooks/useImageEditor';
import type { PaddingFillType } from '../../../types/app';
import { clampPaddingToReference } from '../../../utils/boxValues';
import { computePaddedContentRect } from '../../../utils/paddedContentRect';
import useStore from '../../../store/useStore';

/**
 * InspectorPreview — the editor zone that hosts canvas + crop overlay.
 */
type InspectorPreviewProps = {
  isProcessing: boolean;
  imageObjectUrl: string;
  editor: ImageEditorApi;
  paddingPx: number;
  cornerRadius: unknown;
  paddingFillType: PaddingFillType;
  paddingFillValue: string;
  paddingImageUrl: string | null;
};

const InspectorPreview = ({
  isProcessing,
  imageObjectUrl,
  editor,
  paddingPx,
  cornerRadius,
  paddingFillType,
  paddingFillValue,
  paddingImageUrl,
}: InspectorPreviewProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  
  // Store hooks
  const selectedId = useStore((state) => state.selectedId);
  const cropData = useStore((state) => state.cropData);
  const updateCropEntry = useStore((state) => state.updateCropEntry);
  const addToast = useStore((state) => state.addToast);
  
  const editorRef = useRef<ImageEditorApi>(editor);
  editorRef.current = editor;

  const [containerSize, setLocalContainerSize] = useState({
    width: 0,
    height: 0,
  });
  const [isPinching, setIsPinching] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number } | null>(null);

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

  // Native listeners for wheel + touch pinch
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    const pinchState = {
      active: false,
      startDistance: 0,
      startZoom: editorRef.current.zoom,
    };

    const getTouchDistance = (touchList: TouchList): number => {
      if (!touchList || touchList.length < 2) return 0;
      const first = touchList[0];
      const second = touchList[1];
      return Math.hypot(
        second.clientX - first.clientX,
        second.clientY - first.clientY,
      );
    };

    const getTouchCenter = (touchList: TouchList): { x: number; y: number } | null => {
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

    const handleWheel = (event: WheelEvent) => {
      editorRef.current.handleWheel(event);
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length < 2) return;
      const distance = getTouchDistance(event.touches);
      if (distance <= 0) return;

      pinchState.active = true;
      pinchState.startDistance = distance;
      pinchState.startZoom = editorRef.current.zoom;
      setIsPinching(true);
      event.preventDefault();
    };

    const handleTouchMove = (event: TouchEvent) => {
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

    const handleTouchEnd = (event: TouchEvent) => {
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

  // Native context menu listener for guaranteed capture
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleNativeContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      
      const currentRegion = selectedId ? cropData.get(selectedId)?.detectionRegion : null;

      const menuWidth = 230;
      const menuHeight = currentRegion ? 160 : 80;
      
      let x = e.clientX;
      let y = e.clientY;
      
      if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 10;
      if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 10;
      
      setContextMenu({ x, y });
    };

    el.addEventListener('contextmenu', handleNativeContextMenu);
    return () => el.removeEventListener('contextmenu', handleNativeContextMenu);
  }, [selectedId, cropData]);

  const paddingValues = clampPaddingToReference(
    String(Math.max(0, Math.round(Number(paddingPx) || 0))),
    editor.effectiveWidth,
    editor.effectiveHeight,
  );
  const contentRect = computePaddedContentRect(
    editor.effectiveWidth,
    editor.effectiveHeight,
    paddingValues,
  );
  const EPS = 0.0001;
  const contentGuideStatus = {
    left: Math.abs(editor.crop.x - contentRect.x) < EPS,
    right:
      Math.abs(
        editor.crop.x + editor.crop.w - (contentRect.x + contentRect.width),
      ) < EPS,
    top: Math.abs(editor.crop.y - contentRect.y) < EPS,
    bottom:
      Math.abs(
        editor.crop.y + editor.crop.h - (contentRect.y + contentRect.height),
      ) < EPS,
  };
  const shouldShowContentGuides = Math.max(0, Math.round(Number(paddingPx) || 0)) > 0;

  // ── Context Menu Handlers ──────────────────────────────────────────

  const handleContextMenu = (e: React.MouseEvent) => {
    // React listener as backup/secondary
    e.preventDefault();
  };

  const closeMenu = () => setContextMenu(null);

  const setAsDetectionRegion = () => {
    if (!selectedId || !editor.fitLayout) return;
    const naturalW = editor.fitLayout.displayW / editor.fitLayout.scale;
    const naturalH = editor.fitLayout.displayH / editor.fitLayout.scale;
    
    updateCropEntry(selectedId, {
      detectionRegion: {
        x1: editor.crop.x / naturalW,
        y1: editor.crop.y / naturalH,
        x2: (editor.crop.x + editor.crop.w) / naturalW,
        y2: (editor.crop.y + editor.crop.h) / naturalH
      }
    });
    addToast('Region set for watermark detection', 'success');
    closeMenu();
  };

  const clearDetectionRegion = () => {
    if (!selectedId) return;
    updateCropEntry(selectedId, { detectionRegion: null });
    addToast('Detection region cleared', 'info');
    closeMenu();
  };

  return (
    <div
      className="inspector-crop-container"
      ref={containerRef}
      style={{ overflow: 'hidden', touchAction: 'none' }}
      onContextMenu={handleContextMenu}
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
        contentRect={
          shouldShowContentGuides
            ? {
                x: contentRect.x,
                y: contentRect.y,
                w: contentRect.width,
                h: contentRect.height,
              }
            : null
        }
        contentGuideStatus={shouldShowContentGuides ? contentGuideStatus : undefined}
      />

      {contextMenu && (
        <>
          <div 
            className="context-menu-backdrop" 
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              closeMenu();
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              closeMenu();
            }}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 999999,
              background: 'rgba(0,0,0,0.2)', 
              pointerEvents: 'auto'
            }}
          />
          <div
            className="premium-context-menu"
            style={{
              position: 'fixed',
              zIndex: 1000000,
              top: contextMenu.y,
              left: contextMenu.x,
              pointerEvents: 'auto'
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="menu-header">AI Detection</div>
            
            <button className="menu-item" onClick={(e) => { e.stopPropagation(); setAsDetectionRegion(); }}>
              <MonitorCheck size={16} className="menu-icon text-primary" />
              <div className="menu-text">
                <span className="menu-label">Set as Detection Region</span>
                <span className="menu-sub">Detect watermarks in this area</span>
              </div>
            </button>

            {(selectedId && cropData.get(selectedId)?.detectionRegion) && (
              <button className="menu-button-destructive clickable-row" onClick={(e) => { e.stopPropagation(); clearDetectionRegion(); }} style={{ 
                margin: '4px',
                padding: '8px 12px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                borderRadius: '8px',
                border: 'none',
                background: 'rgba(239, 68, 68, 0.1)',
                color: '#f87171',
                cursor: 'pointer',
                width: 'calc(100% - 8px)',
                textAlign: 'left'
              }}>
                <Trash2 size={16} />
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Unset Detection Region</span>
                  <span style={{ fontSize: '0.68rem', opacity: 0.7 }}>Reset to full image detection</span>
                </div>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default React.memo(InspectorPreview);
