import React, { useCallback, useEffect, useState } from 'react';
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
import InspectorStaticPreview from './Inspector/parts/InspectorStaticPreview';
import InspectorStats from './Inspector/parts/InspectorStats';
import InspectorMetadataView from './Inspector/parts/InspectorMetadataView';
import SelectionControls from './Inspector/parts/SelectionControls';
import TransformControls from './Inspector/parts/TransformControls';
import PaddingSection from './Inspector/parts/PaddingSection';
import CaptionSection from './Inspector/parts/CaptionSection';
import ExportResizeSection from './Inspector/parts/ExportResizeSection';
import BulkApplySection from './Inspector/parts/BulkApplySection';
import SourceEditSection from './Inspector/parts/SourceEditSection';

import { useInspectorLogic } from './Inspector/hooks/useInspectorLogic';
import { useSidebarResize } from './Inspector/hooks/useSidebarResize';
import useStore from '../store/useStore';
import type { ApplyCropToImagesOptions, CropEntry, GalleryImage, InspectorMode, WatermarkSidecarStatus } from '../types/app';


import './Inspector.css';

const ASPECT_PRESETS = [
  { label: 'Freeform', value: null, icon: MousePointer2 },
  { label: 'Square', value: 1, icon: Square },
  { label: '2:3', value: 2 / 3, icon: RectangleVertical },
  { label: '9:16', value: 9 / 16, icon: Smartphone },
  { label: '16:9', value: 16 / 9, icon: RectangleHorizontal },
];

type ApplyTargetType = 'all' | 'rest' | 'prev';

type InspectorProps = {
  image: GalleryImage | null;
  onCropChange: (id: string, coords: CropEntry) => void;
  onClose: () => void;
  onDelete: (id: string) => void;
  onNext: () => void;
  onPrev: () => void;
  hasNext: boolean;
  hasPrev: boolean;
  onApplyTo: (type: ApplyTargetType, options?: ApplyCropToImagesOptions) => void;
  width: number;
  onResize: (width: number) => void;
  mode: InspectorMode;
  isSingleEditMode?: boolean;
};

type InspectorEditSessionProps = {
  image: GalleryImage;
  onCropChange: (id: string, coords: CropEntry) => void;
  onClose: () => void;
  onDelete: (id: string) => void;
  onNext: () => void;
  onPrev: () => void;
  hasNext: boolean;
  hasPrev: boolean;
  onApplyTo: (type: ApplyTargetType, options?: ApplyCropToImagesOptions) => void;
  isSingleEditMode?: boolean;
};

const InspectorEditSession = ({
  image,
  onCropChange,
  onClose,
  onDelete,
  onNext,
  onPrev,
  hasNext,
  hasPrev,
  onApplyTo,
  isSingleEditMode = false,
}: InspectorEditSessionProps) => {
  const [sidecarStatus, setSidecarStatus] = useState<WatermarkSidecarStatus | null>(null);
  
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const status = await invoke<WatermarkSidecarStatus>('get_watermark_sidecar_status');
        setSidecarStatus(status);
      } catch (e) {
        console.error('Failed to fetch sidecar status:', e);
      }
    };
    void fetchStatus();
  }, []);

  const cropState = useStore((state) => state.cropData.get(image.id));
  const sourceEditOps = Array.isArray(cropState?.sourceEditOps)
    ? cropState?.sourceEditOps
    : [];
  const hasLegacySourceEdits =
    (cropState?.sourceEditHistoryIndex ?? -1) >= 0 ||
    (Array.isArray(cropState?.sourceEditHistory)
      ? cropState.sourceEditHistory.length > 0
      : false);
  const canIncludeWatermarkRemoval =
    sourceEditOps.includes('watermark') ||
    (hasLegacySourceEdits && sourceEditOps.length === 0);
  const canIncludeBackgroundRemoval =
    sourceEditOps.includes('background') ||
    (hasLegacySourceEdits && sourceEditOps.length === 0);
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
        mode="edit"
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
            imageObjectUrl={logic.activeImageObjectUrl || image.objectUrl}
            editor={logic.editor}
            paddingPx={logic.paddingPx}
            cornerRadius={logic.cornerRadiusInput}
            paddingFillType={logic.paddingFillType}
            paddingFillValue={logic.paddingFillValue}
            paddingImageUrl={logic.paddingImageUrl}
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
          <section className="settings-section-card settings-section-card--source-edit">
            <SourceEditSection
              onRemoveWatermarks={logic.handleRemoveWatermarks}
              onRemoveBackground={logic.handleRemoveBackground}
              onUndo={logic.undoSourceEdit}
              onRedo={logic.redoSourceEdit}
              onReset={logic.resetSourceEdit}
              canUndo={logic.canUndo}
              canRedo={logic.canRedo}
              canReset={logic.canReset}
              isProcessing={logic.isProcessing}
              isRemovingWatermark={logic.isRemovingWatermark}
              isRemovingBackground={logic.isRemovingBackground}
              isWatermarkReady={Boolean(sidecarStatus?.dependenciesInstalled)}
            />
          </section>

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
              paddingPx={logic.paddingPx}
              paddingMaxPx={logic.paddingMaxPx}
              cornerRadiusInput={logic.cornerRadiusInput}
              paddingFillType={logic.paddingFillType}
              paddingFillValue={logic.paddingFillValue}
              paddingImageUrl={logic.paddingImageUrl}
              handlePaddingPxChange={logic.handlePaddingPxChange}
              handlePaddingInputBlur={logic.handlePaddingInputBlur}
              handleCornerRadiusInputChange={
                logic.handleCornerRadiusInputChange
              }
              handleCornerRadiusInputBlur={logic.handleCornerRadiusInputBlur}
              handlePaddingFillTypeChange={logic.handlePaddingFillTypeChange}
              handlePaddingFillValueChange={logic.handlePaddingFillValueChange}
              handlePaddingImageFileChange={logic.handlePaddingImageFileChange}
              handleResetTweaks={logic.handleResetTweaks}
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
              showSectionLabel={false}
            />
            {!isSingleEditMode && (
              <BulkApplySection
                onApplyTo={(target, options) => {
                  logic.editor.commitChangeNow();
                  onApplyTo(target, options);
                }}
                showSectionLabel={false}
                canIncludeWatermarkRemoval={canIncludeWatermarkRemoval}
                canIncludeBackgroundRemoval={canIncludeBackgroundRemoval}
              />
            )}
          </section>
        </div>
      </div>
    </>
  );
};

type InspectorViewSessionProps = {
  image: GalleryImage;
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
  hasNext: boolean;
  hasPrev: boolean;
};

const InspectorViewSession = ({
  image,
  onClose,
  onNext,
  onPrev,
  hasNext,
  hasPrev,
}: InspectorViewSessionProps) => {
  const cropState = useStore((state) => state.cropData.get(image.id));
  const logic = useInspectorLogic({
    image,
    cropState,
    onClose,
    onNext,
    onPrev,
    hasNext,
    hasPrev,
  });

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
        mode="view"
        imageName={image.name}
        onOpenImageInExplorer={handleOpenImageInExplorer}
        canOpenImageInExplorer={canOpenImageInExplorer}
        onClose={logic.handleClose}
        onPrev={logic.navigatePrev}
        onNext={logic.navigateNext}
        hasPrev={hasPrev}
        hasNext={hasNext}
      />

      <div className="inspector-scroll">
        <div className="inspector-view-layout">
          <section className="inspector-view-preview-card">
            <div className="inspector-view-preview-host">
              <InspectorStaticPreview
                isProcessing={logic.isProcessing}
                imageObjectUrl={logic.activeImageObjectUrl || image.objectUrl}
                editor={logic.editor}
                paddingPx={logic.paddingPx}
                cornerRadius={logic.cornerRadiusInput}
                paddingFillType={logic.paddingFillType}
                paddingFillValue={logic.paddingFillValue}
                paddingImageUrl={logic.paddingImageUrl}
              />
            </div>
          </section>
          <InspectorMetadataView image={image} />
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
  mode,
  isSingleEditMode = false,
}: InspectorProps) => {
  const { isResizing, startResizing, viewportWidth, liveWidth } =
    useSidebarResize(sidebarWidth, onResize);
  const isDashboard = mode === 'edit' && liveWidth > viewportWidth * 0.5;
  const isWideViewMode = mode === 'view' && liveWidth >= 860;

  if (!image) return null;

  return (
    <motion.div
      initial={{ x: '100%', opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '100%', opacity: 0 }}
      transition={{ type: 'tween', duration: 0.16, ease: 'easeOut' }}
      className={`inspector ${isResizing ? 'resizing' : ''} ${isDashboard ? 'inspector-dashboard' : ''} ${mode === 'view' ? 'inspector-view-mode' : ''} ${isWideViewMode ? 'inspector-view-wide' : ''}`}
      style={{ width: liveWidth }}
    >
      <div
        className="resizer-handle"
        role="separator"
        aria-orientation="vertical"
        title="Drag to resize inspector"
        onPointerDown={startResizing}
      />

      {mode === 'view' ? (
        <InspectorViewSession
          key={image.id}
          image={image}
          onClose={onClose}
          onNext={onNext}
          onPrev={onPrev}
          hasNext={hasNext}
          hasPrev={hasPrev}
        />
      ) : (
        <InspectorEditSession
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
          isSingleEditMode={isSingleEditMode}
        />
      )}
    </motion.div>
  );
};

export default Inspector;
