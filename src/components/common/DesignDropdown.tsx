import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Check, Search } from 'lucide-react';
import './DesignDropdown.css';

export interface DesignDropdownOption {
  value: string;
  label: string;
  description?: string;
  icon?: React.ReactNode;
}

interface DesignDropdownProps {
  value: string;
  options: DesignDropdownOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

const DesignDropdown: React.FC<DesignDropdownProps> = ({
  value,
  options,
  onChange,
  placeholder = 'Select an option',
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const selectedOption = options.find((opt) => opt.value === value);

  const [searchTerm, setSearchTerm] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [dropdownRect, setDropdownRect] = useState<DOMRect | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && containerRef.current) {
      setDropdownRect(containerRef.current.getBoundingClientRect());
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleScroll = () => {
      if (containerRef.current) {
        setDropdownRect(containerRef.current.getBoundingClientRect());
      }
    };
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setSearchTerm('');
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  const filteredOptions = useMemo(() => {
    if (!searchTerm) return options;
    const lower = searchTerm.toLowerCase();
    return options.filter((opt) => 
      opt.label.toLowerCase().includes(lower) || 
      opt.description?.toLowerCase().includes(lower) ||
      opt.value.toLowerCase().includes(lower)
    );
  }, [options, searchTerm]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        containerRef.current && !containerRef.current.contains(target) &&
        (!menuRef.current || !menuRef.current.contains(target))
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className={`design-dropdown ${className}`} ref={containerRef}>
      <button
        type="button"
        className={`design-dropdown-trigger ${isOpen ? 'is-open' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <div className="design-dropdown-trigger-content">
          {selectedOption?.icon && <span className="design-dropdown-icon">{selectedOption.icon}</span>}
          <span className="design-dropdown-label">
            {selectedOption ? selectedOption.label : placeholder}
          </span>
        </div>
        <ChevronDown className={`design-dropdown-chevron ${isOpen ? 'is-rotated' : ''}`} size={14} />
      </button>

      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {isOpen && dropdownRect && (
            <motion.div
              ref={menuRef}
              className="design-dropdown-menu-wrapper"
              style={{
                position: 'fixed',
                top: dropdownRect.bottom + 6,
                left: dropdownRect.left,
                width: dropdownRect.width,
                zIndex: 9999,
              }}
              initial={{ opacity: 0, y: -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
            >
              <div className="design-dropdown-search-row">
                <Search className="design-dropdown-search-icon" size={14} />
                <input
                  ref={searchInputRef}
                  type="text"
                  className="design-dropdown-search-input"
                  placeholder="Search..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
              <ul className="design-dropdown-menu-list" role="listbox">
                {filteredOptions.length === 0 ? (
                  <li className="design-dropdown-item-empty">No results found</li>
                ) : (
                  filteredOptions.map((option) => (
                    <li
                      key={option.value}
                      className={`design-dropdown-item ${value === option.value ? 'is-selected' : ''}`}
                      onClick={() => {
                        onChange(option.value);
                        setIsOpen(false);
                      }}
                      role="option"
                      aria-selected={value === option.value}
                    >
                      <div className="design-dropdown-item-content">
                        {option.icon && <span className="design-dropdown-item-icon">{option.icon}</span>}
                        <div className="design-dropdown-item-text">
                          <span className="design-dropdown-item-label">{option.label}</span>
                          {option.description && (
                            <span className="design-dropdown-item-desc">{option.description}</span>
                          )}
                        </div>
                      </div>
                      {value === option.value && <Check size={14} className="design-dropdown-check" />}
                    </li>
                  ))
                )}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
};

export default React.memo(DesignDropdown);
