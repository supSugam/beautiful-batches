import React, { useEffect, useMemo, useState } from 'react';
import { Upload, Trash2 } from 'lucide-react';

const DEFAULT_SOLID = '#ffffff';
const DEFAULT_GRADIENT_START = '#ffffff';
const DEFAULT_GRADIENT_END = '#0f172a';
const DEFAULT_GRADIENT_ANGLE = 90;

const clampColorChannel = (value) => Math.max(0, Math.min(255, value));

const rgbToHex = (r, g, b) =>
  `#${[r, g, b]
    .map((channel) => clampColorChannel(channel).toString(16).padStart(2, '0'))
    .join('')}`;

const normalizeHex = (value, fallback = DEFAULT_SOLID) => {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  const shortHex = /^#([0-9a-fA-F]{3})$/.exec(trimmed);
  if (shortHex) {
    const [r, g, b] = shortHex[1].split('');
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }

  const longHex = /^#([0-9a-fA-F]{6})$/.exec(trimmed);
  if (longHex) return `#${longHex[1].toLowerCase()}`;

  const rgb =
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*[\d.]+\s*)?\)$/.exec(
      trimmed,
    );
  if (rgb) {
    return rgbToHex(
      Number.parseInt(rgb[1], 10),
      Number.parseInt(rgb[2], 10),
      Number.parseInt(rgb[3], 10),
    );
  }

  return fallback;
};

const parseGradientValue = (value) => {
  if (typeof value !== 'string') return null;

  const match =
    /^linear-gradient\(\s*(-?\d+(?:\.\d+)?)deg\s*,\s*(#[0-9a-fA-F]{3,6}|rgba?\([^)]+\))\s*,\s*(#[0-9a-fA-F]{3,6}|rgba?\([^)]+\))\s*\)$/.exec(
      value.trim(),
    );
  if (!match) return null;

  return {
    angle: Math.round(Number.parseFloat(match[1])) || DEFAULT_GRADIENT_ANGLE,
    start: normalizeHex(match[2], DEFAULT_GRADIENT_START),
    end: normalizeHex(match[3], DEFAULT_GRADIENT_END),
  };
};

const buildLinearGradient = (start, end, angle) =>
  `linear-gradient(${angle}deg, ${start}, ${end})`;

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
    setSolidColor(normalizeHex(paddingFillValue, DEFAULT_SOLID));
  }, [paddingFillValue]);

  useEffect(() => {
    if (paddingFillType !== 'color') {
      setShowColorEditor(false);
    }
  }, [paddingFillType]);

  const onImageFileChange = (event) => {
    const file = event.target.files?.[0];
    handlePaddingImageFileChange(file || null);
    event.target.value = '';
  };

  const applySolidColor = (nextColor) => {
    const normalized = normalizeHex(nextColor, DEFAULT_SOLID);
    setColorMode('solid');
    setSolidColor(normalized);
    handlePaddingFillTypeChange('color');
    handlePaddingFillValueChange(normalized);
  };

  const applyGradient = (nextStart, nextEnd, nextAngle) => {
    const safeStart = normalizeHex(nextStart, DEFAULT_GRADIENT_START);
    const safeEnd = normalizeHex(nextEnd, DEFAULT_GRADIENT_END);
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

  const colorPreview =
    colorMode === 'solid' ? solidColor : gradientPreview;
  const colorSummary =
    colorMode === 'solid'
      ? solidColor
      : `${gradientAngle}deg • ${gradientStart} -> ${gradientEnd}`;

  return (
    <section className="control-section padding-section">
      <h3 className="section-label">Output Padding</h3>

      <div className="padding-input-group">
        <label>Padding TRBL (px)</label>
        <input
          type="text"
          value={paddingInput}
          placeholder="0 0 0 0"
          onChange={(e) => handlePaddingInputChange(e.target.value)}
          onBlur={handlePaddingInputBlur}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </div>

      <div className="padding-input-group">
        <label>Rounded Corners TL TR BR BL (px)</label>
        <input
          type="text"
          value={cornerRadiusInput}
          placeholder="0 0 0 0"
          onChange={(e) => handleCornerRadiusInputChange(e.target.value)}
          onBlur={handleCornerRadiusInputBlur}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </div>

      <div className="padding-mode-grid">
        <button
          type="button"
          className={`padding-mode-btn ${paddingMode === 'inner' ? 'active' : ''}`}
          onClick={() => handlePaddingModeChange('inner')}
          title="Keep final output size the same"
        >
          Inner
        </button>
        <button
          type="button"
          className={`padding-mode-btn ${paddingMode === 'outer' ? 'active' : ''}`}
          onClick={() => handlePaddingModeChange('outer')}
          title="Increase final output size with padding"
        >
          Outer
        </button>
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
            <>
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
                  <label className="padding-color-field">
                    <span className="padding-color-field-label">Color</span>
                    <span className="padding-color-field-control">
                      <span
                        className="padding-color-swatch"
                        style={{ '--padding-color-chip': solidColor }}
                      >
                        <input
                          type="color"
                          value={solidColor}
                          aria-label="Choose padding color"
                          onChange={(e) => applySolidColor(e.target.value)}
                        />
                      </span>
                      <span className="padding-color-code">{solidColor}</span>
                    </span>
                  </label>
                ) : (
                  <>
                    <label className="padding-color-field">
                      <span className="padding-color-field-label">Start</span>
                      <span className="padding-color-field-control">
                        <span
                          className="padding-color-swatch"
                          style={{ '--padding-color-chip': gradientStart }}
                        >
                          <input
                            type="color"
                            value={gradientStart}
                            aria-label="Choose gradient start color"
                            onChange={(e) =>
                              applyGradient(
                                e.target.value,
                                gradientEnd,
                                gradientAngle,
                              )
                            }
                          />
                        </span>
                        <span className="padding-color-code">{gradientStart}</span>
                      </span>
                    </label>

                    <label className="padding-color-field">
                      <span className="padding-color-field-label">End</span>
                      <span className="padding-color-field-control">
                        <span
                          className="padding-color-swatch"
                          style={{ '--padding-color-chip': gradientEnd }}
                        >
                          <input
                            type="color"
                            value={gradientEnd}
                            aria-label="Choose gradient end color"
                            onChange={(e) =>
                              applyGradient(
                                gradientStart,
                                e.target.value,
                                gradientAngle,
                              )
                            }
                          />
                        </span>
                        <span className="padding-color-code">{gradientEnd}</span>
                      </span>
                    </label>

                    <div className="padding-gradient-panel">
                      <div className="padding-angle-row">
                        <label>Angle: {gradientAngle}°</label>
                        <input
                          type="range"
                          min="-180"
                          max="180"
                          step="1"
                          value={gradientAngle}
                          onChange={(e) =>
                            applyGradient(
                              gradientStart,
                              gradientEnd,
                              Number.parseInt(e.target.value, 10) || 0,
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
            </>
          )}
        </div>
      )}

      {paddingFillType === 'image' && (
        <div className="padding-image-panel">
          <label className="padding-image-upload">
            <Upload size={14} />
            <span>Choose Image</span>
            <input type="file" accept="image/*" onChange={onImageFileChange} />
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
