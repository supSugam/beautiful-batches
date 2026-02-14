import React, { useRef, useState, useEffect, useCallback } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import './RotationSlider.css';

const SNAP_POINTS = [0, 90, 180, 270, 360];
const SNAP_THRESHOLD = 8; // Increased threshold for a stronger "magnetic" feel

export const RotationSlider = ({ value, onChange, onDraggingChange }) => {
  const containerRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  
  // Internal value representing the literal rotation (0-360)
  const rotationMV = useMotionValue(value);
  
  // Spring version for the visual thumb position to create the "magnetic" effect
  const visualRotation = useSpring(rotationMV, {
    stiffness: 300,
    damping: 30,
    restDelta: 0.01
  });

  // Calculate percentage for thumb positioning
  const thumbLeft = useTransform(visualRotation, [0, 360], ['0%', '100%']);

  const updateRotation = useCallback((clientX) => {
    if (!containerRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    let newRotation = percentage * 360;
    
    // Apply snapping logic
    for (const snap of SNAP_POINTS) {
      if (Math.abs(newRotation - snap) < SNAP_THRESHOLD) {
        newRotation = snap;
        break;
      }
    }
    
    rotationMV.set(newRotation);
    onChange(Math.round(newRotation) % 360);
  }, [onChange, rotationMV]);

  const handlePointerDown = (e) => {
    setIsDragging(true);
    onDraggingChange?.(true);
    updateRotation(e.clientX);
    
    const handlePointerMove = (moveEvent) => {
      updateRotation(moveEvent.clientX);
    };
    
    const handlePointerUp = () => {
      setIsDragging(false);
      onDraggingChange?.(false);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
    
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  // Sync internal motion value with prop
  useEffect(() => {
    if (!isDragging) {
      rotationMV.set(value);
    }
  }, [value, rotationMV, isDragging]);

  return (
    <div className="rotation-slider-container">
      <div 
        className="rotation-slider-track-area"
        onPointerDown={handlePointerDown}
      >
        <div className="rotation-slider-track" ref={containerRef}>
          <div className="rotation-slider-ticks">
            {Array.from({ length: 13 }).map((_, i) => {
              const angle = i * 30;
              const isMajor = SNAP_POINTS.includes(angle);
              const isActive = Math.abs(value - angle) < 2;
              return (
                <div 
                  key={i} 
                  className={`rotation-tick ${isMajor ? 'major' : ''} ${isActive ? 'active' : ''}`}
                  style={{ left: `${(angle / 360) * 100}%` }}
                >
                  {isMajor && <span className="tick-label">{angle === 360 ? 0 : angle}°</span>}
                </div>
              );
            })}
          </div>
          
          <motion.div 
            className="rotation-slider-thumb"
            style={{ left: thumbLeft }}
          >
            <div className="thumb-center" />
            <div className={`thumb-value ${isDragging ? 'visible' : ''}`}>
              {Math.round(value)}°
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
};
