import React, { useMemo } from 'react';
import './DesignSlider.css';

const clampNumber = (value, min, max) => Math.max(min, Math.min(max, value));
const parseNumberOr = (value, fallback) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const DesignSlider = ({
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  ariaLabel = 'Slider',
  className = '',
  disabled = false,
}) => {
  const safeMin = parseNumberOr(min, 0);
  const safeMax = parseNumberOr(max, 100);
  const safeStep = Math.max(0.0001, parseNumberOr(step, 1));
  const maxGreaterThanMin = safeMax > safeMin;
  const safeValue = useMemo(() => {
    const parsed = parseNumberOr(value, safeMin);
    return maxGreaterThanMin
      ? clampNumber(parsed, safeMin, safeMax)
      : safeMin;
  }, [value, safeMin, safeMax, maxGreaterThanMin]);

  const fillPercent = useMemo(() => {
    if (!maxGreaterThanMin) return 0;
    return ((safeValue - safeMin) / (safeMax - safeMin)) * 100;
  }, [safeValue, safeMin, safeMax, maxGreaterThanMin]);

  return (
    <div
      className={`design-slider ${className}`.trim()}
      style={{ '--design-slider-fill': `${fillPercent}%` }}
    >
      <input
        type="range"
        min={safeMin}
        max={safeMax}
        step={safeStep}
        value={safeValue}
        onChange={(event) => {
          const next = Number.parseFloat(event.target.value);
          onChange?.(Number.isFinite(next) ? next : safeValue);
        }}
        aria-label={ariaLabel}
        disabled={disabled}
      />
    </div>
  );
};

export default React.memo(DesignSlider);
