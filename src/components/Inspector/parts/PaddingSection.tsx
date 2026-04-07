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
  '#000000', '#ffffff', '#737373', '#d4d4d4', '#0f172a', 
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', 
  '#3b82f6', '#6366f1', '#a855f7', '#ec4899'
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

const handleSteppedNumericKeyDown = (
  e: React.KeyboardEvent<HTMLInputElement>,
  onChange: (value: string) => void,
) => {
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    const input = e.currentTarget;
    const delta = e.key === 'ArrowUp' ? (e.shiftKey ? 10 : 1) : (e.shiftKey ? -10 : -1);
    
    const result = stepValueAtCursor(
      input.value,
      input.selectionStart,
      input.selectionEnd,
      delta,
    );
    if (result) {
      onChange(result.value);
      requestAnimationFrame(() => {
        input.setSelectionRange(result.selectionStart, result.selectionEnd);
      });
    }
  }
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
  // --- Internal State Management ---
  // We keep local state for the gradient components to ensure smooth interaction.
  // We initialize this state from props on mount (keyed by imageId in parent)
  // and when the fill type changes to 'color'.
  const [colors, setColors] = useState<string[]>(() => {
    const parsed = parseGradientValue(paddingFillValue) || parseRadialGradient(paddingFillValue);
    if (parsed) return [parsed.start, parsed.end];
    return [normalizeColor(paddingFillValue, DEFAULT_SOLID)];
  });
  
  const [gradientAngle, setGradientAngle] = useState(() => {
    const parsed = parseGradientValue(paddingFillValue);
    return parsed ? parsed.angle : DEFAULT_GRADIENT_ANGLE;
  });

  const [gradientType, setGradientType] = useState<'linear' | 'radial'>(() => {
    return parseRadialGradient(paddingFillValue) ? 'radial' : 'linear';
  });

  // These refs keep the store-pushing logic stable without re-creating callbacks.
  const stateRef = useRef({
    colors,
    angle: gradientAngle,
    type: gradientType,
    lastPushed: paddingFillValue,
    isInteracting: false
  });

  // Sync stateRef when state changes locally
  useEffect(() => {
    stateRef.current.colors = colors;
    stateRef.current.angle = gradientAngle;
    stateRef.current.type = gradientType;
  }, [colors, gradientAngle, gradientType]);

  // Sync internal state if paddingFillValue changes FROM OUTSIDE (e.g. undo/redo, image switch)
  useEffect(() => {
    if (paddingFillType !== 'color') return;
    
    // IF WE ARE INTERACTING OR THE VALUE MATCHES WHAT WE LAST SENT, IGNORE THE STORE.
    // This is the primary fix for the "jitter" / "snapping back" problem.
    if (stateRef.current.isInteracting || paddingFillValue === stateRef.current.lastPushed) {
      return;
    }
    
    const parsedGradient = parseGradientValue(paddingFillValue);
    if (parsedGradient) {
      setColors([parsedGradient.start, parsedGradient.end]);
      setGradientAngle(parsedGradient.angle);
      setGradientType('linear');
      stateRef.current.lastPushed = paddingFillValue;
      return;
    }
    
    const parsedRadial = parseRadialGradient(paddingFillValue);
    if (parsedRadial) {
      setColors([parsedRadial.start, parsedRadial.end]);
      setGradientType('radial');
      stateRef.current.lastPushed = paddingFillValue;
      return;
    }
    
    const singleColor = normalizeColor(paddingFillValue, DEFAULT_SOLID);
    setColors([singleColor]);
    stateRef.current.lastPushed = paddingFillValue;
  }, [paddingFillValue, paddingFillType]);

  const pushGradientUpdate = (
    nextColors: string[],
    nextAngle: number,
    nextType: 'linear' | 'radial'
  ) => {
    let nextValue = '';
    if (nextColors.length === 2) {
      nextValue = nextType === 'linear'
        ? buildLinearGradient(nextColors[0], nextColors[1], nextAngle)
        : buildRadialGradient(nextColors[0], nextColors[1]);
    } else {
      nextValue = nextColors[0];
    }
    
    if (nextValue === stateRef.current.lastPushed) return;
    
    stateRef.current.lastPushed = nextValue;
    handlePaddingFillValueChange(nextValue);
  };

  const updateColors = (nextColors: string[]) => {
    setColors(nextColors);
    pushGradientUpdate(nextColors, gradientAngle, gradientType);
  };

  const updateAngle = (nextAngle: number) => {
    const rounded = Math.round(nextAngle);
    setGradientAngle(rounded);
    pushGradientUpdate(colors, rounded, gradientType);
  };

  const updateType = (nextType: 'linear' | 'radial') => {
    setGradientType(nextType);
    pushGradientUpdate(colors, gradientAngle, nextType);
  };

  const addColorRow = () => {
    if (colors.length >= 2) return;
    const nextColors = [...colors, DEFAULT_GRADIENT_END];
    updateColors(nextColors);
  };

  const removeColorRow = (index: number) => {
    if (colors.length <= 1) return;
    const nextColors = colors.filter((_, i) => i !== index);
    updateColors(nextColors);
  };

  const handleColorChange = React.useCallback((index: number, nextColor: string) => {
    stateRef.current.isInteracting = true;
    const normalized = normalizeColor(nextColor, stateRef.current.colors[index]);
    const nextColors = [...stateRef.current.colors];
    nextColors[index] = normalized;
    
    setColors(nextColors);
    pushGradientUpdate(nextColors, stateRef.current.angle, stateRef.current.type);
  }, [handlePaddingFillValueChange]); // Very stable dependency array

  const onImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    handlePaddingImageFileChange(file);
  };

  const [activePickerKey, setActivePickerKey] = useState<string | null>(null);
  const [pickerAnchorRect, setPickerAnchorRect] = useState<DOMRect | null>(null);
  const pickerAnchorRef = useRef<HTMLElement | null>(null);
  const pickerPopoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!activePickerKey) {
      stateRef.current.isInteracting = false;
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const isOutsidePopover = pickerPopoverRef.current && !pickerPopoverRef.current.contains(target);
      const isOutsideAnchor = pickerAnchorRef.current && !pickerAnchorRef.current.contains(target);

      if (isOutsidePopover && isOutsideAnchor) {
        setActivePickerKey(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [activePickerKey]);
  
  const lastNumericStepAtRef = useRef(0);
  const paddingDragRemainderRef = useRef(0);
  const paddingPxRef = useRef(paddingPx);
  paddingPxRef.current = paddingPx;

  const renderColorRow = (color: string, index: number) => {
    const pickerKey = `color-${index}`;
    const isPickerOpen = activePickerKey === pickerKey;
    
    return (
      <motion.div
        key={pickerKey}
        layout
        initial={{ opacity: 0, height: 0, marginTop: 0 }}
        animate={{ 
          opacity: 1, 
          height: 'auto',
          marginTop: index > 0 ? 12 : 0
        }}
        exit={{ 
          opacity: 0, 
          height: 0, 
          marginTop: 0,
          transition: {
            opacity: { duration: 0.12 },
            height: { duration: 0.22, ease: [0.22, 1, 0.36, 1] },
            marginTop: { duration: 0.22, ease: [0.22, 1, 0.36, 1] }
          }
        }}
        transition={REVEAL_SECTION_TRANSITION}
        className="padding-color-row-container"
        style={{ overflow: 'hidden' }}
      >
        <div className="padding-color-row">
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
            {typeof document !== 'undefined' &&
              createPortal(
                <AnimatePresence>
                  {isPickerOpen && pickerAnchorRect && (
                    <div
                      key="picker-popover-portal-container"
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
                      <motion.div
                        key="picker-animation-wrapper"
                        initial={{ opacity: 0, scale: 0.92, y: pickerAnchorRect.top > 400 ? 10 : -10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.92, y: pickerAnchorRect.top > 400 ? 10 : -10 }}
                        transition={{ 
                          type: 'spring', 
                          damping: 25, 
                          stiffness: 350,
                          opacity: { duration: 0.12 }
                        }}
                        style={{ transformOrigin: pickerAnchorRect.top > 400 ? 'bottom left' : 'top left' }}
                      >
                        <AdvancedColorPicker
                          innerRef={pickerPopoverRef as any}
                          color={color}
                          onChange={(nextColor) => handleColorChange(index, nextColor)}
                          presets={COLOR_PRESETS as string[]}
                          showInput={false}
                        />
                      </motion.div>
                    </div>
                  )}
                </AnimatePresence>,
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
              <AnimatePresence mode="wait" initial={false}>
                {index === 0 && colors.length === 1 ? (
                  <motion.button
                    key="new-btn"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={{ duration: 0.12 }}
                    type="button"
                    className="padding-color-new-btn"
                    onClick={addColorRow}
                  >
                    ADD
                  </motion.button>
                ) : colors.length === 2 ? (
                  <motion.button
                    key="remove-btn"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={{ duration: 0.12 }}
                    type="button"
                    className="padding-color-remove-btn"
                    onClick={() => removeColorRow(index)}
                    title="Remove color"
                  >
                    <Trash2 size={15} />
                  </motion.button>
                ) : null}
              </AnimatePresence>
            </div>
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
          onChange={updateType}
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
            onChange={updateAngle}
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
              if (!isNaN(val)) updateAngle(((val % 360) + 360) % 360);
            }}
            onKeyDown={(e) => handleSteppedNumericKeyDown(e, (v) => updateAngle(parseInt(v, 10)))}
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
                <AnimatePresence initial={false}>
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
