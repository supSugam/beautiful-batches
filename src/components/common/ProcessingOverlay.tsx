import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Minimize2 } from 'lucide-react';
import useStore from '../../store/useStore';
import blurryGradient from '../../assets/blurry-gradient.svg';
import { TransitioningStatus } from './TransitioningStatus';
import './ProcessingOverlay.css';

export const ProcessingOverlay = () => {
  const processingState = useStore((state) => state.processingState);
  const setProcessingState = useStore((state) => state.setProcessingState);

  const { isMinimized, isActive, current, total, statusText, estimatedTimeRemaining } = processingState;

  const [localEta, setLocalEta] = useState<number | undefined>(undefined);
  
  useEffect(() => {
    setLocalEta(estimatedTimeRemaining);
  }, [estimatedTimeRemaining]);

  useEffect(() => {
    if (localEta === undefined || localEta <= 0 || !isActive) return;

    const timer = setInterval(() => {
      setLocalEta(prev => (prev !== undefined && prev > 1000) ? prev - 1000 : 0);
    }, 1000);

    return () => clearInterval(timer);
  }, [localEta, isActive]);
  
  if (!isActive || isMinimized) return null;

  const toggleMinimize = () => {
    setProcessingState({ isMinimized: !isMinimized });
  };

  const formatDuration = (ms: number) => {
    if (ms <= 0) return 'Almost done';
    const seconds = Math.ceil(ms / 1000);
    if (seconds < 60) return `${seconds}s remaining`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s remaining`;
  };

  return (
    <div className="processing-overlay-hud-v2">
      <div 
        className="processing-hud-backdrop"
        style={{ backgroundImage: `url(${blurryGradient})` }}
      />

      <div className="processing-hud-center-content">
        <div className="processing-hud-header">
          <div className="processing-hud-counter">
            <span className="current">{current}</span>
            <span className="sep">/</span>
            <div className="total-with-label">
              <span className="total">{total}</span>
              <span className="label">images processed</span>
            </div>
          </div>
          
          {localEta !== undefined && current > 0 && current < total && (
            <div className="processing-hud-eta-pill">
              <span className="eta-text">{formatDuration(localEta)}</span>
            </div>
          )}
        </div>
        
        <div className="processing-hud-progress-container">
          <motion.div 
            className="processing-hud-progress-fill"
            initial={{ width: 0 }}
            animate={{ width: `${(current / total) * 100}%` }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          />
        </div>

        <div className="processing-hud-status-area">
          <TransitioningStatus text={statusText} />
        </div>

        <div className="processing-hud-actions">
          <button
            onClick={() => setProcessingState({ isActive: false })}
            className="hud-simple-btn"
          >
            {current < total ? 'Cancel' : 'Done'}
          </button>
        </div>
      </div>

      <button
        onClick={toggleMinimize}
        className="btn-minimize-top-right"
        title="Minimize"
      >
        <Minimize2 size={24} />
      </button>
    </div>
  );
};

export default ProcessingOverlay;
