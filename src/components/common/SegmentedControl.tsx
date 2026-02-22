import React, { useId, useMemo } from 'react';
import { motion } from 'framer-motion';
import './SegmentedControl.css';

export type SegmentedControlOption<T extends string> = {
  value: T;
  label: React.ReactNode;
  title?: string;
  disabled?: boolean;
  tone?: 'default' | 'danger';
};

type SegmentedControlProps<T extends string> = {
  value: T;
  options: Array<SegmentedControlOption<T>>;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
  equalWidth?: boolean;
};

const SegmentedControl = <T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className = '',
  equalWidth = false,
}: SegmentedControlProps<T>) => {
  const id = useId();
  const layoutId = useMemo(
    () => `segmented-control-active-${id.replace(/[^a-zA-Z0-9_-]/g, '')}`,
    [id],
  );

  return (
    <div
      className={`segmented-control ${equalWidth ? 'is-equal-width' : ''} ${className}`.trim()}
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        const isActive = value === option.value;
        const isDanger = option.tone === 'danger';

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            className={`segmented-control-option ${isActive ? 'is-active' : ''} ${isDanger ? 'is-danger' : ''}`}
            disabled={option.disabled}
            title={option.title}
            onClick={() => onChange(option.value)}
          >
            {isActive && (
              <motion.span
                className={`segmented-control-active-bg ${isDanger ? 'is-danger' : ''}`}
                layoutId={layoutId}
                transition={{
                  type: 'spring',
                  stiffness: 500,
                  damping: 35,
                  mass: 0.4,
                }}
                style={{ borderRadius: 999 }}
              />
            )}
            <span className="segmented-control-option-label">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
};

export default React.memo(SegmentedControl) as typeof SegmentedControl;
