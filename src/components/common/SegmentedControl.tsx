import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
  const rootRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef(new Map<T, HTMLButtonElement>());
  const [activeRect, setActiveRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [hoveredValue, setHoveredValue] = useState<T | null>(null);

  const activeOption = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  );
  const activeIsDanger = activeOption?.tone === 'danger';

  const updateActiveRect = useCallback(() => {
    const activeButton = optionRefs.current.get(value);
    if (!activeButton) {
      setActiveRect(null);
      return;
    }

    const nextRect = {
      x: activeButton.offsetLeft,
      y: activeButton.offsetTop,
      width: activeButton.offsetWidth,
      height: activeButton.offsetHeight,
    };

    setActiveRect((prev) => {
      if (
        prev &&
        prev.x === nextRect.x &&
        prev.y === nextRect.y &&
        prev.width === nextRect.width &&
        prev.height === nextRect.height
      ) {
        return prev;
      }
      return nextRect;
    });
  }, [value]);

  useLayoutEffect(() => {
    updateActiveRect();
  }, [updateActiveRect, options, equalWidth, className]);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return undefined;

    const observer = new ResizeObserver(() => {
      updateActiveRect();
    });

    if (rootRef.current) observer.observe(rootRef.current);
    optionRefs.current.forEach((button) => observer.observe(button));

    return () => observer.disconnect();
  }, [options, updateActiveRect]);

  return (
    <div
      ref={rootRef}
      className={`segmented-control ${equalWidth ? 'is-equal-width' : ''} ${className}`.trim()}
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {activeRect && (
        <motion.span
          className={`segmented-control-active-bg ${activeIsDanger ? 'is-danger' : ''}`}
          initial={false}
          animate={{
            x: activeRect.x,
            y: activeRect.y,
            width: activeRect.width,
            height: activeRect.height,
          }}
          transition={{
            type: 'spring',
            stiffness: 500,
            damping: 35,
            mass: 0.4,
          }}
          style={{ borderRadius: 999 }}
        />
      )}
      {options.map((option) => {
        const isActive = value === option.value;
        const isDanger = option.tone === 'danger';

        return (
          <button
            key={option.value}
            ref={(node) => {
              if (node) {
                optionRefs.current.set(option.value, node);
                return;
              }
              optionRefs.current.delete(option.value);
            }}
            type="button"
            role="radio"
            aria-checked={isActive}
            className={`segmented-control-option ${isActive ? 'is-active' : ''} ${isDanger ? 'is-danger' : ''} ${hoveredValue === option.value ? 'is-hovered' : ''}`}
            disabled={option.disabled}
            title={option.title}
            onClick={() => onChange(option.value)}
            onMouseEnter={() => setHoveredValue(option.value)}
            onMouseLeave={() => setHoveredValue((current) => (current === option.value ? null : current))}
            onFocus={() => setHoveredValue(option.value)}
            onBlur={() => setHoveredValue((current) => (current === option.value ? null : current))}
          >
            <span className="segmented-control-option-label">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
};

export default React.memo(SegmentedControl) as typeof SegmentedControl;
