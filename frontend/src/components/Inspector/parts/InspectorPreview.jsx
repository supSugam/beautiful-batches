import React, { useRef, useEffect } from 'react';
import { Cropper, ImageRestriction } from 'react-advanced-cropper';
import 'react-advanced-cropper/dist/style.css';
import { Loader2 } from 'lucide-react';
import { fitStencilToImage } from 'advanced-cropper/showcase/mobile';

const InspectorPreview = ({
  isProcessing,
  imageObjectUrl,
  onCropperInit,
  onCropperChange,
  aspect,
  centerGuide,
  onCropDragStart,
  onCropDragEnd,
}) => {
  const cropperRef = useRef(null);

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

  // Default to full image cover
  const defaultSize = ({ imageSize, visibleArea }) => {
    return {
      width: (visibleArea || imageSize).width,
      height: (visibleArea || imageSize).height,
    };
  };

  return (
    <div
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
            onUpdate={onCropperChange}
            background={false}
            minZoom={0.5}
            maxZoom={10}
            imageRestriction={ImageRestriction.fitArea}
            postProcess={[fitStencilToImage]}
            transitions={true}
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
