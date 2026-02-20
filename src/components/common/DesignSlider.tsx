import React, { useMemo } from 'react';
import './DesignSlider.css';

const clampNumber = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));
const parseNumberOr = (value: number | string, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

type DesignSliderProps = {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange?: (value: number) => void;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
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
}: DesignSliderProps) => {
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
      style={{ '--design-slider-fill': `${fillPercent}%` } as React.CSSProperties}
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
