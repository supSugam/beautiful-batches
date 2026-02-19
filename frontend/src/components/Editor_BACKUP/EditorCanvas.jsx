
import React, { useRef, useEffect } from 'react';
import { useEditorState } from './hooks/useEditorState';

const EditorCanvas = ({ editorState }) => {
  const canvasRef = useRef(null);
  const { state, image, containerSize } = editorState;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image || containerSize.width === 0 || containerSize.height === 0) return;

    const ctx = canvas.getContext('2d');
    
    // Handle high-DPI displays
    const dpr = window.devicePixelRatio || 1;
    canvas.width = containerSize.width * dpr;
    canvas.height = containerSize.height * dpr;
    canvas.style.width = `${containerSize.width}px`;
    canvas.style.height = `${containerSize.height}px`;
    
    ctx.scale(dpr, dpr);
    
    // Clear
    ctx.clearRect(0, 0, containerSize.width, containerSize.height);
    
    // Check if we have valid dimensions
    if (state.naturalWidth === 0 || state.naturalHeight === 0) return;

    // --- Draw Image ---
    ctx.save();
    
    // Center of container
    const cx = containerSize.width / 2;
    const cy = containerSize.height / 2;
    
    ctx.translate(cx, cy);
    
    // Apply zoom & pan
    ctx.translate(state.pan.x, state.pan.y);
    ctx.scale(state.zoom, state.zoom);
    
    // Apply fit scale (to fit image within container)
    ctx.scale(state.fitScale, state.fitScale);
    
    // Apply rotation
    ctx.rotate((state.rot * Math.PI) / 180);
    
    // Apply flip
    ctx.scale(state.flipH ? -1 : 1, state.flipV ? -1 : 1);
    
    // Draw image centered
    const iw = state.naturalWidth;
    const ih = state.naturalHeight;
    ctx.drawImage(image, -iw / 2, -ih / 2, iw, ih);
    
    ctx.restore();

    // --- Draw Overlay (Dim outside crop) ---
    // Use inverse path clipping or just 4 rectangles?
    // 4 rectangles is easier and performant. 
    // BUT getting the screen coordinates of the crop rect is tricky because the crop rect is in IMAGE space.
    // 
    // Plan B: Draw the overlay in the same transformed coordinate space?
    // No, the crop rect stays "visual" usually? 
    // Wait, in this editor, does the crop rect move or does the image move?
    // "Crop: ... drag and all" -> Crop rect moves over the image.
    // BUT usually for rotation, we want the crop rect to stay upright and image to rotate?
    // React-advanced-cropper rotates the image content BUT the crop boundary stays relative to image?
    // Actually, usually the crop rectangle is axis-aligned to the viewport, and the image rotates underneath.
    // Let's stick to the plan: "EditorCanvas: ... Draw darkened overlay outside crop region"
    // 
    // If crop is stored in image coordinates (common for export), we need to transform it to screen coordinates to draw the overlay.
    //
    // Let's implement coordinates transform helper in geometry.js first? 
    // For now, let's just render the image. The overlay might be better in the SVG layer if it needs to be interactive/complex.
    // Actually, plan said "CropOverlay component - interactive crop zone". 
    // Maybe the *dimming* should be done by the SVG too (big path with hole)? 
    // Yes, SVG `mask` or `path` with fill-rule: evenodd is perfect for this.
    // 
    // So EditorCanvas just renders the image.
    
  }, [state, image, containerSize]);

  return (
    <canvas 
      ref={canvasRef} 
      style={{ display: 'block', width: '100%', height: '100%' }}
    />
  );
};

export default EditorCanvas;
