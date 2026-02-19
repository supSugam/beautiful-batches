
import { useState, useRef, useCallback, useEffect } from 'react';
import { getFitScale, constrainToAspect } from '../utils/geometry';

const DEFAULT_STATE = {
  naturalWidth: 1,
  naturalHeight: 1,
  rot: 0,
  flipH: false,
  flipV: false,
  crop: { x: 0, y: 0, width: 0, height: 0 },
  zoom: 1,
  pan: { x: 0, y: 0 },
  fitScale: 1,
};

export const useEditorState = () => {
  // We use a ref for high-frequency state (pointer moves) to avoid re-renders
  // and a React state for UI updates that need to trigger renders.
  const stateRef = useRef({ ...DEFAULT_STATE });
  const [version, setVersion] = useState(0); // Tick to force render
  const [image, setImage] = useState(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  const updateState = useCallback((updates) => {
    stateRef.current = { ...stateRef.current, ...updates };
    setVersion((v) => v + 1);
  }, []);

  const reset = useCallback(() => {
    stateRef.current = { ...DEFAULT_STATE };
    setVersion((v) => v + 1);
  }, []);

  // Recalculate fit scale when container or image changes
  useEffect(() => {
    if (!image || containerSize.width === 0 || containerSize.height === 0) return;
    
    const { naturalWidth, naturalHeight, rot } = stateRef.current;
    const fitScale = getFitScale(
      containerSize.width, 
      containerSize.height, 
      naturalWidth, 
      naturalHeight, 
      rot
    );
    
    // Auto-center default crop if not set
    let crop = stateRef.current.crop;
    if (crop.width === 0 || crop.height === 0) {
      crop = {
        x: 0,
        y: 0,
        width: naturalWidth,
        height: naturalHeight
      };
    }

    updateState({ fitScale, crop });
  }, [image, containerSize, updateState]);

  const loadImage = useCallback((url) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        stateRef.current.naturalWidth = img.naturalWidth;
        stateRef.current.naturalHeight = img.naturalHeight;
        setImage(img);
        resolve(img);
      };
      img.onerror = reject;
      img.src = url;
    });
  }, []);

  const setRotation = useCallback((degrees) => {
    // Normalize to -180 to 180 or 0-360 depending on preference, 
    // but the inspector seems to use continuous degrees.
    const newRot = degrees;
    
    // Recompute fit scale for new rotation
    const { naturalWidth, naturalHeight } = stateRef.current;
    const fitScale = getFitScale(
      containerSize.width,
      containerSize.height,
      naturalWidth,
      naturalHeight,
      newRot
    );

    updateState({ rot: newRot, fitScale });
  }, [containerSize, updateState]);

  const setFlip = useCallback((horizontal, vertical) => {
    updateState({ flipH: horizontal, flipV: vertical });
  }, [updateState]);

  const setCrop = useCallback((cropRect) => {
    updateState({ crop: cropRect });
  }, [updateState]);

  const setZoom = useCallback((zoomLevel) => {
    updateState({ zoom: Math.max(1, zoomLevel) });
  }, [updateState]);

  const setPan = useCallback((panOffset) => {
    updateState({ pan: panOffset });
  }, [updateState]);

  const setAspect = useCallback((ratio) => {
    updateState({ aspect: ratio });
    
    if (ratio) {
      // Adjust current crop to match aspect
      const { crop, naturalWidth, naturalHeight, rot } = stateRef.current;
      const bbox = getRotatedBoundingBox(naturalWidth, naturalHeight, rot);
      
      // Calculate new dimensions centered on old center
      let { width, height } = constrainToAspect(crop.width, crop.height, ratio);
      
      // Ensure it fits bbox (simple clamp, though aspect might break if bbox is smaller)
      if (width > bbox.width) {
        width = bbox.width;
        height = width / ratio;
      }
      if (height > bbox.height) {
        height = bbox.height;
        width = height * ratio;
      }
      
      const cx = crop.x + crop.width / 2;
      const cy = crop.y + crop.height / 2;
      
      let newX = cx - width / 2;
      let newY = cy - height / 2;
      
      // Clamp position
      newX = Math.max(0, Math.min(newX, bbox.width - width));
      newY = Math.max(0, Math.min(newY, bbox.height - height));
      
      updateState({ 
        crop: { x: newX, y: newY, width, height } 
      });
    }
  }, [updateState]);

  // Generate state object compatible with existing export logic
  const getExportState = useCallback(() => {
    const s = stateRef.current;
    return {
      coordinates: {
        left: s.crop.x,
        top: s.crop.y,
        width: s.crop.width,
        height: s.crop.height,
      },
      transforms: {
        rotate: s.rot,
        flip: {
          horizontal: s.flipH,
          vertical: s.flipV,
        }
      },
      imageSize: {
        width: s.naturalWidth,
        height: s.naturalHeight
      },
      aspect: s.aspect // Optional pass-through
    };
  }, []);

  return {
    state: stateRef.current,
    image,
    containerSize,
    setContainerSize,
    loadImage,
    setRotation,
    setFlip,
    setCrop,
    setZoom,
    setPan,
    setAspect,
    reset,
    restoreState: updateState, // allow restore
    getExportState,
    version, // Subscribe to this if you need render updates
  };
};
