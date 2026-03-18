import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Trash2, RefreshCw, Upload } from 'lucide-react';



import SegmentedControl from '../../common/SegmentedControl';
import DesignSlider from '../../common/DesignSlider';
import AngleKnob from '../../common/AngleKnob';
import { ACCEPTED_IMAGE_TYPES } from '../../../utils/directoryPicker';

import type { PaddingFillType } from '../../../types/app';
import { RotateComponent } from './RotateComponent';
import { AdvancedColorPicker } from '../../common/AdvancedColorPicker';


const DEFAULT_SOLID = '#ffffff';
const DEFAULT_GRADIENT_START = '#ffffff';
const DEFAULT_GRADIENT_END = '#0f172a';
const DEFAULT_GRADIENT_ANGLE = 90;
const COLOR_PRESETS = Object.freeze([
  '#0f172a', '#6366f1', '#7c3aed', '#2563eb', '#3b82f6', '#0d9488', '#fecaca',
  '#f59e0b', '#ea580c', '#fb7185', '#be123c', '#ff006e', '#a3a3a3', '#737373',
  '#d4d4d4', '#ffffff'
]);

const FILL_TYPE_OPTIONS: Array<{
  type: PaddingFillType;
  label: string;
  title: string;
}> = [
  { type: 'empty', label: 'Transparent', title: 'Transparent background' },
  { type: 'color', label: 'Color', title: 'Color or gradient background' },
  { type: 'image', label: 'Image', title: 'Image background' },
];
let colorCanvasContext: CanvasRenderingContext2D | null = null;

type ParsedGradient = {
  angle: number;
  start: string;
  end: string;
};

type NumericToken = {
  start: number;
  end: number;
  raw: string;
};

type StepResult = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
};

const clampColorChannel = (value: number): number =>
  Math.max(0, Math.min(255, Math.round(value)));
const clampAlphaChannel = (value: number): number =>
  Math.max(0, Math.min(1, value));

const rgbToHex = (r: number, g: number, b: number): string =>
  `#${[r, g, b]
    .map((channel) => clampColorChannel(channel).toString(16).padStart(2, '0'))
    .join('')}`;

const formatAlpha = (value: number): string => {
  const rounded = Math.round(clampAlphaChannel(value) * 1000) / 1000;
  const text = String(rounded);
  if (!text.includes('.')) return text;
  return text.replace(/0+$/, '').replace(/\.$/, '');
};

const rgbToCssColor = (r: number, g: number, b: number, alpha = 1): string => {
  const safeR = clampColorChannel(r);
  const safeG = clampColorChannel(g);
  const safeB = clampColorChannel(b);
  const safeAlpha = clampAlphaChannel(alpha);

  if (safeAlpha >= 1) {
    return rgbToHex(safeR, safeG, safeB);
  }

  return `rgba(${safeR}, ${safeG}, ${safeB}, ${formatAlpha(safeAlpha)})`;
};

const parseAlphaValue = (value: unknown): number | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.endsWith('%')) {
    const parsedPercent = Number.parseFloat(trimmed.slice(0, -1));
    if (!Number.isFinite(parsedPercent)) return null;
    return clampAlphaChannel(parsedPercent / 100);
  }

  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return clampAlphaChannel(parsed);
};

const parseHexOrRgbColor = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const shortHex = /^#([0-9a-fA-F]{3})$/i.exec(trimmed);
  if (shortHex?.[1]) {
    const [r, g, b] = shortHex[1];
    return rgbToCssColor(
      Number.parseInt(`${r}${r}`, 16),
      Number.parseInt(`${g}${g}`, 16),
      Number.parseInt(`${b}${b}`, 16),
      1,
    );
  }

  const shortHexAlpha = /^#([0-9a-fA-F]{4})$/i.exec(trimmed);
  if (shortHexAlpha?.[1]) {
    const [r, g, b, a] = shortHexAlpha[1];
    return rgbToCssColor(
      Number.parseInt(`${r}${r}`, 16),
      Number.parseInt(`${g}${g}`, 16),
      Number.parseInt(`${b}${b}`, 16),
      Number.parseInt(`${a}${a}`, 16) / 255,
    );
  }

  const longHex = /^#([0-9a-fA-F]{6})$/i.exec(trimmed);
  if (longHex?.[1]) {
    return rgbToCssColor(
      Number.parseInt(longHex[1].slice(0, 2), 16),
      Number.parseInt(longHex[1].slice(2, 4), 16),
      Number.parseInt(longHex[1].slice(4, 6), 16),
      1,
    );
  }

  const longHexAlpha = /^#([0-9a-fA-F]{8})$/i.exec(trimmed);
  if (longHexAlpha?.[1]) {
    return rgbToCssColor(
      Number.parseInt(longHexAlpha[1].slice(0, 2), 16),
      Number.parseInt(longHexAlpha[1].slice(2, 4), 16),
      Number.parseInt(longHexAlpha[1].slice(4, 6), 16),
      Number.parseInt(longHexAlpha[1].slice(6, 8), 16) / 255,
    );
  }

  const rgb =
    /^rgba?\(\s*(-?\d{1,3}(?:\.\d+)?%?)\s*,\s*(-?\d{1,3}(?:\.\d+)?%?)\s*,\s*(-?\d{1,3}(?:\.\d+)?%?)(?:\s*,\s*([-+]?\d*\.?\d+%?)\s*)?\)$/.exec(
      trimmed,
    );
  if (rgb?.[1] && rgb[2] && rgb[3]) {
    const parseRgbChannel = (channel: string): number => {
      const normalized = channel.trim();
      if (normalized.endsWith('%')) {
        const parsedPercent = Number.parseFloat(normalized.slice(0, -1));
        if (!Number.isFinite(parsedPercent)) return 0;
        return (parsedPercent / 100) * 255;
      }
      const parsed = Number.parseFloat(normalized);
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const parsedAlpha =
      typeof rgb[4] === 'string' ? parseAlphaValue(rgb[4]) : 1;
    return rgbToCssColor(
      parseRgbChannel(rgb[1]),
      parseRgbChannel(rgb[2]),
      parseRgbChannel(rgb[3]),
      parsedAlpha ?? 1,
    );
  }

  return null;
};

const parseCssColor = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || typeof document === 'undefined') return null;

  if (
    typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    !CSS.supports('color', trimmed)
  ) {
    return null;
  }

  if (!colorCanvasContext) {
    const canvas = document.createElement('canvas');
    colorCanvasContext = canvas.getContext('2d');
  }
  if (!colorCanvasContext) return null;

  colorCanvasContext.fillStyle = '#000000';
  colorCanvasContext.fillStyle = trimmed;
  return parseHexOrRgbColor(colorCanvasContext.fillStyle);
};

const normalizeColor = (value: unknown, fallback = DEFAULT_SOLID): string => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(trimmed)) {
      const withHash = `#${trimmed}`;
      const parsed = parseHexOrRgbColor(withHash) || parseCssColor(withHash);
      if (parsed) return parsed;
    }
  }
  const parsed = parseHexOrRgbColor(value) || parseCssColor(value);
  if (parsed) return parsed;
  return fallback;
};


const parseGradientValue = (value: unknown): ParsedGradient | null => {
  if (typeof value !== 'string') return null;

  const match =
    /^linear-gradient\(\s*(-?\d+(?:\.\d+)?)deg\s*,\s*(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|rgba?\([^)]+\))\s*,\s*(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|rgba?\([^)]+\))\s*\)$/.exec(
      value.trim(),
    );
  if (!match) return null;

  const parsedAngle = Number.parseFloat(match[1]);
  return {
    angle: isNaN(parsedAngle) ? DEFAULT_GRADIENT_ANGLE : Math.round(parsedAngle),
    start: normalizeColor(match[2], DEFAULT_GRADIENT_START),
    end: normalizeColor(match[3], DEFAULT_GRADIENT_END),
  };
};


const parseRadialGradient = (value: unknown): { start: string; end: string } | null => {
  if (typeof value !== 'string') return null;
  const match = /^radial-gradient\(\s*circle\s*,\s*(#(?:[0-9a-fA-F]{3,8})|rgba?\([^)]+\))\s*,\s*(#(?:[0-9a-fA-F]{3,8})|rgba?\([^)]+\))\s*\)$/.exec(
    value.trim()
  );
  if (!match) return null;
  return {
    start: normalizeColor(match[1], DEFAULT_GRADIENT_START),
    end: normalizeColor(match[2], DEFAULT_GRADIENT_END),
  };
};

const buildLinearGradient = (start: string, end: string, angle: number): string =>
  `linear-gradient(${angle}deg, ${start}, ${end})`;

const buildRadialGradient = (start: string, end: string): string =>
  `radial-gradient(circle, ${start}, ${end})`;


const NUMERIC_TOKEN_REGEX = /-?\d+(?:\.\d+)?/g;
const REVEAL_SECTION_TRANSITION = {
  duration: 0.22,
  ease: [0.22, 1, 0.36, 1] as const,
};

const getActiveNumericToken = (
  value: string,
  selectionStart: number | null,
  selectionEnd: number | null,
): NumericToken | null => {
  const tokens: NumericToken[] = [];
  let match = NUMERIC_TOKEN_REGEX.exec(value);
  while (match) {
    tokens.push({
      start: match.index,
      end: match.index + match[0].length,
      raw: match[0],
    });
    match = NUMERIC_TOKEN_REGEX.exec(value);
  }
  NUMERIC_TOKEN_REGEX.lastIndex = 0;

  if (tokens.length === 0) return null;

  const rangeStart = Math.max(0, selectionStart ?? 0);
  const rangeEnd = Math.max(rangeStart, selectionEnd ?? rangeStart);

  const intersecting = tokens.find(
    (token) => rangeEnd >= token.start && rangeStart <= token.end,
  );
  if (intersecting) return intersecting;

  const previous = [...tokens].reverse().find((token) => token.end <= rangeStart);
  if (previous) return previous;

  return tokens[0];
};

const stepValueAtCursor = (
  value: string,
  selectionStart: number | null,
  selectionEnd: number | null,
  delta: number,
): StepResult | null => {
  const activeToken = getActiveNumericToken(value, selectionStart, selectionEnd);
  if (!activeToken) {
    if (value.trim() !== '') return null;
    const baseValue = delta > 0 ? 1 : 0;
    const nextRaw = String(baseValue);
    return {
      value: nextRaw,
      selectionStart: nextRaw.length,
      selectionEnd: nextRaw.length,
    };
  }

  const parsed = Number.parseFloat(activeToken.raw);
  const safeCurrent = Number.isFinite(parsed) ? parsed : 0;
  const nextNumber = Math.max(0, Math.round(safeCurrent + delta));
  const replacement = String(nextNumber);
  const nextValue =
    value.slice(0, activeToken.start) + replacement + value.slice(activeToken.end);
  const caret = activeToken.start + replacement.length;

  return {
    value: nextValue,
    selectionStart: caret,
    selectionEnd: caret,
  };
};

type PaddingSectionProps = {
  paddingPx: number;
  paddingMaxPx: number;
  cornerRadiusInput: string;
  paddingFillType: PaddingFillType;
  paddingFillValue: string;
  paddingImageUrl: string | null;
  handlePaddingPxChange: (value: number) => void;
  handlePaddingInputBlur: () => void;
  handleCornerRadiusInputChange: (value: string) => void;
  handleCornerRadiusInputBlur: () => void;
  handlePaddingFillTypeChange: (type: PaddingFillType) => void;
  handlePaddingFillValueChange: (value: string) => void;
  handlePaddingImageFileChange: (file: File | null) => void;
  handleResetTweaks: () => void;
};

const PaddingSection = ({
  paddingPx,
  paddingMaxPx,
  cornerRadiusInput,
  paddingFillType,
  paddingFillValue,
  paddingImageUrl,
  handlePaddingPxChange,
  handlePaddingInputBlur,
  handleCornerRadiusInputChange,
  handleCornerRadiusInputBlur,
  handlePaddingFillTypeChange,
  handlePaddingFillValueChange,
  handlePaddingImageFileChange,
  handleResetTweaks,
}: PaddingSectionProps) => {
  const [colors, setColors] = useState<string[]>([DEFAULT_SOLID]);
  const [gradientAngle, setGradientAngle] = useState(DEFAULT_GRADIENT_ANGLE);
  const [gradientType, setGradientType] = useState<'linear' | 'radial'>('linear');
  const [activePickerKey, setActivePickerKey] = useState<string | null>(null);


  const [pickerHexInput, setPickerHexInput] = useState(DEFAULT_SOLID);
  const pickerAnchorRef = useRef<HTMLElement | null>(null);
  const pickerPopoverRef = useRef<HTMLDivElement | null>(null);
  const [pickerAnchorRect, setPickerAnchorRect] = useState<DOMRect | null>(null);
  const lastNumericStepAtRef = useRef(0);
  const paddingDragRemainderRef = useRef(0);
  const paddingPxRef = useRef(paddingPx);
  paddingPxRef.current = paddingPx;


  useEffect(() => {
    if (paddingFillType !== 'color') return;
    const parsedGradient = parseGradientValue(paddingFillValue);
    if (parsedGradient) {
      setColors([parsedGradient.start, parsedGradient.end]);
      setGradientAngle(parsedGradient.angle);
      setGradientType('linear');
      return;
    }
    const parsedRadial = parseRadialGradient(paddingFillValue);
    if (parsedRadial) {
      setColors([parsedRadial.start, parsedRadial.end]);
      setGradientType('radial');
      return;
    }
    setColors([normalizeColor(paddingFillValue, DEFAULT_SOLID)]);
  }, [paddingFillValue, paddingFillType]);

  useEffect(() => {
    if (paddingFillType !== 'color') return;
    if (colors.length === 2) {
      const nextValue = gradientType === 'linear'
        ? buildLinearGradient(colors[0], colors[1], gradientAngle)
        : buildRadialGradient(colors[0], colors[1]);
      if (paddingFillValue !== nextValue) {
        handlePaddingFillValueChange(nextValue);
      }
    } else {
      if (paddingFillValue !== colors[0]) {
        handlePaddingFillValueChange(colors[0]);
      }
    }
  }, [colors, gradientAngle, gradientType, paddingFillType, handlePaddingFillValueChange, paddingFillValue]);



  useEffect(() => {
    if (paddingFillType !== 'color') {
      setActivePickerKey(null);
    }
  }, [paddingFillType]);


  useEffect(() => {
    if (!activePickerKey) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (pickerAnchorRef.current?.contains(target)) return;
      if (pickerPopoverRef.current?.contains(target)) return;
      setActivePickerKey(null);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActivePickerKey(null);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [activePickerKey]);

  useEffect(() => {
    if (!activePickerKey) return undefined;

    const updateRect = () => {
      const el = pickerAnchorRef.current;
      if (!el) return;
      setPickerAnchorRect(el.getBoundingClientRect());
    };

    updateRect();
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);
    return () => {
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
    };
  }, [activePickerKey]);

  const onImageFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    handlePaddingImageFileChange(file || null);
    event.target.value = '';
  };

  const handleSteppedNumericKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
    onValueChange: (value: string) => void,
  ) => {
    const { key } = event;
    if (key !== 'ArrowUp' && key !== 'ArrowDown') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    // Avoid event-queue backlog on long key repeats, which can look like the value
    // keeps changing after the user releases the key.
    const now = (typeof performance !== 'undefined' && performance.now)
      ? performance.now()
      : Date.now();
    if (now - lastNumericStepAtRef.current < 28) return;
    lastNumericStepAtRef.current = now;

    const inputEl = event.currentTarget;
    const { value, selectionStart, selectionEnd } = inputEl;
    const delta = key === 'ArrowUp' ? 1 : -1;
    const stepped = stepValueAtCursor(value, selectionStart, selectionEnd, delta);
    if (!stepped) return;

    onValueChange(stepped.value);
    requestAnimationFrame(() => {
      if (document.activeElement !== inputEl) return;
      inputEl.setSelectionRange(
        stepped.selectionStart,
        stepped.selectionEnd,
      );
    });
  };

  const updateFillValue = (nextColors: string[], nextAngle: number) => {
    setColors(nextColors);
    setGradientAngle(nextAngle);
    handlePaddingFillTypeChange('color');
    if (nextColors.length === 2) {
      handlePaddingFillValueChange(buildLinearGradient(nextColors[0], nextColors[1], nextAngle));
    } else {
      handlePaddingFillValueChange(nextColors[0]);
    }
  };

  const addColorRow = () => {
    if (colors.length >= 2) return;
    updateFillValue([...colors, DEFAULT_GRADIENT_END], gradientAngle);
  };

  const removeColorRow = (index: number) => {
    if (colors.length <= 1) return;
    const nextColors = colors.filter((_, i) => i !== index);
    updateFillValue(nextColors, gradientAngle);
  };

  const handleColorChange = (index: number, nextColor: string) => {
    const nextColors = [...colors];
    nextColors[index] = normalizeColor(nextColor, nextColors[index]);
    updateFillValue(nextColors, gradientAngle);
  };


  const openColorPicker = (pickerKey: string, currentColor: string) => {
    setPickerHexInput(currentColor);
    setActivePickerKey((prev) => (prev === pickerKey ? null : pickerKey));
  };

  const applyPickerColor = (
    rawColor: string,
    fallbackColor: string,
    onColorChange: (value: string) => void,
  ) => {
    const normalized = normalizeColor(rawColor, fallbackColor);
    setPickerHexInput(normalized);
    onColorChange(normalized);
  };

  const tryNormalizePickerColor = (rawColor: string) => {
    const parsed = normalizeColor(rawColor, '');
    return parsed || null;
  };

  const renderColorRow = (color: string, index: number) => {
    const pickerKey = `color-${index}`;
    const isPickerOpen = activePickerKey === pickerKey;
    
    return (
      <motion.div
        key={pickerKey}
        layout
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="padding-color-row"
      >
        <div className="padding-color-swatch-trigger">
          <button
            type="button"
            className="padding-color-swatch-box"
            style={{ backgroundColor: color }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              pickerAnchorRef.current = event.currentTarget;
              setPickerAnchorRect(event.currentTarget.getBoundingClientRect());
              setActivePickerKey(prev => prev === pickerKey ? null : pickerKey);
            }}
            aria-label={`Choose color ${index + 1}`}
            aria-expanded={isPickerOpen}
          />
          {isPickerOpen &&
            typeof document !== 'undefined' &&
            pickerAnchorRect &&
            createPortal(
              <div
                ref={pickerPopoverRef}
                className="padding-color-popover-new"
                style={{
                  position: 'fixed',
                  zIndex: 9999,
                  left: Math.max(
                    12,
                    Math.min(
                      pickerAnchorRect.left,
                      window.innerWidth - 252,
                    ),
                  ),
                  top:
                    pickerAnchorRect.top > 400
                      ? pickerAnchorRect.top - 10
                      : pickerAnchorRect.bottom + 10,
                  transform:
                    pickerAnchorRect.top > 400
                      ? 'translateY(-100%)'
                      : 'none',
                }}
              >
                <AdvancedColorPicker
                  color={color}
                  onChange={(nextColor) => handleColorChange(index, nextColor)}
                  presets={[...COLOR_PRESETS]}
                />
              </div>,
              document.body,
            )}
        </div>
        
        <div className="padding-color-hex-field">
          <div className="padding-color-hex-main">
            <span className="padding-color-hex-prefix">#</span>
            <input
              type="text"
              className="padding-color-hex-text"
              value={(color || '').replace('#', '').toUpperCase()}
              onChange={(e) => handleColorChange(index, e.target.value)}
              onBlur={() => handleColorChange(index, color)}
              spellCheck={false}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </div>

          <div className="padding-color-row-actions">
            <AnimatePresence initial={false}>
              {index === 0 && colors.length === 1 && (
                <motion.button
                  key="new-btn"
                  initial={{ opacity: 0, x: 4 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 4 }}
                  type="button"
                  className="padding-color-new-btn"
                  onClick={addColorRow}
                >
                  ADD
                </motion.button>
              )}

              {colors.length === 2 && (
                <motion.button
                  key="remove-btn"
                  initial={{ opacity: 0, x: 4 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 4 }}
                  type="button"
                  className="padding-color-remove-btn"
                  onClick={() => removeColorRow(index)}
                  title="Remove color"
                >
                  <Trash2 size={15} />
                </motion.button>
              )}

            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    );
  };






  const renderGradientControls = () => {
    if (colors.length < 2) return null;

    return (
      <div className="padding-gradient-controls-row">
        <SegmentedControl<'linear' | 'radial'>
          value={gradientType}
          onChange={setGradientType}
          ariaLabel="Gradient Type"
          className="padding-gradient-type-toggle"
          equalWidth
          options={[
            { value: 'linear', label: 'Linear' },
            { value: 'radial', label: 'Radial' }
          ]}
        />

        
        <div className={`padding-gradient-angle-group ${gradientType === 'radial' ? 'is-disabled' : ''}`}>
          <AngleKnob
            value={gradientAngle}
            onChange={setGradientAngle}
            disabled={gradientType === 'radial'}
            size={32}
          />
          <input
            type="text"
            className="padding-gradient-angle-input"
            value={gradientAngle}
            disabled={gradientType === 'radial'}
            onChange={(e) => {
              const val = parseInt(e.target.value.replace(/[^0-9]/g, ''), 10);
              if (!isNaN(val)) setGradientAngle(((val % 360) + 360) % 360);
            }}
            onKeyDown={(e) => handleSteppedNumericKeyDown(e, (v) => setGradientAngle(parseInt(v, 10)))}
          />
        </div>
      </div>
    );
  };

  const colorPreview = colors.length === 2 

    ? (gradientType === 'linear' 
        ? buildLinearGradient(colors[0], colors[1], gradientAngle)
        : buildRadialGradient(colors[0], colors[1]))
    : colors[0];
  const colorSummary = colors.length === 2
    ? `${gradientType === 'linear' ? `${gradientAngle}°` : 'Radial'} • ${colors[0]} -> ${colors[1]}`
    : colors[0];



  return (
    <section className="control-section padding-section">
      <div className="section-header">
        <h3 className="section-label">Tweaks</h3>
        <div className="section-header-tools">
          <button
            type="button"
            className="btn-icon-subtle"
            onClick={handleResetTweaks}
            title="Reset tweaks"
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      <div className="padding-input-row">
        <div className="padding-input-group">
          <label>Padding</label>
          <RotateComponent
            from={0}
            to={Math.max(0, Math.round(Number(paddingMaxPx) || 0))}
            value={Math.max(0, Math.round(Number(paddingPx) || 0))}
            step={1}
            density={6}
            onChange={(delta) => {
              // RotateComponent emits fractional deltas; padding is integer-only.
              // Accumulate until we have whole pixels so the slider feels responsive.
              paddingDragRemainderRef.current += Number(delta) || 0;
              const remainder = paddingDragRemainderRef.current;
              const whole = remainder >= 0 ? Math.floor(remainder) : Math.ceil(remainder);
              if (whole === 0) return;
              paddingDragRemainderRef.current -= whole;
              handlePaddingPxChange(paddingPxRef.current + whole);
            }}
            onBlur={() => {
              paddingDragRemainderRef.current = 0;
              handlePaddingInputBlur();
            }}
            valuePrecision={0}
            valueSuffix="px"
          />
        </div>

        <div className="padding-input-group">
          <label>Corner Radius</label>
          <input
            type="text"
            value={cornerRadiusInput}
            placeholder="0 0 0 0"
            onChange={(e) => handleCornerRadiusInputChange(e.target.value)}
            onBlur={handleCornerRadiusInputBlur}
            onKeyDown={(e) =>
              handleSteppedNumericKeyDown(e, handleCornerRadiusInputChange)
            }
          />
        </div>
      </div>

      <SegmentedControl<PaddingFillType>
        value={paddingFillType}
        onChange={handlePaddingFillTypeChange}
        ariaLabel="Background fill"
        className="padding-fill-segmented"
        equalWidth
        options={FILL_TYPE_OPTIONS.map((option) => ({
          value: option.type,
          label: option.label,
          title: option.title,
        }))}
      />

      <AnimatePresence mode="wait" initial={false}>
        {paddingFillType === 'color' && (
          <motion.div
            key="padding-color-panel"
            initial={{ opacity: 0, height: 0, y: -6 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0, y: -6 }}
            transition={REVEAL_SECTION_TRANSITION}
            style={{ overflow: 'hidden' }}
          >
            <div className="padding-color-panel">
              <div className="padding-color-list">
                <AnimatePresence initial={false} mode="popLayout">
                  {colors.map((color, idx) => renderColorRow(color, idx))}
                </AnimatePresence>
              </div>
              {renderGradientControls()}
            </div>
          </motion.div>

        )}


        {paddingFillType === 'image' && (

          <motion.div
            key="padding-image-panel"
            initial={{ opacity: 0, height: 0, y: -6 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0, y: -6 }}
            transition={REVEAL_SECTION_TRANSITION}
            style={{ overflow: 'hidden' }}
          >
            <div className="padding-image-panel">
              <label className="padding-image-upload">
                <Upload size={14} />
                <span>Choose Image</span>
                <input
                  type="file"
                  accept={ACCEPTED_IMAGE_TYPES}
                  onChange={onImageFileChange}
                />
              </label>

              <AnimatePresence initial={false}>
                {paddingImageUrl && (
                  <motion.div
                    key="padding-image-preview-wrap"
                    className="padding-image-preview-wrap"
                    initial={{ opacity: 0, height: 0, y: -4 }}
                    animate={{ opacity: 1, height: 'auto', y: 0 }}
                    exit={{ opacity: 0, height: 0, y: -4 }}
                    transition={REVEAL_SECTION_TRANSITION}
                    style={{ overflow: 'hidden' }}
                  >
                    <div
                      className="padding-image-preview"
                      style={{ backgroundImage: `url(${paddingImageUrl})` }}
                    />
                    <button
                      type="button"
                      className="btn-icon-subtle"
                      title="Remove selected image"
                      onClick={() => handlePaddingImageFileChange(null)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
};

export default React.memo(PaddingSection);
