import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useImageEditor } from './useImageEditor';
import type {
  CropEntry,
  PaddingFillType,
} from '../../../types/app';
import { invoke } from '@tauri-apps/api/core';
import useStore from '../../../store/useStore';
import { getEvenPaddingCap, normalizePaddingInput } from '../../../utils/boxValues';

type InspectorLogicImage = {
  id: string;
  naturalWidth: number;
  naturalHeight: number;
  absolutePath?: string;
  objectUrl: string;
};

type UseInspectorLogicArgs = {
  image: InspectorLogicImage;
  cropState?: CropEntry;
  onCropChange?: (imageId: string, nextState: CropEntry) => void;
  onClose?: () => void;
  onNext?: () => void;
  onPrev?: () => void;
  hasNext: boolean;
  hasPrev: boolean;
};

const normalizeToSignedRotation = (rotation: number) => {
  const normalized = ((Number(rotation) % 360) + 360) % 360;
  return normalized > 180 ? normalized - 360 : normalized;
};

const getRotationAnchor = (signedRotation: number) => {
  let anchor = Math.trunc(signedRotation / 90) * 90;
  const fine = signedRotation - anchor;
  if (fine > 45) anchor += 90;
  if (fine < -45) anchor -= 90;
  return anchor;
};

const getFineRotation = (rotation: number) => {
  const signed = normalizeToSignedRotation(rotation);
  return signed - getRotationAnchor(signed);
};

const parseEvenPaddingPx = (value: unknown): number => {
  if (typeof value === 'string') {
    const match = value.match(/-?\d+(?:\.\d+)?/);
    if (match?.[0]) {
      const numeric = Number.parseFloat(match[0]);
      return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : 0;
    }
    return 0;
  }

  if (value && typeof value === 'object') {
    const normalized = normalizePaddingInput(value as never);
    const even = Math.max(
      normalized.top,
      normalized.right,
      normalized.bottom,
      normalized.left,
    );
    return Math.max(0, Math.round(Number(even) || 0));
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.round(numeric));
};

/**
 * useInspectorLogic — bridges useImageEditor with the Inspector UI and Zustand store.
 *
 * Exposes every property that Inspector.jsx's sub-components need.
 */
export function useInspectorLogic({
  image,
  cropState,
  onCropChange,
  onClose,
  onNext,
  onPrev,
  hasNext,
  hasPrev,
}: UseInspectorLogicArgs) {
  const setLastUsedHardware = useStore((state) => state.setLastUsedHardware);
  const imageId = image?.id || '';
  const naturalWidth = image?.naturalWidth || 1;
  const naturalHeight = image?.naturalHeight || 1;
  // Keep a ref to current cropState to merge non-editor fields
  const cropStateRef = useRef<CropEntry | undefined>(cropState);
  cropStateRef.current = cropState;

  // ── Build initial state from cropState ──────────────────
  const initialState = useMemo(() => {
    if (!cropState) return undefined;
    return {
      coordinates: cropState.coordinates || null,
      transforms: cropState.transforms || {
        rotate: 0,
        flip: { horizontal: false, vertical: false },
      },
      aspect: cropState.aspect ?? null,
      editorView: cropState.editorView || null,
    };
  }, [cropState, imageId]);

  // Padding is now a single even value (all sides). We must initialize it before passing it into useImageEditor.
  const [paddingPx, setPaddingPx] = useState(() =>
    parseEvenPaddingPx(cropState?.padding),
  );

  // ── Editor engine ───────────────────────────────────────
  const editor = useImageEditor({
    imageId,
    naturalWidth,
    naturalHeight,
    initialState,
    paddingPx,
    onChange: useCallback(
      (state) => {
        if (!imageId) return;
        // Merge editor state with existing cropState for non-editor fields
        onCropChange?.(imageId, {
          ...cropStateRef.current,
          coordinates: state.coordinates,
          transforms: state.transforms,
          aspect: state.aspect,
          editorView: state.editorView,
        });
      },
      [imageId, onCropChange],
    ),
  });

  // ── Derived pixel dimensions ────────────────────────────
  const currentPixelWidth = Math.round(editor.effectiveCrop.w);
  const currentPixelHeight = Math.round(editor.effectiveCrop.h);

  // ── Manual dimension input state ────────────────────────
  const [manualW, setManualW] = useState('');
  const [manualH, setManualH] = useState('');

  const handleSelectionDimChange = useCallback(
    (dim: 'w' | 'h', value: string) => {
      const numValue = parseInt(value, 10);
      if (dim === 'w') {
        setManualW(value);
        if (Number.isFinite(numValue) && numValue > 0) {
          const newH = editor.aspect
            ? Math.round(numValue / editor.aspect)
            : currentPixelHeight;
          editor.setCropDimensions(numValue, newH);
        }
      } else {
        setManualH(value);
        if (Number.isFinite(numValue) && numValue > 0) {
          const newW = editor.aspect
            ? Math.round(numValue * editor.aspect)
            : currentPixelWidth;
          editor.setCropDimensions(newW, numValue);
        }
      }
    },
    [editor, currentPixelWidth, currentPixelHeight],
  );

  const handleDimBlur = useCallback((_dim?: 'w' | 'h') => {
    setManualW('');
    setManualH('');
  }, []);

  // ── Aspect ratio handling ───────────────────────────────
  const handleAspectClick = useCallback(
    (value: number | null) => {
      if (value === editor.aspect) {
        // Clicking same aspect — reset crop to full image
        editor.resetCrop();
      } else {
        editor.setAspect(value);
      }
    },
    [editor],
  );

  const handleLockToggle = useCallback(() => {
    if (editor.aspect) {
      editor.setAspect(null);
    } else {
      const ratio = currentPixelWidth / currentPixelHeight;
      editor.setAspect(ratio);
    }
  }, [editor, currentPixelWidth, currentPixelHeight]);

  // ── Center crop ─────────────────────────────────────────
  const handleCenterCrop = useCallback(() => {
    editor.centerCrop();
  }, [editor]);

  // ── Rotation ────────────────────────────────────────────
  const fineRotation = useMemo(() => {
    return getFineRotation(editor.rotation);
  }, [editor.rotation]);

  const handleRotate = useCallback(
    (delta: number) => {
      editor.rotateBy(delta);
    },
    [editor],
  );

  const handleRotateDelta = useCallback(
    (delta: number) => {
      editor.setRotationDelta(delta);
    },
    [editor],
  );

  const handleRotateEnd = useCallback(() => {
    // Fine rotation ended — no-op currently
  }, []);

  // ── Flip ────────────────────────────────────────────────
  const handleFlip = useCallback(
    (axis: 'horizontal' | 'vertical') => {
      if (axis === 'horizontal') {
        editor.flipHorizontal();
      } else {
        editor.flipVertical();
      }
    },
    [editor],
  );

  const handleFillZoom = useCallback(() => {
    editor.fillToAvoidBlanks();
  }, [editor]);

  // ── Reset transforms ───────────────────────────────────
  const handleResetTransforms = useCallback(() => {
    editor.resetTransforms();
  }, [editor]);

  // ── Source Edit History ────────────────────────────────
  // Keeps track of processed versions of the source image.
  // Original is at index -1, processed versions in the array.
  const [processedHistory, setProcessedHistory] = useState<string[]>(
    () => cropState?.sourceEditHistory || [],
  );
  const [historyIndex, setHistoryIndex] = useState(
    () => cropState?.sourceEditHistoryIndex ?? -1,
  );
  const [processedOps, setProcessedOps] = useState<Array<'watermark' | 'background'>>(
    () => (cropState?.sourceEditOps || []) as Array<'watermark' | 'background'>,
  );
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRemovingWatermark, setIsRemovingWatermark] = useState(false);
  const [isRemovingBackground, setIsRemovingBackground] = useState(false);

  // When switching images, hydrate local history state from the stored crop entry.
  useEffect(() => {
    setProcessedHistory(cropState?.sourceEditHistory || []);
    setHistoryIndex(cropState?.sourceEditHistoryIndex ?? -1);
    setProcessedOps(
      (cropState?.sourceEditOps || []) as Array<'watermark' | 'background'>,
    );
  }, [imageId]);

  // Clean up Object URLs when component unmounts or image changes
  useEffect(() => {
    return () => {
      processedHistory.forEach((url) => {
        if (url.startsWith('blob:')) URL.revokeObjectURL(url);
      });
    };
  }, [imageId]); // Intentionally not including processedHistory since we only want to cleanup when image changes or unmounts

  // Sync to store when history changes (if they don't match initialize ref)
  useEffect(() => {
    if (!imageId) return;
    if (
      cropStateRef.current?.sourceEditHistoryIndex !== historyIndex ||
      cropStateRef.current?.sourceEditHistory !== processedHistory ||
      cropStateRef.current?.sourceEditOps !== processedOps
    ) {
      onCropChange?.(imageId, {
        ...cropStateRef.current,
        sourceEditHistory: processedHistory,
        sourceEditHistoryIndex: historyIndex,
        sourceEditOps: processedOps,
      });
    }
  }, [processedHistory, processedOps, historyIndex, imageId, onCropChange]);

  const activeImageObjectUrl = useMemo(() => {
    if (historyIndex === -1) return image?.objectUrl;
    return processedHistory[historyIndex];
  }, [image?.objectUrl, processedHistory, historyIndex]);

  const canUndo = historyIndex > -1;
  const canRedo = historyIndex < processedHistory.length - 1;

  const handleRemoveBackground = useCallback(async () => {
    console.log('handleRemoveBackground triggered', { imageId, absolutePath: image.absolutePath });
    if (!imageId || !image.absolutePath) {
      console.warn('Missing imageId or absolutePath');
      return;
    }
    setIsRemovingBackground(true);
    try {
      console.log('Invoking remove_background_single...');
      const result = await invoke<{ imageBase64: string; deviceUsed?: string }>('remove_background_single', {
        imagePath: image.absolutePath,
      });
      console.log('Background removal result received, updating history. Hardware used:', result.deviceUsed);
      if (result.deviceUsed) setLastUsedHardware(result.deviceUsed);
      setProcessedHistory((prev) => [...prev, result.imageBase64]);
      setProcessedOps((prev) => [...prev, 'background']);
      setHistoryIndex((prev) => prev + 1);
    } catch (error) {
      console.error('Background removal failed:', error);
      alert(`Background removal failed: ${error}`);
    } finally {
      setIsRemovingBackground(false);
    }
  }, [imageId, image.absolutePath]);

  const undoSourceEdit = useCallback(() => {
    if (canUndo) {
      setHistoryIndex((prev) => prev - 1);
    }
  }, [canUndo]);

  const redoSourceEdit = useCallback(() => {
    if (canRedo) {
      setHistoryIndex((prev) => prev + 1);
    }
  }, [canRedo]);

  const resetSourceEdit = useCallback(() => {
    if (historyIndex > -1 || processedHistory.length > 0) {
      setHistoryIndex(-1);
      setProcessedHistory([]);
      setProcessedOps([]);
    }
  }, [historyIndex, processedHistory]);

  const canReset = historyIndex > -1 || processedHistory.length > 0;

  const handleRemoveWatermarks = useCallback(async () => {
    console.log('handleRemoveWatermarks triggered', { imageId, absolutePath: image.absolutePath });
    if (!imageId || !image.absolutePath) {
      console.warn('Missing imageId or absolutePath');
      return;
    }
    setIsRemovingWatermark(true);
    try {
      console.log('Invoking remove_watermark_single...');
      const result = await invoke<{ imageBase64: string; deviceUsed?: string }>('remove_watermark_single', {
        imagePath: image.absolutePath,
        maxBboxPercent: 10.0,
      });
      console.log('Result received, updating history. Hardware used:', result.deviceUsed);
      if (result.deviceUsed) setLastUsedHardware(result.deviceUsed);
      // Add to history
      setProcessedHistory((prev) => [...prev, result.imageBase64]);
      setProcessedOps((prev) => [...prev, 'watermark']);
      setHistoryIndex((prev) => prev + 1);
    } catch (error) {
      console.error('Watermark removal failed:', error);
      alert(`Watermark removal failed: ${error}`);
    } finally {
      setIsRemovingWatermark(false);
    }
  }, [imageId, image.absolutePath]);

  // ── Reset draft (full reset) ────────────────────────────
  const handleResetDraft = useCallback(() => {
    editor.resetAll();
    setManualW('');
    setManualH('');
    setPaddingPx(0);
    setCornerRadiusInput('');
    setPaddingFillType('empty');
    setPaddingFillValue('');
    setPaddingImageUrl(null);
    // Reset non-editor crop state fields
    if (imageId) {
      onCropChange?.(imageId, {
        coordinates: null,
        transforms: { rotate: 0, flip: { horizontal: false, vertical: false } },
        aspect: null,
        outputWidth: null,
        padding: '0',
        cornerRadius: '',
        paddingFillType: 'empty',
        paddingFillValue: '',
        paddingImageUrl: null,
      });
    }
  }, [editor, imageId, onCropChange]);

  // ── Output width (resize on export) ─────────────────────
  const [outputWidth, setOutputWidth] = useState(
    cropState?.outputWidth ?? null,
  );
  const [manualOutputWidth, setManualOutputWidth] = useState('');

  useEffect(() => {
    setOutputWidth(cropState?.outputWidth ?? null);
  }, [cropState?.outputWidth, imageId]);

  const handleResizeToggle = useCallback(() => {
    const nextValue = outputWidth ? null : currentPixelWidth;
    setOutputWidth(nextValue);
    setManualOutputWidth('');
    if (imageId) {
      onCropChange?.(imageId, {
        ...cropStateRef.current,
        outputWidth: nextValue,
      });
    }
  }, [outputWidth, currentPixelWidth, imageId, onCropChange]);

  const handleOutputWidthChange = useCallback(
    (value: string) => {
      setManualOutputWidth(value);
      const numValue = parseInt(value, 10);
      if (Number.isFinite(numValue) && numValue > 0) {
        setOutputWidth(numValue);
        if (imageId) {
          onCropChange?.(imageId, {
            ...cropStateRef.current,
            outputWidth: numValue,
          });
        }
      }
    },
    [imageId, onCropChange],
  );

  const handleOutputWidthBlur = useCallback(() => {
    setManualOutputWidth('');
  }, []);

  // ── Padding & Corner Radius (string format: "T R B L") ──
  // Padding is now a single even value (all sides); corner radius stays per-corner.
  const [cornerRadiusInput, setCornerRadiusInput] = useState(() =>
    typeof cropState?.cornerRadius === 'string' ? cropState.cornerRadius : '',
  );
  const [paddingFillType, setPaddingFillType] = useState(
    () => (cropState?.paddingFillType || 'empty') as PaddingFillType,
  );
  const [paddingFillValue, setPaddingFillValue] = useState(
    () => cropState?.paddingFillValue || '',
  );
  const [paddingImageUrl, setPaddingImageUrl] = useState(
    () => cropState?.paddingImageUrl || null,
  );

  useEffect(() => {
    setPaddingPx(parseEvenPaddingPx(cropState?.padding));
    setCornerRadiusInput(
      typeof cropState?.cornerRadius === 'string' ? cropState.cornerRadius : '',
    );
    setPaddingFillType(
      (cropState?.paddingFillType || 'empty') as PaddingFillType,
    );
    setPaddingFillValue(cropState?.paddingFillValue || '');
    setPaddingImageUrl(cropState?.paddingImageUrl || null);
  }, [
    cropState?.cornerRadius,
    cropState?.padding,
    cropState?.paddingFillType,
    cropState?.paddingFillValue,
    cropState?.paddingImageUrl,
    imageId,
  ]);

  const syncToStoreImmediate = useCallback(
    (partialUpdate: Partial<CropEntry>) => {
      if (!imageId) return;
      onCropChange?.(imageId, {
        ...cropStateRef.current,
        ...partialUpdate,
      });
    },
    [imageId, onCropChange],
  );

  // Coalesce rapid UI tweaks updates (arrow keys / slider drags) into 1 store write per frame.
  const pendingUiUpdateRef = useRef<Partial<CropEntry> | null>(null);
  const pendingUiUpdateRafRef = useRef<number | null>(null);

  const flushPendingUiUpdate = useCallback(() => {
    if (pendingUiUpdateRafRef.current) {
      window.cancelAnimationFrame(pendingUiUpdateRafRef.current);
      pendingUiUpdateRafRef.current = null;
    }
    const pending = pendingUiUpdateRef.current;
    pendingUiUpdateRef.current = null;
    if (!pending) return;
    syncToStoreImmediate(pending);
  }, [syncToStoreImmediate]);

  const handleResetTweaks = useCallback(() => {
    setPaddingPx(0);
    setCornerRadiusInput('');
    setPaddingFillType('empty');
    setPaddingFillValue('');
    setPaddingImageUrl(null);
    flushPendingUiUpdate();
    syncToStoreImmediate({
      padding: '0',
      cornerRadius: '',
      paddingFillType: 'empty',
      paddingFillValue: '',
      paddingImageUrl: null,
    });
  }, [flushPendingUiUpdate, syncToStoreImmediate]);

  const scheduleUiUpdate = useCallback(
    (partialUpdate: Partial<CropEntry>) => {
      if (!imageId) return;
      pendingUiUpdateRef.current = {
        ...(pendingUiUpdateRef.current || {}),
        ...partialUpdate,
      };
      if (pendingUiUpdateRafRef.current) return;
      pendingUiUpdateRafRef.current = window.requestAnimationFrame(() => {
        pendingUiUpdateRafRef.current = null;
        flushPendingUiUpdate();
      });
    },
    [flushPendingUiUpdate, imageId],
  );

  useEffect(() => {
    return () => {
      flushPendingUiUpdate();
    };
  }, [flushPendingUiUpdate]);

  const paddingMaxPx = useMemo(() => {
    return getEvenPaddingCap(editor.effectiveWidth, editor.effectiveHeight);
  }, [editor.effectiveWidth, editor.effectiveHeight]);

  const handlePaddingPxChange = useCallback(
    (value: number) => {
      const safe = Math.max(0, Math.min(paddingMaxPx, Math.round(Number(value) || 0)));
      setPaddingPx(safe);
      scheduleUiUpdate({ padding: String(safe) });
    },
    [paddingMaxPx, scheduleUiUpdate],
  );

  const handlePaddingInputBlur = useCallback(() => {
    flushPendingUiUpdate();
  }, [flushPendingUiUpdate]);

  // cornerRadiusInput is a string
  const handleCornerRadiusInputChange = useCallback(
    (value: string) => {
      setCornerRadiusInput(value);
      scheduleUiUpdate({ cornerRadius: value });
    },
    [scheduleUiUpdate],
  );

  const handleCornerRadiusInputBlur = useCallback(() => {
    flushPendingUiUpdate();
  }, [flushPendingUiUpdate]);

  const handlePaddingFillTypeChange = useCallback(
    (type: PaddingFillType) => {
      setPaddingFillType(type);
      syncToStoreImmediate({ paddingFillType: type });
    },
    [syncToStoreImmediate],
  );

  const handlePaddingFillValueChange = useCallback(
    (value: string) => {
      setPaddingFillValue(value);
      syncToStoreImmediate({ paddingFillValue: value });
    },
    [syncToStoreImmediate],
  );

  const handlePaddingImageFileChange = useCallback(
    (file: File | null) => {
      if (!file) {
        setPaddingImageUrl(null);
        syncToStoreImmediate({ paddingImageUrl: null });
        return;
      }
      const url = URL.createObjectURL(file);
      setPaddingImageUrl(url);
      setPaddingFillType('image');
      syncToStoreImmediate({ paddingFillType: 'image', paddingImageUrl: url });
    },
    [syncToStoreImmediate],
  );

  // ── Navigation ──────────────────────────────────────────
  const navigateNext = useCallback(() => {
    if (!hasNext) return;
    editor.commitChangeNow();
    onNext?.();
  }, [editor, hasNext, onNext]);

  const navigatePrev = useCallback(() => {
    if (!hasPrev) return;
    editor.commitChangeNow();
    onPrev?.();
  }, [editor, hasPrev, onPrev]);

  const handleClose = useCallback(() => {
    editor.commitChangeNow();
    onClose?.();
  }, [editor, onClose]);


  // ── Return everything Inspector needs ───────────────────
  return {
    editor,
    isProcessing,
    isRemovingWatermark,
    isRemovingBackground,

    // Crop state
    aspect: editor.aspect,
    currentPixelWidth,
    currentPixelHeight,
    manualW,
    manualH,
    handleSelectionDimChange,
    handleDimBlur,
    handleAspectClick,
    handleLockToggle,
    centerStatus: editor.centerStatus,
    handleCenterCrop,

    // Rotation & flip
    rotation: editor.rotation,
    fineRotation,
    flip: { horizontal: editor.flipH, vertical: editor.flipV },
    handleRotate,
    handleRotateDelta,
    handleRotateEnd,
    handleFlip,
    handleFillZoom,
    handleResetTransforms,

    // Padding
    paddingPx,
    paddingMaxPx,
    cornerRadiusInput,
    paddingFillType,
    paddingFillValue,
    paddingImageUrl,
    handlePaddingPxChange,
    handlePaddingInputBlur,
    handleCornerRadiusInputChange,
    handleCornerRadiusInputBlur,
    handlePaddingFillTypeChange,
    handlePaddingFillValueChange,
    handlePaddingImageFileChange,
    handleResetTweaks,

    // Output width
    outputWidth,
    manualOutputWidth,
    handleResizeToggle,
    handleOutputWidthChange,
    handleOutputWidthBlur,

    // Navigation & actions
    navigateNext,
    navigatePrev,
    handleClose,
    handleResetDraft,

    // Source Edit History
    activeImageObjectUrl,
    canUndo,
    canRedo,
    undoSourceEdit,
    redoSourceEdit,
    resetSourceEdit,
    canReset,

    // AI Processing
    handleRemoveWatermarks,
    handleRemoveBackground,
  };
}

export default useInspectorLogic;
