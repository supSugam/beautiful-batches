import React, { useEffect, useRef, useState } from 'react';
import { HexColorPicker } from 'react-colorful';
import './AdvancedColorPicker.css';

interface AdvancedColorPickerProps {
  color: string;
  onChange: (color: string) => void;
  presets?: string[];
  className?: string;
}

export const AdvancedColorPicker: React.FC<AdvancedColorPickerProps> = ({
  color,
  onChange,
  presets = [],
  className = '',
}) => {
  const [inputValue, setInputValue] = useState(color);
  const inputRef = useRef<HTMLInputElement>(null);

  // Update input value when color prop changes
  useEffect(() => {
    setInputValue(color);
  }, [color]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);
    
    // Basic hex validation
    if (/^#?([0-9A-F]{3}){1,2}$/i.test(value)) {
      const formattedColor = value.startsWith('#') ? value : `#${value}`;
      onChange(formattedColor);
    }
  };

  const handleInputBlur = () => {
    // Revert to current color if invalid
    if (!/^#?([0-9A-F]{3}){1,2}$/i.test(inputValue)) {
      setInputValue(color);
    } else if (!inputValue.startsWith('#')) {
      setInputValue(`#${inputValue}`);
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      inputRef.current?.blur();
    }
  };

  return (
    <div className={`advanced-color-picker ${className}`}>
      <div className="picker-container">
        <HexColorPicker color={color} onChange={onChange} />
      </div>

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
            onKeyDown={handleInputKeyDown}
            placeholder="000000"
            spellCheck={false}
          />
          <div 
            className="color-preview-dot" 
            style={{ backgroundColor: color }} 
          />
        </div>
      </div>

      {presets.length > 0 && (
        <div className="picker-presets">
          <div className="presets-label">Colors</div>
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
};
