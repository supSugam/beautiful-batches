import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useImageEditor } from './useImageEditor';
import type {
  CropEntry,
  PaddingFillType,
  PaddingMode,
} from '../../../types/app';

type InspectorLogicImage = {
  id: string;
  naturalWidth: number;
  naturalHeight: number;
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
  const imageId = image?.id || '';
  const naturalWidth = image?.naturalWidth || 1;
  const naturalHeight = image?.naturalHeight || 1;

  // ── Build initial state from cropState ──────────────────
  const initialState = useMemo(() => {
    if (!cropState) return null;
    return {
      coordinates: cropState.coordinates || null,
      transforms: cropState.transforms || {
        rotate: 0,
        flip: { horizontal: false, vertical: false },
      },
      aspect: cropState.aspect ?? null,
      editorView: cropState.editorView || null,
    };
  }, [imageId]); // Re-derive exactly when the image ID changes

  // ── Editor engine ───────────────────────────────────────
  const editor = useImageEditor({
    imageId,
    naturalWidth,
    naturalHeight,
    initialState,
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

  // Keep a ref to current cropState to merge non-editor fields
  const cropStateRef = useRef<CropEntry | undefined>(cropState);
  cropStateRef.current = cropState;

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

  // ── Reset draft (full reset) ────────────────────────────
  const handleResetDraft = useCallback(() => {
    editor.resetAll();
    setManualW('');
    setManualH('');
    // Reset non-editor crop state fields
    if (imageId) {
      onCropChange?.(imageId, {
        coordinates: null,
        transforms: { rotate: 0, flip: { horizontal: false, vertical: false } },
        aspect: null,
        outputWidth: null,
        padding: '',
        cornerRadius: '',
        paddingFillType: 'empty',
        paddingFillValue: '',
        paddingMode: 'outer',
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
  }, [imageId]);

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
  // PaddingSection expects plain strings like "0 0 0 0" or "10", not objects

  const [paddingInput, setPaddingInput] = useState(() =>
    typeof cropState?.padding === 'string' ? cropState.padding : '',
  );
  const [paddingMode, setPaddingMode] = useState(
    () => (cropState?.paddingMode || 'outer') as PaddingMode,
  );
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
    setPaddingInput(
      typeof cropState?.padding === 'string' ? cropState.padding : '',
    );
    setPaddingMode((cropState?.paddingMode || 'outer') as PaddingMode);
    setCornerRadiusInput(
      typeof cropState?.cornerRadius === 'string' ? cropState.cornerRadius : '',
    );
    setPaddingFillType(
      (cropState?.paddingFillType || 'empty') as PaddingFillType,
    );
    setPaddingFillValue(cropState?.paddingFillValue || '');
    setPaddingImageUrl(cropState?.paddingImageUrl || null);
  }, [imageId]);

  const syncToStore = useCallback(
    (partialUpdate: Partial<CropEntry>) => {
      if (!imageId) return;
      onCropChange?.(imageId, {
        ...cropStateRef.current,
        ...partialUpdate,
      });
    },
    [imageId, onCropChange],
  );

  // PaddingSection calls handlePaddingInputChange(string) — single string value
  const handlePaddingInputChange = useCallback(
    (value: string) => {
      setPaddingInput(value);
      syncToStore({ padding: value });
    },
    [syncToStore],
  );

  const handlePaddingInputBlur = useCallback(() => {}, []);

  const handlePaddingModeChange = useCallback(
    (mode: PaddingMode) => {
      setPaddingMode(mode);
      syncToStore({ paddingMode: mode });
    },
    [syncToStore],
  );

  // cornerRadiusInput is also a string
  const handleCornerRadiusInputChange = useCallback(
    (value: string) => {
      setCornerRadiusInput(value);
      syncToStore({ cornerRadius: value });
    },
    [syncToStore],
  );

  const handleCornerRadiusInputBlur = useCallback(() => {}, []);

  const handlePaddingFillTypeChange = useCallback(
    (type: PaddingFillType) => {
      setPaddingFillType(type);
      syncToStore({ paddingFillType: type });
    },
    [syncToStore],
  );

  const handlePaddingFillValueChange = useCallback(
    (value: string) => {
      setPaddingFillValue(value);
      syncToStore({ paddingFillValue: value });
    },
    [syncToStore],
  );

  const handlePaddingImageFileChange = useCallback(
    (file: File | null) => {
      if (!file) {
        setPaddingImageUrl(null);
        syncToStore({ paddingImageUrl: null });
        return;
      }
      const url = URL.createObjectURL(file);
      setPaddingImageUrl(url);
      setPaddingFillType('image');
      syncToStore({ paddingFillType: 'image', paddingImageUrl: url });
    },
    [syncToStore],
  );

  // ── Navigation ──────────────────────────────────────────
  const navigateNext = useCallback(() => {
    if (hasNext) onNext?.();
  }, [hasNext, onNext]);

  const navigatePrev = useCallback(() => {
    if (hasPrev) onPrev?.();
  }, [hasPrev, onPrev]);

  const handleClose = useCallback(() => {
    onClose?.();
  }, [onClose]);

  // ── Processing state ────────────────────────────────────
  const isProcessing = false;

  // ── Return everything Inspector needs ───────────────────
  return {
    editor,
    isProcessing,

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
    paddingInput,
    paddingMode,
    cornerRadiusInput,
    paddingFillType,
    paddingFillValue,
    paddingImageUrl,
    handlePaddingInputChange,
    handlePaddingInputBlur,
    handlePaddingModeChange,
    handleCornerRadiusInputChange,
    handleCornerRadiusInputBlur,
    handlePaddingFillTypeChange,
    handlePaddingFillValueChange,
    handlePaddingImageFileChange,

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
  };
}

export default useInspectorLogic;
