import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useCallback,
} from 'react';
import { usePointerDrag } from '../hooks/usePointerDrag';
import './RotateComponent.css';

function range(from: number, to: number, step = 1): number[] {
  let index = -1;
  let length = Math.max(Math.ceil((to - from) / (step || 1)), 0);
  const result = new Array(length);
  while (length--) {
    result[++index] = from;
    from += step;
  }
  return result;
}

type RotateItem = {
  value: number;
  highlighted: boolean;
  zero: boolean;
  opacity: number;
  translate: number;
};

type RotateComponentRef = {
  refresh: () => void;
};

type RotateComponentProps = {
  from?: number;
  to?: number;
  value?: number;
  step?: number;
  thickness?: number;
  onBlur?: () => void;
  onChange?: (delta: number) => void;
  className?: string;
  valueBarClassName?: string;
  barsClassName?: string;
  barClassName?: string;
  highlightedBarClassName?: string;
  zeroBarClassName?: string;
  density?: number;
  valuePrecision?: number;
  valueSuffix?: string;
  valueFormatter?: (value: number) => string;
};

export const RotateComponent = forwardRef<RotateComponentRef, RotateComponentProps>(
  (
    {
      from = -45,
      to = 45,
      value = 0,
      step = 2.5,
      thickness = 2,
      onBlur,
      onChange,
      className = '',
      valueBarClassName = '',
      barsClassName = '',
      barClassName = '',
      highlightedBarClassName = '',
      zeroBarClassName = '',
      density = 10,
      valuePrecision = 1,
      valueSuffix = '°',
      valueFormatter,
    },
    ref,
  ) => {
    const barsRef = useRef<HTMLDivElement | null>(null);
    const [dragging, setDragging] = useState(false);
    const [items, setItems] = useState<RotateItem[]>([]);

    const recalculate = useCallback(() => {
      if (!barsRef.current) return;
      const width = barsRef.current.clientWidth;
      if (width <= 0) return;
      const count = Math.max(1, width / density);
      const half = Math.max(1, Math.ceil(count / 2));
      const buffer = 2;
      const windowFrom = Math.max(from, value - (half + buffer) * step);
      const windowTo = Math.min(to, value + (half + buffer) * step);

      const values = range(windowFrom, windowTo + step, step);

      const radius = Math.abs(Math.ceil(count / 2) * step);

      setItems(
        values.map((barValue) => {
          const sign = Math.sign(barValue - value);

          let translate;
          if (Math.abs(barValue - value) / step <= Math.ceil(count / 2)) {
            const multiplier =
              Math.sqrt(
                Math.pow(radius, 2) -
                  Math.pow(value + sign * radius - barValue, 2),
              ) / radius;
            translate =
              width / 2 + sign * (width / 2) * Math.pow(multiplier, 2.5);
          } else {
            translate = width / 2 + (sign * width) / 2;
          }

          let opacity = 0;
          if (
            count > 0 &&
            Math.abs(barValue - value) / step <= Math.ceil(count / 2)
          ) {
            opacity = Math.pow(
              Math.sqrt(Math.pow(radius, 2) - Math.pow(value - barValue, 2)) /
                radius,
              4,
            );
          }

          if (isNaN(opacity)) opacity = 0;

          return {
            value: barValue,
            highlighted:
              (value < 0 && barValue >= value && barValue <= 0) ||
              (value > 0 && barValue <= value && barValue >= 0),
            zero: barValue === 0,
            opacity,
            translate: translate - thickness / 2,
          };
        }),
      );
    }, [density, thickness, from, to, value, step]);

    useEffect(() => {
      recalculate();
    }, [recalculate]);

    useEffect(() => {
      const handleResize = () => recalculate();
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }, [recalculate]);

    useEffect(() => {
      if (!barsRef.current || typeof ResizeObserver === 'undefined') return undefined;
      const observer = new ResizeObserver(() => recalculate());
      observer.observe(barsRef.current);
      return () => observer.disconnect();
    }, [recalculate]);

    useImperativeHandle(ref, () => ({
      refresh: recalculate,
    }));

    const { onPointerDown } = usePointerDrag({
      onMoveStart: () => {
        document.body.classList.add('dragging');
        setDragging(true);
      },
      onMove: ({ deltaX }) => {
        if (!barsRef.current || !onChange) return;
        const width = barsRef.current.clientWidth;
        if (width <= 0) return;
        const count = Math.max(1, width / density);
        const shift = -(deltaX / width) * count * step;

        if (value + shift > to) {
          onChange(to - value);
        } else if (value + shift < from) {
          onChange(from - value);
        } else {
          onChange(shift);
        }
      },
      onMoveEnd: () => {
        document.body.classList.remove('dragging');
        setDragging(false);
        onBlur?.();
      },
    });

    return (
      <div className={`telegram-rotate-component ${className}`}>
        <div
          className={`telegram-rotate-component__bars ${
            dragging ? 'telegram-rotate-component__bars--dragging' : ''
          } ${barsClassName}`}
          ref={barsRef}
          onPointerDown={onPointerDown}
          style={{ touchAction: 'none' }}
        >
          {items.map((bar) => (
            <div
              className={`telegram-rotate-component__bar ${
                bar.zero ? 'telegram-rotate-component__bar--zero' : ''
              } ${
                bar.highlighted
                  ? 'telegram-rotate-component__bar--highlighted'
                  : ''
              } ${barClassName} ${
                bar.highlighted ? highlightedBarClassName : ''
              } ${bar.zero ? zeroBarClassName : ''}`}
              key={bar.value}
              style={{
                width: bar.opacity ? thickness : 0,
                opacity: bar.opacity,
                transform: `translate(${bar.translate}px, -50%)`,
              }}
            />
          ))}
          <div
            className={`telegram-rotate-component__value ${valueBarClassName}`}
          >
            <div className="telegram-rotate-component__value-number">
              {valueFormatter
                ? valueFormatter(value)
                : `${value.toFixed(valuePrecision)}${valueSuffix}`}
            </div>
          </div>
        </div>
      </div>
    );
  },
);

RotateComponent.displayName = 'RotateComponent';
