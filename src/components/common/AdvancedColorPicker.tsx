import React, { useEffect, useRef, useState } from 'react';
import { HexColorPicker } from 'react-colorful';
import './AdvancedColorPicker.css';

interface AdvancedColorPickerProps {
  color: string;
  onChange: (color: string) => void;
  presets?: string[];
  className?: string;
  showInput?: boolean;
  innerRef?: React.RefObject<HTMLDivElement>;
}

export function AdvancedColorPicker({
  color,
  onChange,
  presets = [],
  className = '',
  showInput = true,
  innerRef,
}: AdvancedColorPickerProps) {
  const [inputValue, setInputValue] = useState(color);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setInputValue(color);
  }, [color]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);
    if (/^#?([0-9A-F]{3}){1,2}$/i.test(value)) {
      const formattedColor = value.startsWith('#') ? value : `#${value}`;
      onChange(formattedColor);
    }
  };

  const handleInputBlur = () => {
    if (!/^#?([0-9A-F]{3}){1,2}$/i.test(inputValue)) {
      setInputValue(color);
    } else if (!inputValue.startsWith('#')) {
      setInputValue(`#${inputValue}`);
    }
  };

  return (
    <div ref={innerRef} className={`advanced-color-picker ${className}`}>
      <div className="picker-container">
        <HexColorPicker color={color} onChange={onChange} />
      </div>

      {showInput && (
        <div className="picker-controls">
          <div className="hex-input-wrapper">
            <div className="hex-prefix">#</div>
            <input
              ref={inputRef}
              type="text"
              className="hex-input"
              value={inputValue.replace('#', '')}
              onChange={handleInputChange}
              onBlur={handleInputBlur}
              placeholder="000000"
              spellCheck={false}
            />
            <div 
              className="color-preview-dot" 
              style={{ backgroundColor: color }} 
            />
          </div>
        </div>
      )}

      {presets && presets.length > 0 && (
        <div className="picker-presets">
          <div className="presets-grid">
            {presets.map((preset) => (
              <button
                key={preset}
                type="button"
                className={`preset-swatch ${preset.toLowerCase() === color.toLowerCase() ? 'active' : ''}`}
                style={{ backgroundColor: preset }}
                onClick={() => onChange(preset)}
                title={preset}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
