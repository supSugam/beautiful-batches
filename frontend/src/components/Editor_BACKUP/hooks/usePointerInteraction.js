import { useState, useRef, useCallback, useEffect } from 'react';
import { getRotatedBoundingBox, cropToScreen } from '../utils/geometry';

export const usePointerInteraction = (editorState, containerRef) => {
  const { state, setCrop, setPan, setZoom } = editorState;
  const { crop, zoom, pan, fitScale, naturalWidth, naturalHeight, rot, aspect } = state;
  const { containerSize } = editorState; // Need containerSize for cropToScreen
  const aspectRef = useRef(aspect);
  
  // Keep aspect fresh in ref for event handlers
  useEffect(() => { aspectRef.current = aspect; }, [aspect]);

  const interactionRef = useRef({
    mode: null, // 'move' | 'resize' | 'pan'
    startX: 0,
    startY: 0,
    startCrop: null, // { x, y, width, height }
    startPan: null,  // { x, y }
    handle: null,    // 'nw', 'n', 'ne', etc.
  });

  const [isInteracting, setIsInteracting] = useState(false);

  // --- Helpers ---
  
  const getScale = useCallback(() => fitScale * zoom, [fitScale, zoom]);

  const clampCrop = useCallback((rect) => {
    // Current transformed image bbox
    const bbox = getRotatedBoundingBox(naturalWidth, naturalHeight, rot);
    
    let { x, y, width, height } = rect;
    
    // Constrain size
    width = Math.max(10, Math.min(width, bbox.width));
    height = Math.max(10, Math.min(height, bbox.height));
    
    // Constrain position (keep inside bbox)
    x = Math.max(0, Math.min(x, bbox.width - width));
    y = Math.max(0, Math.min(y, bbox.height - height));
    
    return { x, y, width, height };
  }, [naturalWidth, naturalHeight, rot]);

  // --- Handlers ---

  const handlePointerDown = useCallback((e, mode, handle = null) => {
    e.preventDefault();
    e.stopPropagation();
    
    const clientX = e.clientX;
    const clientY = e.clientY;
    
    interactionRef.current = {
      mode,
      startX: clientX,
      startY: clientY,
      startCrop: { ...crop },
      startPan: { ...pan },
      handle
    };
    
    setIsInteracting(true);
    
    // Capture pointer on window/document usually, or the element. 
    // Since SVG overlay handles events, we capture on target.
    if (e.target.setPointerCapture) {
      e.target.setPointerCapture(e.pointerId);
    }
  }, [crop, pan]);

  const handlePointerMove = useCallback((e) => {
    if (!interactionRef.current.mode) return;
    e.preventDefault();
    
    const { mode, startX, startY, startCrop, startPan, handle } = interactionRef.current;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const scale = getScale(); // fitScale * zoom
    
    if (mode === 'move') {
      // Move crop
      const dxCrop = dx / scale;
      const dyCrop = dy / scale;
      
      let newCrop = {
        ...startCrop,
        x: startCrop.x + dxCrop,
        y: startCrop.y + dyCrop
      };
      
      setCrop(clampCrop(newCrop));
    } 
    else if (mode === 'resize') {
      // Resize crop logic
      const dxCrop = dx / scale;
      const dyCrop = dy / scale;
      
      let newX = startCrop.x;
      let newY = startCrop.y;
      let newW = startCrop.width;
      let newH = startCrop.height;
      
      // Apply deltas based on handle
      if (handle.includes('w')) { 
        newX += dxCrop; 
        newW -= dxCrop; 
      } else if (handle.includes('e')) {
        newW += dxCrop;
      }
      
      if (handle.includes('n')) {
        newY += dyCrop;
        newH -= dyCrop;
      } else if (handle.includes('s')) {
        newH += dyCrop;
      }
      
      // Prevent negative size (flip handle logic creates UX issues, so just clamp min size)
      if (newW < 20) {
          if (handle.includes('w')) newX = startCrop.x + startCrop.width - 20;
          newW = 20;
      }
      if (newH < 20) {
          if (handle.includes('n')) newY = startCrop.y + startCrop.height - 20;
          newH = 20;
      }

      // Aspect Ratio Constraint
      const currentAspect = aspectRef.current;
      if (currentAspect) {
        if (handle.length === 1) {
            // Side handle. Calculate new dimension. Center the other dimension change.
            if (handle === 'w' || handle === 'e') {
                const targetH = newW / currentAspect;
                const deltaH = targetH - newH;
                newH = targetH;
                newY -= deltaH / 2; // Center Y expansion
            } else {
                const targetW = newH * currentAspect;
                const deltaW = targetW - newW;
                newW = targetW;
                newX -= deltaW / 2; // Center X expansion
            }
        } else {
            // Corner handle. Width drives Height logic.
            newH = newW / currentAspect;
            if (handle.includes('n')) {
                // If we changed H, and we are dragging N, we need to update Y to keep Bottom fixed.
                newY = (startCrop.y + startCrop.height) - newH;
            }
        }
      }
      
      setCrop(clampCrop({ x: newX, y: newY, width: newW, height: newH }));
    }
    else if (mode === 'pan') {
      const sensitivity = 1;
      setPan({
        x: startPan.x + dx * sensitivity,
        y: startPan.y + dy * sensitivity
      });
    }
  }, [getScale, setCrop, setPan, clampCrop]); // Removed aspect dependency, using ref

  const handlePointerUp = useCallback((e) => {
    if (!interactionRef.current.mode) return;
    setIsInteracting(false);
    interactionRef.current.mode = null;
    if (e.target.releasePointerCapture) {
      e.target.releasePointerCapture(e.pointerId);
    }
  }, []);

  // Wheel Zoom Listener
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !containerSize.width) return;

    const handleWheel = (e) => {
      e.preventDefault();
      
      // Zoom logic
      const delta = -e.deltaY;
      // Exponential zoom
      const ZOOM_SPEED = 0.001; 
      const zoomChange = Math.exp(delta * ZOOM_SPEED);
      
      const currentZoom = editorState.state.zoom;
      let nextZoom = currentZoom * zoomChange;
      
      // Clamp
      nextZoom = Math.max(1, Math.min(20, nextZoom));
      
      if (Math.abs(nextZoom - currentZoom) < 0.001) return;

      // Focal point logic
      const rect = container.getBoundingClientRect();
      // Mouse position relative to center of container
      const px = e.clientX - rect.left - rect.width / 2;
      const py = e.clientY - rect.top - rect.height / 2;
      
      // Check if mouse is over crop area
      // Calculate screen crop
      const screenCrop = cropToScreen(crop, editorState.state, containerSize);
      
      // Helper check
      // screenCrop is { x, y, width, height } relative to container top-left?
      // cropToScreen returns { x, y } where x,y are from screen LEFT/TOP (0,0 is top-left of container).
      
      // Mouse relative to container top-left
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      
      const isOverCrop = 
        mouseX >= screenCrop.x && 
        mouseX <= screenCrop.x + screenCrop.width && 
        mouseY >= screenCrop.y && 
        mouseY <= screenCrop.y + screenCrop.height;
      
      let focalX = px;
      let focalY = py;
      
      // "Zoom in: when zoomed in, if hovered hover the crop tool, it will zoom over there" (Mouse)
      // "otherwise center of crop zone"
      
      // But zoom OUT ("can only zoom out until image for now") -> standard zoom out usually centers image?
      // Or zooms out from mouse?
      // Let's implement User Request:
      // If NOT over crop, use crop center as focal point.
      
      if (!isOverCrop && delta > 0) { // Only force crop-center on zoom IN? 
         // "Zoom in: ... otherwise center of crop zone"
         // Logic implies: If I'm looking at black space, zoom me to the crop.
         
         // Crop Center relative to container top-left
         const cx = screenCrop.x + screenCrop.width / 2;
         const cy = screenCrop.y + screenCrop.height / 2;
         
         // Focal point relative to container center
         focalX = cx - rect.width / 2;
         focalY = cy - rect.height / 2;
      }
      
      // Zoom math
      // P = (Point_Image * Scale) + Pan
      // NewPan = P - (P - Pan) * (NewZoom / OldZoom)
      // Here P is focal point.
      
      const currentPan = editorState.state.pan;
      const ratio = nextZoom / currentZoom;
      const newPanX = focalX - (focalX - currentPan.x) * ratio;
      const newPanY = focalY - (focalY - currentPan.y) * ratio;
      
      setZoom(nextZoom);
      setPan({ x: newPanX, y: newPanY });
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [containerRef, editorState.state, containerSize, setZoom, setPan, crop]);

  return {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    isInteracting
  };
};
