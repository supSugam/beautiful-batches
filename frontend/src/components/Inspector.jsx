import React from 'react';
import { motion } from 'framer-motion';
import {
  MousePointer2,
  Square,
  RectangleVertical,
  Smartphone,
  RectangleHorizontal,
} from 'lucide-react';

import InspectorHeader from './Inspector/parts/InspectorHeader';
import InspectorPreview from './Inspector/parts/InspectorPreview';
import InspectorStats from './Inspector/parts/InspectorStats';
import SelectionControls from './Inspector/parts/SelectionControls';
import TransformControls from './Inspector/parts/TransformControls';
import ExportResizeSection from './Inspector/parts/ExportResizeSection';
import BulkApplySection from './Inspector/parts/BulkApplySection';
import DangerZone from './Inspector/parts/DangerZone';

import { useInspectorLogic } from './Inspector/hooks/useInspectorLogic';
import { useSidebarResize } from './Inspector/hooks/useSidebarResize';
import useStore from '../store/useStore';

import 'react-image-crop/dist/ReactCrop.css';
import './Inspector.css';

const ASPECT_PRESETS = [
  { label: 'Freeform', value: null, icon: MousePointer2 },
  { label: 'Square', value: 1, icon: Square },
  { label: '2:3', value: 2 / 3, icon: RectangleVertical },
  { label: '9:16', value: 9 / 16, icon: Smartphone },
  { label: '16:9', value: 16 / 9, icon: RectangleHorizontal },
];

export const Inspector = ({
  image,
  onCropChange,
  onClose,
  onDelete,
  onNext,
  onPrev,
  hasNext,
  hasPrev,
  onApplyTo,
  width: sidebarWidth,
  onResize,
}) => {
  const cropState = useStore((state) => state.cropData.get(image?.id));

  const logic = useInspectorLogic({
    image,
    cropState,
    onCropChange,
    onClose,
    onNext,
    onPrev,
    hasNext,
    hasPrev,
  });

  const { isResizing, startResizing } = useSidebarResize(onResize);

  if (!image) return null;

  return (
    <motion.div
      initial={{ x: '100%', opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '100%', opacity: 0 }}
      transition={{ type: 'spring', damping: 30, stiffness: 200 }}
      className={`inspector ${isResizing ? 'resizing' : ''} ${sidebarWidth > 750 ? 'inspector-dashboard' : ''}`}
      style={{ width: sidebarWidth }}
    >
      <div className="resizer-handle" onMouseDown={startResizing} />

      <InspectorHeader
        imageName={image.name}
        onClose={logic.handleClose}
        onPrev={logic.navigatePrev}
        onNext={logic.navigateNext}
        hasPrev={hasPrev}
        hasNext={hasNext}
      />

      <div className="inspector-scroll">
        <div className="inspector-preview-section">
          <InspectorPreview
            key={logic.cropperKey} // Hard reset by remounting wrapper? Or pass prop?
            // Actually better to pass prop to use on Cropper, but wrapper remount works too.
            // Let's pass it as a prop 'resetKey' inside to keep wrapper stable if possible,
            // or just use valid logic.cropperKey here if we want full freshstart.
            // If we remount InspectorPreview, we lose local ref? yes.
            // That's exactly what we want for a hard reset.
            isProcessing={logic.isProcessing}
            imageObjectUrl={image.objectUrl}
            onCropperInit={logic.onCropperInit}
            onCropperChange={logic.onCropperChange}
            aspect={logic.aspect}
          />

          <InspectorStats
            rotation={logic.rotation}
            naturalWidth={image.naturalWidth}
            naturalHeight={image.naturalHeight}
            outputWidth={logic.outputWidth}
            aspect={logic.aspect}
            currentPixelWidth={logic.currentPixelWidth}
            currentPixelHeight={logic.currentPixelHeight}
          />

          <div className="inspector-divider" />

          <SelectionControls
            aspect={logic.aspect}
            handleLockToggle={logic.handleLockToggle}
            manualW={logic.manualW}
            currentPixelWidth={logic.currentPixelWidth}
            handleSelectionDimChange={logic.handleSelectionDimChange}
            handleDimBlur={logic.handleDimBlur}
            manualH={logic.manualH}
            currentPixelHeight={logic.currentPixelHeight}
            aspectPresets={ASPECT_PRESETS}
            handleAspectClick={logic.handleAspectClick}
          />
        </div>

        <div className="inspector-controls">
          <TransformControls
            rotation={logic.rotation}
            handleRotate={logic.handleRotate}
            handleRotateDelta={logic.handleRotateDelta}
            handleRotateEnd={logic.handleRotateEnd}
            flip={logic.flip}
            handleFlip={logic.handleFlip}
            handleResetTransforms={logic.handleResetDraft}
          />

          <ExportResizeSection
            outputWidth={logic.outputWidth}
            handleResizeToggle={logic.handleResizeToggle}
            manualOutputWidth={logic.manualOutputWidth}
            handleOutputWidthChange={logic.handleOutputWidthChange}
            handleOutputWidthBlur={logic.handleOutputWidthBlur}
            aspect={logic.aspect}
            currentPixelWidth={logic.currentPixelWidth}
            currentPixelHeight={logic.currentPixelHeight}
          />

          <BulkApplySection onApplyTo={onApplyTo} />

          <div className="inspector-divider" />

          <DangerZone
            handleResetDraft={logic.handleResetDraft}
            handleDelete={() => {
              onDelete(image.id);
              onClose();
            }}
            imageName={image.name}
          />
        </div>
      </div>
    </motion.div>
  );
};

export default Inspector;
