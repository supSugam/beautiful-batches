import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Upload, Trash2 } from 'lucide-react';
import DesignSlider from '../../common/DesignSlider';
import { ACCEPTED_IMAGE_TYPES } from '../../../utils/directoryPicker';

const DEFAULT_SOLID = '#ffffff';
const DEFAULT_GRADIENT_START = '#ffffff';
const DEFAULT_GRADIENT_END = '#0f172a';
const DEFAULT_GRADIENT_ANGLE = 90;
const COLOR_PRESETS = Object.freeze([
  '#ffffff',
  '#d4d4d8',
  '#94a3b8',
  '#0f172a',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#818cf8',
  '#ec4899',
]);
let colorCanvasContext = null;

const clampColorChannel = (value) =>
  Math.max(0, Math.min(255, Math.round(value)));
const clampAlphaChannel = (value) => Math.max(0, Math.min(1, value));

const rgbToHex = (r, g, b) =>
  `#${[r, g, b]
    .map((channel) => clampColorChannel(channel).toString(16).padStart(2, '0'))
    .join('')}`;

const formatAlpha = (value) => {
  const rounded = Math.round(clampAlphaChannel(value) * 1000) / 1000;
  const text = String(rounded);
  if (!text.includes('.')) return text;
  return text.replace(/0+$/, '').replace(/\.$/, '');
};

const rgbToCssColor = (r, g, b, alpha = 1) => {
  const safeR = clampColorChannel(r);
  const safeG = clampColorChannel(g);
  const safeB = clampColorChannel(b);
  const safeAlpha = clampAlphaChannel(alpha);

  if (safeAlpha >= 1) {
    return rgbToHex(safeR, safeG, safeB);
  }

  return `rgba(${safeR}, ${safeG}, ${safeB}, ${formatAlpha(safeAlpha)})`;
};

const parseAlphaValue = (value) => {
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

const parseHexOrRgbColor = (value) => {
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
    const parseRgbChannel = (channel) => {
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

const parseCssColor = (value) => {
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

const normalizeColor = (value, fallback = DEFAULT_SOLID) => {
  const parsed = parseHexOrRgbColor(value) || parseCssColor(value);
  if (parsed) return parsed;
  return fallback;
};

const parseGradientValue = (value) => {
  if (typeof value !== 'string') return null;

  const match =
    /^linear-gradient\(\s*(-?\d+(?:\.\d+)?)deg\s*,\s*(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|rgba?\([^)]+\))\s*,\s*(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|rgba?\([^)]+\))\s*\)$/.exec(
      value.trim(),
    );
  if (!match) return null;

  return {
    angle: Math.round(Number.parseFloat(match[1])) || DEFAULT_GRADIENT_ANGLE,
    start: normalizeColor(match[2], DEFAULT_GRADIENT_START),
    end: normalizeColor(match[3], DEFAULT_GRADIENT_END),
  };
};

const buildLinearGradient = (start, end, angle) =>
  `linear-gradient(${angle}deg, ${start}, ${end})`;

const NUMERIC_TOKEN_REGEX = /-?\d+(?:\.\d+)?/g;

const getActiveNumericToken = (value, selectionStart, selectionEnd) => {
  const tokens = [];
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

const stepValueAtCursor = (value, selectionStart, selectionEnd, delta) => {
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

const PaddingSection = ({
  paddingInput,
  paddingMode,
  cornerRadiusInput,
  paddingFillType,
  paddingFillValue,
  paddingImageUrl,
  handlePaddingInputChange,
  handlePaddingInputBlur,
  handlePaddingModeChange,
  handleCornerRadiusInputChange,
  handleCornerRadiusInputBlur,
  handlePaddingFillTypeChange,
  handlePaddingFillValueChange,
  handlePaddingImageFileChange,
}) => {
  const [colorMode, setColorMode] = useState('solid');
  const [solidColor, setSolidColor] = useState(DEFAULT_SOLID);
  const [gradientStart, setGradientStart] = useState(DEFAULT_GRADIENT_START);
  const [gradientEnd, setGradientEnd] = useState(DEFAULT_GRADIENT_END);
  const [gradientAngle, setGradientAngle] = useState(DEFAULT_GRADIENT_ANGLE);
  const [showColorEditor, setShowColorEditor] = useState(false);
  const [activePickerKey, setActivePickerKey] = useState(null);
  const [pickerHexInput, setPickerHexInput] = useState(DEFAULT_SOLID);
  const pickerPopoverRef = useRef(null);

  const gradientPreview = useMemo(
    () => buildLinearGradient(gradientStart, gradientEnd, gradientAngle),
    [gradientStart, gradientEnd, gradientAngle],
  );

  useEffect(() => {
    const parsedGradient = parseGradientValue(paddingFillValue);
    if (parsedGradient) {
      setColorMode('gradient');
      setGradientStart(parsedGradient.start);
      setGradientEnd(parsedGradient.end);
      setGradientAngle(parsedGradient.angle);
      return;
    }

    setColorMode('solid');
    setSolidColor(normalizeColor(paddingFillValue, DEFAULT_SOLID));
  }, [paddingFillValue]);

  useEffect(() => {
    if (paddingFillType !== 'color') {
      setShowColorEditor(false);
      setActivePickerKey(null);
    }
  }, [paddingFillType]);

  useEffect(() => {
    if (!activePickerKey) return undefined;

    const handlePointerDown = (event) => {
      if (!pickerPopoverRef.current) return;
      if (pickerPopoverRef.current.contains(event.target)) return;
      setActivePickerKey(null);
    };

    const handleEscape = (event) => {
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

  const onImageFileChange = (event) => {
    const file = event.target.files?.[0];
    handlePaddingImageFileChange(file || null);
    event.target.value = '';
  };

  const handleSteppedNumericKeyDown = (event, onValueChange) => {
    const { key } = event;
    if (key !== 'ArrowUp' && key !== 'ArrowDown') {
      event.stopPropagation();
      return;
    }

    event.preventDefault();
    event.stopPropagation();

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

  const applySolidColor = (nextColor) => {
    const normalized = normalizeColor(nextColor, DEFAULT_SOLID);
    setColorMode('solid');
    setSolidColor(normalized);
    handlePaddingFillTypeChange('color');
    handlePaddingFillValueChange(normalized);
  };

  const applyGradient = (nextStart, nextEnd, nextAngle) => {
    const safeStart = normalizeColor(nextStart, DEFAULT_GRADIENT_START);
    const safeEnd = normalizeColor(nextEnd, DEFAULT_GRADIENT_END);
    const safeAngle = Math.max(-180, Math.min(180, Math.round(nextAngle)));
    setColorMode('gradient');
    setGradientStart(safeStart);
    setGradientEnd(safeEnd);
    setGradientAngle(safeAngle);
    handlePaddingFillTypeChange('color');
    handlePaddingFillValueChange(
      buildLinearGradient(safeStart, safeEnd, safeAngle),
    );
  };

  const openColorPicker = (pickerKey, currentColor) => {
    setPickerHexInput(currentColor);
    setActivePickerKey((prev) => (prev === pickerKey ? null : pickerKey));
  };

  const applyPickerColor = (rawColor, fallbackColor, onColorChange) => {
    const normalized = normalizeColor(rawColor, fallbackColor);
    setPickerHexInput(normalized);
    onColorChange(normalized);
  };

  const tryNormalizePickerColor = (rawColor) => {
    const parsed = normalizeColor(rawColor, '');
    return parsed || null;
  };

  const renderColorField = ({ label, color, pickerKey, onColorChange }) => {
    const isPickerOpen = activePickerKey === pickerKey;
    return (
      <label className="padding-color-field">
        <span className="padding-color-field-label">{label}</span>
        <span className="padding-color-field-control">
          <span
            className="padding-color-picker-wrap"
            ref={isPickerOpen ? pickerPopoverRef : null}
          >
            <button
              type="button"
              className="padding-color-swatch"
              style={{ '--padding-color-chip': color }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                openColorPicker(pickerKey, color);
              }}
              aria-label={`Choose ${label.toLowerCase()} color`}
              aria-expanded={isPickerOpen}
            />
            <span className="padding-color-code">{color}</span>

            {isPickerOpen && (
              <div className="padding-color-popover">
                <div
                  className="padding-color-popover-preview"
                  style={{ '--padding-color-chip': color }}
                />
                <div className="padding-color-preset-grid">
                  {COLOR_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className={`padding-color-preset ${preset === color ? 'active' : ''}`}
                      style={{ '--padding-color-chip': preset }}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        applyPickerColor(preset, color, onColorChange);
                      }}
                      aria-label={`Use color ${preset}`}
                    />
                  ))}
                </div>
                <input
                  type="text"
                  className="padding-color-hex-input"
                  value={pickerHexInput}
                  onChange={(event) => {
                    const nextRaw = event.target.value;
                    setPickerHexInput(nextRaw);
                    const parsed = tryNormalizePickerColor(nextRaw);
                    if (parsed) {
                      onColorChange(parsed);
                    }
                  }}
                  onBlur={() => {
                    const parsed = tryNormalizePickerColor(pickerHexInput);
                    if (parsed) {
                      applyPickerColor(parsed, color, onColorChange);
                      return;
                    }
                    setPickerHexInput(color);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      const parsed = tryNormalizePickerColor(pickerHexInput);
                      if (parsed) {
                        applyPickerColor(parsed, color, onColorChange);
                      } else {
                        setPickerHexInput(color);
                      }
                      setActivePickerKey(null);
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      setActivePickerKey(null);
                    }
                  }}
                  placeholder="#fff / rgb() / rgba()"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                />
              </div>
            )}
          </span>
        </span>
      </label>
    );
  };

  const colorPreview =
    colorMode === 'solid' ? solidColor : gradientPreview;
  const colorSummary =
    colorMode === 'solid'
      ? solidColor
      : `${gradientAngle}deg • ${gradientStart} -> ${gradientEnd}`;

  return (
    <section className="control-section padding-section">
      <h3 className="section-label">Tweaks (Top, Right, Bottom, Left)</h3>

      <div className="padding-input-row">
        <div className="padding-input-group">
          <label>Padding</label>
          <div className="padding-input-shell">
            <input
              type="text"
              value={paddingInput}
              placeholder="0 0 0 0"
              onChange={(e) => handlePaddingInputChange(e.target.value)}
              onBlur={handlePaddingInputBlur}
              onKeyDown={(e) =>
                handleSteppedNumericKeyDown(e, handlePaddingInputChange)
              }
            />
            <div className="padding-mode-float" aria-label="Padding mode">
              <button
                type="button"
                className={`padding-mode-chip ${paddingMode === 'inner' ? 'active' : ''}`}
                onClick={() => handlePaddingModeChange('inner')}
                title="Inner padding"
              >
                Inner
              </button>
              <button
                type="button"
                className={`padding-mode-chip ${paddingMode === 'outer' ? 'active' : ''}`}
                onClick={() => handlePaddingModeChange('outer')}
                title="Outer padding"
              >
                Outer
              </button>
            </div>
          </div>
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

      <div className="padding-fill-grid">
        <button
          type="button"
          className={`padding-fill-btn ${paddingFillType === 'empty' ? 'active' : ''}`}
          onClick={() => handlePaddingFillTypeChange('empty')}
          title="Neutral fill"
        >
          Empty
        </button>
        <button
          type="button"
          className={`padding-fill-btn ${paddingFillType === 'color' ? 'active' : ''}`}
          onClick={() => handlePaddingFillTypeChange('color')}
          title="Color fill"
        >
          Color
        </button>
        <button
          type="button"
          className={`padding-fill-btn ${paddingFillType === 'image' ? 'active' : ''}`}
          onClick={() => handlePaddingFillTypeChange('image')}
          title="Image fill"
        >
          Image
        </button>
      </div>

      {paddingFillType === 'color' && (
        <div className="padding-color-panel">
          <div className="padding-color-header">
            <div className="padding-color-summary">
              <div
                className="padding-color-preview"
                style={{ background: colorPreview }}
              />
              <div className="padding-color-summary-text">{colorSummary}</div>
            </div>
            <button
              type="button"
              className={`padding-editor-toggle ${showColorEditor ? 'active' : ''}`}
              onClick={() => setShowColorEditor((prev) => !prev)}
            >
              {showColorEditor ? 'Hide' : 'Customize'}
            </button>
          </div>

          {showColorEditor && (
            <div className="padding-color-editor">
              <div className="padding-color-editor-label">Style</div>
              <div className="padding-color-mode-grid">
                <button
                  type="button"
                  className={`padding-color-mode-btn ${colorMode === 'solid' ? 'active' : ''}`}
                  onClick={() => applySolidColor(solidColor)}
                >
                  Solid
                </button>
                <button
                  type="button"
                  className={`padding-color-mode-btn ${colorMode === 'gradient' ? 'active' : ''}`}
                  onClick={() =>
                    applyGradient(gradientStart, gradientEnd, gradientAngle)
                  }
                >
                  Gradient
                </button>
              </div>

              <div className="padding-color-fields">
                {colorMode === 'solid' ? (
                  renderColorField({
                    label: 'Color',
                    color: solidColor,
                    pickerKey: 'solid',
                    onColorChange: applySolidColor,
                  })
                ) : (
                  <>
                    {renderColorField({
                      label: 'Start',
                      color: gradientStart,
                      pickerKey: 'gradient-start',
                      onColorChange: (nextStart) =>
                        applyGradient(nextStart, gradientEnd, gradientAngle),
                    })}
                    {renderColorField({
                      label: 'End',
                      color: gradientEnd,
                      pickerKey: 'gradient-end',
                      onColorChange: (nextEnd) =>
                        applyGradient(gradientStart, nextEnd, gradientAngle),
                    })}

                    <div className="padding-gradient-panel">
                      <div className="padding-angle-row">
                        <label>Angle: {gradientAngle}°</label>
                        <DesignSlider
                          className="padding-angle-slider"
                          min={-180}
                          max={180}
                          step={1}
                          value={gradientAngle}
                          ariaLabel="Gradient angle"
                          onChange={(nextValue) =>
                            applyGradient(
                              gradientStart,
                              gradientEnd,
                              Math.round(nextValue),
                            )
                          }
                        />
                      </div>
                      <div
                        className="padding-gradient-preview"
                        style={{ background: gradientPreview }}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {paddingFillType === 'image' && (
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

          {paddingImageUrl && (
            <div className="padding-image-preview-wrap">
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
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export default React.memo(PaddingSection);
