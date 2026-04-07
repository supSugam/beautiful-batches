import React, { useRef, useEffect, useCallback } from 'react';
import './AngleKnob.css';

interface AngleKnobProps {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  size?: number;
}

const AngleKnob: React.FC<AngleKnobProps> = ({
  value,
  onChange,
  disabled = false,
  size = 32,
}) => {
  const knobRef = useRef<HTMLDivElement>(null);

  const calculateAngle = useCallback(
    (clientX: number, clientY: number) => {
      if (!knobRef.current) return;
      const rect = knobRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      
      const dx = clientX - centerX;
      const dy = clientY - centerY;
      
      // Math.atan2 gives 0 at Right, +90 at Bottom, -90 at Top.
      // We want 0 at Top, 90 at Right.
      // So we rotate by 90 degrees (+90 in degrees)
      let angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
      
      // Standardize to [0, 360)
      angleDeg = (angleDeg + 360) % 360;
      
      const rounded = Math.round(angleDeg);
      if (rounded !== value) {
        onChange(rounded);
      }
    },
    [onChange, value]
  );

  const handlePointerDown = (e: React.PointerEvent) => {
    if (disabled || e.button !== 0) return;
    
    // Capture pointer to receive events outside the element
    e.currentTarget.setPointerCapture(e.pointerId);
    calculateAngle(e.clientX, e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (disabled || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    calculateAngle(e.clientX, e.clientY);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  // Convert current value (CSS angle) back to visual coordinates for the dot
  // In CSS angle logic: 0 is UP, 90 is RIGHT
  // To draw on canvas/DOM: UP is -90 deg from Right
  const visualAngleRad = ((value - 90) * Math.PI) / 180;
  
  // Keep dot within circle bounds with a visible gap from the edge
  const radius = size / 2 - 7;
  const dotX = Math.cos(visualAngleRad) * radius;
  const dotY = Math.sin(visualAngleRad) * radius;

  return (
    <div
      ref={knobRef}
      className={`angle-knob ${disabled ? 'is-disabled' : ''}`}
      style={{ width: size, height: size }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <div className="angle-knob-circle">
        <div 
          className="angle-knob-dot" 
          style={{ 
            transform: `translate(calc(-50% + ${dotX}px), calc(-50% + ${dotY}px))` 
          }} 
        />
      </div>
    </div>
  );
};

export default AngleKnob;
