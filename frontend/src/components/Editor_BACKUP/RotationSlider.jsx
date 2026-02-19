
import React, { useRef, useState, useEffect, useCallback } from 'react';

const RotationSlider = ({ value, onChange, min = -45, max = 45 }) => {
  const containerRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef({ startX: 0, startValue: 0 });

  // visual configuration
  const DENSITY = 10; // pixels per degree
  const MAJOR_TICK = 5; // every 5 degrees
  
  const handlePointerDown = (e) => {
    e.preventDefault();
    setIsDragging(true);
    dragRef.current = {
      startX: e.clientX,
      startValue: value
    };
    e.target.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e) => {
    if (!isDragging) return;
    e.preventDefault();
    
    const deltaX = e.clientX - dragRef.current.startX;
    // Dragging right -> decrease angle (move slider bar right means looking left?)
    // Usually: Drag Left -> Angle goes Positive (strip moves left).
    // Let's copy standard behavior:
    // Moving finger Left -> Value increases? No, moves the "ruler" left.
    // Ruler values increase to the right.
    // So dragging Ruler Left means Viewport moves Right -> Value Increases.
    // wait.
    // Value 0 is Center.
    // Values: -45 ... 0 ... 45
    // If I drag Left, I want to see 10, 20...
    // So 0 moves Left.
    // So Value Increases.
    
    // DeltaX < 0 (Drag Left) -> Value Increases.
    
    const deltaDeg = -deltaX / DENSITY;
    let newValue = dragRef.current.startValue + deltaDeg;
    
    // Clamp
    newValue = Math.max(min, Math.min(max, newValue));
    
    onChange(newValue);
  };

  const handlePointerUp = (e) => {
    setIsDragging(false);
    e.target.releasePointerCapture(e.pointerId);
  };

  // Render ticks
  // We render ticks that are visible.
  // Container width?
  const [width, setWidth] = useState(0);
  
  useEffect(() => {
    if (containerRef.current) {
      const resizeObserver = new ResizeObserver(entries => {
          setWidth(entries[0].contentRect.width);
      });
      resizeObserver.observe(containerRef.current);
      return () => resizeObserver.disconnect();
    }
  }, []);

  const renderTicks = () => {
    if (!width) return null;
    
    const center = width / 2;
    // Visible range in degrees
    const range = (width / 2) / DENSITY; // degrees from center to edge
    const startDeg = Math.floor(value - range - 5);
    const endDeg = Math.ceil(value + range + 5);
    
    const ticks = [];
    for (let i = startDeg; i <= endDeg; i++) {
      if (i < min || i > max) continue;
      
      const x = center + (i - value) * DENSITY;
      const isMajor = i % MAJOR_TICK === 0;
      const isZero = i === 0;
      
      ticks.push(
        <div
          key={i}
          style={{
            position: 'absolute',
            left: x,
            top: '50%',
            transform: 'translate(-50%, -50%)',
            width: isZero ? 2 : 1,
            height: isMajor ? 12 : 6,
            backgroundColor: isZero ? 'var(--accent, #3b82f6)' : 'rgba(255,255,255,0.4)',
            pointerEvents: 'none'
          }}
        />
      );
      
      if (isMajor) {
          ticks.push(
            <div
              key={`label-${i}`}
              style={{
                position: 'absolute',
                left: x,
                top: '5px',
                transform: 'translate(-50%, 0)',
                fontSize: '10px',
                color: 'rgba(255,255,255,0.4)',
                pointerEvents: 'none'
              }}
            >
              {i}
            </div>
          );
      }
    }
    return ticks;
  };

  return (
    <div 
      className="rotation-slider-container" 
      style={{ 
          position: 'relative', 
          height: '40px', 
          width: '100%', 
          overflow: 'hidden', 
          cursor: isDragging ? 'grabbing' : 'grab',
          touchAction: 'none',
          userSelect: 'none',
          background: 'rgba(0,0,0,0.2)',
          borderRadius: '8px'
      }}
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
        {renderTicks()}
        {/* Center Indicator */}
        <div 
            style={{
                position: 'absolute',
                left: '50%',
                top: 0,
                bottom: 0,
                width: 2,
                background: 'var(--accent, #3b82f6)',
                transform: 'translateX(-50%)',
                zIndex: 10,
                pointerEvents: 'none'
            }}
        />
    </div>
  );
};

export default RotationSlider;
