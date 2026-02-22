import React, { useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import './TriStateCheckbox.css';

export type TriState = 'unchecked' | 'checked' | 'mixed';

type TriStateCheckboxProps = {
  state: TriState;
  onToggle: (nextChecked: boolean) => void;
  ariaLabel: string;
  title?: string;
  disabled?: boolean;
  className?: string;
};

const TriStateCheckbox = ({
  state,
  onToggle,
  ariaLabel,
  title,
  disabled = false,
  className = '',
}: TriStateCheckboxProps) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isChecked = useMemo(() => state === 'checked', [state]);
  const isMixed = useMemo(() => state === 'mixed', [state]);

  useEffect(() => {
    if (!inputRef.current) return;
    inputRef.current.indeterminate = isMixed;
  }, [isMixed]);

  return (
    <label
      className={`metadata-checkbox-row tri-state-checkbox ${isMixed ? 'is-mixed' : ''} ${disabled ? 'is-disabled' : ''} ${className}`.trim()}
      title={title}
    >
      <input
        ref={inputRef}
        type="checkbox"
        className="metadata-checkbox-input"
        checked={isChecked}
        disabled={disabled}
        onChange={(event) => onToggle(event.target.checked)}
        aria-label={ariaLabel}
      />
      <span className="metadata-checkbox-indicator" aria-hidden="true">
        <motion.svg
          className="metadata-checkbox-mark"
          viewBox="0 0 24 24"
          fill="none"
          initial={false}
          animate={{ opacity: isChecked || isMixed ? 1 : 0.7 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
        >
          {isMixed ? (
            <motion.path
              className="tri-state-checkbox-mixed-path"
              d="M6.5 12h11"
              strokeWidth="2.6"
              strokeLinecap="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
            />
          ) : (
            <motion.path
              className="metadata-checkbox-mark-path"
              d="M5 12l4.5 4.5L19 7"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={false}
              animate={{
                opacity: isChecked ? 1 : 0,
                pathLength: isChecked ? 1 : 0,
              }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
            />
          )}
        </motion.svg>
      </span>
    </label>
  );
};

export default React.memo(TriStateCheckbox);
