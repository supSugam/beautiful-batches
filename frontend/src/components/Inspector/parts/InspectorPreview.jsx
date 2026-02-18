import React, { useCallback, useEffect, useRef } from 'react';
import { Cropper, ImageRestriction } from 'react-advanced-cropper';
import 'react-advanced-cropper/dist/style.css';
import { Loader2 } from 'lucide-react';

const InspectorPreview = ({
  isProcessing,
  imageObjectUrl,
  onCropperInit,
  onCropperReady,
  onCropperChange,
  aspect,
  centerGuide,
  onCropDragStart,
  onCropDragEnd,
}) => {
  const cropperRef = useRef(null);
  const containerRef = useRef(null);
  const refreshFrameRef = useRef(0);

  const resolveDragMode = (target) => {
    if (!(target instanceof Element)) return 'unknown';

    const resizeTarget = target.closest(
      '.advanced-cropper-handler-wrapper, .advanced-cropper-bounding-box__handler-wrapper, .advanced-cropper-line-wrapper, .advanced-cropper-bounding-box__line',
    );
    if (resizeTarget) return 'resize';

    const moveTarget = target.closest(
      '.advanced-cropper-rectangle-stencil__draggable-area, .advanced-cropper-circle-stencil__draggable-area, .advanced-cropper-rectangle-stencil--movable, .advanced-cropper-circle-stencil--movable, .advanced-cropper-bounding-box, .advanced-cropper-rectangle-stencil, .advanced-cropper-circle-stencil',
    );
    if (moveTarget) return 'move';

    return 'unknown';
  };

  useEffect(() => {
    if (onCropperInit && cropperRef.current) {
      onCropperInit(cropperRef.current);
    }
  }, [onCropperInit]);

  const scheduleRefresh = useCallback(() => {
    if (refreshFrameRef.current) {
      cancelAnimationFrame(refreshFrameRef.current);
    }
    refreshFrameRef.current = requestAnimationFrame(() => {
      refreshFrameRef.current = 0;
      const cropper = cropperRef.current;
      if (!cropper) return;
      cropper.refresh?.();
    });
  }, []);

  useEffect(() => {
    if (!containerRef.current) return undefined;

    if (typeof ResizeObserver === 'undefined') {
      const onResize = () => scheduleRefresh();
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }

    const observer = new ResizeObserver(() => scheduleRefresh());
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [scheduleRefresh]);

  useEffect(() => {
    scheduleRefresh();
  }, [imageObjectUrl, aspect, scheduleRefresh]);

  useEffect(
    () => () => {
      if (refreshFrameRef.current) {
        cancelAnimationFrame(refreshFrameRef.current);
        refreshFrameRef.current = 0;
      }
    },
    [],
  );

  // Default to full image cover
  const defaultSize = ({ imageSize, visibleArea }) => {
    return {
      width: (visibleArea || imageSize).width,
      height: (visibleArea || imageSize).height,
    };
  };

  return (
    <div
      ref={containerRef}
      className="inspector-crop-container"
      onPointerDownCapture={(event) =>
        onCropDragStart?.(resolveDragMode(event.target))
      }
      onPointerUpCapture={onCropDragEnd}
      onPointerCancelCapture={onCropDragEnd}
      style={{
        display: 'grid',
        placeItems: 'center',
        width: '100%',
        height: '100%',
        background: '#09090b',
        overflow: 'hidden',
      }}
    >
      {!imageObjectUrl ? (
        <Loader2 className="spin text-muted" size={32} />
      ) : (
        <>
          <Cropper
            ref={cropperRef}
            src={imageObjectUrl}
            className="custom-cropper-instance"
            stencilProps={{
              aspectRatio: aspect || undefined,
              grid: true,
            }}
            defaultSize={defaultSize}
            onChange={onCropperChange}
            onReady={onCropperReady}
            background={false}
            minZoom={0.5}
            maxZoom={10}
            imageRestriction={ImageRestriction.fitArea}
            transitions={false}
            priority="coordinates"
            style={{ height: '100%', width: '100%' }}
          />
          <div
            className={[
              'center-guide-line center-guide-line--vertical',
              centerGuide?.hintX || centerGuide?.snapX ? 'visible' : '',
              centerGuide?.snapX ? 'snapped' : '',
              centerGuide?.hintX && !centerGuide?.snapX ? 'hint' : '',
            ]
              .join(' ')
              .trim()}
          />
          <div
            className={[
              'center-guide-line center-guide-line--horizontal',
              centerGuide?.hintY || centerGuide?.snapY ? 'visible' : '',
              centerGuide?.snapY ? 'snapped' : '',
              centerGuide?.hintY && !centerGuide?.snapY ? 'hint' : '',
            ]
              .join(' ')
              .trim()}
          />
        </>
      )}
    </div>
  );
};
export default React.memo(InspectorPreview);
