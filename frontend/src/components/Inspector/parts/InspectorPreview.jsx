import React, { useRef, useEffect } from 'react';
import { Cropper, ImageRestriction } from 'react-advanced-cropper';
import {
  zoomStencil,
  fitStencilToImage,
  resizeCoordinates,
  transformImage,
  defaultSize as mobileDefaultSize,
  stencilConstraints,
} from 'advanced-cropper/showcase/mobile';
import 'react-advanced-cropper/dist/style.css';
import { Loader2 } from 'lucide-react';

const InspectorPreview = ({
  isProcessing,
  imageObjectUrl,
  onCropperInit, 
  onCropperChange,
  aspect,
}) => {
  const cropperRef = useRef(null);

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
        <Cropper
          ref={cropperRef}
          src={imageObjectUrl}
          className="custom-cropper-instance"
          stencilProps={{
            aspectRatio: aspect || undefined,
            grid: true,
          }}
          defaultSize={mobileDefaultSize}
          onChange={onCropperChange}
          onUpdate={onCropperChange}
          background={false}
          minZoom={0.5}
          maxZoom={10}
          imageRestriction={ImageRestriction.none}
          postProcess={[fitStencilToImage, zoomStencil]}
          transformImageAlgorithm={transformImage}
          resizeCoordinatesAlgorithm={resizeCoordinates}
          stencilConstraints={stencilConstraints}
          transitions={true}
          style={{ height: '100%', width: '100%' }}
        />
      )}
    </div>
  );
};
export default React.memo(InspectorPreview);
