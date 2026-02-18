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
import PaddingSection from './Inspector/parts/PaddingSection';
import CaptionSection from './Inspector/parts/CaptionSection';
import ExportResizeSection from './Inspector/parts/ExportResizeSection';
import BulkApplySection from './Inspector/parts/BulkApplySection';

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

const EMPTY_IMAGE = Object.freeze({
  id: '',
  name: '',
  objectUrl: '',
  naturalWidth: 1,
  naturalHeight: 1,
});

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
  const activeImage = image || EMPTY_IMAGE;
  const cropState = useStore((state) => state.cropData.get(activeImage.id));
  const ifFileExists = useStore((state) => state.ifFileExists);
  const setIfFileExists = useStore((state) => state.setIfFileExists);

  const logic = useInspectorLogic({
    image: activeImage,
    cropState,
    onCropChange,
    onClose,
    onNext,
    onPrev,
    hasNext,
    hasPrev,
  });

  const { isResizing, startResizing, viewportWidth, liveWidth } =
    useSidebarResize(sidebarWidth, onResize);
  const isSingleColumn = liveWidth <= viewportWidth * 0.5;

  if (!image) return null;

  return (
    <motion.div
      initial={{ x: '100%', opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '100%', opacity: 0 }}
      transition={{ type: 'tween', duration: 0.16, ease: 'easeOut' }}
      className={`inspector ${isResizing ? 'resizing' : ''} ${isSingleColumn ? '' : 'inspector-dashboard'}`}
      style={{ width: liveWidth }}
    >
      <div
        className="resizer-handle"
        role="separator"
        aria-orientation="vertical"
        title="Drag to resize settings panel"
        onPointerDown={startResizing}
      />

      <InspectorHeader
        imageName={image.name}
        onClose={logic.handleClose}
        onPrev={logic.navigatePrev}
        onNext={logic.navigateNext}
        onReset={() => {
          logic.handleResetDraft();
          if (!image?.id) return;
          useStore.getState().setCaptionForImage(image.id, '');
        }}
        onDelete={() => {
          onDelete(image.id);
          onClose();
        }}
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
            onCropperReady={logic.onCropperReady}
            onCropperChange={logic.onCropperChange}
            aspect={logic.aspect}
            centerGuide={logic.centerGuide}
            onCropDragStart={logic.handleCropDragStart}
            onCropDragEnd={logic.handleCropDragEnd}
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
            handleCenterCrop={logic.handleCenterCrop}
            centerStatus={logic.centerStatus}
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
          <section className="settings-section-card settings-section-card--transform">
            <TransformControls
              rotation={logic.rotation}
              handleRotate={logic.handleRotate}
              handleRotateDelta={logic.handleRotateDelta}
              handleRotateEnd={logic.handleRotateEnd}
              flip={logic.flip}
              handleFlip={logic.handleFlip}
              handleResetTransforms={logic.handleResetTransforms}
            />
          </section>

          <section className="settings-section-card settings-section-card--tweaks">
            <PaddingSection
              paddingInput={logic.paddingInput}
              paddingMode={logic.paddingMode}
              cornerRadiusInput={logic.cornerRadiusInput}
              paddingFillType={logic.paddingFillType}
              paddingFillValue={logic.paddingFillValue}
              paddingImageUrl={logic.paddingImageUrl}
              handlePaddingInputChange={logic.handlePaddingInputChange}
              handlePaddingInputBlur={logic.handlePaddingInputBlur}
              handlePaddingModeChange={logic.handlePaddingModeChange}
              handleCornerRadiusInputChange={
                logic.handleCornerRadiusInputChange
              }
              handleCornerRadiusInputBlur={logic.handleCornerRadiusInputBlur}
              handlePaddingFillTypeChange={logic.handlePaddingFillTypeChange}
              handlePaddingFillValueChange={logic.handlePaddingFillValueChange}
              handlePaddingImageFileChange={logic.handlePaddingImageFileChange}
            />
          </section>

          <section className="settings-section-card settings-section-card--caption">
            <CaptionSection imageId={image.id} />
          </section>

          <section className="settings-section-card settings-section-card--export">
            <h3 className="settings-card-title">Export</h3>
            <ExportResizeSection
              outputWidth={logic.outputWidth}
              handleResizeToggle={logic.handleResizeToggle}
              manualOutputWidth={logic.manualOutputWidth}
              handleOutputWidthChange={logic.handleOutputWidthChange}
              handleOutputWidthBlur={logic.handleOutputWidthBlur}
              aspect={logic.aspect}
              currentPixelWidth={logic.currentPixelWidth}
              currentPixelHeight={logic.currentPixelHeight}
              ifFileExists={ifFileExists}
              onIfFileExistsChange={setIfFileExists}
              showSectionLabel={false}
            />
            <BulkApplySection onApplyTo={onApplyTo} showSectionLabel={false} />
          </section>
        </div>
      </div>
    </motion.div>
  );
};

export default Inspector;
