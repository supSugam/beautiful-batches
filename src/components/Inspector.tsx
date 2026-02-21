import React, { useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
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
import type { CropEntry, GalleryImage } from '../types/app';


import './Inspector.css';

const ASPECT_PRESETS = [
  { label: 'Freeform', value: null, icon: MousePointer2 },
  { label: 'Square', value: 1, icon: Square },
  { label: '2:3', value: 2 / 3, icon: RectangleVertical },
  { label: '9:16', value: 9 / 16, icon: Smartphone },
  { label: '16:9', value: 16 / 9, icon: RectangleHorizontal },
];

type ApplyTargetType = 'all' | 'rest' | 'prev';
type ApplyOptions = { includeCaption?: boolean };

type InspectorProps = {
  image: GalleryImage | null;
  onCropChange: (id: string, coords: CropEntry) => void;
  onClose: () => void;
  onDelete: (id: string) => void;
  onNext: () => void;
  onPrev: () => void;
  hasNext: boolean;
  hasPrev: boolean;
  onApplyTo: (type: ApplyTargetType, options?: ApplyOptions) => void;
  width: number;
  onResize: (width: number) => void;
};

type InspectorSessionProps = {
  image: GalleryImage;
  onCropChange: (id: string, coords: CropEntry) => void;
  onClose: () => void;
  onDelete: (id: string) => void;
  onNext: () => void;
  onPrev: () => void;
  hasNext: boolean;
  hasPrev: boolean;
  onApplyTo: (type: ApplyTargetType, options?: ApplyOptions) => void;
};

const InspectorSession = ({
  image,
  onCropChange,
  onClose,
  onDelete,
  onNext,
  onPrev,
  hasNext,
  hasPrev,
  onApplyTo,
}: InspectorSessionProps) => {
  const cropState = useStore((state) => state.cropData.get(image.id));
  const normalizedImagePath = String(image?.absolutePath || '')
    .replace(/\\/g, '/')
    .trim();
  const canOpenImageInExplorer =
    normalizedImagePath.length > 0 &&
    typeof window !== 'undefined' &&
    '__TAURI_INTERNALS__' in window;

  const handleOpenImageInExplorer = useCallback(async () => {
    if (!canOpenImageInExplorer) return;
    try {
      await invoke('reveal_file_in_file_explorer', {
        filePath: normalizedImagePath,
      });
    } catch (error) {
      console.error('Failed to reveal image in file explorer:', error);
    }
  }, [canOpenImageInExplorer, normalizedImagePath]);

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

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      if (!element) return false;
      if (element.isContentEditable) return true;

      const tagName = String(element.tagName || '').toLowerCase();
      if (tagName === 'textarea' || tagName === 'select') return true;
      if (tagName === 'input') {
        const input = element as HTMLInputElement;
        const type = String(input.type || '').toLowerCase();
        return type !== 'checkbox' && type !== 'radio' && type !== 'button';
      }
      return false;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableTarget(event.target)) return;

      if (event.key === 'ArrowRight') {
        if (!hasNext) return;
        event.preventDefault();
        event.stopPropagation();
        logic.navigateNext();
        return;
      }

      if (event.key === 'ArrowLeft') {
        if (!hasPrev) return;
        event.preventDefault();
        event.stopPropagation();
        logic.navigatePrev();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [hasNext, hasPrev, logic.navigateNext, logic.navigatePrev]);

  return (
    <>
      <InspectorHeader
        imageName={image.name}
        onOpenImageInExplorer={handleOpenImageInExplorer}
        canOpenImageInExplorer={canOpenImageInExplorer}
        onClose={logic.handleClose}
        onPrev={logic.navigatePrev}
        onNext={logic.navigateNext}
        onReset={() => {
          logic.handleResetDraft();
          if (!image?.id) return;
          useStore.getState().resetCaptionForImage(image.id);
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
            isProcessing={logic.isProcessing}
            imageObjectUrl={image.objectUrl}
            editor={logic.editor}
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
              fineRotation={logic.fineRotation}
              handleRotate={logic.handleRotate}
              handleRotateDelta={logic.handleRotateDelta}
              handleRotateEnd={logic.handleRotateEnd}
              flip={logic.flip}
              handleFlip={logic.handleFlip}
              handleFillZoom={logic.handleFillZoom}
              handleResetTransforms={logic.handleResetTransforms}
            />
          </section>

          <section className="settings-section-card settings-section-card--tweaks">
            <PaddingSection
              paddingInput={logic.paddingInput}
              cornerRadiusInput={logic.cornerRadiusInput}
              paddingFillType={logic.paddingFillType}
              paddingFillValue={logic.paddingFillValue}
              paddingImageUrl={logic.paddingImageUrl}
              handlePaddingInputChange={logic.handlePaddingInputChange}
              handlePaddingInputBlur={logic.handlePaddingInputBlur}
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
            <CaptionSection
              imageId={image.id}
              imageName={image.name}
              imageAbsolutePath={image.absolutePath}
            />
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
              clearImageMetadata={logic.clearImageMetadata}
              onClearImageMetadataChange={logic.handleClearImageMetadataChange}
              showSectionLabel={false}
            />
            <BulkApplySection
              onApplyTo={(target, options) => {
                logic.editor.commitChangeNow();
                onApplyTo(target, options);
              }}
              showSectionLabel={false}
            />
          </section>
        </div>
      </div>
    </>
  );
};

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
}: InspectorProps) => {
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

      <InspectorSession
        key={image.id}
        image={image}
        onCropChange={onCropChange}
        onClose={onClose}
        onDelete={onDelete}
        onNext={onNext}
        onPrev={onPrev}
        hasNext={hasNext}
        hasPrev={hasPrev}
        onApplyTo={onApplyTo}
      />
    </motion.div>
  );
};

export default Inspector;
